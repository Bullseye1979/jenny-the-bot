# Jenny — Discord AI Bot

> **Version:** 1.0 · **Date:** 2026-03-15

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
   - [bard](#bard-flow)
   - [webpage / web modules](#webpage-flow--admin-modules)
   - [webpage](#webpage-flow)
7. [Browser Extension](#browser-extension)
8. [Bard Music System](#bard-music-system)
9. [Module Pipeline](#module-pipeline)
   - [Pre-Processing (00xxx)](#pre-processing-00xxx)
   - [AI Processing (01xxx)](#ai-processing-01xxx)
   - [Output & Post-Processing (02xxx–08xxx)](#output--post-processing-02xxx08xxx)
   - [Final Output (10000)](#final-output-10000)
10. [Tools](#tools)
11. [Core Infrastructure](#core-infrastructure)
   - [main.js — Runner & Dashboard](#mainjs--runner--dashboard)
   - [core/context.js — Conversation Storage](#corecontextjs--conversation-storage)
   - [core/registry.js — In-Memory Store](#coreregistryjs--in-memory-store)
   - [core/logging.js — Structured Logging](#coreloggingjs--structured-logging)
12. [GDPR & Consent](#gdpr--consent)
13. [Macro System](#macro-system)
14. [Channel Configuration & Overrides](#channel-configuration--overrides)
15. [Adding a New Module](#adding-a-new-module)
16. [Adding a New Tool](#adding-a-new-tool)
17. [Slash Commands](#slash-commands)
18. [Dependencies](#dependencies)

---

## Requirements

| Requirement | Version |
|---|---|
| Node.js | 20.x (ESM, `node:` built-ins) |
| MySQL / MariaDB | 8.0 / 10.6 |
| FFmpeg | 6.x (required for voice) |
| ImageMagick `convert` | 7.x (required for `getToken`) |
| Gifsicle | 1.94+ (required for `getToken`) |
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
| `requestTimeoutMs` | number | `1000000` | HTTP request timeout in milliseconds |
| `triggerWordWindow` | number | `3` | Number of words at start of message to scan for trigger |
| `doNotWriteToContext` | boolean | `false` | Skip writing this turn to MySQL context |
| `modAdmin` | string | — | Discord user ID of the bot admin |
| `modSilence` | string | `"[silence]"` | Token that suppresses output if found in response |
| `apiSecret` | string | `""` | Shared secret for the HTTP API token gate. When set, every `POST /api` request must supply `Authorization: Bearer <secret>`. Leave empty to disable token checking. |
| `apiEnabled` | number | `1` | Controls whether this channel can be reached via the HTTP API. `0` = always blocked (regardless of token). `1` = allowed when token matches or no secret is set. Can be overridden per channel via `core-channel-config`. |
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

#### config.webpage-config-editor

> **Replaces the old `config-editor` standalone flow.** The config editor now runs as a **webpage-flow module** (`modules/00047-webpage-config-editor.js`) on a dedicated port within the webpage flow. Add the port to `config.webpage.ports`.

Serves the **JSON config editor SPA** (`GET /config`) — browse and edit every value in `core.json` without touching a text editor. Objects render as collapsible cards, flat arrays as tag chips, secrets as password fields.

**UI controls:**
- **✏ pencil** (in header, only when `_title` exists) — inline-edit the block title
- **×** (in header) — delete an entire block or array (with confirmation)
- **×** (on field row) — delete a single attribute (with confirmation)
- **+ Attribute** (bottom of every object) — prompts for name and initial value, adds a string field
- **+ Block** (bottom of every object) — prompts for name, adds an empty `{}` sub-object
- **+ Add item** (bottom of every object array) — append an empty item

Changes are held in memory until **Save** is clicked (or Ctrl+S). The AI chat has moved to the separate `webpage-chat` module (`GET /chat`).

```jsonc
{
  "webpage": {
    "flowName": "webpage",
    "ports": [3000, 3111]
  },
  "webpage-config-editor": {
    "flow":         ["webpage"],
    "port":         3111,
    "basePath":     "/config",
    "configPath":   "",
    "allowedRoles": ["admin"]
  }
}
```

| Key | Description |
|---|---|
| `flow` | Must include `"webpage"` |
| `port` | HTTP port to listen on (default `3111`) — also add to `config.webpage.ports` |
| `basePath` | URL prefix (default `"/config"`) |
| `configPath` | Absolute path to the JSON file to edit; defaults to `core.json` in the project root |
| `allowedRoles` | Roles allowed to view and save. Empty array = public |

#### config.webpage-chat

Serves the **AI chat SPA** (`GET /chat`) on a dedicated port. The `apiSecret` per channel is injected server-side and is never exposed to the browser.

```jsonc
{
  "webpage-chat": {
    "flow":         ["webpage"],
    "port":         3112,
    "basePath":     "/chat",
    "allowedRoles": ["member", "admin"],
    "apiUrl": "http://localhost:3400/api",
    "chats": [
      { "label": "General",           "channelID": "YOUR_CHANNEL_ID",   "apiSecret": "" },
      { "label": "Browser Extension", "channelID": "browser-extension", "apiSecret": "" }
    ]
  }
}
```

| Key | Description |
|---|---|
| `flow` | Must include `"webpage"` |
| `port` | HTTP port to listen on (default `3112`) — must also be in `config.webpage.ports` |
| `basePath` | URL prefix (default `"/chat"`) |
| `allowedRoles` | Roles allowed to view the chat. Empty array = public |
| `apiUrl` | Default URL of the bot's HTTP API endpoint (default `http://localhost:3400/api`) |
| `chats[].label` | Display name shown in the channel selector dropdown |
| `chats[].channelID` | Channel ID passed to the API as context |
| `chats[].apiSecret` | Bearer token for the API; injected server-side, never sent to the browser |
| `chats[].apiUrl` | Per-chat API URL override; falls back to the global `apiUrl` if omitted |

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
      },
      {
        "id":        "bard-label-gen",
        "cron":      "*/3 * * * *",
        "enabled":   true,
        "channelID": "YOUR_TEXT_CHANNEL_ID"
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
  "turn_id":   "01JXXXXXXXXXXXXXXXXXXXXX",
  "channelID": "optional-channel-id",
  "response":  "The weather in Berlin is..."
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

### bard Flow

**File:** `flows/bard.js`

Headless music scheduler that runs continuously (polling every `pollIntervalMs` ms). No Discord voice connection required.

1. Reads `bard:registry` for active sessions.
2. For each session: reads `bard:labels:{guildId}` (AI mood tags) and `bard:nowplaying:{guildId}`.
3. Compares AI labels to labels active when the track started — switches track if changed.
4. On track end: selects best-fit track using bidirectional position-weighted scoring.
5. Writes `bard:stream:{guildId}` for the browser audio player.

**workingObject fields set:**

| Field | Value |
|---|---|
| `flow` | `"bard"` |
| `guildId` | Guild ID of the session |

---

### webpage Flow + Admin Modules

**Files:** `flows/webpage.js` + all `modules/00041–00054-webpage-*.js` (including `00052-webpage-wiki.js`)

The webpage flow starts **one HTTP server per port** listed in `config.webpage.ports`. Each request exposes `wo.http.port`, allowing modules to route by port.

**⚙ Config Editor** (`modules/00047`, `GET /config`)
- Collapsible cards per object section; flat arrays as tag chips; password fields for secrets; textareas for long strings
- ✏ pencil in card header (when `_title` exists) — inline-edit the section title
- × in header — delete an entire block or array
- × on field row — delete a single attribute
- **+ Attribute** (bottom of every object) — prompts for name and initial value, adds a string field
- **+ Block** (bottom of every object) — prompts for name, adds an empty `{}` sub-object
- **+ Add item** (bottom of every object array) — append an empty item
- After adding, the affected section opens and scrolls into view; scroll position preserved on delete
- `Ctrl + S` to save

**💬 Chat** (`modules/00048`, `GET /chat`)
- Large scrollable chat window with AI; loads the last 100 context entries from MySQL on channel select
- Channel selector dropdown (configured via `chats[]` in `config["webpage-chat"]`)
- Messages proxied server-side — `apiSecret` is never sent to the browser
- Fixed-height textarea with internal scroll; `Enter` sends, `Shift + Enter` adds a newline
- **Markdown rendering** — headings, bold/italic, code blocks, blockquotes, lists, and horizontal rules are fully rendered in chat bubbles
- **Thinking indicator with tool name** — while the bot is processing, the name of the currently active tool (e.g. `getImage`) is displayed next to the animated dots; polled from `/api/toolcall?channelID=<id>` every 800 ms (per-channel, no cross-channel interference)
- **Link parser & media embeds:** URLs become clickable links; YouTube/Vimeo URLs embed an inline player; `.mp4/.webm/.ogg` render a `<video>` player; image URLs render inline (broken images auto-removed)

**📖 AI Wiki** (`modules/00052`, `GET /wiki`)
- Per-channel Fandom-style wiki at `/wiki/{channelId}`; each channel has independent articles
- Search → FULLTEXT MySQL lookup; 0 hits → LLM generates new article + optional DALL-E image
- Single hit → redirect to article; 2+ hits → disambiguation list
- Article page: two-column layout (content + infobox), TOC, categories, See Also links
- Admin role (configurable) sees 🗑 Delete button on article page
- Articles stored in MySQL (`wiki_articles` table, auto-created; `model` column added via migration); the generating LLM model is shown at the bottom of each article page; images at `pub/wiki/{channelId}/images/`
- `allowedRoles: []` = public wiki (no login required)

```jsonc
"webpage-wiki": {
  "flow":     ["webpage"],
  "port":     3117,
  "basePath": "/wiki",
  "overrides": {                              // global defaults for all channels
    "useAiModule":      "completions",
    "model":            "gpt-4o-mini",
    "temperature":      0.7,
    "maxTokens":        4000,
    "maxLoops":         5,
    "requestTimeoutMs": 120000,
    "contextSize":      150,
    "tools":            ["getImage", "getTimeline", "getInformation"],
    "systemPrompt":     "",
    "persona":          "",
    "instructions":     ""
  },
  "channels": [
    {
      "_title":       "My Channel Wiki",
      "channelId":    "YOUR_CHANNEL_ID",
      "allowedRoles": [],
      "adminRoles":   ["admin"],
      "editorRoles":  ["editor"],
      "creatorRoles": ["creator"],
      "maxAgeDays":   7,
      "overrides":    {}                      // optional per-channel overrides; win over global
    }
  ]
}
```

Add `3117` to `config.webpage.ports[]`, `config.webpage-auth.ports[]`, and add `reverse_proxy /wiki* localhost:3117` to your Caddyfile.

**Configuration:** `config["webpage-config-editor"]` and `config["webpage-chat"]` — see the respective config sections above.

#### Adding a new webpage module

Drop a single file into `modules/` — no flow changes needed.

```js
// modules/00049-webpage-myapp.js
export default async function getWebpageMyapp(coreData) {
  const wo  = coreData?.workingObject || {};
  if (wo?.flow !== "webpage") return coreData;

  const cfg  = coreData?.config?.["webpage-myapp"] || {};
  const port = Number(cfg.port ?? 3222);

  /* 1. Always register in nav menu */
  if (Array.isArray(wo.web?.menu)) wo.web.menu.push({ label: "🔧 My App", port, path: "/myapp" });

  /* 2. Only handle our port */
  if (wo.http?.port !== port) return coreData;

  const urlPath = String(wo.http?.path ?? "/").split("?")[0];

  if (wo.http?.method === "GET" && urlPath === "/myapp") {
    wo.http.response = { status: 200, headers: { "Content-Type": "text/html" }, body: "<html>…</html>" };
    wo.web.useLayout = false;
    wo.jump = true;
    return coreData;
  }

  return coreData;  /* unknown path — let other modules handle it */
}
```

Config in `core.json`:
```jsonc
"webpage-myapp": { "flow": ["webpage"], "port": 3222, "label": "🔧 My App" }
```

Add `3222` to `config.webpage.ports`. See **ADMIN_MANUAL §6.8.1** for the full pattern and key rules.

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
| `00005` | discord-status-prepare | Reads current Discord status; prepares AI-generated presence payload |
| `00010` | core-channel-config | Applies hierarchical channel/flow/user config overrides (deep merge) |
| `00019` | bard-voice-gate | Gates discord-voice: halts pipeline when the speaking user is the Bard bot itself (prevents self-transcription) |
| `00020` | discord-channel-gate | Checks if the bot is permitted to respond in this channel |
| `00021` | api-token-gate | Two-stage API gate: blocks when `apiEnabled=0`; verifies Bearer token when `apiSecret` is set |
| `00022` | discord-gdpr-gate | Enforces GDPR consent; sends disclaimer DM on first contact |
| `00025` | discord-admin-gdpr | Handles `/gdpr` management commands |
| `00030` | discord-voice-transcribe | Captures voice audio with VAD filtering; transcribes via Whisper API |
| `00032` | discord-add-files | Extracts file attachment URLs from the Discord message into `wo.fileUrls` |
| `00035` | bard-join | Handles `/bardstart` and `/bardstop` — creates or removes headless bard sessions in the registry |
| `00036` | bard-cron | Prepares the `bard-label-gen` flow: reads chat context, builds priority-ordered tag prompt, passes to `core-ai-completions` |
| `00040` | discord-admin-join | Handles `/join` and `/leave` voice channel commands |
| `00041` | webpage-auth | Discord OAuth2 SSO — passive module; sets `wo.webAuth` (role, userId, username) on every webpage request |
| `00043` | webpage-menu | Sets `wo.web.menu` from `config["webpage-menu"].items[]`, filtered by `wo.webAuth.role` |
| `00045` | webpage-inpaint | Redirects `GET /documents/*.png` to the inpainting port so AI images open directly in the editor |
| `00046` | webpage-bard | Bard library manager SPA (port 3114, `/bard`) — tag editor, preview, Now Playing, Bulk Auto-Tag upload |
| `00047` | webpage-config-editor | Config editor SPA (port 3111, `/config`) — collapsible cards, tag chips, password fields |
| `00048` | webpage-chat | Chat SPA (port 3112, `/chat`) — markdown, media embeds, toolcall indicator, server-side secret injection |
| `00049` | webpage-inpainting | Inpainting SPA (port 3113, `/inpainting`) — brush mask editor, SD proxy, auth gate |
| `00050` | discord-admin-commands | Processes slash commands and DM admin commands |
| `00051` | webpage-dashboard | Live telemetry dashboard (port 3115, `/dashboard`) — flow status, memory, per-module timing |
| `00052` | webpage-wiki | AI-driven Fandom-style wiki (port 3117, `/wiki`) — per-channel articles, DALL-E images, role-based access |
| `00053` | webpage-context | Context DB editor SPA (port 3118, `/context`) — browse, search, search & replace, bulk delete |
| `00054` | webpage-documentation | Documentation browser (port 3116, `/docs`) — renders Markdown files as HTML |
| `00055` | core-admin-commands | Core admin operations (purge, freeze, DB commands) |
| `00060` | discord-admin-avatar | Generates or uploads a new bot avatar via DALL-E or URL |
| `00065` | discord-admin-macro | Personal text-macro management (create, list, delete, run) |
| `00070` | discord-add-context | Loads conversation history from MySQL into the context window |
| `00072` | api-add-context | Loads context for API flow requests |
| `00075` | discord-trigger-gate | Filters messages based on configured trigger words |
| `00080` | discord-reaction-start | Adds a progress reaction emoji to the user's message |

---

### AI Processing (01xxx)

Exactly **one** of the four AI modules below is activated per run, selected by `workingObject.useAiModule`.

| Module | Name | useAiModule value | Description |
|---|---|---|---|
| `01000` | core-ai-completions | `"completions"` | `chat/completions` runner with iterative tool calling and automatic cut-off continuation |
| `01001` | core-ai-responses | `"responses"` | Full Responses API with iterative tool calling, reasoning accumulation, image persistence, finish_reason logging, and automatic cut-off continuation |
| `01002` | core-ai-pseudotoolcalls | `"pseudotoolcalls"` | Text-based pseudo tool calling for local models without native function-call support; finish_reason logging and cut-off continuation |
| `01003` | core-ai-roleplay | `"roleplay"` | Two-pass generation (text + image prompt) with tool calling, finish_reason logging, and automatic cut-off continuation |

All four modules share identical continue logic: `getLooksCutOff` fires regardless of `finish_reason` (local backends often return `"stop"` on truncation); `maxLoops` caps false-positive loops.

#### core-ai-responses (01001) — Detail

This is the primary AI module. It runs a loop of up to `maxLoops` iterations:

1. Translates the context (MySQL history + current payload) into the Responses API format.
2. Calls the Responses API; on each turn:
   - **Tool calls present** → invokes each tool, appends results, loops.
   - **`status === "incomplete"` or `finish_reason === "length"`** → sends a continue turn and loops.
   - **Output looks truncated** (`getLooksCutOff`) → heuristic continue, regardless of `finish_reason`; loops.
   - **Otherwise** → exits loop.
3. Appends any reasoning tokens to `workingObject.reasoningSummary`.
4. Persists images returned by tools to `./pub/documents/`.
5. Sets `workingObject.response` to the accumulated text.

**Logging:** Every turn logs `finish_reason`, `content_length`, and `tool_calls` count. A `Continue triggered` entry is written when continuation fires.

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
| `09300` | webpage-output | Sends the response back to the webpage flow caller |

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
| `getTavily` | Web search via Tavily Search API; supports depth, topic (`general`/`news`/`finance`), time range, and optional AI-generated answer |
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
    "getTavily": {
      "apiKey":      "<tavily-api-key>",
      "searchDepth": "basic",
      "maxResults":  5,
      "topic":       "general",
      "timeoutMs":   20000
    },
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
| `/bardstart` | No | Start the bard music scheduler for this server |
| `/bardstop` | No | Stop the bard music scheduler for this server |
| `/error` | No | Simulate an internal error (testing) |

---

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `discord.js` | ^14.22.1 | Discord client (messages, guilds, voice states) |
| `@discordjs/voice` | ^0.19.0 | Voice connection and audio pipeline |
| `@snazzah/davey` | ^0.1.10 | DAVE E2EE dispatcher (required by `@discordjs/voice` 0.19+); platform binary installed automatically via `optionalDependencies` |
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

## Browser Extension

A Manifest V3 browser extension (Edge / Chrome) is included under `extensions/jenny-extension/`.

### Features

| Feature | Description |
|---|---|
| **Chat UI** | Full chat window with markdown rendering, link embedding, and video playback — identical to the admin panel chat |
| **Summarize button** | One click sends the current tab's URL to the bot with a summarization task (`getWebpage` / `getYoutube`) |
| **Toolcall display** | Active tool name shown next to the animated thinking dots |
| **META frame filtering** | Lines starting with `META|` are stripped from API responses before display; internal context-injection frames are never shown to the user |
| **Options page** | Configure API URL, Channel ID, and API Secret via `chrome.storage` |

### Installation

1. Open `edge://extensions/` (or `chrome://extensions/`).
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** → select `extensions/jenny-extension/`.
4. Accept the **"Read and change all your data on all websites"** permission prompt (`host_permissions: ["<all_urls>"]` is required for the extension to reach the bot's API).

### Configuration (Options page)

| Field | Description |
|---|---|
| **API URL** | Full URL of the bot's API endpoint, e.g. `http://localhost:3400/api` |
| **Channel ID** | Channel the extension talks to; must have `apiEnabled: 1` in `core.json` |
| **API Secret** | Bearer token (leave empty if `apiSecret` is not set on the channel) |

### Bot-side setup (`core.json`)

Add or verify the `browser-extension` channel entry in `core-channel-config.channels`:

```jsonc
{
  "channelMatch": ["browser-extension"],
  "overrides": {
    "apiEnabled": 1,
    "apiSecret":  "",
    "persona":    "You are Jenny, a browser extension assistant. You help users summarize web pages and YouTube videos.",
    "instructions": "When given a URL, use getWebpage or getYoutube to fetch and summarize the content.",
    "contextSize":  70
  }
}
```

And add the chat to `webpage-chat.chats[]` so the admin panel can monitor it:

```jsonc
{ "label": "Browser Extension", "channelID": "browser-extension", "apiSecret": "" }
```

---

## Bard Music System

The Bard is a **headless background music scheduler** for tabletop RPG sessions. It requires no second Discord bot — music is served directly to a browser player.

### How it works

```
/bardstart command
  → Creates a session in the registry (bard:session:{guildId})
  → Seeds bard:labels with ["default"]

Cron job (every N minutes, flow: bard-label-gen)
  → bard-cron: reads chat context, builds AI prompt
  → core-ai-completions: LLM classifies mood as 3 priority-ordered tags
  → bard-label-output: validates tags, writes bard:labels:{guildId}
    (also writes bard:lastrun:{guildId} only on success)

flows/bard.js (polls every 5 s)
  → Reads bard:labels and bard:nowplaying
  → If labels changed → selects best-fit track (bidirectional scoring)
  → Writes bard:stream:{guildId} → browser player picks up change
  → Schedules next poll (ffprobe duration + 200 ms)
```

### Track selection

`getSelectSong` uses **bidirectional position-weighted scoring**:

- AI labels have descending weights: 1st label = N pts, 2nd = N−1, …, last = 1 pt
- Track tags also have descending weights: primary tag = highest weight
- Score = sum of (AI label weight × track tag weight) for each matching pair

This means a track whose primary tag is also the top AI label scores highest.

### Setup

1. Add MP3 files to `assets/bard/` and manage the library at `/bard`
2. Run `/bardstart` in Discord
3. Add a cron job for `bard-label-gen` in `core.json`
4. Open `/bard` in the browser to hear the music

### Slash commands

| Command | Description |
|---|---|
| `/bardstart` | Start the music scheduler for this server |
| `/bardstop` | Stop the music scheduler |

### Registry keys

| Key | Purpose |
|---|---|
| `bard:registry` | List of active session keys |
| `bard:session:{guildId}` | Session state (status, track timer, last played) |
| `bard:labels:{guildId}` | Current AI mood tags |
| `bard:nowplaying:{guildId}` | Track info at time of song start |
| `bard:stream:{guildId}` | Current stream data for browser player |
| `bard:lastrun:{guildId}` | Last successful label-gen timestamp |

---

*Documentation generated 2026-03-09.*
