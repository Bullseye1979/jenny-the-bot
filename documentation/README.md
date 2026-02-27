# Jenny — Discord AI Bot

Jenny is a modular, production-grade Discord AI assistant built on Node.js. It features a pipeline-based module architecture, multi-platform support (Discord, HTTP API, voice), advanced OpenAI integration with full tool-calling, GDPR-compliant consent management, and a live terminal dashboard with hot-reload.

---

## Table of Contents

1. [Requirements](#requirements)
2. [Installation](#installation)
3. [Quick Start](#quick-start)
4. [Architecture Overview](#architecture-overview)
5. [Configuration Reference (`core.json`)](#configuration-reference-corejson)
   - [Root-Level Keys](#root-level-keys)
   - [workingObject](#workingobject)
   - [config](#config)
6. [Flows](#flows)
   - [discord](#discord-flow)
   - [discord-admin](#discord-admin-flow)
   - [discord-voice](#discord-voice-flow)
   - [api](#api-flow)
   - [cron](#cron-flow)
   - [toolcall](#toolcall-flow)
   - [config-editor](#config-editor-flow)
   - [webpage](#webpage-flow)
7. [Module Pipeline](#module-pipeline)
   - [Pre-Processing (00xxx)](#pre-processing-00xxx)
   - [AI Processing (01xxx)](#ai-processing-01xxx)
   - [Output & Post-Processing (02xxx–08xxx)](#output--post-processing-02xxx08xxx)
   - [Final Output (10000)](#final-output-10000)
8. [Tools](#tools)
9. [Core Infrastructure](#core-infrastructure)
   - [main.js — Runner & Dashboard](#mainjs--runner--dashboard)
   - [core/context.js — Conversation Storage](#corecontextjs--conversation-storage)
   - [core/registry.js — In-Memory Store](#coreregistryjs--in-memory-store)
   - [core/logging.js — Structured Logging](#coreloggingjs--structured-logging)
10. [GDPR & Consent](#gdpr--consent)
11. [Macro System](#macro-system)
12. [Channel Configuration & Overrides](#channel-configuration--overrides)
13. [Adding a New Module](#adding-a-new-module)
14. [Adding a New Tool](#adding-a-new-tool)
15. [Slash Commands](#slash-commands)
16. [Dependencies](#dependencies)

---

## Requirements

| Requirement | Version |
|---|---|
| Node.js | ≥ 18 (ESM, `node:` built-ins) |
| MySQL / MariaDB | ≥ 5.7 |
| ffmpeg | Latest (audio processing) |
| OpenAI API key | Required |
| Discord Bot Token | Required |

---

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd jenny-the-bot/development

# Install dependencies
npm install

# Copy and configure
cp core.json.example core.json   # if an example exists, otherwise edit core.json directly
```

Edit `core.json` (see [Configuration Reference](#configuration-reference-corejson)) with at minimum:
- Your Discord bot token
- Your OpenAI API key
- Your MySQL database credentials

---

## Quick Start

```bash
node main.js
```

The terminal dashboard will start, showing live flow status, memory usage, and per-module timing. Jenny watches `core.json` for changes and hot-reloads automatically — no restart required for config edits.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                        main.js                           │
│  Hot-reload • Dashboard • Flow runner • Registry pruner  │
└────────────────────────┬─────────────────────────────────┘
                         │  starts
          ┌──────────────┼──────────────┐
          │              │              │
    ┌─────▼────┐  ┌──────▼─────┐  ┌───▼──────┐  ...
    │ discord  │  │    api     │  │   cron   │
    │  flow    │  │   flow     │  │   flow   │
    └─────┬────┘  └──────┬─────┘  └───┬──────┘
          │              │             │
          └──────────────▼─────────────┘
                  workingObject created
                         │
              ┌──────────▼───────────┐
              │   Module Pipeline    │
              │  00xxx → 01xxx →     │
              │  02xxx → ... → 08xxx │
              └──────────┬───────────┘
                         │
              ┌──────────▼───────────┐
              │  Output Modules      │
              │  Discord / API /     │
              │  Voice / Webhook     │
              └──────────┬───────────┘
                         │
              ┌──────────▼───────────┐
              │  Storage             │
              │  MySQL (context.js)  │
              │  Registry (memory)   │
              └──────────────────────┘
```

Each incoming event (Discord message, HTTP request, cron tick, etc.) creates a **`workingObject`** — a plain JavaScript object that is passed sequentially through every module in the pipeline. Modules read from and write to this object. The pipeline is ordered numerically by module filename prefix.

---

## Configuration Reference (`core.json`)

`core.json` is the single source of truth for the entire bot. It is watched at runtime; saving the file triggers a hot-reload within seconds.

### Root-Level Keys

```jsonc
{
  "workingObject": { ... },   // Runtime defaults & AI configuration
  "config":        { ... }    // Module-specific and flow-specific settings
}
```

---

### workingObject

These values serve as **runtime defaults** for every flow. They can be overridden per-channel, per-flow, or per-user via `config.core-channel-config` (see [Channel Configuration](#channel-configuration--overrides)).

| Key | Type | Default | Description |
|---|---|---|---|
| `botName` | string | `"Jenny"` | The bot's display name and identity |
| `systemPrompt` | string | `"You are a helpful assistant."` | System-level instruction passed to the LLM |
| `persona` | string | `"Default AI Assistant"` | Short persona label |
| `instructions` | string | `"Answer concisely."` | Additional behavioural instructions appended to the system prompt |
| `reasoning` | boolean | `false` | Enable extended reasoning (thinking) output |
| `model` | string | `"gpt-5"` | LLM model identifier |
| `endpoint` | string | OpenAI completions URL | API endpoint for chat completions |
| `endpointResponses` | string | OpenAI responses URL | API endpoint for the Responses API |
| `apiKey` | string | — | OpenAI API key |
| `useAiModule` | string | `"responses"` | Which AI module to use: `"responses"`, `"completions"`, or `"pseudotoolcalls"` |
| `temperature` | number | `0.2` | Sampling temperature (0–2) |
| `maxTokens` | number | `2000` | Maximum tokens in a single LLM response |
| `maxLoops` | number | `15` | Maximum tool-call iterations per turn |
| `maxToolCalls` | number | `7` | Maximum individual tool calls per turn |
| `toolChoice` | string | `"auto"` | Tool-call mode: `"auto"`, `"none"`, `"required"` |
| `tools` | array | See below | List of enabled tool names |
| `includeHistory` | boolean | `true` | Include conversation history in context |
| `includeHistoryTools` | boolean | `false` | Include tool-call history in context |
| `includeRuntimeContext` | boolean | `true` | Inject runtime context (time, user, channel) |
| `detailedContext` | boolean | `true` | Fetch detailed context from MySQL |
| `contextTokenBudget` | number | `60000` | Maximum tokens for conversation history |
| `reasoningSummary` | string | `""` | Accumulated reasoning output (set by AI module) |
| `response` | string | `""` | Final AI response text (set by AI module) |
| `payload` | string | `""` | The user's input message |
| `timezone` | string | `"Europe/Berlin"` | Default timezone for cron/time tools |
| `baseUrl` | string | `""` | Public base URL for generated files (images, etc.) |
| `allowArtifactGeneration` | boolean | `true` | **Currently not implemented** — reserved for a future global on/off switch for image and file generation. Setting this value has no effect. |
| `requestTimeoutMs` | number | `1000000` | HTTP request timeout in milliseconds |
| `triggerWordWindow` | number | `3` | Number of words at start of message to scan for trigger |
| `doNotWriteToContext` | boolean | `false` | Skip writing this turn to MySQL context |
| `modAdmin` | string | — | Discord user ID of the bot admin |
| `modSilence` | string | `"[silence]"` | Token that suppresses output if found in response |
| `gdprDisclaimer` | string | Long legal text | Full GDPR disclaimer sent to users on first interaction |
| `avatarApiKey` | string | — | API key for avatar image generation |
| `avatarEndpoint` | string | DALL-E endpoint | Endpoint for avatar generation |
| `avatarModel` | string | `"dall-e-3"` | Model for avatar generation |
| `avatarSize` | string | `"1024x1024"` | Avatar image dimensions |
| `avatarPrompt` | string | `""` | Prompt prefix for avatar generation |
| `showReactions` | boolean | `true` | Add emoji reactions to messages during processing |
| `fileUrls` | array | `[]` | Attachment URLs extracted from the current message |
| `contextSize` | number | `20` | Number of context rows to load from MySQL |
| `trigger` | string | `"jenny"` | Trigger word that activates the bot |

**Default enabled tools:**
`getGoogle`, `getWebpage`, `getAnimatedPicture`, `getConfluence`, `getYoutube`, `getImage`, `getImageDescription`, `getHistory`, `getText`, `getInformation`, `getJira`, `getLocation`, `getPDF`, `getTime`, `getTimeline`, `getToken`, `getVideoFromText`

---

### config

Module-specific settings live under `config.<module-name>`. The most important sections are described below.

#### config.discord

```jsonc
{
  "discord": {
    "token":    "<your-discord-bot-token>",
    "flowName": "discord"
  }
}
```

| Key | Description |
|---|---|
| `token` | Discord bot token (required) |
| `flowName` | Name of the flow to trigger for each incoming message |

#### config.api

```jsonc
{
  "api": {
    "host":               "0.0.0.0",
    "port":               3400,
    "path":               "/api",
    "toolcallPath":       "/toolcall",
    "toolcallRegistryKey":"status:tool"
  }
}
```

#### config.config-editor

Starts a web-based JSON configuration editor (standalone HTTP server). Open `http://<host>:<port>` in any browser to browse, add, edit, duplicate, and delete every value in `core.json` without touching a text editor.

```jsonc
{
  "config-editor": {
    "port":       3111,
    "host":       "127.0.0.1",
    "token":      "",
    "configPath": ""
  }
}
```

| Key | Description |
|---|---|
| `port` | HTTP port to listen on (default `3111`) |
| `host` | Bind address; use `"127.0.0.1"` for localhost-only or `"0.0.0.0"` for all interfaces |
| `token` | Optional auth token; supply as `Authorization: Bearer <token>` or as the Basic password |
| `configPath` | Absolute path to the JSON file to edit; defaults to `core.json` in the project root |

---

#### config.db / workingObject.db

MySQL connection settings. Can be placed under `workingObject.db` or `config.db`:

```jsonc
{
  "db": {
    "host":     "localhost",
    "port":     3306,
    "user":     "jenny",
    "password": "secret",
    "database": "jenny"
  }
}
```

#### config.context

Settings for conversation summarisation (used by `core/context.js`):

```jsonc
{
  "context": {
    "endpoint":   "https://api.openai.com/v1/chat/completions",
    "model":      "gpt-4o-mini",
    "apiKey":     "<key>",
    "periodSize": 600
  }
}
```

`periodSize` is the rolling window in seconds for timeline summarisation (default 600 s = 10 min).

#### config.cron

```jsonc
{
  "cron": {
    "tickMs":   15000,
    "timezone": "Europe/Berlin",
    "jobs": [
      {
        "id":        "morning-report",
        "cron":      "0 8 * * *",
        "enabled":   true,
        "channelID": "123456789012345678"
      }
    ]
  }
}
```

Supported cron expressions: `* * * * *` (every minute) and `*/N * * * *` (every N minutes).

#### config.core-channel-config

See [Channel Configuration & Overrides](#channel-configuration--overrides).

---

## Flows

Flows are the **entry points** of the pipeline. Each flow is started by `main.js` and handles a specific event source. Flows create a `workingObject`, populate it with event data, and invoke `runFlow()` to execute the module pipeline.

### discord Flow

**File:** `flows/discord.js`

Listens for Discord messages via `discord.js`. On each message:

1. Generates a monotonic ULID as `turn_id`.
2. Maps the Discord `Message` object to `workingObject` fields.
3. Checks for macro invocations (messages tagged with `#Macro#`).
4. Resolves any active voice session in the guild.
5. Calls `runFlow()` → module pipeline executes.

**workingObject fields set:**

| Field | Value |
|---|---|
| `flow` | `"discord"` |
| `turn_id` | ULID string |
| `payload` | Message content |
| `channelID` | Channel ID |
| `userId` | Author's Discord ID |
| `authorDisplayname` | Author's display name |
| `guildId` | Guild (server) ID |
| `isDM` | `true` if direct message |
| `channelType` | Discord channel type integer |
| `message` | Raw Discord `Message` object |
| `clientRef` | Registry key for the Discord client |
| `fileUrls` | Array of attachment URLs |
| `voiceSessionRef` | Registry key for active voice session (if any) |

---

### discord-admin Flow

**File:** `flows/discord-admin.js`

Processes Discord slash commands. Only commands registered in `workingObject["discord-admin"].slash.definitions` are handled. Responses are ephemeral by default.

---

### discord-voice Flow

**File:** `flows/discord-voice.js`

Handles voice channel audio:
1. Records audio frames into a voice session (stored in registry).
2. Transcribes audio using Whisper via module `00030-discord-voice-transcribe`.
3. Runs the full module pipeline.
4. Synthesises a TTS reply via module `08100-discord-voice-tts`.

---

### api Flow

**File:** `flows/api.js`

Starts an HTTP server (default port **3400**).

**Endpoints:**

| Method | Path | Description |
|---|---|---|
| `POST` | `/api` (configurable) | Submit a request; returns JSON `{ turn_id, response }` |
| `GET` | `/toolcall` (configurable) | Poll tool-call status from registry |

**POST `/api` request body:**

```jsonc
{
  "payload":   "What is the weather in Berlin?",
  "channelID": "optional-channel-id",
  "userId":    "optional-user-id"
}
```

**POST `/api` response:**

```jsonc
{
  "turn_id":  "01JXXXXXXXXXXXXXXXXXXXXX",
  "id":       "optional-channel-id",
  "response": "The weather in Berlin is..."
}
```

---

### cron Flow

**File:** `flows/cron.js`

Runs scheduled jobs defined in `config.cron.jobs`. On each tick (default every 15 s), checks all enabled jobs for their next-due time and fires the configured flow.

---

### toolcall Flow

**File:** `flows/toolcall.js`

Watches the `status:tool` registry key. When a tool-call result is deposited into the registry, this flow triggers, allowing deferred or async tool execution to feed back into the pipeline.

---

### config-editor Flow

**File:** `flows/config-editor.js`

Starts a standalone HTTP server that serves a single-page application (SPA) for editing `core.json` through a browser UI. Unlike all other flows, this flow does **not** run the module pipeline; it starts the server once and returns immediately.

**Features:**
- Left sidebar tree: sections `{}` as expandable nodes; object arrays `[{…}]` as tree items at the same level
- Right panel: inline editing of primitives, tag/chip editors for primitive arrays, navigation links for sub-sections
- Add Attribute / Section / Object Array / Tag Array per section
- Duplicate and Delete on every tree node and array item
- Keyboard shortcut `Ctrl + S` / `⌘ S` to save
- Fully responsive — works on mobile via a hamburger sidebar
- Optional Bearer / Basic password authentication via `config["config-editor"].token`

**Configuration:** `config["config-editor"]` — see [config.config-editor](#configconfig-editor).

---

### webpage Flow

**File:** `flows/webpage.js`

Uses Puppeteer to render web pages and extract their content (screenshot + DOM). The extracted content is injected into `workingObject` for processing by the module pipeline.

---

## Module Pipeline

Modules are loaded from the `modules/` directory and executed in ascending numeric order based on their filename prefix. The naming convention is:

```
[NUMBER]-[PREFIX]-[NAME].js
```

Modules numbered **0–8999** run in the **main phase**. Modules numbered **9000+** run in the **jump phase** (after main-phase modules complete). Each module exports a default async function:

```js
export default async function myModule(coreData) {
  const { workingObject, logging } = coreData;
  // read from workingObject, write results back
}
```

A module can halt pipeline execution by setting `workingObject.stop = true`.

---

### Pre-Processing (00xxx)

| Module | Name | Description |
|---|---|---|
| `00005` | discord-status-prepare | Reads current Discord status; prepares status update payload |
| `00010` | core-channel-config | Applies hierarchical channel/flow/user config overrides (deep merge) |
| `00020` | discord-channel-gate | Checks if the bot is permitted to respond in this channel |
| `00022` | discord-gdpr-gate | Enforces GDPR consent; sends disclaimer on first contact |
| `00025` | discord-admin-gdpr | Handles admin GDPR management commands |
| `00030` | discord-voice-transcribe | Transcribes voice audio using the Whisper API |
| `00032` | discord-add-files | Extracts file attachments and URLs from the Discord message |
| `00040` | discord-admin-join | Handles bot join/leave commands |
| `00045` | webpage-inpaint | Image inpainting for web content |
| `00050` | discord-admin-commands | Processes slash commands and DM admin commands |
| `00055` | core-admin-commands | Core admin operations (purge, freeze, DB commands) |
| `00060` | discord-admin-avatar | Generates or uploads a new bot avatar via DALL-E or URL |
| `00065` | discord-admin-macro | Personal text-macro management (create, list, delete, run) |
| `00070` | discord-add-context | Loads conversation history from MySQL into the context window |
| `00072` | api-add-context | Loads context for API flow requests |
| `00075` | discord-trigger-gate | Filters messages based on configured trigger words |
| `00080` | discord-reaction-start | Adds a progress reaction emoji to the user's message |

---

### AI Processing (01xxx)

Exactly **one** of the three AI modules below is activated per run, selected by `workingObject.useAiModule`.

| Module | Name | useAiModule value | Description |
|---|---|---|---|
| `01000` | core-ai-completions | `"completions"` | Simple `chat/completions` runner; no tool calling |
| `01001` | core-ai-responses | `"responses"` | Full Responses API with iterative tool calling, reasoning accumulation, image persistence |
| `01002` | core-ai-pseudotoolcalls | `"pseudotoolcalls"` | Text-based pseudo tool calling without native API tools |
| `01003` | core-ai-roleplay | — | Character/persona injection for roleplay scenarios |

#### core-ai-responses (01001) — Detail

This is the primary AI module. It runs a loop of up to `maxLoops` iterations:

1. Translates the context (MySQL history + current payload) into the Responses API format.
2. Calls the LLM.
3. If the response contains tool calls, invokes each tool, appends results, and loops.
4. Once no more tool calls are present (or budget is exhausted), sets `workingObject.response`.
5. Appends any reasoning tokens to `workingObject.reasoningSummary`.
6. Persists images returned by tools to `./pub/documents/`.

---

### Output & Post-Processing (02xxx–08xxx)

| Module | Name | Description |
|---|---|---|
| `02000` | moderation-output | Content filtering; can suppress or replace the response |
| `03000` | discord-status-apply | Applies the prepared Discord status/presence update |
| `07000` | core-add-id | Tags the response with a context ID before writing to MySQL |
| `08000` | discord-text-output | Formats and sends the response as a Discord embed; creates reasoning thread |
| `08100` | discord-voice-tts | Synthesises TTS audio with speaker-tagged voice selection |
| `08200` | discord-reaction-finish | Removes the progress reaction; adds a completion reaction |
| `08300` | webpage-output | Sends the response back to the webpage flow caller |

#### discord-text-output (08000) — Detail

- Renders the user's question as a Markdown code block inside a Discord embed.
- Truncates the response to Discord's 4 096-character embed limit.
- Extracts the first image URL from the response and sets it as the embed image.
- If `workingObject.reasoningSummary` is non-empty, creates a thread and posts the reasoning there.
- Supports webhook delivery for large responses.

---

### Final Output (10000)

| Module | Name | Description |
|---|---|---|
| `10000` | core-output | Universal logger; writes the final `workingObject` to disk for debugging |

---

## Tools

Tools are callable functions that the LLM can invoke during a turn. They are defined in `tools/` and registered by name in `workingObject.tools`.

Each tool file exports:

```js
export default {
  name:       "getGoogle",         // must match entry in workingObject.tools
  definition: { type: "function", function: { name, description, parameters } },
  invoke:     async (args, workingObject) => { /* ... */ return result }
};
```

### Available Tools

| Tool | Description |
|---|---|
| `getGoogle` | Google Custom Search API; returns titles, snippets, and links |
| `getWebpage` | Fetches and parses a web page; returns extracted text |
| `getImage` | Generates images via OpenAI Images API; persists to `./pub/documents/` |
| `getImageDescription` | Analyses an image URL using the Vision API |
| `getImageSD` | Generates images via Stable Diffusion |
| `getAnimatedPicture` | Animates a still image into a short video (WAN/Replicate) |
| `getVideoFromText` | Generates a video from a text prompt (Veo-3/Replicate) |
| `getYoutube` | Extracts transcripts from YouTube videos |
| `getJira` | Queries Jira projects and issues |
| `getConfluence` | Retrieves Confluence pages |
| `getPDF` | Generates a PDF from HTML content and delivers a public URL |
| `getHistory` | Retrieves and summarises conversation history from MySQL |
| `getText` | Generates a plain-text file and delivers a public URL |
| `getInformation` | Clusters and retrieves information from the context log |
| `getLocation` | Geolocation, Google Maps, and Street View look-up |
| `getTime` | Current time and timezone information |
| `getTimeline` | Historical timeline generation from context data |
| `getToken` | Converts an image or video into an animated GIF token |
| `getBan` | Issues user bans (admin-only) |

### Tool Configuration

Tool-specific settings go under `workingObject.toolsconfig.<toolName>`:

```jsonc
{
  "toolsconfig": {
    "getGoogle": {
      "apiKey": "<google-api-key>",
      "cseId":  "<custom-search-engine-id>",
      "num":    5
    },
    "getImage": {
      "model":           "dall-e-3",
      "size":            "1024x1024",
      "publicBaseUrl":   "https://yourserver.example.com/",
      "targetLongEdge":  1152
    }
  }
}
```

---

## Core Infrastructure

### main.js — Runner & Dashboard

`main.js` is the application entry point. It:

1. **Loads `core.json`** and starts all configured flows.
2. **Watches `core.json`** with `fs.watch`; on change, reloads config and reinitialises flows (hot-reload).
3. **Executes the module pipeline** for each flow invocation:
   - Loads module files dynamically (with cache-busting imports).
   - Runs modules in numeric order; supports a two-phase approach (main 0–8999, jump 9000+).
   - Tracks per-module timing, success/error state.
4. **Renders a live dashboard** to the terminal every second showing:
   - All active flows with ULID, phase, current module, elapsed time.
   - ASCII progress bar per flow.
   - System memory (RSS / heap).
   - Last 10 completed flows with their final status.
5. **Prunes the registry** to keep only the last 10 finished flows.

---

### core/context.js — Conversation Storage

Manages persistent conversation history in MySQL.

**Table schema (`context`):**

| Column | Type | Description |
|---|---|---|
| `ctx_id` | BIGINT AUTO_INCREMENT | Primary key |
| `ts` | BIGINT | Unix timestamp (ms) |
| `id` | VARCHAR | Channel ID |
| `json` | MEDIUMTEXT | Full message JSON |
| `text` | TEXT | Plain-text content |
| `role` | VARCHAR | `user` or `assistant` |
| `turn_id` | VARCHAR | ULID of the conversation turn |
| `frozen` | TINYINT | 1 = protected from deletion |

**Key behaviours:**

- **Monotonic IDs:** Ensures rows are always inserted in strict order.
- **Rolling timeline summaries:** Messages are grouped into `periodSize`-second windows. After a period closes, a summary is generated via the configured LLM and replaces the raw messages.
- **Token budget:** Context is trimmed (dropping only the last user message per trim step) until it fits within `contextTokenBudget`.
- **User blocking:** When a user is blocked, their token budget is capped at 1.
- **Extra channels:** Messages from additional channels can be included as quoted context.

**Exported functions:**

```js
import {
  getAddContext,   // Load history into workingObject
  getWriteContext, // Persist the current turn to MySQL
  getDeleteContext // Delete messages for a channel
} from "./core/context.js";
```

---

### core/registry.js — In-Memory Store

A lightweight key-value store for ephemeral runtime data (voice sessions, tool-call tracking, client references, etc.).

```js
import { setItem, getItem, delItem, listKeys } from "./core/registry.js";

setItem("my-key", { data: 123 }, 3600); // TTL in seconds
const val = getItem("my-key");
delItem("my-key");
const keys = listKeys("prefix:");
```

| Feature | Detail |
|---|---|
| TTL | Global default: 7 days; per-item override supported |
| LRU eviction | Optional; max 100 000 entries |
| GC interval | Every 1 second |
| Touch-on-read | LRU timestamp updated on `getItem` |

---

### core/logging.js — Structured Logging

Appends structured log entries to `workingObject.logging[]`.

```js
import { getLog } from "./core/logging.js";

const log = getLog("my-module");
log.info("Processing started", { userId });
log.warn("Rate limit hit");
log.error("API call failed", err);
```

Log entries include: `level`, `prefix`, `name`, `message`, `timestamp`, optional `context` object.

---

## GDPR & Consent

Jenny ships with a full GDPR consent workflow compliant with EU Regulation 2016/679 and the German BDSG.

**How it works:**

1. On first interaction in a channel, the bot sends the user a **private DM** containing the full GDPR disclaimer (`workingObject.gdprDisclaimer`).
2. The user's `disclaimer` flag is set to `1` in the `gdpr_consent` MySQL table.
3. Processing is blocked until the user explicitly opts in using the slash commands below.

**Slash commands:**

| Command | Effect |
|---|---|
| `/gdpr text 1` | Enable text (chat) processing for this channel |
| `/gdpr text 0` | Disable text processing for this channel |
| `/gdpr voice 1` | Enable voice processing for this channel |
| `/gdpr voice 0` | Disable voice processing for this channel |

**MySQL table (`gdpr_consent`):**

| Column | Description |
|---|---|
| `user_id` | Discord user ID |
| `channel_id` | Discord channel ID |
| `chat` | 1 = text consent granted |
| `voice` | 1 = voice consent granted |
| `disclaimer` | 1 = disclaimer has been seen |
| `updated_at` | Last update timestamp |

---

## Macro System

Users can save personal text macros that expand when a message is prefixed with the macro name.

**Management (via `/macro` slash command):**

| Subcommand | Description |
|---|---|
| `/macro create <name> <text>` | Create or update a macro |
| `/macro delete <name>` | Delete a macro |
| `/macro list` | List all personal macros |

**Usage:**
Type the macro name at the start of any message. The bot expands the macro before processing.

Macros are stored per-user in the registry with a configurable TTL.

---

## Channel Configuration & Overrides

The `core-channel-config` module applies a **three-level hierarchy** of overrides to `workingObject` before the AI module runs.

```
Channel-level override
  └── Flow-level override
        └── User-level override
```

Configuration in `core.json`:

```jsonc
{
  "config": {
    "core-channel-config": {
      "channels": [
        {
          "channelMatch": ["123456789012345678", "general"],
          "overrides": {
            "temperature": 0.7,
            "systemPrompt": "You are a creative writing assistant."
          },
          "flows": [
            {
              "flowMatch": ["discord"],
              "overrides": {
                "maxTokens": 4000
              },
              "users": [
                {
                  "userMatch": ["406901027665870848"],
                  "overrides": {
                    "tools": ["getGoogle", "getImage"]
                  }
                }
              ]
            }
          ]
        }
      ]
    }
  }
}
```

**Merge rules:**

- **Plain objects** are deep-merged (nested keys are combined).
- **Arrays** are replaced entirely (not merged).
- **Last matching rule wins** — rules are applied in order; later matches overwrite earlier ones.
- Channel and flow matching is **case-insensitive**; user matching is **case-sensitive**.

---

## Adding a New Module

1. Create a file in `modules/` with the naming pattern `[NUMBER]-[PREFIX]-[NAME].js`. Choose a number that places it correctly in the pipeline order.

2. Export a default async function:

```js
// modules/04500-myprefix-mymodule.js

export default async function getMyModule(coreData) {
  const { workingObject } = coreData;

  // Guard: only run for the discord flow
  if (workingObject.flow !== "discord") return;

  // Do work
  const result = await doSomething(workingObject.payload);
  workingObject.myResult = result;

  // Optionally stop the pipeline
  // workingObject.stop = true;
}
```

3. Register the module in `core.json` under the appropriate flow's module list (if flow-based subscriptions are configured), or it will run for all flows by default.

---

## Adding a New Tool

1. Create a file in `tools/myTool.js`:

```js
export default {
  name: "myTool",

  definition: {
    type: "function",
    function: {
      name: "myTool",
      description: "What this tool does, in one sentence.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query"
          }
        },
        required: ["query"]
      }
    }
  },

  invoke: async (args, workingObject) => {
    const { query } = args;
    const apiKey = workingObject?.toolsconfig?.myTool?.apiKey;
    // perform work ...
    return { ok: true, result: "..." };
  }
};
```

2. Add the tool name to `workingObject.tools` in `core.json`:

```jsonc
{
  "workingObject": {
    "tools": ["getGoogle", "getWebpage", "myTool"]
  }
}
```

3. Add any tool-specific config under `workingObject.toolsconfig.myTool`.

---

## Slash Commands

Jenny registers slash commands via the `discord-admin` flow. Commands are defined in `workingObject["discord-admin"].slash.definitions`.

### Built-in Commands

| Command | Admin Only | Description |
|---|---|---|
| `/macro create <name> <text>` | No | Create or update a personal macro |
| `/macro delete <name>` | No | Delete a personal macro |
| `/macro list` | No | List personal macros |
| `/avatar prompt <text>` | Yes | Generate a new bot avatar from a prompt |
| `/avatar url <url>` | Yes | Set bot avatar from a URL |
| `/avatar regen` | Yes | Regenerate avatar using current prompt |
| `/purge [count]` | Yes | Delete the last N messages in the channel |
| `/purgedb` | Yes | Purge conversation history from MySQL |
| `/freeze` | Yes | Freeze (protect) the last message in MySQL |
| `/gdpr text <0\|1>` | No | Toggle GDPR consent for text processing |
| `/gdpr voice <0\|1>` | No | Toggle GDPR consent for voice processing |
| `/join` | No | Bot joins your current voice channel |
| `/leave` | No | Bot leaves the voice channel |
| `/error` | No | Simulate an internal error (testing) |

---

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `discord.js` | ^14.22.1 | Discord client (messages, guilds, voice states) |
| `@discordjs/voice` | ^0.18.0 | Voice connection and audio pipeline |
| `@discordjs/opus` | ^0.10.0 | Opus audio codec |
| `opusscript` | ^0.0.8 | Pure-JS Opus fallback |
| `prism-media` | ^1.3.5 | Audio transcoding for Discord voice |
| `fluent-ffmpeg` | ^2.1.3 | Audio processing (OggOpus → MP3) |
| `mysql2` | ^3.15.1 | MySQL database driver (Promise API) |
| `axios` | ^1.13.1 | HTTP client for API calls |
| `node-fetch` | ^2.7.0 | Fetch API polyfill |
| `nanoid` | ^5.1.6 | Unique ID generation (ULIDs) |
| `cron-parser` | ^5.4.0 | Cron expression parsing |
| `puppeteer` | ^24.27.0 | Headless browser (webpage flow) |
| `youtube-transcript-plus` | ^1.1.1 | YouTube transcript extraction |
| `fs` | ^0.0.1-security | Node.js file system (explicit dep) |

---

*Documentation generated 2026-02-26.*
