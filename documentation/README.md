# Jenny — Discord AI Bot

> **Version:** 1.0 · **Date:** 2026-04-05

Jenny is a modular, production-grade Discord AI assistant built on Node.js. It features a pipeline-based module architecture, multi-platform support (Discord, HTTP API, voice, browser voice interface), advanced OpenAI integration with full tool-calling, GDPR-compliant consent management with a self-service data-export portal, a live terminal dashboard with hot-reload, and a web-based image gallery. A first-run setup wizard eliminates manual `core.json` creation.

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
   - [core/secrets.js — Centralized Secret Store](#coresecretsjs--centralized-secret-store)
   - [core/fetch.js — HTTP Timeout Wrapper](#corefetchjs--http-timeout-wrapper)
   - [shared/webpage/ — Shared Web Helpers](#sharedwebpage--shared-web-helpers)
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
```

### First-run Setup Wizard

If `core.json` does not exist, run `node main.js` and open `http://localhost:3400/setup` in your browser. The wizard collects the minimum required values (OpenAI API key, database credentials, bot name, trigger word, Discord token) and writes a starter `core.json`. Restart the bot after the wizard completes.

### Manual setup

Copy the example and fill in the placeholders:

```bash
cp core.json.example core.json
```

Required fields:
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

### Architecture Compliance Baseline (v1.0)

The current codebase follows these baseline rules:

- Modules and tools import reusable logic from `core/` or `shared/`, not from other modules/tools.
- Modules and tools read their own configuration section (`toolsconfig.<toolName>` or `config.<moduleName>`) and shared runtime defaults from `workingObject`.
- Tool contracts are defined in `manifests/*.json`; runtime behavior must stay aligned with those manifests.
- Secrets are resolved via `core/secrets.js` (`getSecret`) instead of plaintext values.
- File writes from tools should use helpers in `core/file.js`.
- LLM requests from tools/modules are routed through the internal API (`http://localhost:3400`) unless the feature is explicitly non-LLM (for example image/video generation or transcription providers).
- Public tool parameters should use camelCase. Legacy snake_case aliases may still be accepted for backward compatibility.

Subagent orchestration updates are standardized as **1.0**, including async spawn/resume behavior (`getSubAgent`, `getAgentResume`) and explicit project-context continuation.

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
| `contextChannelID` | string | `""` | Override the channel ID used for context reads/writes; when set, context is stored under this ID instead of `channelID` |
| `skipAiCompletions` | boolean | `false` | When `true`, `core-ai-completions` exits immediately without calling the LLM |
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
`getGoogle`, `getWebpage`, `getAnimatedPicture`, `getConfluence`, `getYoutube`, `getImage`, `getImageDescription`, `getHistory`, `getText`, `getInformation`, `getJira`, `getLocation`, `getPDF`, `getTime`, `getToken`, `getVideoFromText`

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

> **Replaces the old `config-editor` standalone flow.** The config editor now runs as a **webpage-flow module** (`modules/00044-webpage-config-editor.js`) on a dedicated port within the webpage flow. Add the port to `config.webpage.ports`.

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

Serves the **AI chat SPA** (`GET /chat`) on a dedicated port. `00048-webpage-chat` is a pure HTTP handler — it sets up the `workingObject` (channelID, payload, systemPrompt, persona, instructions, contextSize) and returns. The AI pipeline modules (01000–01003) then handle the AI call naturally. Subchannels allow scoped conversation threads per channel, stored in the `chat_subchannels` DB table.

```jsonc
{
  "webpage-chat": {
    "flow":         ["webpage"],
    "port":         3112,
    "basePath":     "/chat",
    "allowedRoles": ["member", "admin"],
    "systemPrompt": "",
    "contextSize":  20,
    "maxTokens":    1024,
    "chats": [
      { "label": "General", "channelID": "YOUR_CHANNEL_ID", "roles": [] }
    ]
  }
}
```

| Key | Description |
|---|---|
| `flow` | Must include `"webpage"` |
| `port` | HTTP port (default `3112`) |
| `basePath` | URL prefix (default `"/chat"`) |
| `allowedRoles` | Roles allowed to access the chat. Empty = public |
| `systemPrompt` | Optional system prompt prepended to every AI call (default `""`) |
| `contextSize` | Recent user turns to include in AI context (default `20`) |
| `maxTokens` | Max tokens in AI response (default `1024`) |
| `chats[].label` | Display name in the channel selector |
| `chats[].channelID` | Channel ID used as context scope |
| `chats[].roles` | Optional role restriction for this chat entry |

> AI credentials (`apiKey`, `model`, `endpoint`) are read from the workingObject — the same global bot config used by all channels. No separate `ai.*` section is needed in `webpage-chat`.

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
    "periodSize": 600,
    "subchannelFallback": false
  }
}
```

`periodSize` is the rolling window in seconds for timeline summarisation (default 600 s = 10 min).

| Key | Description |
|---|---|
| `endpoint` | LLM endpoint used by the context summariser |
| `model` | Model used for rolling timeline summarisation |
| `apiKey` | API key for the summariser |
| `periodSize` | Rolling window in seconds; messages older than this are summarised |
| `subchannelFallback` | `false` (default): when `wo.subchannel` is not set, all functions (getContext, setPurgeContext, setFreezeContext, getContextLastSeconds, getContextSince) operate only on rows where `subchannel IS NULL`. `true`: no subchannel filter — all rows for the channel including subchannel rows are included. |

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
| `POST` | `/api` (configurable) | Submit a synchronous request; returns JSON `{ turn_id, response }` |
| `GET` | `/toolcall` (configurable) | Poll tool-call status from registry |
| `POST` | `/api/spawn` | Spawn an async subagent job; returns `{ ok, jobId, projectId }` immediately |
| `GET` | `/api/jobs?channelID=<id>` | List async jobs whose `callerChannelId` matches the given channel |
| `GET` | `/context?channelID=<id>` | Read recent conversation history for a channel |

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

### discord-subagent-poll Flow

**File:** `flows/discord-subagent-poll.js`

Background poller that detects completed async subagent jobs and delivers their results back to the originating Discord channel.

1. Starts a `setInterval` on bot startup (disabled unless `config["discord-subagent-poll"].enabled = true`).
2. On each tick, scans all `job:*` registry keys.
3. Jobs with `status: "running"` are left alone (expired jobs older than `maxJobAgeMs` are marked `error`).
4. Jobs with `status: "done"` or `"error"` whose `callerFlow` matches `callerFlowPattern` are picked up.
5. The job entry is removed from the registry, then a full Discord pipeline pass is run with `wo.deliverSubagentJob` set — causing the result to be posted to `wo.channelID = job.callerChannelId`.

Activate by setting `config["discord-subagent-poll"].enabled = true` in `core.json`. See [getSubAgent](#getsubagent) for the full async job lifecycle.

### Subagent Orchestration (getSubAgent / getAgentResume)

Subagent execution is asynchronous by design and is routed through the internal API on port `3400`.

**Operational model (v1.0):**

1. Parent assistant calls `getSubAgent` with `{ type, task }`.
2. The tool resolves the target virtual channel from `toolsconfig.getSubAgent.types`.
3. The tool posts a spawn request to `/api/spawn` and returns immediately with `{ ok, jobId, projectId, status: "started" }`.
4. The subagent runs in an isolated channel config (own tools, prompts, limits).
5. `discord-subagent-poll` detects completion and delivers the final result into the original Discord channel.

**Resume flow (v1.0):**

- `getAgentResume` continues an existing async project by `projectId`.
- It resolves target routing from `toolsconfig.getAgentResume.types` and starts a new async spawn on the mapped channel.
- Resume does not require re-sending prior artifacts if they are already part of project context.

**Configuration boundaries:**

- `getSubAgent` reads only `toolsconfig.getSubAgent` + runtime `workingObject`.
- `getAgentResume` reads only `toolsconfig.getAgentResume` + runtime `workingObject`.
- Both tools authenticate via `apiSecret` placeholders resolved through `core/secrets.js`.

**Canonical payload keys (camelCase):**

- `channelId` (legacy alias: `channel_id`)
- `orchestration.globalGoal`, `yourTask`, `yourRole`, `doOnly`, `doNot`, `existingArtifacts`, `assignedToOthers`, `toolLocks`

Legacy snake_case aliases are still accepted for backward compatibility, but new callers should use camelCase.

---

### bard Flow

**File:** `flows/bard.js`

Headless music scheduler that runs continuously (polling every `pollIntervalMs` ms). No Discord voice connection required.

1. Reads `bard:registry` for active sessions.
2. For each session: reads `bard:labels:{guildId}` (AI mood tags) and `bard:nowplaying:{guildId}`.
3. Compares AI labels directly against the current track's own tags (`getShouldSwitch`): switches if location/situation changed or >50% of the track's mood tags are gone. Empty AI values = "unknown" → that position skipped.
4. On track end: selects best-fit track using bidirectional position-weighted scoring.
5. Writes `bard:stream:{guildId}` for the browser audio player.

**workingObject fields set:**

| Field | Value |
|---|---|
| `flow` | `"bard"` |
| `guildId` | Guild ID of the session |

---

### webpage Flow + Admin Modules

**Files:** `flows/webpage.js` + all `modules/00007-webpage-router.js`, `00041–00054-webpage-*.js`

The webpage flow starts **one HTTP server per port** listed in `config.webpage.ports`. Each request exposes `wo.http.port`, allowing modules to route by port.

**Endpoint → flow routing (`webpage-router`):** Module `00007-webpage-router` maps port + path prefix combinations to named flows (e.g. `"webpage-voice"`, `"webpage-wiki"`) and sets `wo.channelID` before `core-channel-config` runs. This lets `core-channel-config` `flows[].flowMatch` entries apply per-endpoint AI overrides. Configured in `config["webpage-router"].routes[]`.

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
- Large scrollable chat window with AI; `00048` is a pure HTTP handler — it sets up `workingObject` fields (channelID, payload, systemPrompt, persona, instructions, contextSize) and returns; AI pipeline modules (01000–01003) handle the actual AI call
- Channel selector dropdown (configured via `chats[]` in `config["webpage-chat"]`); subchannel selector for scoped conversation threads
- Fixed-height textarea with internal scroll; `Enter` sends, `Shift + Enter` adds a newline
- **Markdown rendering** — headings, bold/italic, code blocks, blockquotes, lists, and horizontal rules are fully rendered in chat bubbles
- **Thinking indicator with tool name** — while the bot is processing, the name of the currently active tool (e.g. `getImage`) is displayed next to the animated dots; the chat frontend holds a persistent SSE connection to `GET <basePath>/api/toolstatus/stream?channelID=<id>` and receives a push event only when the active tool name changes (no per-tick polling from the browser)
- **Link parser & media embeds:** URLs become clickable links; YouTube/Vimeo URLs embed an inline player; `.mp4/.webm/.ogg` render a `<video>` player; image URLs render inline (broken images auto-removed)

**📖 AI Wiki** (`modules/00052`, `GET /wiki`)
- Per-channel Fandom-style wiki at `/wiki/{channelId}`; each channel has independent articles
- Search → FULLTEXT MySQL lookup; 0 hits → LLM generates new article + optional DALL-E image
- Single hit → redirect to article; 2+ hits → disambiguation list
- Article page: two-column layout (content + infobox), TOC, categories, See Also links
- Admin role (configurable) sees 🗑 Delete button on article page
- Articles stored in MySQL (`wiki_articles` table, auto-created; `model` column added via migration); the generating LLM model is shown at the bottom of each article page; images at `pub/wiki/{channelId}/images/`
- `allowedRoles: []` = public wiki (no login required)
- AI calls are made via **HTTP POST to the internal API flow** (`cfg.apiUrl`, defaults to `http://localhost:3400/api`) — no direct import of AI modules. Wiki channel AI config (systemPrompt, tools, model, etc.) lives in `core.json` api-channel-config. `cfg.apiUrl` in `core.json["webpage-wiki"]` configures the endpoint.

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
    "tools":            ["getImage", "getInformation"],
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

**🎤 Browser Voice Interface** (`modules/00047-webpage-voice`, `GET /voice`, port 3119)
- **Mic button (always-on mode):** Click once to start continuous listening. Audio is sent automatically on silence, transcribed, processed by the AI pipeline, and the MP3 response is played back in the browser. Click again to stop.
- **REC button (meeting recorder):** Records the full session. On stop, transcribes with `gpt-4o-transcribe` + optional speaker diarization and stores the result in channel context. Returns `{ ok, words, speakers }`.
- Channel dropdown populated from `config["webpage-voice"].channels[]`; persisted in `localStorage`
- Access controlled via `allowedRoles[]`; add `3119` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`

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
| `00011` | webpage-channel-config | Stores the parsed `webpage-chat.chats[]` channel list in `wo._webpageChannelConfig` so downstream modules (e.g. `00048`) can read it without accessing foreign config keys |
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
| `00047` | webpage-config-editor | Config editor SPA (port 3111, `/config`) — collapsible cards, tag chips, password fields (Version 1.0) |
| `00048` | webpage-chat | Chat SPA (port 3112, `/chat`) — pure HTTP handler; sets up `wo` (channelID, payload, systemPrompt, persona, instructions, contextSize) and returns; AI pipeline modules (01000–01003) handle the AI call naturally |
| `00049` | webpage-inpainting | Inpainting SPA (port 3113, `/inpainting`) — brush mask editor, SD proxy, auth gate |
| `00050` | discord-admin-commands | Processes slash commands and DM admin commands |
| `00051` | webpage-dashboard | Live telemetry dashboard (port 3115, `/dashboard`) — flow status, memory, per-module timing |
| `00052` | webpage-wiki | AI-driven Fandom-style wiki (port 3117, `/wiki`) — per-channel articles, DALL-E images, role-based access |
| `00053` | webpage-context | Context DB editor SPA (port 3118, `/context`) — browse, search, search & replace, bulk delete |
| `00054` | webpage-documentation | Documentation browser (port 3116, `/docs`) — renders Markdown files as HTML |
| `00055` | core-admin-commands | Core admin operations (purge, freeze, DB commands) |
| `00060` | discord-admin-avatar | Generates or uploads a new bot avatar via DALL-E or URL |
| `00065` | discord-admin-macro | Personal text-macro management (create, list, delete, run) |
| `00066` | webpage-manifests | Admin-only manifest JSON editor SPA (port 3126, `/manifests`) — list, view, and save tool manifest JSON files |
| `00070` | discord-add-context | Loads conversation history from MySQL into the context window |
| `00072` | api-add-context | Loads context for API flow requests |
| `00075` | discord-trigger-gate | Filters messages based on configured trigger words |
| `00080` | discord-reaction-start | Adds a progress reaction emoji to the user's message |

| `00999` | core-ai-context-loader | Pre-loads conversation context into `wo._contextSnapshot` before AI modules run. When `channelID` is missing, leaves `_contextSnapshot` unset; AI modules fall back to `getContext()` themselves. |

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
| `03000` | discord-status-apply | Applies the prepared Discord status/presence update. Tool-call status messages are only shown when the originating flow matches `cfg.allowedFlows` (recommended: `["discord","discord-voice"]`). If `allowedFlows` is empty or absent, all flows are shown. |
| `07000` | core-add-id | Tags the response with a context ID before writing to MySQL |
| `08000` | discord-text-output | Formats and sends the response as a Discord embed; creates reasoning thread |
| `08100` | discord-voice-tts | Synthesises TTS audio with speaker-tagged voice selection |
| `08200` | discord-reaction-finish | Removes the progress reaction; adds a completion reaction |
| `09300` | webpage-output | Sends the response back to the webpage flow caller. When `wo.http.response.body` is null and `wo.response` is set, sends `{ response: wo.response }` as JSON. When both are absent, sends `{ ok: false, error: "Empty response" }`. |

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
| `subchannel` | VARCHAR(128) | Optional subchannel UUID; `NULL` = main channel |

**Key behaviours:**

- **Monotonic IDs:** Ensures rows are always inserted in strict order.
- **Rolling timeline summaries:** Messages are grouped into `periodSize`-second windows. After a period closes, a summary is generated via the configured LLM and replaces the raw messages.
- **Token budget:** Context is trimmed (dropping only the last user message per trim step) until it fits within `contextTokenBudget`.
- **User blocking:** When a user is blocked, their token budget is capped at 1.
- **Extra channels:** Messages from additional channels can be included as quoted context.
- **Subchannel isolation:** `wo.subchannel` (UUID) is stored with every row written by `setContext`. All functions use an internal `getSubchannelFilter()` helper that applies a consistent WHERE clause:
  - `wo.subchannel` set → scope to that subchannel only
  - `wo.subchannel` not set + `subchannelFallback=false` (default) → only rows where `subchannel IS NULL`
  - `wo.subchannel` not set + `subchannelFallback=true` → no filter (full channel including all subchannels)
- **Subchannel deletion (`setPurgeSubchannel`):** When a subchannel is deleted, non-frozen context entries are permanently deleted. Frozen entries are **promoted** to the main channel (their `subchannel` field is set to `NULL`) so they are preserved and become part of the main context.
- **Purge/Freeze scoping:** `setPurgeContext` and `setFreezeContext` respect the same filter. The channel-wide timeline rows are only affected when targeting the full channel (not a specific subchannel).

**Exported functions:**

```js
import {
  setContext,             // Persist a record; stores wo.subchannel if set
  getContext,             // Load history; scoped by getSubchannelFilter
  setPurgeContext,        // Delete non-frozen rows; scoped by getSubchannelFilter
                          //   subchannel set              → that subchannel only (timeline untouched)
                          //   no subchannel + fallback=false → subchannel IS NULL rows + timeline
                          //   no subchannel + fallback=true  → all rows for channel + timeline
  setPurgeSubchannel,     // Called on subchannel delete:
                          //   1. DELETE non-frozen rows with that subchannelId
                          //   2. UPDATE frozen rows: set subchannel=NULL (promoted to main channel)
                          //   Returns { deleted, promoted }
  setFreezeContext,       // Mark rows frozen; same scoping as setPurgeContext
  getContextLastSeconds,  // Rows from last N seconds; scoped by getSubchannelFilter
  getContextSince         // Rows since timestamp; scoped by getSubchannelFilter
} from "./core/context.js";
```

---

### core/registry.js — In-Memory Store

A lightweight key-value store for ephemeral runtime data (voice sessions, tool-call tracking, client references, etc.).

```js
import { putItem, getItem, deleteItem, listKeys, clearAll } from "../core/registry.js";

putItem({ data: 123 }, "my-key");  // store object under key; returns the key
const val  = getItem("my-key");    // retrieve; null if expired/missing
deleteItem("my-key");              // remove
const keys = listKeys("prefix:");  // list all keys starting with prefix
clearAll();                        // wipe entire registry
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
import { getPrefixedLogger } from "../core/logging.js";

// Pass workingObject and import.meta.url — the module name is derived automatically.
const log = getPrefixedLogger(workingObject, import.meta.url);

log("Processing started");           // default level: "info"
log("Rate limit hit", "warn");
log("API call failed", "error", { detail: err.message });
```

Log entries include: `level`, `prefix`, `moduleName`, `message`, `ts`, optional `context` object.

---

### core/secrets.js — Centralized Secret Store

Resolves symbolic placeholder names (e.g. `"OPENAI"`) to real secret values stored in the `bot_secrets` MySQL table. Real keys are never stored in `core.json`.

```js
import { getSecret } from "../core/secrets.js";

const apiKey = await getSecret(wo, "OPENAI");        // resolve placeholder → real value
const apiKey = await getSecret(wo, cfg.apiKey);      // cfg.apiKey is a placeholder string
```

If the placeholder is not found in the DB, the placeholder string is returned unchanged (the bot fails at the API level, not at startup).

---

### core/fetch.js — HTTP Timeout Wrapper

Provides `fetchWithTimeout(url, options, timeoutMs)` — a centralized HTTP timeout wrapper used by all tools and AI modules to make outbound HTTP requests with a consistent timeout mechanism.

```js
import { fetchWithTimeout } from "../core/fetch.js";

const res = await fetchWithTimeout(url, { method: "POST", body: "..." }, 30000);
```

---

### shared/webpage/ — Shared Web Helpers

All web modules must import helpers from `shared/webpage/` instead of implementing them locally.

**`shared/webpage/interface.js`** — menu, DB, file I/O, auth:

```js
import { getBody, getDb, getMenuHtml, getThemeHeadScript, escHtml,
         readJsonFile, writeJsonFile, isAuthorized } from "../shared/webpage/interface.js";
```

| Export | Description |
|---|---|
| `getBody(req)` | Read full HTTP request body → `Promise<string>` |
| `getDb(coreData)` | Lazy-init mysql2 pool (singleton) → `Promise<Pool>` |
| `getMenuHtml(menu, path, role, ...)` | Render shared `<nav>` HTML |
| `getThemeHeadScript()` | Inline `<script>` for dark/light theme |
| `escHtml(s)` | HTML-escape `& < > " '` |
| `readJsonFile(path)` | Sync JSON read → `{ ok, data }` |
| `writeJsonFile(path, data)` | Sync JSON write → `{ ok }` |
| `isAuthorized(req, token)` | Validate Bearer/Basic `Authorization` header |

**`shared/webpage/utils.js`** — HTTP response helpers, role checks:

```js
import { setSendNow, setJsonResp, getUserRoleLabels, getIsAllowedRoles }
  from "../shared/webpage/utils.js";
```

| Export | Description |
|---|---|
| `setSendNow(wo)` | Flush `wo.http.response` to socket immediately; safe to call multiple times |
| `setJsonResp(wo, status, data)` | Set JSON response on `wo.http.response` |
| `getUserRoleLabels(wo)` | All role labels from `wo.webAuth` (lower-cased, deduplicated) |
| `getIsAllowedRoles(wo, allowedRoles)` | `true` if user has any of the required roles; empty array = everyone allowed |

**`shared/webpage/style.css`** — Shared CSS (dark/light theme, nav bar, common UI). Served at `/style.css` by the webpage flow.

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

### GDPR Data Export (`/gdpr`)

Authenticated users can request a machine-readable export of all personal data held for their account. Navigate to `/gdpr` in the web interface and click **Download Excel export**. The generated `.xlsx` file contains three sheets:

| Sheet | Contents |
|---|---|
| **Context** | All conversation history rows associated with the user's ID |
| **GDPR Consent** | Consent records per channel |
| **Files** | Files stored in the user's personal documents directory |

The export is generated on demand by module `00057-webpage-gdpr.js` (port 3121). See [CORE_JSON.md](CORE_JSON.md#webpage-gdpr) for configuration details.

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

**Module isolation rules (mandatory):**
- Modules read their own config ONLY from `coreData?.config?.[MODULE_NAME]` — never from another module's config key.
- No module may import another module.
- Exception: core-ai modules (01000–01003) may dynamically `import()` tools from `../tools/`.
- Config isolation is enforced by ESLint (`npm run lint`).

1. Create a file in `modules/` with the naming pattern `[NUMBER]-[PREFIX]-[NAME].js`. Choose a number that places it correctly in the pipeline order.

2. Export a default async function:

```js
// modules/04500-myprefix-mymodule.js
import { putItem, getItem, deleteItem } from "../core/registry.js";
import { getPrefixedLogger }           from "../core/logging.js";
import { getSecret }                   from "../core/secrets.js";

const MODULE_NAME = "myprefix-mymodule";

export default async function getMyModule(coreData) {
  const wo  = coreData.workingObject;
  const cfg = coreData?.config?.[MODULE_NAME] || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  // Guard: only run for the discord flow
  if (wo.flow !== "discord") return coreData;

  // Read own config (never another module's key)
  const myOption = cfg.myOption || "default";

  // Registry: ephemeral in-memory KV store
  putItem({ status: "running" }, `mymodule:${wo.channelID}`);
  const prev = getItem(`mymodule:${wo.channelID}`);

  // Secrets: resolve a placeholder name to the real secret from DB
  const apiKey = await getSecret(wo, "MY_API_KEY_PLACEHOLDER");

  // Logging
  log(`Running for channel ${wo.channelID}`, "info");

  // Do work
  wo.myResult = "done";

  // Optionally stop the pipeline
  // wo.stop = true;

  return coreData;
}
```

3. Register the module in `core.json` so it only runs for the desired flows:

```jsonc
{
  "config": {
    "myprefix-mymodule": {
      "flow": ["discord"],
      "myOption": "value"
    }
  }
}
```

If `"flow"` is omitted or empty, the module runs for **all** flows. The `flow` array must match the flow name(s) the module should be active in (`"discord"`, `"api"`, `"webpage"`, `"cron"`, etc.).

---

## Adding a New Tool

1. Create a file in `tools/myTool.js`:

```js
// tools/myTool.js
import { getSecret } from "../core/secrets.js";

const MODULE_NAME = "myTool";

async function getInvoke(args, coreData) {
  // coreData is the full pipeline object — workingObject lives inside it
  const wo      = coreData?.workingObject || {};
  const { query } = args;

  // Tools read config ONLY from wo.toolsconfig?.[toolName]
  const toolCfg = wo?.toolsconfig?.[MODULE_NAME] || {};

  // Resolve secrets via the centralized secret store (never hardcode keys)
  const apiKey  = await getSecret(wo, toolCfg.apiKey || "MY_SERVICE_KEY");

  // perform work ...
  return { ok: true, result: "..." };
}

export default {
  name: MODULE_NAME,

  definition: {
    type: "function",
    function: {
      name: MODULE_NAME,
      description: "What this tool does, in one sentence.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query"
          }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  },

  invoke: getInvoke
};
```

> **Important:** The second parameter of `invoke` is always `coreData` (the full pipeline object), **not** `workingObject`. Always access `coreData.workingObject` explicitly.

2. Add the tool name to `workingObject.tools` in `core.json`:

```jsonc
{
  "workingObject": {
    "tools": ["getGoogle", "getWebpage", "myTool"]
  }
}
```

3. Add any tool-specific config under `workingObject.toolsconfig.myTool`:

```jsonc
{
  "workingObject": {
    "toolsconfig": {
      "myTool": {
        "apiKey": "MY_SERVICE_KEY",
        "baseUrl": "https://api.example.com",
        "timeoutMs": 30000
      }
    }
  }
}
```

The `apiKey` value (`"MY_SERVICE_KEY"`) is a **placeholder name** that must exist as a row in the `bot_secrets` MySQL table. The real API key is stored there, not in `core.json`. See [core/secrets.js](#coreinfrastructure) for details.

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
| **Gallery upload** | Drag-and-drop or click to upload images directly to the bot's Gallery. Requires `webBaseUrl` in the options and an active login session on the Jenny web interface. |
| **Toolcall display** | Active tool name shown next to the animated thinking dots |
| **META frame filtering** | Lines starting with `META|` are stripped from API responses before display; internal context-injection frames are never shown to the user |
| **Options page** | Configure API URL, Channel ID, API Secret, and Web Base URL via `chrome.storage` |

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
| **Web Base URL** | Base URL of the Jenny web interface (e.g. `https://jenny.example.com`). Required for gallery uploads. You must be logged into the web interface first — click **Open login page** in the options. |

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
{ "label": "Browser Extension", "channelID": "browser-extension", "roles": [] }
```

---

## Bard Music System

The Bard is a **headless background music scheduler** for tabletop RPG sessions. It requires no second Discord bot — music is served directly to a browser player.

### How it works

```
/bardstart command
  → Creates a session in the registry (bard:session:{guildId})
  → Does not write bard:labels — first poll picks a random track

Cron job (every N minutes, flow: bard-label-gen)
  → bard-cron: reads chat context, builds AI prompt
  → core-ai-completions: LLM returns 6-position label string (location,situation,mood×4)
  → bard-label-output: category-based rescue (fixes AI position errors), validates moods,
    writes bard:labels:{guildId} as [location,situation,mood1,mood2,mood3,mood4]
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
