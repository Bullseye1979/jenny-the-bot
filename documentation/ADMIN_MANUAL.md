# Jenny Discord AI Bot — Administrator Manual

> **Version:** 1.0 · **Date:** 2026-04-05
> This document provides a complete reference for the bot's architecture, all modules, flows, tools, and every parameter of the `core.json`.

---

## Table of Contents

1. [Quickstart Guide](#1-quickstart-guide)
2. [Architecture Overview](#2-architecture-overview)
3. [Directory Structure](#3-directory-structure)
4. [Starting the Bot](#4-starting-the-bot)
5. [core.json — Full Parameter Reference](#5-corejson--full-parameter-reference)
   - 5.1 [workingObject — Global Defaults](#51-workingobject--global-defaults)
   - 5.2 [Database (db)](#52-database-db)
   - 5.3 [Voice / TTS / Transcription](#53-voice--tts--transcription)
   - 5.4 [Avatar Generation](#54-avatar-generation)
   - 5.5 [Discord Admin / Slash Commands](#55-discord-admin--slash-commands)
   - 5.6 [toolsconfig — Per-Tool Configuration](#56-toolsconfig--per-tool-configuration)
   - 5.7 [config — Flow Wiring and Module Configuration](#57-config--flow-wiring-and-module-configuration)
   - 5.8 [core-channel-config — Channel/Flow/User Overrides](#58-core-channel-config--channelflowuser-overrides)
6. [Flows](#6-flows)
   - 6.1 [discord](#61-discord)
   - 6.2 [discord-admin](#62-discord-admin)
   - 6.3 [discord-voice](#63-discord-voice)
   - 6.4 [api](#64-api)
   - 6.5 [cron](#65-cron)
   - 6.6 [toolcall](#66-toolcall)
   - 6.7 [webpage (chat module)](#67-webpage-chat-module)
   - 6.8 [webpage](#68-webpage)
   - 6.8.1 [Adding a new webpage module](#681-adding-a-new-webpage-module)
   - 6.9 [Browser Extension](#69-browser-extension)
7. [Module Pipeline](#7-module-pipeline)
   - 7.1 [Pre-Processing (00xxx)](#71-pre-processing-00xxx)
   - 7.2 [AI Processing (01xxx)](#72-ai-processing-01xxx)
   - 7.3 [Output & Post-Processing (02xxx–08xxx)](#73-output--post-processing-02xxx08xxx)
   - 7.4 [Final Logging (10xxx)](#74-final-logging-10xxx)
8. [Tools — LLM-callable Functions](#8-tools--llm-callable-functions)
   - [getGoogle](#getgoogle)
   - [getTavily](#gettavily)
   - [getWebpage](#getwebpage)
   - [getImage](#getimage)
   - [getImageDescription](#getimagedescription)
   - [getImageSD](#getimagesd)
   - [getAnimatedPicture](#getanimatedpicture)
   - [getVideoFromText](#getvideofromtext)
   - [getYoutube](#getyoutube)
   - [getJira](#getjira)
   - [getConfluence](#getconfluence)
   - [getPDF](#getpdf)
   - [getText](#gettext)
   - [getHistory](#gethistory)
   - [getTimeline](#gettimeline)
   - [getLocation](#getlocation)
   - [getTime](#gettime)
   - [getToken](#gettoken)
   - [getBan](#getban)
   - [getGraph](#getgraph)
   - [getSpotify](#getspotify)
   - [getApi](#getapi)
   - [getShell](#getshell)
   - [getOauthProviders](#getoauthproviders)
   - [getApiBearers](#getapibearers)
   - [getMyConnections](#getmyconnections)
9. [Core Infrastructure](#9-core-infrastructure)
   - 9.1 [registry.js — In-Memory Key-Value Store](#91-registryjs--in-memory-key-value-store)
   - 9.2 [context.js — MySQL Conversation Storage](#92-contextjs--mysql-conversation-storage)
   - 9.3 [logging.js — Structured Logging](#93-loggingjs--structured-logging)
   - 9.4 [secrets.js — Centralized Secret Store](#94-secretsjs--centralized-secret-store)
   - 9.5 [fetch.js — HTTP Timeout Wrapper](#95-fetchjs--http-timeout-wrapper)
   - 9.6 [shared/webpage/ — Shared Web Helpers](#96-sharedwebpage--shared-web-helpers)
10. [GDPR & Consent Workflow](#10-gdpr--consent-workflow)
11. [Macro System](#11-macro-system)
12. [Discord Slash Commands — Overview](#12-discord-slash-commands--overview)
13. [Database Schema](#13-database-schema)
14. [Reverse Proxy (Caddy)](#14-reverse-proxy-caddy)
15. [Discord Bot Permissions](#15-discord-bot-permissions)
16. [Web Modules](#16-web-modules)
   - 16.1 [Overview](#161-overview)
   - 16.2 [Config Editor (`/config`)](#162-config-editor-config)
   - 16.3 [Chat SPA (`/chat`)](#163-chat-spa-chat)
   - 16.4 [Inpainting SPA (`/inpainting`)](#164-inpainting-spa-inpainting)
   - 16.4a [Gallery (`/gallery`)](#164a-gallery-gallery)
   - 16.4b [GDPR Data Export (`/gdpr`)](#164b-gdpr-data-export-gdpr)
   - 16.5 [Bard Library Manager (`/bard`)](#165-bard-library-manager-bard)
   - 16.6 [Live Dashboard (`/dashboard`)](#166-live-dashboard-dashboard)
   - 16.7 [Documentation Browser (`/docs`)](#167-documentation-browser-docs)
   - 16.8 [AI Wiki (`/wiki`)](#168-ai-wiki-wiki)
   - 16.9 [Context Editor (`/context`)](#169-context-editor-context)
   - 16.9a [Timeline Editor (`/timeline`)](#169a-timeline-editor-timeline)
     - 16.9b [Webpage Voice Interface (`/voice`)](#169b-webpage-voice-interface-voice)
   - 16.10 [Authentication & SSO (`/auth`)](#1610-authentication--sso-auth)
   - 16.11 [Navigation Menu](#1611-navigation-menu)
   - 16.12 [Permission Concept](#1612-permission-concept)
   - 16.13 [Creating a New Web Module](#1613-creating-a-new-web-module)
   - 16.14 [Key Manager (`/key-manager`)](#1614-key-manager-key-manager)
   - 16.14a [Channel Config Manager (`/channels`)](#1614a-channel-config-manager-channels)
   - 16.15 [Microsoft Graph Auth (`/graph-auth`)](#1615-microsoft-graph-auth-graph-auth)
   - 16.16 [Token Refresh Cron (`cron-graph-token-refresh`)](#1616-token-refresh-cron-cron-graph-token-refresh)
   - 16.17 [Spotify Auth (`/spotify-auth`)](#1617-spotify-auth-spotify-auth)
   - 16.18 [Spotify Token Refresh Cron (`cron-spotify-token-refresh`)](#1618-spotify-token-refresh-cron-cron-spotify-token-refresh)
   - 16.19 [OAuth Manager (`/oauth`)](#1619-oauth-manager-oauth)
   - 16.20 [OAuth Token Refresh Cron (`cron-oauth-token-refresh`)](#1620-oauth-token-refresh-cron-cron-oauth-token-refresh)
   - 16.21 [OAuth Connections (`/connections`)](#1621-oauth-connections-connections)
   - 16.22 [OAuth Provider Exposure (`/oauth-exposure`)](#1622-oauth-provider-exposure-oauth-exposure)
   - 16.23 [API Key Exposure (`/bearer-exposure`)](#1623-api-key-exposure-bearer-exposure)
17. [Bard Music System](#17-bard-music-system)
18. [Dependencies](#18-dependencies)

---

## 1. Quickstart Guide

### Prerequisites

| Requirement | Minimum Version |
|---|---|
| Node.js | 20.x |
| MySQL / MariaDB | 8.0 / 10.6 |
| FFmpeg | 6.x (required for voice) |
| ImageMagick `convert` | 7.x (required for getToken) |
| Gifsicle | 1.94+ (required for getToken) |

### Step 1: Prepare the Repository

```bash
cd /home/discordbot/jenny-the-bot/development
npm install
```

### Step 2: Create the MySQL Database

```sql
CREATE DATABASE discord_ai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'discord_bot'@'localhost' IDENTIFIED BY 'YOUR_PASSWORD';
GRANT ALL PRIVILEGES ON discord_ai.* TO 'discord_bot'@'localhost';
FLUSH PRIVILEGES;

USE discord_ai;

-- Conversation history table
CREATE TABLE context (
  ctx_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ts       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  id       VARCHAR(128) NOT NULL,
  userid   VARCHAR(128) NULL,
  json     LONGTEXT NOT NULL,
  text     TEXT NULL,
  role     VARCHAR(32) NOT NULL DEFAULT 'user',
  turn_id  CHAR(26) NULL,
  frozen   TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_id_ctx (id, ctx_id),
  KEY idx_role (role),
  KEY idx_turn (turn_id),
  KEY idx_id_turn (id, turn_id),
  KEY idx_userid (userid)
);

-- GDPR consent table
CREATE TABLE gdpr (
  user_id    VARCHAR(64) NOT NULL,
  channel_id VARCHAR(128) NOT NULL,
  chat       TINYINT(1) NOT NULL DEFAULT 0,
  voice      TINYINT(1) NOT NULL DEFAULT 0,
  disclaimer TINYINT(1) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, channel_id)
);

-- Secret store (placeholder name → real value)
-- See Section 9.4 for details. The bot auto-creates this table on first start,
-- but creating it here ensures it exists before the bot connects.
CREATE TABLE IF NOT EXISTS bot_secrets (
  name        VARCHAR(64)  NOT NULL,
  value       TEXT         NOT NULL,
  description VARCHAR(255) NULL,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Populate with your real secret values.
-- Replace each '...' with the actual key/token for that service.
INSERT INTO bot_secrets (name, value, description) VALUES
  ('OPENAI',               '...',             'OpenAI API key — completions, responses, DALL-E, Whisper, TTS, vision'),
  ('DISCORD',              '...',             'Discord bot token (main Jenny bot)'),
  ('BARD_DISCORD',         '...',             'Discord bot token (Bard music bot — only if bard flow is active)'),
  ('DISCORD_CLIENT_SECRET','...',             'Discord OAuth2 client secret (webpage-auth SSO)'),
  ('SESSION_SECRET',       '...',             'Express session signing secret (webpage-auth)'),
  ('TAVILY',               '...',             'Tavily Search API key'),
  ('GOOGLE',               '...',             'Google Custom Search API key'),
  ('GOOGLE_CSE_ID',        '...',             'Google Custom Search Engine ID'),
  ('JIRA',                 '...',             'Jira API token'),
  ('JIRA_EMAIL',           '...',             'Jira account email'),
  ('CONFLUENCE',           '...',             'Confluence API token'),
  ('CONFLUENCE_EMAIL',     '...',             'Confluence account email'),
  ('ANIMATED_PICTURE',     '...',             'Animated picture generation API token'),
  ('VIDEO_FROM_TEXT',      '...',             'Video generation API token'),
  ('REPLICATE',            '...',             'Replicate API token (inpainting)'),
  ('API_SECRET',           '...',             'Internal API bearer token for the bot /api endpoint')
ON DUPLICATE KEY UPDATE
  value       = VALUES(value),
  description = COALESCE(VALUES(description), description);
```

### Step 3: Create core.json (or use the Setup Wizard)

#### Option A — Setup Wizard (recommended for first-time installs)

If `core.json` does not exist when the bot starts, a **first-run setup wizard** is automatically launched instead of the normal bot. It serves a web form at **`http://localhost:3400/setup`** that collects the minimum required values:

- OpenAI API key
- MySQL database credentials (host, user, password, database name)
- Bot name
- Trigger word
- Discord bot token

After submitting the form the wizard writes a starter `core.json` and the process exits with instructions to restart. On the next start the full bot initializes normally.

**No manual file editing is needed for the initial configuration.** Once the bot is running you can edit `core.json` via the `/config` web editor or directly in the file.

#### Option B — Manual setup

The following fields are **mandatory** for the bot to start:

| Field | Description |
|---|---|
| `workingObject.apiKey` | Placeholder name for the LLM API key, e.g. `"OPENAI"` — resolved from `bot_secrets` at runtime |
| `workingObject.db.host` | MySQL host |
| `workingObject.db.user` | MySQL user |
| `workingObject.db.password` | MySQL password alias or runtime-provided DB password. In committed config, use an alias such as `"DB_PASSWORD"` instead of a real secret. |
| `workingObject.db.database` | MySQL database name |
| `config.discord.token` | Placeholder name for the Discord bot token, e.g. `"DISCORD"` |
| `workingObject.modAdmin` | Discord user ID of the administrator |
| `workingObject.baseUrl` | Public base URL of the server (for file links) |

A minimal example file is provided as `core.json.example` in the same directory.
Copy it to `core.json`. **API keys and tokens are not stored in `core.json`** — they are stored in the `bot_secrets` database table (see Step 2 above). The `core.json` fields that previously held real keys now hold **symbolic placeholder names** (e.g. `"OPENAI"`, `"DISCORD"`) that the bot resolves at runtime via `core/secrets.js`.

Alias policy: values such as `OPENAI`, `API_SECRET`, `DISCORD_CLIENT_SECRET`, and `DB_PASSWORD` are valid committed placeholders. Secret-looking fields are allowed in config only when the value is a symbolic alias. Real provider-issued keys, bearer tokens, and passwords must never be committed.

```bash
cp core.json.example core.json
# core.json already uses symbolic placeholder names — no key values to fill in
# Real secrets go into the bot_secrets table (see Step 2)
```

### Step 4: Start the Bot

```bash
node main.js
```

The dashboard refreshes every second in the terminal and shows all active flows.

### Step 5: Register Discord Slash Commands

On first start the bot automatically registers slash commands with the Discord API.
It may take a few minutes before they appear inside Discord.

### Step 6: Grant GDPR Consent

Every user must explicitly consent before the bot will interact with them:

```
/gdpr text 1    <- enable text processing
/gdpr voice 1   <- enable voice processing (optional)
```

---

## 2. Architecture Overview

Jenny uses a **pipeline-based modular architecture**:

```
Event source (Discord / HTTP API / Cron / Voice / Webpage)
        |
        v
   Flow Handler
   +-----------------------------------------+
   | Creates workingObject with event data    |
   | Calls runFlow()                          |
   +-----------------------------------------+
        |
        v
   Module Pipeline (ordered execution 00xxx -> 10xxx)
   +------------+------------+------------+------------+
   | 00xxx      | 01xxx      | 02-08xxx   | 10xxx      |
   | Pre-Proc.  | AI Module  | Output     | Logging    |
   +------------+------------+------------+------------+
        |
        v
   Storage
   +-----------------+------------------------+
   | MySQL (context) | In-Memory (registry)   |
   +-----------------+------------------------+
```

**Key principles:**
- Every module receives `coreData = { workingObject, logging }` and reads/writes from it.
- Modules read their own config ONLY from `coreData?.config?.[MODULE_NAME]`; tools read config ONLY from `wo.toolsconfig?.[toolName]`.
- No module may import another module. Exception: core-ai modules (01000–01003) may dynamically `import()` tools from `../tools/`.
- `workingObject.stop = true` halts the pipeline immediately.
- Any change to `core.json` is automatically detected and the bot reinitializes — **no restart required** (hot-reload).
- All settings for channels, flows, and users can be overridden via the channel config hierarchy.

---

## 3. Directory Structure

```
/home/discordbot/jenny-the-bot/development/
├── main.js                  # Entry point, hot-reload, live dashboard
├── core.json                # Central configuration file (not checked in)
├── core.json.example        # Minimal example configuration
├── package.json
├── core/
│   ├── registry.js          # In-memory KV store with TTL/LRU
│   ├── context.js           # MySQL conversation storage
│   ├── logging.js           # Structured logging
│   └── fetch.js             # Centralized HTTP timeout wrapper (fetchWithTimeout)
├── flows/
│   ├── discord.js           # Discord message listener
│   ├── discord-admin.js     # Slash command handler
│   ├── discord-voice.js     # Voice channel handler
│   ├── api.js               # HTTP API server
│   ├── bard.js              # Bard music scheduler (headless, no Discord bot)
│   ├── cron.js              # Scheduled jobs
│   ├── toolcall.js          # Registry-triggered flow
│   └── webpage.js           # Multi-port HTTP server for web tools
├── modules/                 # Ordered modules (00xxx-10xxx)
├── tools/                   # LLM-callable tools
├── types/
│   └── workingObject.js     # JSDoc @typedef for WorkingObject (no runtime impact; for IDE/AI reference)
├── eslint-rules/
│   └── no-foreign-config.js # Custom ESLint rule: config isolation enforcement
├── eslint.config.js         # ESLint flat config (applies rule to modules/)
├── shared/
│   └── webpage/
│       ├── interface.js     # Shared web utilities (menu, auth, DB, file I/O)
│       ├── utils.js         # HTTP response helpers (setSendNow, setJsonResp, role checks)
│       └── style.css        # Shared CSS for all web modules
├── assets/
│   └── bard/
│       └── library.xml      # Bard music catalog
├── pub/
│   ├── documents/           # Generated images, PDFs, videos
│   └── debug/               # Debug logs
└── logs/                    # Log directory
    ├── events/              # Per-flow event logs (events-1.log, events-2.log)
    ├── pipeline/            # WorkingObject diff logs (pipeline-1.log, pipeline-2.log)
    ├── objects/             # Full coreData dumps per flow
    └── json-error.log       # core.json parse errors
```

---

## 4. Starting the Bot

```bash
node main.js
```

The live dashboard displays:
- All active flows with ULID, phase, current module, elapsed time
- ASCII progress bar per flow
- System memory (RSS / heap)
- Last 10 completed flows with final status

**Console padding:** Each dashboard line is padded with trailing spaces to the full terminal width so no leftover text is visible from shorter previous renders. ANSI escape codes are excluded from the visual width calculation.

**Web dashboard:** `main.js` also writes structured telemetry to the `dashboard:state` registry key every 2 seconds. The `00051-webpage-dashboard.js` module reads this key and serves it as an HTML page at `/dashboard` (port 3115) with configurable auto-refresh (default 5 s).

**Hot-Reload:** Every change to `core.json` is detected automatically and the bot reinitializes without a restart.

---

## 5. core.json — Full Parameter Reference

`core.json` has two root keys:

```json
{
  "workingObject": { ... },
  "config":        { ... }
}
```

`workingObject` holds global runtime defaults.
`config` holds flow wiring, module configurations, and channel overrides.

> **Note:** `__description` keys anywhere in the JSON are treated as inline comments and are ignored by the bot.

---

### 5.1 workingObject — Global Defaults

#### Bot Identity

| Parameter | Type | Default | Description |
|---|---|---|---|
| `botName` | string | `"Jenny"` | Display name of the bot |
| `persona` | string | `"Default AI Assistant"` | Identity block: who the assistant is and what its job is |
| `systemPrompt` | string | `"You are a helpful assistant."` | Processing rules and non-negotiable task constraints |
| `instructions` | string | `"Answer concisely."` | Delivery rules for response style, verbosity, language, length, and formatting |
| `trigger` | string | `"jenny"` | Trigger word to activate the bot (empty = always active) |
| `triggerWordWindow` | number | `3` | Number of words from the start of a message in which the trigger is searched |
| `modAdmin` | string | — | Discord user ID with administrator rights |
| `modSilence` | string | `"[silence]"` | If the AI response contains this token, no output is sent |
| `apiSecret` | string | `""` | Shared secret for the HTTP API token gate. When set, every `POST /api` request must supply `Authorization: Bearer <secret>`. Leave empty to disable token checking. |
| `apiEnabled` | number | `1` | Controls whether this channel can be reached via the HTTP API. `0` = always blocked (regardless of token). `1` = allowed when token matches or no secret is set. Can be overridden per channel via `core-channel-config`. |
| `botsAllow` | array | `[]` | List of Discord bot IDs permitted to trigger the bot |

#### AI Model

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | string | `"gpt-4o-mini"` | LLM model ID |
| `endpoint` | string | OpenAI URL | Chat completions endpoint |
| `apiKey` | string | — | API key for LLM calls |
| `useAiModule` | string | `"completions"` | AI module to use: `"completions"` \| `"responses"` \| `"pseudotoolcalls"` |
| `temperature` | number | `0.2` | Sampling temperature (0–2) |
| `maxTokens` | number | `2000` | Max tokens per response |
| `requestTimeoutMs` | number | `1000000` | HTTP timeout for AI requests (ms) |

#### Responses API (useAiModule = "responses")

| Parameter | Type | Default | Description |
|---|---|---|---|
| `reasoning` | boolean | `false` | Enable extended reasoning / chain-of-thought output |
| `ResponseTools` | array | — | Native Responses API tools, e.g. `[{"type":"web_search"},{"type":"image_generation"}]` |

#### Tool Calling

| Parameter | Type | Default | Description |
|---|---|---|---|
| `tools` | array | `[...]` | List of enabled tool names, e.g. `["getGoogle","getImage"]` |
| `toolsBlacklist` | array | `["getImageSD"]` | Tool names subtracted from `tools` before the AI request is sent. Does not modify the `tools` array itself. When `fallbackOverrides` is active its `toolsBlacklist` **replaces** (not merges with) the base blacklist. Supported in `core-ai-completions`, `core-ai-responses`, and `core-ai-pseudotoolcalls`. |
| `toolChoice` | string | `"auto"` | Tool selection mode: `"auto"` \| `"none"` \| `"required"` |
| `maxLoops` | number | `15` | Max AI loop iterations per turn (each tool-call round = one iteration) |
| `maxToolCalls` | number | `7` | Max total tool calls across all iterations. Once reached, tools are disabled for the remainder of the turn so the AI produces a final answer. Enforced in `core-ai-completions` (01000) and `core-ai-responses` (01001). |
| `fallbackOverrides` | object | — | Fields applied automatically when the primary endpoint fails a TCP probe. Any `workingObject` key is valid. Typically overrides `endpoint`, `apiKey`, `model`, `useAiModule`, `toolsBlacklist`. The probe result is cached for 5 s. Add `getOrchestrator` and `getSpecialists` to the fallback `toolsBlacklist` to prevent expensive multi-agent runs on paid public APIs. |

#### Conversation History

| Parameter | Type | Default | Description |
|---|---|---|---|
| `includeHistory` | boolean | `true` | Load conversation history into context |
| `includeHistoryTools` | boolean | `false` | Include tool-call rows in history |
| `includeRuntimeContext` | boolean | `true` | Inject runtime metadata into system prompt |
| `detailedContext` | boolean | `true` | Load full JSON rows from MySQL |
| `contextTokenBudget` | number | `60000` | Maximum token budget for history |
| `contextSize` | number | `40` | Number of history rows to load |
| `simplifiedContext` | boolean | `false` | Load simplified context (for fast/small models) |
| `channelIds` | array | `[]` | Additional channel IDs whose history is included as quoted context |
| `doNotWriteToContext` | boolean | `false` | Skip writing to MySQL. Honoured by `01004-core-ai-context-writer` and `00072-api-add-context`. Set by `discord-status` and `bard-label-gen` flows. Can also be passed in the API request body (`POST /api`) to prevent internal system calls (e.g. wiki article generation) from polluting the channel context. |

#### Output & Reactions

| Parameter | Type | Default | Description |
|---|---|---|---|
| `showReactions` | boolean | `true` | Add progress emoji reactions to Discord messages |
| `baseUrl` | string | `""` | Public base URL for file links, e.g. `https://myserver.com` |
| `timezone` | string | `"Europe/Berlin"` | Default timezone |

#### Internal Runtime Fields (set by the system)

| Parameter | Type | Description |
|---|---|---|
| `payload` | string | User input for this turn |
| `response` | string | Final AI response |
| `reasoningSummary` | string | Accumulated reasoning (set by the AI module) |
| `fileUrls` | array | Attachment URLs from Discord messages |
| `logging` | array | Log entries for the current turn |
| `messageId` | string | Discord message ID of the triggering message (set by discord flow) |
| `agentType` | string | Set to `"orchestrator"` or `"specialist"` when the pipeline runs in an agentic context. Absent (or empty) in primary user channels. The AI modules use this to adjust the system prompt. |
| `agentDepth` | number | Nesting depth of the current agent invocation. `0` = primary channel, `1` = orchestrator, `2` = specialist, etc. |
| `skipAiCompletions` | boolean | When `true`, all `core-ai-*` modules exit immediately without calling the LLM. Use when a preceding module has already populated `wo.response` (e.g. a delivery module for async subagent results). |
| `allowArtifactGeneration` | boolean | Enables artifact link generation in the output (e.g. PDF, document download links). |
| `aborted` | boolean | Set to `true` by tools or modules to signal that the pipeline should stop processing. Checked by `getOrchestrator` and `getSpecialists` before dispatching. |
| `jumpReason` | string | Human-readable reason logged when `wo.jump` is set (pipeline skip triggered). |

#### GDPR

| Parameter | Type | Description |
|---|---|---|
| `gdprDisclaimer` | string | Full GDPR notice text sent as a DM to new users |

---

### 5.2 Database (db)

```json
"db": {
  "host":     "localhost",
  "port":     3306,
  "user":     "discord_bot",
  "password": "YOUR_PASSWORD",
  "database": "discord_ai",
  "charset":  "utf8mb4"
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `host` | string | `"localhost"` | MySQL server hostname |
| `port` | number | `3306` | MySQL port |
| `user` | string | — | MySQL username |
| `password` | string | — | MySQL password |
| `database` | string | — | Database name |
| `charset` | string | `"utf8mb4"` | Character set |

---

### 5.3 Voice / TTS / Transcription

| Parameter | Type | Default | Description |
|---|---|---|---|
| `useVoiceChannel` | number | `0` | Voice channel mode (0 = disabled) |
| `ttsModel` | string | `"gpt-4o-mini-tts"` | Text-to-speech model |
| `ttsVoice` | string | `"nova"` | TTS voice name |
| `ttsEndpoint` | string | OpenAI URL | TTS API endpoint |
| `ttsApiKey` | string | — | API key for TTS (if different from `apiKey`) |
| `ttsFormat` | string | `"opus"` | Audio output format for TTS. `"opus"` for Discord (default), `"mp3"` for webpage voice. Overridable per-module in `config["core-voice-tts"]`. |
| `ttsFetchTimeoutMs` | number | `30000` | Timeout in milliseconds for each TTS API request. |
| `transcribeModel` | string | `"gpt-4o-mini-transcribe"` | Global fallback transcription model. Prefer setting `transcribeModel` in `config["core-voice-transcribe"]` for explicit control. |
| `transcribeLanguage` | string | `""` | Force language (ISO 639-1; empty = auto-detect). |
| `transcribeEndpoint` | string | `""` | Transcription API base URL. |
| `transcribeApiKey` | string | — | API key for transcription (if different from `apiKey`). |

---

### 5.4 Avatar Generation

| Parameter | Type | Default | Description |
|---|---|---|---|
| `avatarApiKey` | string | — | Alias for avatar generation, resolved via `getSecret()` |
| `avatarEndpoint` | string | DALL-E URL | Avatar generation endpoint |
| `avatarModel` | string | `"dall-e-3"` | Image model used for avatars |
| `avatarSize` | string | `"1024x1024"` | Avatar dimensions |
| `avatarPrompt` | string | `""` | Persistent prompt prefix for avatar generation |

---

### 5.5 Discord Admin / Slash Commands

The slash command block lives under `workingObject["discord-admin"].slash`:

```json
"discord-admin": {
  "slash": {
    "silent": true,
    "ephemeral": false,
    "definitions": [ ... ]
  }
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `silent` | boolean | `true` | Send slash command replies silently (deferred) |
| `ephemeral` | boolean | `false` | Send replies as ephemeral (visible only to the caller) |
| `definitions` | array | `[...]` | List of slash command definitions |

**Definition structure:**

```json
{
  "name": "commandname",
  "description": "Description",
  "admin": ["USER_ID_1"],
  "options": [
    {
      "type": 1,
      "name": "subcommand",
      "description": "...",
      "admin": ["USER_ID_1"],
      "options": [
        { "type": 3, "name": "param", "description": "...", "required": true }
      ]
    }
  ]
}
```

| Discord type | Meaning |
|---|---|
| `1` | SUB_COMMAND |
| `3` | STRING |
| `4` | INTEGER |
| `5` | BOOLEAN |
| `6` | USER |

The `admin` array on a command or subcommand restricts execution to the listed user IDs.

**Built-in slash commands defined here:**

| Command | Admin | Description |
|---|---|---|
| `/macro` | Partial | Create, run, list, delete personal macros |
| `/avatar` | Yes | Set or generate a bot avatar |
| `/purge` | Yes | Delete recent messages |
| `/purgedb` | Yes | Wipe database entries for this channel |
| `/freeze` | Yes | Mark database rows as frozen |
| `/rebuilddb` | Yes | Rebuild derived context tables for the current channel only |
| `/gdpr` | No | Set GDPR consent flags |
| `/join` | No | Join user's voice channel |
| `/leave` | No | Leave voice channel |
| `/bardstart` | No | Start the bard music scheduler for this server |
| `/bardstop` | No | Stop the bard music scheduler for this server |
| `/error` | No | Simulate an internal error (testing) |

---

### 5.6 toolsconfig — Per-Tool Configuration

All tool configurations live under `workingObject.toolsconfig.<toolName>`:

---

#### toolsconfig.getGoogle

Performs web searches using the Google Custom Search JSON API.

```json
"getGoogle": {
  "apiKey":    "GOOGLE_API_KEY",
  "cseId":     "CUSTOM_SEARCH_ENGINE_ID",
  "num":       10,
  "safe":      "off",
  "hl":        "en",
  "lr":        "lang_en",
  "cr":        "countryUS",
  "gl":        "us",
  "timeoutMs": 20000
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `apiKey` | string | — | **Required.** Google Custom Search API key |
| `cseId` | string | — | **Required.** Custom Search Engine ID |
| `num` | number | `5` | Default number of results (1–10) |
| `safe` | string | `"off"` | Safe search: `"off"` \| `"active"` \| `"high"` |
| `hl` | string | — | UI language hint, e.g. `"en"`, `"de"` |
| `lr` | string | — | Language restrict, e.g. `"lang_en"` |
| `cr` | string | — | Country restrict, e.g. `"countryUS"` |
| `gl` | string | — | Geolocation, e.g. `"us"` |
| `timeoutMs` | number | `20000` | HTTP timeout (ms) |

---

#### toolsconfig.getWebpage

Fetches and reads web page content.

```json
"getWebpage": {
  "userAgent":        "Mozilla/5.0 ...",
  "timeoutMs":        30000,
  "maxInputChars":    240000,
  "wordThreshold":    2000,
  "summaryApiUrl":    "http://localhost:3400",
  "summaryChannelId": "",
  "summaryApiSecret": "",
  "summaryTimeoutMs": 45000
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `userAgent` | string | Chrome UA | HTTP User-Agent for page requests |
| `timeoutMs` | number | `30000` | HTTP timeout for page fetch (ms) |
| `maxInputChars` | number | `240000` | Hard character cap on extracted page text |
| `wordThreshold` | number | `2000` | Below this word count: dump mode; above: AI summary |
| `summaryApiUrl` | string | `"http://localhost:3400"` | Internal API base URL for AI summarization |
| `summaryChannelId` | string | `""` | Channel ID for the summarizer; if empty, raw text is returned |
| `summaryApiSecret` | string | `""` | Optional bearer token key name for the summary API |
| `summaryTimeoutMs` | number | `45000` | Timeout for the AI summary call (ms) |

---

#### toolsconfig.getImage

Generates images from a natural-language prompt using an OpenAI-compatible Images API.

```json
"getImage": {
  "apiKey":              "YOUR_OPENAI_API_KEY",
  "endpoint":            "https://api.openai.com/v1/images/generations",
  "model":               "dall-e-3",
  "size":                "1024x1024",
  "n":                   1,
  "publicBaseUrl":       "https://myserver.com/",
  "targetLongEdge":      1152,
  "aspect":              "",
  "enhancerApiUrl":      "http://localhost:3400",
  "enhancerChannelId":   "",
  "enhancerApiSecret":   ""
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `apiKey` | string | — | **Required.** API key for image generation |
| `endpoint` | string | DALL-E URL | Image generation endpoint |
| `model` | string | `"gpt-image-1"` | Image generation model |
| `size` | string | — | Explicit size `"WxH"`, e.g. `"1024x1024"` |
| `n` | number | `1` | Number of images to generate (max 4) |
| `publicBaseUrl` | string | — | Base URL for public image links |
| `targetLongEdge` | number | `1024` | Target pixels for the long edge when `size` is omitted |
| `aspect` | string | — | Aspect preset: `"portrait"`, `"landscape"`, `"1:1"`, `"16:9"`, etc. |
| `enhancerApiUrl` | string | `"http://localhost:3400"` | Internal API base URL for prompt enhancement |
| `enhancerChannelId` | string | `""` | Channel ID for the prompt enhancer; if empty, heuristic fallback is used |
| `enhancerApiSecret` | string | `""` | Optional bearer token key name for the enhancer API |

---

#### toolsconfig.getImageDescription

Vision model — describe an image.

```json
"getImageDescription": {
  "apiKey":      "YOUR_OPENAI_API_KEY",
  "model":       "gpt-4o-mini",
  "endpoint":    "https://api.openai.com/v1/chat/completions",
  "temperature": 0.2,
  "maxTokens":   1000,
  "timeoutMs":   60000
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `apiKey` | string | — | **Required.** API key |
| `model` | string | `"gpt-4o-mini"` | Vision model |
| `endpoint` | string | — | **Required.** Chat completions endpoint |
| `temperature` | number | `0.2` | Sampling temperature |
| `maxTokens` | number | `1000` | Max tokens |
| `timeoutMs` | number | `60000` | Timeout (ms) |

---

#### toolsconfig.getImageSD

Local Stable Diffusion image generation (AUTOMATIC1111 WebUI API).

```json
"getImageSD": {
  "baseUrl":          "http://127.0.0.1:7860",
  "publicBaseUrl":    "https://myserver.com",
  "size":             "512x512",
  "n":                1,
  "steps":            15,
  "cfgScale":         7,
  "sampler":          "Euler a",
  "seed":             -1,
  "model":            "realisticVisionV60B1_v51HyperVAE.safetensors",
  "negativeExtra":    "overprocessed, muddy colors",
  "timeoutMs":        1400000,
  "networkTimeoutMs": 14400000
}
```

| Parameter | Type | Description |
|---|---|---|
| `baseUrl` | string | Local Stable Diffusion API URL (AUTOMATIC1111) |
| `publicBaseUrl` | string | Public base URL for generated images |
| `size` | string | Image size `"WxH"` |
| `n` | number | Number of images |
| `steps` | number | Inference steps |
| `cfgScale` | number | CFG guidance scale |
| `sampler` | string | Sampler algorithm |
| `seed` | number | Seed (-1 = random) |
| `model` | string | Checkpoint filename |
| `negativeExtra` | string | Extra negative prompt text |
| `timeoutMs` | number | Request timeout (ms) |
| `networkTimeoutMs` | number | Network-level timeout (ms) |

---

#### toolsconfig.getAnimatedPicture

Animate a still image into a short video (image-to-video via Replicate WAN).

```json
"getAnimatedPicture": {
  "videoApiToken":       "YOUR_REPLICATE_API_TOKEN",
  "videoBaseUrl":        "https://api.replicate.com/v1",
  "videoModel":          "wan-video/wan-2.5-i2v",
  "videoPollIntervalMs": 5000,
  "videoTimeoutMs":      600000,
  "videoPublicBaseUrl":  "https://myserver.com"
}
```

| Parameter | Type | Description |
|---|---|---|
| `videoApiToken` | string | **Required.** Replicate API token |
| `videoBaseUrl` | string | Replicate API base URL |
| `videoModel` | string | Model ID on Replicate (image-to-video) |
| `videoPollIntervalMs` | number | Poll interval for job status (ms) |
| `videoTimeoutMs` | number | Total timeout (ms) |
| `videoPublicBaseUrl` | string | Public base URL for video links |

---

#### toolsconfig.getVideoFromText

Generate a video from a text prompt (text-to-video via Replicate / Veo-3).

```json
"getVideoFromText": {
  "videoApiToken":       "YOUR_REPLICATE_API_TOKEN",
  "videoBaseUrl":        "https://api.replicate.com/v1",
  "videoModel":          "google/veo-3",
  "videoPollIntervalMs": 5000,
  "videoTimeoutMs":      600000,
  "videoPublicBaseUrl":  "https://myserver.com"
}
```

Same parameters as `getAnimatedPicture`, but for text-to-video generation.

---

#### toolsconfig.getYoutube

YouTube search and transcript fetcher.

```json
"getYoutube": {
  "googleApiKey":       "YOUR_GOOGLE_API_KEY",
  "endpoint":           "https://api.openai.com/v1/chat/completions",
  "apiKey":             "YOUR_OPENAI_API_KEY",
  "model":              "gpt-4.1",
  "temperature":        0.2,
  "maxTokens":          8000,
  "dumpThresholdChars": 20000,
  "transcriptLangs":    ["en", "de"],
  "regionCode":         "US",
  "relevanceLanguage":  "en",
  "searchMaxResults":   5,
  "aiTimeoutMs":        300000
}
```

| Parameter | Type | Description |
|---|---|---|
| `googleApiKey` | string | Google Data API v3 key (for search and metadata) |
| `endpoint` | string | Chat completions endpoint for AI summary |
| `apiKey` | string | API key for AI summary |
| `model` | string | Model for AI summary |
| `temperature` | number | Temperature for AI summary |
| `maxTokens` | number | Max tokens for AI response |
| `dumpThresholdChars` | number | Below this char count: dump mode; above: AI summary |
| `transcriptLangs` | array | Preferred transcript languages (falls back to `en`) |
| `regionCode` | string | YouTube region code, e.g. `"US"` |
| `relevanceLanguage` | string | Relevance language for search, e.g. `"en"` |
| `searchMaxResults` | number | Max search results (1–10) |
| `aiTimeoutMs` | number | Timeout for AI call (ms) |

---

#### toolsconfig.getJira

Full CRUD access to Jira Cloud issues via the Atlassian REST API.

```json
"getJira": {
  "baseUrl":          "https://DOMAIN.atlassian.net",
  "email":            "user@example.com",
  "token":            "YOUR_ATLASSIAN_API_TOKEN",
  "projectKey":       "PROJ",
  "defaultIssueType": "Task",
  "defaultAssignee":  "",
  "defaultPriority":  "Medium",
  "timeoutMs":        60000,
  "defaults": {
    "fields": {
      "summary":     "",
      "description": "",
      "priority": { "name": "Medium" }
    }
  },
  "customFields": {
    "epicLink":    "customfield_10014",
    "storyPoints": "customfield_10016"
  },
  "search": { "maxResults": 50 },
  "transitions": {
    "open":       "",
    "inProgress": "",
    "done":       ""
  }
}
```

| Parameter | Type | Description |
|---|---|---|
| `baseUrl` | string | **Required.** Jira Cloud base URL |
| `email` | string | **Required.** Atlassian account email |
| `token` | string | **Required.** Atlassian API token |
| `projectKey` | string | Default project key |
| `defaultIssueType` | string | Default issue type |
| `defaultAssignee` | string | Default assignee |
| `defaultPriority` | string | Default priority |
| `timeoutMs` | number | HTTP timeout (ms) |
| `defaults.fields` | object | Default field values for new issues |
| `customFields` | object | Custom field name-to-ID mapping |
| `search.maxResults` | number | Max results for JQL searches |
| `transitions` | object | Transition names for status changes |

---

#### toolsconfig.getConfluence

Full CRUD access to Confluence Cloud pages via the Atlassian REST API.

```json
"getConfluence": {
  "baseUrl":    "https://DOMAIN.atlassian.net/wiki",
  "email":      "user@example.com",
  "token":      "YOUR_ATLASSIAN_API_TOKEN",
  "project":    "SPACE_KEY",
  "mainPageId": "123456789",
  "useV2":      true
}
```

| Parameter | Type | Description |
|---|---|---|
| `baseUrl` | string | **Required.** Confluence Cloud wiki URL |
| `email` | string | **Required.** Atlassian account email |
| `token` | string | **Required.** Atlassian API token |
| `project` | string | Space key, e.g. `"ST"` |
| `mainPageId` | string | ID of the root page in the space |
| `useV2` | boolean | Use Confluence API v2 (recommended: `true`) |

---

#### toolsconfig.getPDF

HTML to PDF generator using Puppeteer (headless Chromium).

```json
"getPDF": {
  "publicBaseUrl":   "https://myserver.com",
  "headless":        "new",
  "chromeArgs":      ["--no-sandbox"],
  "waitUntil":       "networkidle0",
  "timeoutMs":       120000,
  "format":          "A4",
  "printBackground": true
}
```

| Parameter | Type | Description |
|---|---|---|
| `publicBaseUrl` | string | **Required.** Public base URL for PDF links |
| `headless` | string | Puppeteer mode: `"new"` \| `true` |
| `chromeArgs` | array | Chromium launch arguments |
| `waitUntil` | string | Puppeteer wait criterion: `"networkidle0"` \| `"domcontentloaded"` |
| `timeoutMs` | number | Timeout for PDF generation (ms) |
| `format` | string | Page format: `"A4"`, `"Letter"`, etc. |
| `printBackground` | boolean | Print background colours |

---

#### toolsconfig.getText

Plain-text file generator.

```json
"getText": {
  "publicBaseUrl": "https://myserver.com"
}
```

| Parameter | Type | Description |
|---|---|---|
| `publicBaseUrl` | string | **Required.** Public base URL for text file links |

---

#### toolsconfig.getHistory

Hierarchical history zoom retrieval.

```json
"getHistory": {
  "maxRows":        300,
  "includeToolRows": false,
  "includeJson":    false
}
```

| Parameter | Type | Description |
|---|---|---|
| `maxRows` | number | Maximum number of raw rows returned when the selected block is already at the bottom level |
| `includeToolRows` | boolean | Include tool-call rows when the bottom level returns raw history |
| `includeJson` | boolean | Include the stored JSON payload when the bottom level returns raw history |

---

#### toolsconfig.getLocation

Google Maps and Street View.

```json
"getLocation": {
  "googleApiKey":  "YOUR_GOOGLE_API_KEY",
  "publicBaseUrl": "https://myserver.com",
  "streetSize":    "800x600",
  "streetFov":     90,
  "timeoutMs":     20000
}
```

| Parameter | Type | Description |
|---|---|---|
| `googleApiKey` | string | **Required.** Google Maps API key |
| `publicBaseUrl` | string | **Required.** Public base URL for Street View images |
| `streetSize` | string | Street View image dimensions |
| `streetFov` | number | Field of view (degrees) |
| `timeoutMs` | number | HTTP timeout (ms) |

---

#### toolsconfig.getToken

Animated GIF generator from images or video.

```json
"getToken": {
  "publicBaseUrl":      "https://myserver.com",
  "magickPath":         "convert",
  "size":               512,
  "borderPx":           10,
  "ffmpegPath":         "ffmpeg",
  "maxMb":              10,
  "fpsList":            [12, 10, 8],
  "scaleList":          [512, 384, 320],
  "maxColorsList":      [128, 96, 64, 48, 32],
  "ditherList":         ["bayer:bayer_scale=3:diff_mode=rectangle", "none"],
  "useGifsicleLossy":   true,
  "gifsiclePath":       "gifsicle",
  "gifsicleLossyLevels": [80, 100, 120]
}
```

| Parameter | Type | Description |
|---|---|---|
| `publicBaseUrl` | string | **Required.** Public base URL for GIF links |
| `magickPath` | string | Path to the `convert` command (ImageMagick) |
| `size` | number | GIF target size in pixels |
| `borderPx` | number | Border in pixels |
| `ffmpegPath` | string | Path to `ffmpeg` |
| `maxMb` | number | Max GIF file size in MB |
| `fpsList` | array | Fallback FPS list (tried high-to-low) |
| `scaleList` | array | Fallback scale list in pixels |
| `maxColorsList` | array | Fallback palette colour counts |
| `ditherList` | array | Fallback dithering method list |
| `useGifsicleLossy` | boolean | Use gifsicle for lossy compression |
| `gifsiclePath` | string | Path to `gifsicle` |
| `gifsicleLossyLevels` | array | Gifsicle lossy compression levels |

---

#### toolsconfig.getGraph

Microsoft Graph API — SharePoint, OneDrive, Exchange mail, Azure AD/Entra user management. Uses **delegated OAuth2** tokens stored per Discord user in the `graph_tokens` database table. No app-level credentials are needed here; credentials are managed by `webpage-graph-auth` (module 00057) and `cron-graph-token-refresh` (module 00058).

```json
"getGraph": {
  "defaultSharePointHostname": "mycompany.sharepoint.com",
  "defaultMailFolderId":       "inbox",
  "defaultPageSize":           25
}
```

| Parameter | Type | Description |
|---|---|---|
| `defaultSharePointHostname` | string | SharePoint host (e.g. `mycompany.sharepoint.com`). Used for siteId auto-discovery. |
| `defaultUserId` | string | Fallback user ID / UPN when the AI does not specify one. With delegated auth this is rarely needed — the token already scopes requests to the authenticated user. |
| `defaultSiteId` | string | Fallback SharePoint site ID. Auto-discovered from `defaultSharePointHostname` when omitted. |
| `defaultDriveId` | string | Fallback drive ID. Auto-discovered from site or user when omitted. |
| `defaultMailFolderId` | string | Fallback mail folder ID or well-known name (`inbox`, `sentitems`, `deleteditems`, `drafts`, `junkemail`) |
| `defaultDestinationFolderId` | string | Fallback destination folder for `moveEmails` |
| `forcedUserId` | string | Overrides all user IDs (AI cannot override). Use for strict single-user deployments. |
| `forcedSiteId` | string | Overrides all site IDs (AI cannot override) |
| `forcedDriveId` | string | Overrides all drive IDs (AI cannot override) |
| `forcedMailFolderId` | string | Overrides all mail folder IDs (AI cannot override) |
| `forcedDestinationFolderId` | string | Overrides destination folder ID (AI cannot override) |
| `version` | string | Default Graph API version (`v1.0` or `beta`) |
| `defaultPageSize` | number | Default page size for list/search operations |
| `defaultEntityTypes` | array | Default entity types for `fulltextSearch` |
| `timeoutMs` | number | HTTP request timeout in ms (default: 30000) |

**Auto-discovery (no secret DB entries needed for IDs):**
- `siteId` is auto-discovered via `GET /sites/{hostname}:/` when `defaultSharePointHostname` is set and `defaultSiteId` is not
- `driveId` is auto-discovered via `GET /sites/{siteId}/drive` (or `/me/drive` when no site) when not set
- Discovery results are cached for 5 minutes per process

**Minimum required config:** none — the tool works with an empty config object as long as the user has authenticated at `/graph-auth`. Add `defaultSharePointHostname` to enable SharePoint auto-discovery.

---

#### toolsconfig.getSpotify

Spotify API — playback control, device management, playlist operations, and search. This is the only music playback tool; the AI uses it for all music requests regardless of whether the user mentions Spotify. Uses **delegated OAuth2** tokens stored per Discord user in the `spotify_tokens` database table. No app-level credentials are needed here; credentials are managed by `webpage-spotify-auth` (module 00061) and `cron-spotify-token-refresh` (module 00062). **Spotify Premium is required for playback control operations** (play, pause, transfer).

```json
"getSpotify": {}
```

No additional config keys are required. The tool reads the authenticated user's token directly from the DB.

**Minimum required config:** none — the tool works with an empty config object as long as the user has authenticated at `/spotify-auth`. See the full [getSpotify reference](#getspotify) for the complete play workflow and all parameters.

---

#### toolsconfig.getOrchestrator

Synchronous orchestrator tool. The calling AI blocks until the orchestrator finishes and returns its result. The orchestrator runs as a normal API pipeline (flow `api`) on a dynamically generated unique channel ID derived from the configured base channel. It has full access to all tools including `getSpecialists`.

```json
"getOrchestrator": {
  "types": {
    "generic": "subagent-orchestrator-generic"
  },
  "defaultType": "generic",
  "apiUrl":      "http://localhost:3400",
  "apiSecret":   "API_SECRET",
  "timeoutMs":   604800000
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `types` | object | `{}` | **Required.** Maps orchestrator type names to base channel IDs. Each call appends a random hex suffix to ensure uniqueness. |
| `defaultType` | string | `"generic"` | Fallback type when the AI omits the `type` argument. |
| `apiUrl` | string | `"http://localhost:3400"` | Base URL of the internal API server to dispatch the orchestrator to. |
| `apiSecret` | string | `""` | Placeholder name for the bearer token (resolved from `bot_secrets` at runtime). |
| `timeoutMs` | number | `604800000` | Maximum wait time for the orchestrator to complete (milliseconds). Default is 7 days — set lower for interactive use cases. |

**How it works:** The tool posts a payload to `apiUrl/api` with the generated channel ID, user ID, guild ID, `callerChannelId`, and `callerChannelIds`. The orchestrator channel must be configured as a valid API channel in `core.json`. The `callerChannelId` allows the orchestrator to send results back to the originating channel. The tool returns `{ ok, rows: [responseText] }`.

**`wo.aborted` check:** If `wo.aborted === true` when the tool is called, it returns immediately without dispatching.

---

#### toolsconfig.getSpecialists

Parallel specialist dispatcher. Runs multiple specialist AI workers concurrently in configurable batch sizes and waits for all to complete. Designed to be called **from within an orchestrator** — not from a primary user channel. Each specialist receives its own unique channel ID derived from the base channel configured for its type.

```json
"getSpecialists": {
  "types": {
    "specialist-generic": "subagent-specialist-generic",
    "specialist-coding":  "subagent-specialist-coding"
  },
  "defaultType":    "specialist-generic",
  "apiUrl":         "http://localhost:3400",
  "apiSecret":      "API_SECRET",
  "timeoutMs":      604800000,
  "maxConcurrent":  3
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `types` | object | `{}` | **Required.** Maps specialist type names to base channel IDs. |
| `defaultType` | string | `""` | Fallback type for specialist entries that omit `type`. |
| `apiUrl` | string | `"http://localhost:3400"` | Base URL of the internal API server. |
| `apiSecret` | string | `""` | Placeholder name for the bearer token. |
| `timeoutMs` | number | `604800000` | Maximum wait time per specialist (milliseconds). |
| `maxConcurrent` | number | `3` | Maximum number of specialist calls running at the same time. Specialists are processed in sequential batches of this size. |

**Input format:** The AI passes a `specialists` array where each entry is `{ type, jobID, prompt }`. The `jobID` is an integer that the orchestrator assigns and uses to correlate results. The tool returns an array of result objects `{ jobID, type, ok, response?, error? }`.

**Batch execution:** Specialists are split into sequential batches of `maxConcurrent`. Within each batch all calls run concurrently via `Promise.all`. The tool waits for the entire batch before starting the next.

**Return value:** `{ ok, count, complete, failed, rows: [...results], error? }`. `ok` is `true` only if all specialists succeeded.

---

### 5.7 config — Flow Wiring and Module Configuration

The `config` block controls which modules are active in which flows.

#### config.discord

Configures and starts the Discord.js gateway client.

```json
"discord": {
  "flowName": "discord",
  "token": "YOUR_DISCORD_BOT_TOKEN",
  "intents": [
    "Guilds",
    "GuildMessages",
    "MessageContent",
    "GuildVoiceStates",
    "GuildMembers",
    "DirectMessages"
  ]
}
```

| Parameter | Type | Description |
|---|---|---|
| `flowName` | string | Internal flow name (`"discord"`) |
| `token` | string | **Required.** Discord bot token |
| `intents` | array | Discord Gateway intents |

---

#### config.api

Starts a lightweight HTTP API server.

**Token gating:** Set `workingObject.apiSecret` to enable token checking. Every request must include `Authorization: Bearer <secret>`.

**Channel blocking:** Set `apiEnabled: 0` in a channel override to block API access permanently.

```json
"api": {
  "flowName": "api",
  "host":     "0.0.0.0",
  "port":     3400,
  "path":     "/api"
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `flowName` | string | `"api"` | Internal flow name |
| `host` | string | `"0.0.0.0"` | Bind host |
| `port` | number | `3400` | HTTP port |
| `path` | string | `"/api"` | API endpoint path |

---

#### config.webpage-config-editor

Visual config editor served on a dedicated port. Objects render as collapsible cards, flat arrays as tag chips, secrets as password fields. Supports adding and removing attributes, sub-blocks and array items directly in the UI. Edits are tracked in memory and written atomically on save. The port must also appear in `config.webpage.ports`.

```json
"webpage-config-editor": {
  "flow":         ["webpage"],
  "port":         3111,
  "basePath":     "/config",
  "file":         "/absolute/path/to/core.json",
  "allowedRoles": ["admin"]
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `flow` | array | `["webpage"]` | Must include `"webpage"` for the module to activate |
| `port` | number | `3111` | HTTP port — must also be listed in `config.webpage.ports` |
| `basePath` | string | `"/config"` | URL prefix served by this module |
| `file` | string | *(project root core.json)* | Absolute path to the JSON file to edit |
| `allowedRoles` | array | `["admin"]` | Roles allowed to view and save the config. Empty array = public |

---

#### config.webpage-chat

Serves the **AI chat SPA** (`GET /chat`) on a dedicated port. `00048-webpage-chat` is a pure HTTP handler — it sets up the `workingObject` (`channelId`, `payload`, `subchannel`, `contextSize`) and returns; the AI pipeline modules (01000–01003) then process the request naturally. Subchannels allow scoped conversation threads per channel, stored in the `chat_subchannels` DB table. Prompt, persona, and instructions come only from channel config and manifests, not from the subchannel table.

```jsonc
{
  "webpage-chat": {
    "flow":             ["webpage"],
    "port":             3112,
    "basePath":         "/chat",
    "allowedRoles":     ["member", "admin"],
    "systemPrompt":     "",
    "contextSize":      20,
    "maxTokens":        1024,
    "toolStatusPollMs": 500,
    "chats": [
      {
        "label":     "General",
        "channelId": "YOUR_CHANNEL_ID",
        "apiUrl":    "http://localhost:3400/api",
        "apiSecret": "your-secret-here",
        "roles":     []
      }
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
| `toolStatusPollMs` | Polling interval in ms for the toolcall status display inside the thinking bubble (default `500`). The frontend polls `GET /chat/api/toolstatus?channelId=<id>` at this rate while waiting for an AI response. |
| `chats[].label` | Display name in the channel selector |
| `chats[].channelId` | Channel ID used as context scope |
| `chats[].apiUrl` | Internal API endpoint for this chat (default `http://localhost:3400/api`). Per-chat override — each entry can point to a different API. |
| `chats[].apiSecret` | Placeholder name resolved from `bot_secrets` at runtime via `getSecret()`. Sent as `Authorization: Bearer` with every AI request and file upload proxy request. Must match the `apiSecret` in `core-channel-config`. Falls back to top-level `cfg.apiSecret` if omitted. Leave empty if no token gate is active. |
| `chats[].roles` | Optional role restriction for this chat entry |

> `apiUrl` and `apiSecret` are per chat entry. Different chats can use different API endpoints and secret aliases. If a chat entry omits `apiSecret`, the top-level `cfg.apiSecret` is used as fallback. The stored config value must be a placeholder alias, not a committed real token.

> AI credentials (`apiKey`, `model`, `endpoint`) are read from the workingObject — the same global bot config used by all channels. No separate `ai.*` section is needed in `webpage-chat`.

---

#### config.webpage-live

Live context monitor SPA (`modules/00059-webpage-live.js`, port 3123, `/live`). Polls the `context` table at a configurable interval and streams new rows as a live chat transcript. Channels are shown as checkboxes (select one or more); fields (timestamp, channel ID, role) are toggleable. `json.authorName` and `json.content` are extracted from the stored JSON to produce readable author names and message texts — Discord user messages always carry both. The settings sidebar (channels, fields, poll interval, initial load) is collapsible via a toggle button (◀/▶). Autoscroll, polling and sidebar collapsed state persist in `localStorage` (`live_autoscroll`, `live_polling`, `live_sidebar_collapsed`).

**Message ordering:** Each message element in the DOM carries `data-ts` and `data-ctx-id` attributes. When a poll response arrives, messages are sorted by `ts` (tiebreaker: `ctx_id`) before insertion, and each is placed at the correct DOM position using a reverse scan of existing children. This prevents race conditions where a delayed poll response would otherwise append earlier messages after newer ones already on screen.

```jsonc
"webpage-live": {
  "flow":             ["webpage"],
  "port":             3123,
  "basePath":         "/live",
  "allowedRoles":     ["admin"],
  "pollIntervalMs":   2000,
  "messageLimit":     300
}
```

| Key | Description |
|---|---|
| `flow` | Must include `"webpage"` |
| `port` | HTTP port (default `3123`) — must also be in `config.webpage.ports` and `config.webpage-auth.ports` |
| `basePath` | URL prefix (default `"/live"`) |
| `allowedRoles` | Roles allowed to access the page (default `["admin"]`) |
| `pollIntervalMs` | Default poll interval in ms; overridable in the UI (default `2000`, min `500`) |
| `messageLimit` | Max rows returned per API call; also the max initial load limit selectable in the UI (default `300`) |

> Add `3123` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`, and add `reverse_proxy /live* localhost:3123` to your Caddyfile.

---

#### config.cron

Runs scheduled background jobs.

```json
"cron": {
  "flowName": "cron",
  "timezone": "Europe/Berlin",
  "tickMs":   15000,
  "jobs": [
    {
      "id":        "my-job",
      "cron":      "*/1 * * * *",
      "enabled":   true,
"channelId": "DISCORD_CHANNEL_ID"
    }
  ]
}
```

| Parameter | Type | Description |
|---|---|---|
| `flowName` | string | Internal flow name |
| `timezone` | string | Timezone for cron evaluation |
| `tickMs` | number | Check interval in milliseconds |
| `jobs[].id` | string | Unique job ID |
| `jobs[].cron` | string | Cron expression (`* * * * *` or `*/N * * * *`) |
| `jobs[].enabled` | boolean | Job enabled/disabled |
| `jobs[].channelId` | string | Target Discord channel ID |

---

#### config.context

Controls the hierarchical zoom context engine and its supporting derived layers.

```json
"context": {
  "endpoint":           "https://api.openai.com/v1/chat/completions",
  "model":              "gpt-4o-mini",
  "apiKey":             "YOUR_OPENAI_API_KEY",
  "segmentTurnCount":   6,
  "nodeBranchFactor":   4,
  "recentRawCount":     80,
  "retrievalMaxSegments": 6,
  "retrievalNeighborSegments": 1,
  "retrievalMaxNodeSummaries": 2,
  "segmentGapMinutes":  20,
  "summaryMaxLength":   320,
  "anchorEnabled":      true,
  "anchorRebuildOnWrite": true,
  "anchorMinConfidence": 0.2,
  "anchorMaxEvidenceRows": 12,
  "anchorOriginDepth":  3,
  "anchorLinkedContextWeight": 0.55,
  "anchorLlmFallbackEnabled": false,
  "embeddingEnabled":   true,
  "embeddingRebuildOnWrite": true,
  "embeddingMaxCandidates": 10,
  "embeddingMinScore":  0.18,
  "embeddingLinkedContextWeight": 0.5,
  "historyZoomEnabled": true,
  "historyZoomBaseSize": 100,
  "historyZoomMaxLevels": 4,
  "historyZoomLinkedContextWeight": 0.5,
  "historyZoomRebuildOnWrite": true,
  "meshEnabled":       true,
  "meshRebuildOnWrite": true,
  "meshTargetMicroRows": 100,
  "meshRollupFactor":  10,
  "meshMaxLevels":     4,
  "meshEntityMinConfidence": 0.25,
  "meshGraphDepth":    2,
  "meshLinkedContextWeight": 0.5,
  "meshNeighborBlockCount": 2,
  "eventEnabled":       true,
  "eventRebuildOnWrite": true,
  "eventMinConfidence": 0.28,
  "eventMaxCandidates": 8,
  "eventLinkedContextWeight": 0.45,
  "eventMinRows":       3,
  "eventMaxRows":       18,
  "eventAdaptiveGapMinutes": 12,
  "subchannelFallback": false
}
```

| Parameter | Type | Description |
|---|---|---|
| `endpoint` | string | Reserved compatibility setting for future internal API-based context enrichment. Modules and tools must not call LLM providers directly. |
| `model` | string | Reserved compatibility setting for future internal API-based context enrichment |
| `apiKey` | string | Reserved compatibility setting for future internal API-based context enrichment |
| `segmentTurnCount` | number | Target number of turns per derived retrieval segment |
| `nodeBranchFactor` | number | Number of child segments or nodes grouped into one higher-level node |
| `recentRawCount` | number | Number of newest raw rows always considered for continuity |
| `retrievalMaxSegments` | number | Maximum number of matched derived segments expanded into the snapshot |
| `retrievalNeighborSegments` | number | Number of neighboring segments to include around each matched segment |
| `retrievalMaxNodeSummaries` | number | Maximum number of higher-level node summaries used as compression overlays |
| `segmentGapMinutes` | number | Time gap threshold that starts a new derived segment |
| `summaryMaxLength` | number | Maximum length of injected summary overlay text |
| `anchorEnabled` | boolean | Enables the generic anchor graph on top of the derived context layers |
| `anchorRebuildOnWrite` | boolean | Rebuilds anchor tables together with the other derived context tables after writes |
| `anchorMinConfidence` | number | Minimum confidence threshold for anchor retrieval matches |
| `anchorMaxEvidenceRows` | number | Maximum evidence windows per matched anchor expanded into the snapshot |
| `anchorOriginDepth` | number | Number of earliest segments treated as the origin window for anchor paths |
| `anchorLinkedContextWeight` | number | Weight multiplier applied to anchors from linked `channelIds` compared to the base context |
| `anchorLlmFallbackEnabled` | boolean | Reserved optional switch for future internal API-based fallback enrichment. Default `false`. |
| `embeddingEnabled` | boolean | Enables the local semantic fingerprint layer used for hybrid RAG retrieval |
| `embeddingRebuildOnWrite` | boolean | Rebuilds semantic fingerprints together with the other derived context tables after writes |
| `embeddingMaxCandidates` | number | Maximum number of semantic matches considered per context source |
| `embeddingMinScore` | number | Minimum local vector similarity score required for a semantic match |
| `embeddingLinkedContextWeight` | number | Weight multiplier applied to semantic matches from linked `channelIds` compared to the base context |
| `historyZoomEnabled` | boolean | Enables the hierarchical zoom output for older history |
| `historyZoomBaseSize` | number | Base block size used for the newest raw window and each zoom hierarchy level |
| `historyZoomMaxLevels` | number | Maximum number of summary levels built above the raw layer |
| `historyZoomLinkedContextWeight` | number | Weight multiplier applied to linked `channelIds` when choosing older zoom blocks |
| `historyZoomRebuildOnWrite` | boolean | Rebuilds the zoom hierarchy together with the other derived context layers after writes |
| `meshEnabled` | boolean | Enables the context mesh built from micro blocks, rollup blocks, and entity links |
| `meshRebuildOnWrite` | boolean | Rebuilds the mesh tables together with the other derived context tables after writes |
| `meshTargetMicroRows` | number | Target raw-row size for one adaptive micro block |
| `meshRollupFactor` | number | Target number of child blocks grouped into one higher rollup block |
| `meshMaxLevels` | number | Maximum number of rollup levels built above the micro blocks |
| `meshEntityMinConfidence` | number | Minimum confidence threshold for mesh-entity retrieval matches |
| `meshGraphDepth` | number | Maximum expansion depth when traversing the mesh during retrieval |
| `meshLinkedContextWeight` | number | Weight multiplier applied to mesh matches from linked `channelIds` compared to the base context |
| `meshNeighborBlockCount` | number | Number of neighboring mesh blocks considered during expansion |
| `eventEnabled` | boolean | Enables the generic event-memory layer for unnamed historical episodes and transitions |
| `eventRebuildOnWrite` | boolean | Rebuilds event tables together with the other derived context tables after writes |
| `eventMinConfidence` | number | Minimum confidence threshold for event retrieval matches |
| `eventMaxCandidates` | number | Maximum number of event candidates considered per context source |
| `eventLinkedContextWeight` | number | Weight multiplier applied to events from linked `channelIds` compared to the base context |
| `eventMinRows` | number | Minimum raw-row window size for one derived event block |
| `eventMaxRows` | number | Maximum raw-row window size for one derived event block |
| `eventAdaptiveGapMinutes` | number | Time-gap threshold used when expanding event windows around candidate rows |
| `subchannelFallback` | boolean | `false` (default): when `wo.subchannel` is not set, all functions (getContext, setPurgeContext, setFreezeContext, getContextLastSeconds, getContextSince) operate only on rows where `subchannel IS NULL`. `true`: no subchannel filter — all rows for the channel including subchannel rows are included. |

---

#### config.toolcall

Wires up the internal tool-call status tracking flow.

```json
"toolcall": {
  "flowName":       "toolcall",
  "pollMs":         400,
  "initialDelayMs": 500,
  "registryKey":    "status:tool"
}
```

| Parameter | Type | Description |
|---|---|---|
| `flowName` | string | Internal flow name |
| `pollMs` | number | Poll interval for tool status (ms) |
| `initialDelayMs` | number | Initial wait before first poll (ms) |
| `registryKey` | string | Registry key for tool status |

---

#### config.bard

Configuration for the headless bard music scheduler.

```json
"bard": {
  "musicDir":      "assets/bard",
  "pollIntervalMs": 5000
}
```

| Parameter | Type | Description |
|---|---|---|
| `musicDir` | string | Directory containing MP3 files and `library.xml` (default: `assets/bard`) |
| `pollIntervalMs` | number | Poll interval in milliseconds (min 5000, default: 5000) |

#### config.bard-join

Configuration for the bard start/stop command handler.

```json
"bard-join": {
  "flow": ["discord-admin", "discord", "webpage", "api"],
  "commandPrefix": ["/"]
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `flow` | array | — | Must include `"discord-admin"` for slash commands. Add `"discord"`, `"webpage"`, and/or `"api"` to also accept text-based `/bardstart` and `/bardstop` commands in those flows. The `"api"` flow is used internally by the webpage-chat SPA proxy. |
| `commandPrefix` | array | `["/"]` | Prefix characters that trigger the command in `discord` and `webpage` flows. Only used when the flow is not `discord-admin`. |

---

#### config.bard-cron

Configuration for the label-generation module. AI params (`endpoint`, `apiKey`, `model`) fall back to the global `workingObject` defaults if not set here.

```json
"bard-cron": {
  "flow": ["bard-label-gen"],
  "prompt": "Optional custom system prompt template (use {{TAGS}} placeholder)"
}
```

---

#### config.discord-voice-capture

Controls PCM capture and VAD from the Discord voice receiver. Produces a 16kHz mono WAV file and writes `wo.transcribeAudio = true` for the transcription module. Does not make quality decisions — those are handled by `core-voice-transcribe`.

```json
"discord-voice-capture": {
  "flow":              ["discord-voice"],
  "pollMs":            1000,
  "silenceMs":         1500,
  "maxCaptureMs":      25000,
  "minWavBytes":       24000,
  "frameMs":           20,
  "startDebounceMs":   600,
  "maxSegmentsPerRun": 32,
  "keepWav":           false
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `pollMs` | number | `1000` | How often the voice receiver is polled (ms) |
| `silenceMs` | number | `1500` | Silence duration that ends a capture segment (ms) |
| `maxCaptureMs` | number | `25000` | Maximum capture duration per segment (ms) |
| `minWavBytes` | number | `24000` | Minimum WAV size (bytes); segments below this are skipped |
| `frameMs` | number | `20` | Opus frame duration (ms) |
| `startDebounceMs` | number | `600` | Debounce before starting a new capture (ms) |
| `maxSegmentsPerRun` | number | `32` | Maximum segments processed per polling cycle |
| `keepWav` | boolean | `false` | Retain WAV files on disk after processing (for debugging) |

---

#### config.core-voice-transcribe

Source-agnostic transcription module. Active in `discord-voice` and `webpage` flows. When `wo.audioStats` is present, applies a quality gate before calling the transcription API. Large audio files (>20 MB) are automatically split into overlapping chunks and transcribed sequentially.

**Speaker stitching (diarize mode):** Each chunk after the first starts `overlapDurationS` seconds earlier than its logical boundary. After transcription, speakers that appear in the overlap region are matched to the global labels from the previous chunk by order of first appearance. Matched speakers keep their global label (A, B, …); unmatched speakers receive an offset label (e.g. `C_2`) to signal uncertain identity. The overlap region is excluded from the final output so that no text appears twice.

API credentials fall back to `workingObject.transcribeApiKey` / `OPENAI_API_KEY` env var if not set here.

**Diarize support:** When the model name contains `"diarize"` (e.g. `gpt-4o-transcribe-diarize`), the module sets `response_format: "diarized_json"` and `chunking_strategy: "auto"`. The API returns a structured response with per-segment speaker labels; the module converts these to `A: text\nB: text` lines in `wo.payload` (using whatever label the API provides — typically single letters like `A`, `B`).

```json
"core-voice-transcribe": {
  "flow":                   ["discord-voice", "webpage"],
  "minVoicedMs":            1000,
  "snrDbThreshold":         3.8,
  "keepWav":                false,
  "transcribeModel":        "gpt-4o-mini-transcribe",
  "transcribeModelDiarize": "gpt-4o-transcribe-diarize",
  "chunkDurationS":         300,
  "overlapDurationS":       60,
  "transcribeLanguage":     "",
  "transcribeEndpoint":     "",
  "transcribeApiKey":       ""
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `minVoicedMs` | number | `1000` | Minimum voiced audio (ms) required; checked against `wo.audioStats.usefulMs` when set |
| `snrDbThreshold` | number | `3.8` | SNR threshold; segments below this are discarded; checked against `wo.audioStats.snrDb` when set |
| `keepWav` | boolean | `false` | Retain WAV files on disk after transcription (for debugging) |
| `transcribeModel` | string | `"gpt-4o-mini-transcribe"` | Transcription model for always-on voice turns and discord-voice. Overridable per-turn via `wo.transcribeModel`. |
| `transcribeModelDiarize` | string | `"gpt-4o-transcribe-diarize"` | Transcription model used when `wo.transcribeOnly === true` (meeting recorder). |
| `diarizeChunkMB` | number | `1` | Target chunk size for the diarize meeting path (`transcribeOnly`). The duration heuristic is still derived from `diarizeChunkMB` and `opusBitrateKbps`, but chunks are materialized as 16 kHz mono WAV before the sample preamble is prepended so FFmpeg concatenation stays format-compatible. At the default heuristic (1 MB, 32 kbps), the resulting chunk duration is roughly 4 minutes. Smaller values produce more granular Review chunks but more API calls. |
| `opusBitrateKbps` | number | `32` | Opus audio bitrate (kbps) used when encoding diarize chunks. 32 kbps is sufficient quality for mono speech and keeps chunk files small. |
| `chunkDurationS` | number | `300` | Duration (seconds) of each chunk when splitting large audio files. Files >20 MB are split automatically. |
| `overlapDurationS` | number | `60` | Seconds of audio overlap between consecutive chunks when splitting large files in diarize mode. The overlap is used to match speaker labels across chunks; the overlapping audio is excluded from the final transcript to avoid duplicate text. |
| `transcribeLanguage` | string | `""` | Force a specific language (ISO 639-1). Empty = auto-detect. |
| `transcribeEndpoint` | string | `""` | Base URL for the transcription API. Falls back to `workingObject.transcribeEndpoint` and otherwise uses the default OpenAI transcription endpoint. |
| `transcribeApiKey` | string | `""` | API key for transcription. Falls back to `workingObject.transcribeApiKey` then `OPENAI_API_KEY` env var. |

---

#### config.core-voice-tts

Source-agnostic TTS renderer. Active in `discord-voice` and `webpage` flows. Splits `wo.response` on `[speaker: <voice>]` tags for multi-voice output. Calls the OpenAI TTS API for each segment in parallel (concurrency 2). TTS credentials fall back to `workingObject.ttsApiKey` / `workingObject.apiKey` if not set here.

```json
"core-voice-tts": {
  "flow":              ["discord-voice", "webpage"],
  "ttsModel":          "gpt-4o-mini-tts",
  "ttsVoice":          "alloy",
  "ttsEndpoint":       "",
  "ttsApiKey":         "",
  "ttsFormat":         "opus",
  "ttsFetchTimeoutMs": 30000
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `ttsModel` | string | `"gpt-4o-mini-tts"` | TTS model. Falls back to `workingObject.ttsModel` if not set |
| `ttsVoice` | string | `"alloy"` | Default TTS voice. Falls back to `workingObject.ttsVoice` if not set |
| `ttsEndpoint` | string | `""` | TTS API endpoint. Falls back to `workingObject.ttsEndpoint` |
| `ttsApiKey` | string | `""` | API key for TTS. Falls back to `workingObject.ttsApiKey` then `workingObject.apiKey` |
| `ttsFormat` | string | `"opus"` | Audio format. Use `"mp3"` for webpage voice; `"opus"` for Discord playback |
| `ttsFetchTimeoutMs` | number | `30000` | HTTP timeout for TTS API calls (ms) |

---

#### config.discord-voice-tts-play

Discord-specific TTS playback. Plays `wo.ttsSegments` into the active voice channel using the @discordjs/voice AudioPlayer. Manages a guild-level lock to prevent overlapping speech. Only active in `discord-voice`.

```json
"discord-voice-tts-play": {
  "flow": ["discord-voice"]
}
```

| Parameter | Type | Description |
|---|---|---|
| `flow` | array | Must include `"discord-voice"` |

---

#### config.webpage-voice

Browser-based always-on voice interface with meeting recorder, speaker management, and diarization review. Serves the SPA at `GET /voice` and accepts audio at `POST /voice/audio`. The meeting recorder uses `?transcribeOnly=1` to skip AI/TTS, store a diarized session in the DB, and let the user review/correct speaker assignments before applying the transcript to the channel context.

Async subagent completions triggered from `/voice` are re-delivered through the original caller channel. The poller runs a persona pass on the caller channel first, then synthesizes the final text through the webpage voice flow. This ensures the spoken answer uses the same caller-specific instructions as the original channel and any generated document or media links are patched with `id=<callerChannelId>` instead of a subagent channel ID. If the raw subagent result already contains artifact URLs, the delivery helper preserves those URLs in the final caller-facing response even when the persona pass rewrites the surrounding prose.

```json
"webpage-voice": {
  "flow":                          ["webpage"],
  "port":                          3119,
  "basePath":                      "/voice",
  "silenceTimeoutMs":              2500,
  "silenceRmsThreshold":           0.04,
  "maxDurationMs":                 30000,
  "allowedRoles":                  [],
  "clearContextChannels":          [],
  "sampleModel":                   "gpt-4o-mini-transcribe",
  "transcribeApiKey":              "",
  "transcribeEndpoint":            "",
  "channels": [
    { "id": "YOUR_CHANNEL_ID", "label": "General" }
  ]
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `flow` | array | — | Must include `"webpage"` |
| `port` | number | `3119` | HTTP port — must also be in `config.webpage.ports` |
| `basePath` | string | `"/voice"` | URL prefix for this module |
| `silenceTimeoutMs` | number | `2500` | Silence duration (ms) before the always-on mic auto-sends audio |
| `silenceRmsThreshold` | number | `0.04` | RMS amplitude threshold below which audio is considered silence. Raise this value if background noise is detected as speech. Recommended: `0.04` for slight sensitivity reduction, `0.07` for noisy environments. Production default: `0.07`. |
| `maxDurationMs` | number | `30000` | Hard cap on a single always-on audio segment (ms) |
| `allowedRoles` | array | `[]` | Roles that may access the voice interface. Empty array = public |
| `clearContextChannels` | array | `[]` | Channel IDs whose non-frozen context rows are purged (via `setPurgeContext`) before writing a transcript. Frozen rows are never deleted. Add a channel ID here for "start-of-session" mode on that channel. |
| `sampleModel` | string | `"gpt-4o-mini-transcribe"` | Transcription model used to transcribe speaker sample recordings in the Speakers tab |
| `transcribeApiKey` | string | `OPENAI_API_KEY` env fallback | API key used for speaker sample transcription |
| `transcribeEndpoint` | string | `""` | Optional custom OpenAI-compatible base URL for sample transcription |
| `channels` | array | `[]` | Channel list shown in the SPA dropdown. Each entry: `{ "id": "...", "label": "..." }`. If empty, a free-text input is shown instead. |

---

#### config.webpage-voice-input

Handles `POST /voice/audio` — converts incoming audio to WAV and sets `wo` fields for the shared transcription pipeline. Reads config from `config["webpage-voice-input"]`.

```json
"webpage-voice-input": {
  "flow": ["webpage"],
  "port": 3119
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `flow` | array | — | Must include `"webpage"` |
| `port` | number | `3119` | Must match `config["webpage-voice"].port` |

---

#### config.webpage-voice-record

Handles `POST /voice/record` — full meeting recording: transcribes audio, optionally runs diarization through the internal API channel, then stores transcript in context DB. Reads config from `config["webpage-voice-record"]`. If the diarize transcription path fails, the runtime now retries once with the standard transcription model so the browser still receives a transcript instead of a generic `400`.

```json
"webpage-voice-record": {
  "flow":                 ["webpage"],
  "port":                 3119,
  "allowedRoles":         ["member", "admin"],
  "transcribeModel":      "gpt-4o-transcribe",
  "transcribeApiKey":     "",
  "transcribeEndpoint":   "",
  "diarize":              true,
  "diarizationChannelId": "voice-diarize",
  "apiUrl":               "http://localhost:3400",
  "apiSecret":            "API_SECRET",
  "diarizationSystemPrompt": "",
  "clearContextChannels": []
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `flow` | array | — | Must include `"webpage"` |
| `port` | number | `3119` | Must match `config["webpage-voice"].port` |
| `allowedRoles` | array | `[]` | Roles allowed to use the recorder. Empty = open |
| `transcribeModel` | string | `"gpt-4o-transcribe"` | Transcription model for the recorder |
| `transcribeApiKey` | string | `wo.apiKey` | Alias for the transcription API secret |
| `transcribeEndpoint` | string | `wo.transcribeEndpoint` | Base URL for the transcription API |
| `diarize` | boolean | `true` | Run speaker-attribution pass after transcription |
| `diarizationChannelId` | string | `""` | Internal API channel used for diarization inference |
| `apiUrl` | string | `http://localhost:3400` | Internal API base URL for diarization requests |
| `apiSecret` | string | `""` | Optional bearer token placeholder resolved via `bot_secrets` |
| `diarizationSystemPrompt` | string | built-in default | Prompt prefix sent before segment list |
| `clearContextChannels` | array | `[]` | Channel IDs whose non-frozen context rows are purged (via `setPurgeContext`) before storing the transcript. Frozen rows are never deleted. |

---

#### config.webpage-voice-add-context

Writes the voice transcription to the context DB immediately after transcription for the **always-on voice path only** (position 00031). Skips when `wo.transcribeOnly === true` (meeting recorder) — those transcripts are stored in the diarize review DB and written to context only when the user clicks **Apply to Channel**. Reads config from `config["webpage-voice-add-context"]`.

```json
"webpage-voice-add-context": {
  "flow": ["webpage"]
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `flow` | array | — | Must include `"webpage"` |

> **Note:** This module does **not** purge context. Context purging (`clearContextChannels`) is intentionally restricted to the meeting transcript apply path (`00047`, Apply button) and the recording endpoint (`00027`, `POST /voice/record`). Always-on voice turns must never clear the context, so that follow-up questions about a stored transcript continue to work.

---

#### config.webpage-voice-output

Sends TTS audio back to the webpage voice caller. Triggered unconditionally when `wo.isWebpageVoice === true`.

The same synthesis path is also used for async subagent completions in the webpage voice interface. When the SSE stream is connected, the browser receives `audioBase64` plus `audioMime` and plays the spoken answer immediately. If the SSE client missed the event, the fallback `/api/jobs` payload can carry the same audio fields.

```json
"webpage-voice-output": {
  "flow": ["webpage"]
}
```

| Parameter | Type | Description |
|---|---|---|
| `flow` | array | Must include `"webpage"` |

> **Always-on mic — recording restart after TTS:** The SPA does not restart the microphone immediately after sending a voice turn. It waits until the TTS audio response has finished playing before calling `getUserMedia` again. This prevents `getUserMedia` from interrupting the browser's audio session mid-playback. The restart is triggered by the `playNextAudio` done callback once the audio queue is empty. For text-only responses (no TTS audio), the mic restarts immediately after the response arrives.

> **Mobile scrollability:** The voice SPA and keymanager pages apply `body { overflow-y: auto }` in their own `<style>` block to override the shared CSS `body { overflow: hidden }`. The voice page additionally applies `justify-content: flex-start` on screens narrower than 640 px so that buttons are not pushed behind the browser chrome or navigation bar.

---

#### config.webpage-router

Maps HTTP endpoints (by port + path prefix) to named flows and sets `wo.channelId` from the request. This runs before `core-channel-config` (module 00010), allowing per-flow `core-channel-config` overrides to apply to web endpoints the same way they apply to Discord channels.

**Use case:** Give `/voice` or `/wiki` requests their own named flow so that `core-channel-config` can apply a `flows[].flowMatch` override for that specific flow (e.g. a different trigger word on the voice page).

```json
"webpage-router": {
  "flow": ["webpage"],
  "routes": [
    {
      "port":            3117,
      "pathPrefix":      "/wiki",
      "flow":            "webpage-wiki",
      "channelIdSource": "path:0"
    },
    {
      "port":            3119,
      "pathPrefix":      "/voice",
      "flow":            "webpage-voice",
      "channelIdSource": "query:channelId"
    }
  ]
}
```

| Parameter | Type | Description |
|---|---|---|
| `flow` | array | Must include `"webpage"` |
| `routes[].port` | number | HTTP port to match |
| `routes[].pathPrefix` | string | URL path prefix to match (e.g. `"/voice"`, `"/wiki"`) |
| `routes[].flow` | string | Value written to `wo.flow` (used by `core-channel-config` `flowMatch`) |
| `routes[].channelIdSource` | string | How `wo.channelId` is derived. Strategies: `"query:<param>"` — from URL query string param; `"path:<N>"` — path segment N after the prefix (0-based); any other string — treated as a literal static channel ID |
| `routes[].removeModules` | array | Optional list of module filename prefixes (e.g. `"00043-webpage-bard"`) to skip for this route. Appended to `wo.flowModuleRemove` before the pipeline runs. |

**`core-channel-config` flow overrides example:**

```json
{
  "channelMatch": ["YOUR_VOICE_CHANNEL_ID"],
  "overrides": {},
  "flows": [
    {
      "flowMatch": ["webpage-voice"],
      "overrides": {
        "trigger": "jenny",
        "triggerWordWindow": 3
      }
    }
  ]
}
```

> **Note:** `webpage-router` changes `wo.flow` on the existing workingObject. The module pipeline is already assembled at this point (based on the initial `wo.flow = "webpage"`). The new `wo.flow` value is used exclusively by `core-channel-config` for its `flowMatch` logic — it does not affect which modules run.

---

#### config.webpage-auth

Discord OAuth2 SSO for all web modules. Handles login (`/auth/login`), OAuth2 callback (`/auth/callback`), and logout (`/auth/logout`) exclusively on `loginPort`. Writes `wo.webAuth` for downstream modules.

```json
"webpage-auth": {
  "flow":           ["webpage"],
  "enabled":        true,
  "loginPort":      3111,
  "ports":          [3111, 3112, 3113, 3114, 3115, 3116, 3117, 3118, 3119],
  "clientId":       "YOUR_DISCORD_APP_CLIENT_ID",
  "clientSecret":   "YOUR_DISCORD_APP_CLIENT_SECRET",
  "sessionSecret":  "long_random_secret_string",
  "redirectUri":    "",
  "scope":          "identify guilds.members.read",
  "sessionMaxAgeSec": 43200,
  "sameSite":       "Lax",
  "guilds": [
    {
      "guildId":      "YOUR_PRIMARY_GUILD_ID",
      "defaultRole":  "member",
      "allowRoleIds": ["DISCORD_ROLE_ID_1", "DISCORD_ROLE_ID_2"],
      "rolePriority": ["DISCORD_ROLE_ID_1", "DISCORD_ROLE_ID_2"],
      "roleMap":      { "DISCORD_ROLE_ID_1": "admin", "DISCORD_ROLE_ID_2": "member" }
    },
    {
      "guildId":      "YOUR_SECONDARY_GUILD_ID",
      "defaultRole":  "member",
      "allowRoleIds": [],
      "rolePriority": ["DISCORD_ROLE_ID_3"],
      "roleMap":      { "DISCORD_ROLE_ID_3": "admin" }
    }
  ]
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Set to `false` to disable OAuth2 entirely (all users have no role) |
| `loginPort` | number | `3111` | Port that handles `/auth/*` routes |
| `ports` | array | `[loginPort]` | All ports where session cookies are validated |
| `clientId` | string | — | Discord application Client ID |
| `clientSecret` | string | — | Discord application Client Secret |
| `sessionSecret` | string | — | Secret used to sign session cookies |
| `redirectUri` | string | `""` | OAuth2 callback URL; auto-derived from `Host` header if empty |
| `scope` | string | `"identify"` | Discord OAuth2 scope |
| `sessionMaxAgeSec` | number | `43200` | Session lifetime in seconds (default: 12 h) |
| `sameSite` | string | `"Lax"` | Cookie `SameSite` attribute (`"Lax"`, `"Strict"`, or `"None"`) |
| `guilds` | array | `[]` | List of guilds to authenticate against (see below). Guilds are tried in order — the first guild where the user is a member **and** passes `allowRoleIds` wins. If a guild matches membership but the user has no permitted role there, iteration continues to the next guild. |
| `guilds[].guildId` | string | — | Discord Guild (server) ID. The Jenny bot must be a member of this server. |
| `guilds[].defaultRole` | string | `"member"` | Role assigned to authenticated users not matched by `roleMap` |
| `guilds[].allowRoleIds` | array | `[]` | If non-empty, only users with at least one of these Role IDs are allowed in |
| `guilds[].rolePriority` | array | `[]` | Order in which role IDs are checked; highest priority first |
| `guilds[].roleMap` | object | `{}` | Maps Discord Role ID → role label (`"admin"`, `"member"`, etc.) |
| `ssoPartners` | array | `[]` | List of partner base URLs for cross-domain SSO chaining (e.g. `["https://other.example.com"]`). After login the session is forwarded to each partner using a short-lived single-use token. Leave empty to disable. The full session payload (`userId`, `username`, `guildId`, `role`, `roles`, `roleIds`) is forwarded unchanged. |

> **Backward compatibility:** The old single-guild format (`"guildId"` + `"roleMap"` etc. at top level) is still supported. If `guilds` is absent, the top-level `guildId` is used as a single-entry guild list.

> **Multi-guild requirement:** For `guilds.members.read` to work, the **Jenny bot must be invited to every guild in the list**. You don't need Developer Portal access to Server 2 — as long as you are an admin there, you can invite the bot using its existing OAuth2 invite URL.

---

#### Module–Flow Assignment (Reference)

Every module can be restricted to specific flows via its config block:

```json
"discord-add-context": {
  "flow": ["discord", "discord-voice"]
}
```

| Module | Active flows |
|---|---|
| `webpage-router` | webpage |
| `core-channel-config` | discord, discord-voice, discord-admin, discord-status, api, webpage |
| `core-channel-gate` | discord, discord-voice, discord-admin, api, webpage |
| `api-token-gate` | api |
| `discord-gdpr-gate` | discord, discord-voice, discord-admin, webpage |
| `discord-add-context` | discord, discord-voice |
| `core-trigger-gate` | discord, discord-voice, api, webpage |
| `discord-reaction-start/finish` | discord |
| `discord-text-output` | all |
| `discord-voice-capture` | discord-voice |
| `core-voice-transcribe` | discord-voice, webpage |
| `core-voice-tts` | discord-voice, webpage |
| `discord-voice-tts-play` | discord-voice |
| `core-ai-context-loader` | discord-status, discord, discord-voice, api, bard-label-gen, webpage |
| `core-ai-completions` | discord-status, discord, discord-voice, api, **bard-label-gen**, webpage |
| `core-ai-responses` | discord-status, discord, discord-voice, api, webpage |
| `core-ai-pseudotoolcalls` | discord-status, discord, discord-voice, api, webpage |
| `core-ai-roleplay` | discord-status, discord, discord-voice, api, webpage |
| `core-output` | all |
| `bard-join` | discord-admin, discord, webpage, api |
| `discord-purge` | discord-admin, discord |
| `core-admin-commands` | api, discord-admin, discord, webpage |
| `bard-cron` | bard-label-gen |
| `bard-label-output` | bard-label-gen |
| `webpage-bard` | webpage |
| `webpage-config-editor` | webpage |
| `webpage-manifests` | webpage |
| `webpage-chat` | webpage |
| `webpage-inpaint` | webpage |
| `webpage-inpainting` | webpage |
| `webpage-gallery` | webpage |
| `webpage-gdpr` | webpage |
| `webpage-dashboard` | webpage |
| `webpage-documentation` | webpage |
| `webpage-wiki` | webpage |
| `webpage-voice` | webpage |
| `webpage-voice-output` | webpage |
| `webpage-context` | webpage |

---

### 5.8 core-channel-config — Channel/Flow/User Overrides

The three-level hierarchy allows fine-grained configuration:

```
Channel override
  +-- Flow override
        +-- User override
```

```json
"core-channel-config": {
  "flow": ["discord", "discord-voice", "discord-admin", "discord-status", "api"],
  "channels": [
    {
      "channelMatch": ["CHANNEL_ID", "general"],
      "overrides": {
        "temperature": 0.7,
        "systemPrompt": "You are a creative writing assistant.",
        "tools": ["getGoogle", "getImage"],
        "contextSize": 50
      },
      "flows": [
        {
          "flowMatch": ["discord"],
          "overrides": {
            "maxTokens": 4000
          },
          "users": [
            {
              "userMatch": ["DISCORD_USER_ID"],
              "overrides": {
                "temperature": 1.0
              }
            }
          ]
        }
      ]
    }
  ]
}
```

**Merge rules:**
- Plain objects: deep-merged (nested keys are combined)
- Arrays: fully replaced (not merged)
- Last matching rule wins
- Channel and flow matching: **case-insensitive**
- User matching: **case-sensitive**

**channelMatch:** Can contain channel IDs or channel names. The special value `"browser"` matches all API requests. The special value `"DM"` matches Direct Messages sent to the bot — add a channel entry with `"channelMatch": ["DM"]` to enable DM support (without it the channel-gate blocks all DMs).

**DM detection heuristic:** A message is treated as a DM (and `effectiveChannelId` becomes `"DM"`) when: `isDM === true`, or `channelType === "DM"`, or `channelType === 1`, or — as a fallback — `guildId` is empty *and* `userId` is set *and* `isDM` is **not explicitly `false`**. The API flow sets `isDM = false` explicitly, so API requests with a `userId` are never misidentified as DMs even when `guildId` is empty.

**Flow overrides with `webpage-router`:** When `webpage-router` is configured, web requests get a named flow (e.g. `"webpage-voice"`, `"webpage-wiki"`). Add `flows[]` entries to `core-channel-config` to apply overrides only when that flow is active:

```json
{
  "channelMatch": ["YOUR_VOICE_CHANNEL_ID"],
  "overrides": {},
  "flows": [
    {
      "flowMatch": ["webpage-voice"],
      "overrides": {
        "trigger":           "jenny",
        "triggerWordWindow": 3
      }
    }
  ]
}
```

**All `workingObject` parameters can be used in overrides**, including `toolsconfig`.

---

## 6. Flows

Flows are event sources that create a `workingObject` and trigger the module pipeline.

### 6.1 discord

**File:** `flows/discord.js`
**Purpose:** Listens for Discord messages in guilds and DMs

**Fields set in workingObject:**

| Field | Description |
|---|---|
| `flow` | `"discord"` |
| `turnId` | Monotonic ULID (26 characters) |
| `payload` | Message content |
| `channelId` | Channel ID |
| `userId` | Discord user ID of the author |
| `authorDisplayname` | Display name of the author |
| `guildId` | Guild ID |
| `isDM` | `true` if direct message |
| `channelType` | Discord channel type integer |
| `message` | Raw Discord.js Message object |
| `clientRef` | Registry key for the Discord client |
| `fileUrls` | Array of attachment URLs |
| `voiceSessionRef` | Registry key for active voice session |

**Notable behaviour:**
- ULID generation for monotonic turn tracking
- Macro expansion (messages tagged with `#Macro#` are expanded)
- Filters own bot messages (except those in `botsAllow`)
- Triggers the `discord-admin` flow for slash command interactions

**Intents used:** `Guilds`, `GuildMessages`, `MessageContent`, `GuildVoiceStates`, `DirectMessages`

> Note: `MessageContent` is a **privileged intent** and must be enabled in the Discord Developer Portal under your bot's settings.

---

### 6.2 discord-admin

**File:** `flows/discord-admin.js`
**Purpose:** Processes Discord slash command interactions

**Notable behaviour:**
- Returns ephemeral replies (visible only to the caller)
- Routes to defined slash command definitions
- Admin check based on the `admin` arrays in the definitions

---

### 6.3 discord-voice

**File:** `flows/discord-voice.js`
**Purpose:** Processes audio frames from voice channels

**Pipeline:**
1. Capture PCM audio from the Discord voice receiver, apply VAD, produce a 16kHz mono WAV (`00029-discord-voice-capture`)
2. Transcribe the WAV via the OpenAI Audio Transcriptions API (`00030-core-voice-transcribe`)
3. Run the full module pipeline (AI + tools)
4. Render TTS audio segments (`08100-core-voice-tts`)
5. Play TTS audio back into the voice channel (`08110-discord-voice-tts-play`)

**Activation:** User runs `/join`, bot enters the voice channel.

**Handoff fields between capture and transcription:**

| Field | Set by | Description |
|---|---|---|
| `wo.audioFile` | `discord-voice-capture` | Path to the voiced WAV file |
| `wo._audioCaptureDir` | `discord-voice-capture` | Temp directory (cleaned up by transcription module) |
| `wo.audioStats` | `discord-voice-capture` | `{snrDb, usefulMs}` — quality metrics |
| `wo.transcribeAudio` | `discord-voice-capture` | `true` — signals transcription module to run |

---

### 6.4 api

**File:** `flows/api.js`
**Purpose:** HTTP API server for external requests

**Endpoints:**

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Returns `{ ok: true, botname }` — used by reverse proxy health checks |
| `POST` | `/api` | Bearer | Synchronous AI pipeline; returns `{ ok, response, turnId, ... }` |
| `GET` | `/toolcall` | Bearer | Poll global tool-call status from registry |
| `GET` | `/toolcall?channelId=<id>` | Bearer | Poll channel-specific tool-call status (browser extension, chat UI) |
| `GET` | `/context?channelId=<id>` | Bearer | Read recent conversation history for a channel; optional `?limit=N` |
| `POST` | `/api/spawn` | Bearer | Spawn async subagent job; returns `{ ok, jobId, projectId }` immediately |
| `GET` | `/api/jobs?channelId=<id>` | Bearer | List all async jobs whose `callerChannelId` matches the given channel. Webpage voice fallback entries may include `audioBase64` and `audioMime`. |
| `POST` | `/upload` | Bearer | Upload a file (raw body, `X-Filename` header); returns `{ ok, filename, url }` |

**POST /api request:**
```json
{
  "payload":              "What is the weather in Berlin?",
  "channelId":            "optional-channel-id",
  "userId":               "optional-user-id",
  "subchannel":           "optional-subchannel-id",
  "doNotWriteToContext":  true,
  "callerChannelId":      "optional-parent-channel-id",
  "agentDepth":           0,
  "agentType":            ""
}
```

- `subchannel` — optional; routes the request through a specific subchannel context. Subchannels scope context only and do not inject prompt text.
- `doNotWriteToContext` — optional boolean; when `true`, neither the user message (`00072`) nor the AI response (`01004`) are written to the MySQL context. Used for internal system calls (e.g. wiki article generation) that must not pollute the conversation history.
- `callerChannelId` — forwarded from the parent when called by `getSubAgent`; used to mirror tool-call status to the original Discord channel
- `agentDepth` / `agentType` — subagent nesting controls forwarded by `getSubAgent`

**POST /api response:**
```json
{
  "ok":             true,
  "flow":           "api",
"turnId":         "01JXXXXXXXXXXXXXXXXXXXXX",
  "channelId":      "optional-channel-id",
  "subchannel":     "optional-subchannel-id",
  "channelAllowed": true,
  "response":       "The weather in Berlin is...",
  "toolCallLog":    [...],
  "subagentLog":    [...],
  "botname":        "Jenny"
}
```

`subchannel`, `toolCallLog`, and `subagentLog` are only present when applicable.

**POST /api/spawn request:**
```json
{
  "channelId":        "subagent-develop",
  "payload":          "Write a Python script that ...",
  "userId":           "",
  "guildId":          "",
  "projectId":        "optional-stable-project-id",
  "callerChannelId":  "originating-discord-channel-id",
  "callerFlow":       "discord",
  "agentDepth":       1,
  "agentType":        "develop"
}
```

Returns immediately:
```json
{ "ok": true, "jobId": "01JXXX...", "projectId": "01JYYY..." }
```

The subagent pipeline runs in the background. The spawned subagent uses only its own target-channel persona, system prompt, and instructions. It does not inherit the caller persona or caller instructions. Delivery always targets `callerChannelId`. Discord delivery uses the caller channel directly, while webpage delivery performs a final caller-channel persona pass before sending SSE or fallback job payloads so channel-specific formatting and link patching stay anchored to the original caller channel.

---

### 6.5 cron

**File:** `flows/cron.js`
**Purpose:** Executes scheduled jobs based on cron expressions

**Cron format:** `* * * * *` (minute, hour, day, month, weekday).
Also supports `*/N * * * *` (every N minutes).

**Job configuration:** See `config.cron.jobs[]`

**Parallel execution:** Each job runs as a fire-and-forget async IIFE with its own `running` flag. This means long-running jobs (e.g. `discord-status`) do not delay other jobs (e.g. `bard-label-gen`) — all due jobs start concurrently.

> **Implicit flows:** `discord-status` and `bard-label-gen` are **logical flow names** — they have no corresponding file in `flows/`. They exist only as string values passed to `runFlow()` by `cron.js`. Modules subscribe to them via their `flow` config array like any other flow (e.g. `"flow": ["discord-status", "discord"]`). If you search `flows/` for these names you will find nothing — that is expected.

```javascript
// Internal pattern — each job:
(async () => {
  try { await runFlow(targetFlow, rc); }
  catch (e) { /* log */ }
  finally { job.running = false; job.nextDueAt = getNextDue(job); }
})();
```

---

### 6.6 toolcall

**File:** `flows/toolcall.js`
**Purpose:** Registry-triggered flow for async tool-call tracking

**Flow:**
1. An AI module deposits `{ name, flow }` into the global `status:tool` registry key (channel-specific `status:tool:<channelId>` key stores only the tool name string)
2. `flows/toolcall.js` polls the key every 400 ms; when hasTool or identity changes it triggers the `toolcall` flow
3. `discord-status-apply` reads the tool entry, checks the `flow` field against `allowedFlows`, and updates Discord presence only if the originating flow is permitted

---

### 6.7 webpage (chat module)

**Files:** `flows/webpage.js` + `modules/00048-webpage-chat.js`
**Purpose:** The webpage flow serves **multiple ports simultaneously** (configured via `config.webpage.ports`). Admin modules route by URL path.

**Multi-port:** `config.webpage.ports` is an array — one HTTP server is started per port. Each incoming request sets `wo.http.port` so modules can route by port.

**Chat** (`modules/00048-webpage-chat.js`, `GET /chat`)
- Channel dropdown populated from `webpage-chat.chats[]` in `core.json`
- `00048` is a **pure HTTP handler** — for AI requests it makes an internal `POST` to the API flow and returns `{ response }` as JSON. The AI pipeline (model, tools, persona, context) is fully controlled by `core-channel-config` for the given `channelId`. `apiUrl` and `apiSecret` are read **per chat entry** from `webpage-chat.chats[x].apiUrl` / `.apiSecret` — different chats can use different endpoints and secrets.
- **Channel config:** per-channel AI settings (model, persona, systemPrompt, tools, etc.) live in `core-channel-config` — the same entries used by Discord and the browser extension.
- **Subchannels:** create, rename, and delete separate conversation threads from the UI; each subchannel has its own isolated context history stored in the `chat_subchannels` DB table. The subchannel ID is forwarded in the internal API call so the API pipeline can scope context reads and writes to that subchannel.
- **Context writing:** handled by `00072-api-add-context` (user message) and `01004-core-ai-context-writer` (AI response) on the API side — `00048` does not write to context directly.
- Last N context entries loaded from MySQL on channel/subchannel select (controlled by `contextSize`)
- Large scrollable message window (top) + auto-resize input (bottom)
- Enter = send, Shift+Enter = newline
- **Thinking indicator with tool name:** the currently active tool is shown next to the animated dots. The chat frontend opens a persistent SSE connection to `GET <basePath>/api/toolstatus/stream?channelId=<id>` and receives an event only when the active tool changes — no repeated polling overhead. The server checks the registry at `toolStatusPollMs` ms intervals and pushes a `data:` event when the value changes. The stream is opened at chat start and closed when the page unloads.
- **Markdown rendering:** `#`/`##`/`###` headings, bold/italic, fenced and inline code, blockquotes, lists, and `---` HR are fully rendered in chat bubbles
- **Link parser & media embeds:** URLs become clickable links; YouTube/Vimeo URLs embed an inline player; `.mp4/.webm/.ogg` render a `<video>` player; image URLs render inline (broken images auto-removed)

---

### 6.8 webpage

**File:** `flows/webpage.js`
**Purpose:** HTTP server flow for web-based tools (document serving, AI image inpainting, config editor, custom modules).

**Multi-port support:** `config.webpage.ports` accepts an array of port numbers. One HTTP server per port is started. Each incoming request populates the following `workingObject` fields before running the module pipeline:

| Field | Type | Description |
|---|---|---|
| `wo.http.port` | number | The port this request arrived on — use this to route |
| `wo.http.method` | string | HTTP method (`"GET"`, `"POST"`, ...) |
| `wo.http.path` | string | URL path without query string (e.g. `"/api/data"`) |
| `wo.http.url` | string | Full URL including query string |
| `wo.http.headers` | object | Request headers |
| `wo.http.rawBody` | string | Request body as UTF-8 string (populated for POST, PUT, PATCH, DELETE) |
| `wo.http.rawBodyBytes` | Buffer | Request body as raw Buffer (same methods as above) |
| `wo.http.json` | object | Parsed JSON body, if `Content-Type` is JSON and parsing succeeds (same methods) |
| `wo.http.req` | `IncomingMessage` | Raw Node.js request object (set by `flows/webpage.js`) |
| `wo.http.res` | `ServerResponse` | Raw Node.js response object (set by `flows/webpage.js`) |
| `wo.http.response` | object | Set `{ status, headers, body }` here — `webpage-output` sends it |
| `wo.web.menu` | array | Modules push `{ label, port, path }` here for nav cross-linking |
| `wo.jump` | boolean | Set to `true` to stop the normal pipeline loop and jump directly to the ≥9000 output phase (e.g. `core-output`). Use after `setSendNow()` in webpage modules. |
| `wo.stop` | boolean | Hard stop — breaks the normal loop **and** skips the output phase (≥9000). Use when the flow should be aborted entirely with no logging. |
| `wo.stopReason` | string | Optional diagnostic label set alongside `wo.stop = true`. Logged by `core-output` for debugging (e.g. `"channel_not_allowed"`, `"bearer_invalid"`, `"admin_command_handled"`). Never read by pipeline logic — purely informational. |
| `wo.tracePipeline` | boolean | Set to `true` to enable the pipeline diff logger (see §7.4). When `false` or absent, no diffs are computed and `logs/pipeline/` is not written. Set in `core.json` under `workingObject`. |
| `wo.tracePipelineExcludeFlows` | string[] | Optional blacklist for the pipeline diff logger. Flows matching any entry are **not** traced even when `tracePipeline` is `true`. Supports `*` wildcards — e.g. `"webpage*"` excludes all `webpage-*` flows. Omit or set to `[]` to trace all flows. Example: `["webpage*", "bard-*"]`. |

**Early-response pattern (`setSendNow`)**

Most web modules set `wo.http.response` and `wo.jump = true` — `09300-webpage-output` then sends the response after the pipeline loop ends. However, some modules need to write to the socket immediately (e.g. before setting `wo.stop = true` which would skip the output phase). For those cases, include a local helper:

```javascript
async function setSendNow(wo) {
  const res = wo?.http?.res;
  if (!res || res.writableEnded) return;
  const r = wo.http?.response || {};
  try {
    res.writeHead(r.status ?? 200, r.headers ?? {});
    res.end(r.body ?? "");
  } catch {}
}
```

Call it after setting `wo.http.response`, then set `wo.stop = true` (or `wo.jump = true`). The helper reads `wo.http.res` directly — **never** use the old `getItem(requestKey)` pattern which is no longer set.

---

### 6.8.1 Adding a new webpage module

New web tools can be added by dropping a single file into `modules/`. No flow changes required.

**Step 1 — Create the module file**

```
modules/NNNNN-webpage-myapp.js
```

Use a number between `00076` and `00099` to run before AI processing, or higher if needed. The range `00042`–`00075` is occupied by existing webpage, bard, admin, and gate modules.

**Step 2 — Module skeleton**

See [Section 16.13: Creating a New Web Module](#1613-creating-a-new-web-module) for the full template and guidelines.

**Step 3 — Add config section to `core.json`**

```jsonc
"webpage-myapp": {
  "flow":  ["webpage"],
  "port":  3222,
  "label": "My App"
}
```

**Step 4 — Register the port in `config.webpage.ports`**

```jsonc
"webpage": {
  "flowName": "webpage",
  "ports": [3000, 3111, 3112, 3113, 3114, 3222]
}
```

**Key rules for multi-module port sharing**

Multiple modules can share a single port. Each module routes by URL path:

1. **Always push to `wo.web.menu`** — regardless of port and before any early returns, so cross-nav links work on all pages.
2. **Check `wo.http.port !== port`** — return immediately if the request is on a different port.
3. **Use `wo.http.path`** for URL routing — this is the path without query string.
4. **Set `wo.jump = true`** when handling a route — the pipeline runner breaks the normal loop and jumps to the output phase; no further webpage modules run.
5. **Do not add a catch-all 404 fallback** — unrecognized paths should fall through (`return coreData`) so modules further down the pipeline can handle them.

---

### 6.9 Browser Extension

**Directory:** `extensions/jenny-extension/`
**Type:** Manifest V3 browser extension (Edge / Chrome)
**Purpose:** Chat with the bot and summarize web pages or YouTube videos from the browser toolbar

#### Features

| Feature | Description |
|---|---|
| **Persistent side panel** | Opens as a browser side panel (not a popup) — stays open while you browse other pages or click elsewhere |
| **Chat UI** | Full chat UI with markdown rendering, link/video embeds and toolcall display |
| **Summarize button** | Sends the active tab's URL to the bot with a summarization task; auto-detects YouTube vs. general web page |
| **Toolcall display** | Active tool name shown next to the animated thinking dots; polled from `/toolcall?channelId=<id>` every 800 ms (per-channel) |
| **Gallery upload** | Upload images to the bot's Gallery via drag-and-drop or click. Requires `webBaseUrl` to be configured and an active login session on the Jenny web interface. |
| **Auth status bar** | Displays the logged-in username (from the Jenny web session) at the top of the popup. Shows a **Login** link when not authenticated and a **Logout** link when logged in. Requires `webBaseUrl` to be configured. |
| **Options page** | `apiUrl`, `channelId`, `apiSecret`, `webBaseUrl` stored in `chrome.storage.sync` |

#### Installation (developer mode)

1. Open `edge://extensions/` (or `chrome://extensions/`).
2. Enable **Developer mode**.
3. Click **Load unpacked** → select the `extensions/jenny-extension/` folder.
4. Click the **Jenny Bot** icon in the toolbar to open the side panel.
5. Accept the **"Read and change all your data on all websites"** permission prompt — this is required so the extension can reach the bot's API (`host_permissions: ["<all_urls>"]` in `manifest.json`).

> **CORS note:** The bot's API server (`flows/api.js`) returns `Access-Control-Allow-Origin: *` and handles `OPTIONS` preflight requests. Without this, Chrome would block the extension's `fetch()` calls even with correct `host_permissions`.

#### Options page fields

| Field | Description |
|---|---|
| `API URL` | Full URL of the bot's API endpoint, e.g. `http://localhost:3400/api` |
| `Channel ID` | Must match a channel with `apiEnabled: 1` in `core.json` — default `browser-extension` |
| `API Secret` | Bearer token; leave empty if `apiSecret` is not set on the channel |
| `Web Base URL` | Base URL of the Jenny web interface (e.g. `https://jenny.example.com`). When set, the extension fetches `/auth/me` on startup to retrieve the current login session. The logged-in username and user ID are displayed in the auth bar at the top of the popup. Use the **Login** / **Logout** links in the auth bar to manage the session. The user ID from the session is automatically sent with every API message for GDPR attribution. |

#### Bot-side configuration

The `browser-extension` channel is pre-configured in `core.json`. Key overrides:

```jsonc
{
  "channelMatch": ["browser-extension"],
  "overrides": {
    "apiEnabled":   1,
    "apiSecret":    "",
    "persona":      "You are Jenny, a browser extension assistant ...",
    "instructions": "When given a URL, use getWebpage or getYoutube to fetch and summarize the content.",
    "contextSize":  70
  }
}
```

Add `{ "label": "Browser Extension", "channelId": "browser-extension", "roles": [] }` to `webpage-chat.chats[]` to monitor the extension's chat history in the admin panel.

---

## 7. Module Pipeline

Modules execute in **strict numeric order**. Naming convention: `NNNNN-PREFIX-NAME.js`

**Module isolation rules (mandatory):**
- Modules read their own config ONLY from `coreData?.config?.[MODULE_NAME]` — never from another module's config key.
- Tools read config ONLY from `wo.toolsconfig?.[toolName]`.
- No module may import another module.
- Exception: core-ai modules (01000–01003) may dynamically `import()` tools from `../tools/`.
- `core/ai-completions.js` does NOT exist as a shared helper — AI calls always go through the pipeline modules.

**Config isolation is enforced automatically by ESLint:**

```bash
npm run lint
```

The custom rule `local/no-foreign-config` in `eslint-rules/no-foreign-config.js` checks every file in `modules/`. It derives the expected config key from the filename (e.g. `00050-discord-purge.js` → `"discord-purge"`) and flags any string-literal bracket access to `.config` that uses a different key:

```
modules/00048-webpage-chat.js:52
  coreData.config["core-channel-config"]
  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  Config isolation: this module ("webpage-chat") must not access
  config["core-channel-config"] — only config["webpage-chat"] is allowed.
```

Accesses via variable (`config?.[MODULE_NAME]`) are not flagged — only hardcoded string literals.

Run `npm run lint` after any refactoring or before deploying changes to `modules/`.

Every module is an async function:
```javascript
export default async function myModule(coreData) {
  const { workingObject, logging } = coreData;
  const cfg = coreData?.config?.["my-module-name"] || {};
  // Read from workingObject, do work, write results back
  // Optional: workingObject.stop = true -> halt pipeline
}
```

---

### 7.1 Pre-Processing (00xxx)

| No. | File | Purpose |
|---|---|---|
| 00005 | `discord-status-prepare` | Reads Discord context; prepares AI-generated status update |
| 00007 | `webpage-router` | Maps HTTP port + path to a named flow and sets `wo.channelId`. Runs before `core-channel-config` so that flow-specific overrides (e.g. different trigger word for `/voice`) can be applied. Config key: `webpage-router`. Active only in `webpage` flow. |
| 00010 | `core-channel-config` | Applies hierarchical channel/flow/user overrides (deep-merge) |
| 00012 | `subchannel-config` | Lightweight compatibility hook for subchannel-aware runs. When `wo.subchannel` is set, the module leaves prompt fields untouched and lets the rest of the pipeline use the subchannel only as a context scope selector. |
| 00020 | `core-channel-gate` | Checks whether the bot is allowed to respond in this channel — sets `wo.stop = true` when `wo.channelAllowed` is falsy |
| 00021 | `api-token-gate` | Two-stage API gate: (1) blocks the channel entirely when `apiEnabled=0`; (2) verifies the Bearer token when `apiSecret` is set |
| 00022 | `discord-gdpr-gate` | Enforces GDPR consent; sends disclaimer DM on first contact |
| 00025 | `discord-admin-gdpr` | Handles admin GDPR management commands |
| 00027 | `webpage-voice-record` | Handles `POST /voice/record` (port 3119) — receives a full meeting recording, transcribes it (default model: `gpt-4o-transcribe`), optionally runs a GPT-4o diarization pass, optionally purges non-frozen channel context, and stores the formatted transcript via `setContext`. Config key: `webpage-voice-record`. |
| 00028 | `webpage-voice-input` | Handles `POST /voice/audio` (webpage flow) — validates auth + `channelId`, converts the incoming audio body to a 16 kHz mono WAV temp file, and sets `wo` fields so the shared transcription → AI → TTS pipeline runs identically to the Discord voice flow. Sets `wo.audioFile`, `wo.transcribeAudio`, `wo.isWebpageVoice`, `wo.ttsFormat = "mp3"`. Must run before `00030-core-voice-transcribe`. |
| 00029 | `discord-voice-capture` | Captures PCM from the Discord voice receiver (Opus → PCM via prism-media), applies RMS/ZCR-based VAD, extracts voiced frames, and combines them into a single 16kHz mono WAV. Outputs `wo.audioFile`, `wo.audioStats = {snrDb, usefulMs}`, and `wo.transcribeAudio = true`. Does not make quality decisions — deferred to the transcription module. Only runs when `wo.voiceIntent.action === "describe_and_transcribe"` |
| 00030 | `core-voice-transcribe` | Source-agnostic transcription module. Runs when `wo.transcribeAudio === true`. When `wo.audioStats` is set, applies a quality gate. Large files (>20 MB) are split into overlapping chunks; speaker labels are stitched across chunk boundaries. When `wo.transcribeOnly === true` and the model name contains `"diarize"`, calls `getDiarizeWithSamples`: loads registered speaker profiles from `voice_speakers`, builds a preamble WAV (speaker samples + pure-Node.js silence), concatenates it before the meeting audio, transcribes with the diarize model, resolves label→speaker mappings via `resolveSpeakerMapping`, and stores a session + chunks + assignments in `voice_sessions`/`voice_chunks`/`voice_chunk_speakers`. Sets `wo.voiceDiarizeSessionId`. Active in `discord-voice` and `webpage` flows. |
| 00031 | `webpage-voice-add-context` | Writes the voice transcription to the context DB for the **always-on voice path only**. Skips when `wo.transcribeOnly === true` (meeting recorder path) — those transcripts only reach context via the Review tab Apply button. Active when `wo.isWebpageVoice === true`, `wo.transcribeOnly !== true`, and `wo.payload` is set. Diarized transcripts are parsed into one DB entry per speaker turn (`source: "voice-transcribe"`). When the channel ID is listed in `clearContextChannels`, purges non-frozen context rows (via `setPurgeContext`) for the channel first. |
| 00032 | `discord-add-files` | Extracts file attachments and URLs from Discord messages |
| 00033 | `webpage-voice-transcribe-gate` | For `POST /voice/audio?transcribeOnly=1` (meeting recorder): sends HTTP 200 JSON `{ transcript, sessionId }` and sets `wo.stop = true` so AI/TTS never run. The transcript is NOT written to context here — that happens when the user clicks **Apply to Channel** in the Review tab (`POST /voice/api/session/:id/apply`). Active only in `webpage` flow when `wo.isWebpageVoice && wo.transcribeOnly`. |
| 00035 | `bard-join` | Processes `/bardstart` and `/bardstop` commands across **all subscribed flows** — creates or removes a headless channel-based bard session in the registry. Sessions are keyed by `channelId`; multiple sessions can run simultaneously on the same Discord server. In `discord-admin` flow: reads slash command via `wo.admin.command`. In `discord`, `webpage`, and `api` flows: reads `wo.payload` or `wo.message` and matches the configured `commandPrefix` (default: `["/"]`). Responds with `""` (silent) in discord-admin; responds with `"🎵 Bard started/stopped."` and sets `wo.stop = true` in other flows. |
| 00036 | `bard-cron` | Prepares `wo.payload` and AI params for the bard-label-gen flow; hands off to `core-ai-completions` |
| 00037 | `discord-admin-join` | Processes `/join` and `/leave` commands for voice channels |
| 00040 | `webpage-auth` | Discord OAuth2 SSO for webpage ports. Runs passively on every request — reads session cookies and sets `wo.webAuth` (username, userId, guildId, role, roles) and `wo.userId`. Login/logout routes handled on the configured `loginPort`. Role is normalized at login time via the matched guild's `roleMap` and stored in the session cookie as-is; on subsequent requests it is read directly from the session without re-normalization (so custom labels like `"dnd"` are preserved). Guild iteration: if a user is found in a guild but has no matching `allowRoleIds`, iteration continues to the next guild in `guilds[]`. `guildId` is preserved through SSO token handoff so cross-domain sessions also carry the originating guild. Non-`/auth/*` requests pass through unchanged. Scope controlled via `cfg.ports`. |
| 00041 | `webpage-menu` | Global menu provider for webpage flows. Reads `config["webpage-menu"].items[]`, filters items by `wo.webAuth.role`, and sets `wo.web.menu`. If no role is set, all items without role restriction are shown. Runs before any page module to ensure the menu is always populated |
| 00042 | `webpage-inpaint` | Redirect `GET /documents/*.<ext>` (PNG, JPG, JPEG, WebP, GIF, BMP) to the inpainting SPA. The target host is taken from `config["webpage-inpaint"].inpaintHost` — when the value contains a hostname, it is used directly; when it starts with `/`, it is appended to the request's own hostname. Use a fixed hostname (e.g. `"jenny.ralfreschke.de/inpainting"`) pointing to the domain where users log in, so the session cookie is valid on the inpainting SPA. |
| 00043 | `webpage-bard` | Bard music library manager SPA (port 3114, `/bard`) — tiered access (allowedRoles = basic listener access, adminRoles = full upload/manage rights, no matching role = 403 deny); bulk auto-tag upload, tag editor, play-preview buttons, live Now Playing card. Reads `bard:registry`, `bard:stream`, `bard:labels` from registry via `getItem` for the `/api/nowplaying` endpoint. |
| 00044 | `webpage-config-editor` | JSON config editor SPA; serves `GET /config` and `GET|POST /config/api/config` on the configured port within the webpage flow. |
| 00047 | `webpage-voice` | Webpage voice interface — three-tab SPA (Voice / Speakers / Review). Voice tab: always-on mic + meeting recorder. Speakers tab: register known voices with sample audio for automatic speaker identification. Review tab: inspect diarized sessions, correct speaker assignments, and apply the final transcript to the channel context via `POST /voice/api/session/:id/apply`. On Apply: rebuilds transcript with DB speaker names, sets `authorName` to participant list, optionally purges context, writes via `setContext`, deletes session. |
| 00048 | `webpage-chat` | AI chat SPA; serves `GET /chat`, `/chat/api/chats`, `/chat/api/context`, `POST /chat/api/chat`, and subchannel CRUD endpoints (`GET/POST/PATCH/DELETE /chat/api/subchannels`). **Pure HTTP handler** — sets up `wo` fields (`channelId`, `payload`, `subchannel`, `contextSize`) from the request and returns. The AI pipeline modules (01000–01003) handle the AI call naturally. Context writing is handled by the API-side modules, not inline here. Subchannel names are stored in `chat_subchannels`; no prompt fields are stored there. When the user's role is not in `allowedRoles`, serves a styled **403 Access Denied** page (with navigation menu and a link to `/`) instead of redirecting — prevents redirect loops on ports without a root handler. Admin commands (`/purgedb`, `/freeze`, `/rebuilddb`) are **not** handled inline here — they pass through the api proxy to `localhost:3400/api` where `00055-core-admin-commands` handles them. The proxy request body includes `guildId` so downstream modules can identify the originating guild. |
| 00049 | `webpage-inpainting` | Inpainting SPA; serves `GET /inpainting` and API routes on port 3113 |
| 00050 | `discord-purge` | Discord message deletion commands. `/purge` (slash command, discord-admin flow) deletes Discord channel messages with rate-limit backoff. `!purge [N]` (discord DM flow only) deletes up to N bot messages from the DM channel. These are Discord-specific operations — they delete actual Discord messages, not DB rows. DB-level commands (`purgedb`, `freeze`, `rebuilddb`) are handled by `00055-core-admin-commands`. |
| 00051 | `webpage-dashboard` | Live bot telemetry dashboard (port 3115, `/dashboard`) |
| 00052 | `webpage-wiki` | AI-driven Fandom-style wiki (port 3117, `/wiki`) |
| 00053 | `webpage-context` | Context DB editor SPA (port 3118, `/context`) — channel browser with collapsible sidebar (state persisted in `localStorage`), field selector, search, search & replace, bulk delete |
| 00054 | `webpage-timeline` | Timeline DB editor SPA (port 3128, `/timeline`) — browse, search, edit, and bulk-delete timeline summary rows |
| 00054 | `webpage-documentation` | Documentation viewer (port 3116, `/docs`) — collapsible file-navigation sidebar (state persisted in `localStorage`) |
| 00055 | `core-admin-commands` | DB-level admin commands for all flows. `discord-admin`: reads `wo.admin.command` (`purgedb`/`freeze`/`rebuilddb`), target channel from `wo.admin.channelId`. `discord` (DM only): `!purgedb` and `!rebuilddb` in payload. `api`: `/purgedb`, `/freeze`, `/rebuilddb` slash-text in payload. `webpage`: `/purgedb`, `/freeze`, `/rebuilddb` in the chat SPA — these are routed via the api proxy in `00048-webpage-chat`, so they arrive as `api` flow requests and are handled here (inline handling in 00048 has been removed). No Discord-API access — pure DB operations only. `rebuilddb` rebuilds the derived context tables for the current channel only and recreates its timeline rows from scratch. |
| 00056 | `webpage-gallery` | Image gallery SPA (port 3120, `/gallery`) — lists, uploads, and deletes the logged-in user's images stored in `pub/documents/<userId>/`. Integrates with the inpainting SPA via the `inpaintingUrl` config key. |
| 00057 | `webpage-graph-auth` | Microsoft Graph OAuth2 delegated auth page (port 3124, `/graph-auth`). Logged-in users connect or disconnect their Microsoft account. Stores access + refresh tokens in `graph_tokens` DB table. Required before the `getGraph` tool can be used. |
| 00058 | `cron-graph-token-refresh` | Cron module — refreshes expiring Microsoft Graph tokens. Queries `graph_tokens` for rows with `expires_at` within the configured buffer window and calls the MS token refresh endpoint. Skips on failure (does not delete). Only runs in the `cron-graph-token-refresh` flow (the cron job `id` must match exactly). |
| 00061 | `webpage-spotify-auth` | Spotify OAuth2 delegated auth page (port 3125, `/spotify-auth`). Logged-in users connect or disconnect their Spotify account. Stores access + refresh tokens in `spotify_tokens` DB table. Required before the `getSpotify` tool can be used. Uses `Authorization: Basic` header for token exchange (Spotify-specific). |
| 00062 | `cron-spotify-token-refresh` | Cron module — refreshes expiring Spotify tokens. Queries `spotify_tokens` for rows with `expires_at` within the configured buffer window. Uses `Authorization: Basic` header. Stores new refresh token if Spotify issues one. Skips on failure (does not delete). Only runs in the `cron-spotify-token-refresh` flow (the cron job `id` must match exactly). |
| 00063 | `webpage-oauth-manager` | Admin UI and API for managing `client_credentials` OAuth2 provider registrations (port 3130, `/oauth`). Provides CRUD for `oauth_registrations`, service-token status view, and delete-with-cascade. Used to configure server-to-server providers for `getApi` with `authType: "oauth_cc"`. |
| 00069 | `webpage-oauth-connections` | User-facing page for managing personal OAuth2 account connections (port 3131, `/connections`). Lists all `auth_code` providers with per-user connect/disconnect/renew UI and callback handler. The **Renew** button appears when a `refresh_token` is stored, allowing manual token refresh without reconnecting. Tokens stored in `oauth_tokens` keyed by Discord user ID. Used with `getApi` `authType: "oauth_user"`. |
| 00064 | `cron-oauth-token-refresh` | Cron module — refreshes expiring OAuth2 tokens stored in `oauth_tokens` for any registered provider. Queries rows with `expires_at` within buffer window and `refresh_token IS NOT NULL`. Calls the provider's `token_url` with `grant_type=refresh_token`. Only runs in the `cron-oauth-token-refresh` flow. |
| 00059 | `webpage-live` | Live context monitor SPA (port 3123, `/live`) — selectable channel checkboxes, field toggles (timestamp, channel, role), configurable poll interval, autoscroll toggle. Collapsible settings sidebar (◀/▶). All UI state persists in `localStorage`. Parses `json.authorName` and `json.content` from Discord context entries to display chat transcripts in real time. New messages are inserted into the DOM sorted by `ts` (tiebreaker: `ctx_id`) regardless of arrival order — each message element carries `data-ts` and `data-ctx-id` attributes so out-of-order poll responses (race condition) are placed at the correct position rather than appended at the bottom. |
| 00060 | `discord-admin-avatar` | Generates or uploads a bot avatar via DALL-E or URL |
| 00065 | `discord-admin-macro` | Macro management (create, list, delete, run) |
| 00066 | `webpage-manifests` | Admin-only manifest JSON editor SPA (port 3126, `/manifests`). Uses a manifest selector and structured JSON editor. Routes: `GET /manifests`, `GET /manifests/api/list`, `GET /manifests/api/get?name=`, `POST /manifests/api/save`. Config key: `webpage-manifests`. |
| 00067 | `webpage-subagent-manager` | Admin-only subagent manager SPA (port 3127, `/subagents`). Routes: `GET /subagents`, `GET /subagents/api/list`, `GET /subagents/api/get?type=`, `POST /subagents/api/save`, `DELETE /subagents/api/delete?type=`. Saves subagent channel entries into `core.json` and matching blocks into `manifests/getSubAgent.json`. |
| 00068 | `webpage-channel-config-manager` | Admin-only channel config manager SPA (port 3129, `/channels`). Routes: `GET /channels`, `GET /channels/api/list`, `GET /channels/api/item?index=`, `POST /channels/api/save`, and `POST /channels/api/delete`. Edits entries inside `config["core-channel-config"].channels` in `core.json`. |
| 00070 | `discord-add-context` | Writes the incoming Discord user message to the context DB (role=user) |
| 00072 | `api-add-context` | Writes the incoming API user message to the context DB (role=user). Skipped when `wo.doNotWriteToContext === true` (e.g. internal wiki/system API calls). |
| 00073 | *(deleted)* | `webpage-add-context` has been removed. Its logic was inlined into `00048-webpage-chat`. |
| 00074 | `core-trigger-gate` | Flow-agnostic trigger gate. Stops the pipeline when `wo.payload` does not start with the configured trigger word. |
| 00075 | *(deleted)* | `discord-trigger-gate` has been removed. Flow-agnostic replacement: `00074-core-trigger-gate`. |
| 00080 | `discord-reaction-start` | Adds a progress reaction emoji to the user's message |
| 00999 | `core-ai-context-loader` | Pre-loads conversation context into `wo._contextSnapshot` before any `core-ai-*` module runs. When `channelId` is missing (e.g. not yet set by `00048`), leaves `_contextSnapshot` unset; AI modules fall back to `getContext()` themselves. Retrieval planning, compression, and indexing live in `core/context.js`, not in the loader. |

---

### 7.2 AI Processing (01xxx)

Only **one** of these modules runs per turn, selected by `workingObject.useAiModule`:

| No. | File | useAiModule | Purpose |
|---|---|---|---|
| 01000 | `core-ai-completions` | `"completions"` | OpenAI-compatible `chat/completions` runner with tool calling, multi-turn continue logic, and local-model heuristics |
| 01001 | `core-ai-responses` | `"responses"` | Full Responses API with iterative tool calling, reasoning, image persistence |
| 01002 | `core-ai-pseudotoolcalls` | `"pseudotoolcalls"` | Text-based pseudo tool calling for local models without native function-call support |
| 01003 | `core-ai-roleplay` | `"roleplay"` | Two-pass generation (text + image prompt) with tool calling, finish_reason logging, and automatic cut-off continuation |

**All four modules share identical continue logic** — see the continue strategy below.

#### config.core-ai-context-loader

Pre-loads the conversation context snapshot from the DB into `wo._contextSnapshot` before any `core-ai-*` module runs. The module is intentionally thin: all retrieval planning, compression, indexing, and subchannel-aware scoping happen inside `core/context.js`.

All `core-ai-*` modules retain a direct `getContext()` fallback, so synthetic pipelines that invoke an AI module directly (without running the full module pipeline) continue to work unchanged.

```json
"core-ai-context-loader": {
  "flow": ["discord-status", "discord", "discord-voice", "api", "bard-label-gen", "webpage"]
}
```

| Parameter | Type | Description |
|---|---|---|
| `flow` | array | Flows in which the module runs. Must include all flows where `core-ai-*` modules are active. |

**`wo._contextSnapshot`** — After this module runs, `wo._contextSnapshot` is an array of context rows (same format as `getContext()` returns). Set it to an empty array `[]` to suppress history. Replace or append rows to inject context.

There is no separate loader-side `contextOptimization` stage anymore. Tune retrieval through `config.context` in `core.json`.

**`source: "voice-transcription"` — special treatment**

Context rows with `source: "voice-transcription"` receive special treatment during optimization. All voice write paths must set this source value:

| Module | Path | Sets source |
|---|---|---|
| `00070-discord-add-context` | Discord voice (when `wo.voiceTranscribed === true`) | ✓ |
| `00031-webpage-voice-add-context` | Webpage always-on voice | ✓ |
| `00047-webpage-voice` | Diarize sessions | ✓ |
| `00027-webpage-voice-record` | Meeting recorder | ✓ |

**Transcription filtering** — voice rows with fewer words than `minWords` are excluded from the snapshot entirely when outside the protected recent window. Excluded rows do not count against the context budget seen by the AI.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `transcriptions.enabled` | boolean | `true` | Toggle transcription filtering. Omitting the `transcriptions` key enables it with defaults. |
| `transcriptions.minWords` | number | `5` | Voice rows with fewer words than this are excluded when outside the recent window. |
| `transcriptions.keepRecentCount` | number | `3` | Number of most-recent snapshot rows that are always kept regardless of word count. |

**Relevance filtering** — scores non-voice rows in the older portion of the snapshot using Jaccard similarity against `wo.payload`. Rows below the threshold are dropped. Voice transcription rows are always retained regardless of score.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `relevance.enabled` | boolean | `false` | Toggle relevance filtering. Off by default. |
| `relevance.keepRecentCount` | number | `5` | Always retain this many most-recent rows regardless of score. |
| `relevance.minScore` | number | `0.05` | Minimum Jaccard score (0.0–1.0) to retain an older row. Set to `0` to keep all. |

**Requirements:** Source detection requires non-simplified context (`simplifiedContext !== true`). In simplified mode, rows have no `source` field and voice transcriptions are treated as regular user rows.

---

#### config.core-ai-context-writer

Persists the conversation turns queued by `core-ai-*` modules into the context DB. During their run, `core-ai-*` modules (01000–01003) push each assistant turn and tool result into `wo._contextPersistQueue`. This module drains the queue afterwards.

Modules positioned between the last `core-ai-*` module and `01004` can inspect or modify `wo._contextPersistQueue` before it is written — enabling post-processing of AI responses at pipeline level (e.g. filtering, logging, transforming stored turns).

```json
"core-ai-context-writer": {
  "flow": ["discord-status", "discord", "discord-voice", "api", "bard-label-gen", "webpage"]
}
```

| Parameter | Type | Description |
|---|---|---|
| `flow` | array | Flows in which the module runs. Must include all flows where `core-ai-*` modules are active. |

**`wo._contextPersistQueue`** — Array of turn objects to be persisted. Each entry is `{ role, content, ... }` as returned by `getWithTurnId()`. Set to `[]` to suppress all writes. Add entries to inject additional turns into the stored context.

---

#### core-ai-completions (01000) — Detailed flow

**`skipAiCompletions` flag:** If `wo.skipAiCompletions === true` when this module runs, it exits immediately without making any LLM call. Use this when a preceding module has already populated `wo.response` (e.g. a delivery module for async subagent jobs that simply forwards a pre-computed result) and the AI step should be suppressed entirely for that pipeline pass.

1. Builds the message array: system prompt → history (if `includeHistory=true`) → current user turn
2. Calls `POST /chat/completions`; loops up to `maxLoops` (default 20):
   - **Tool calls present and `maxToolCalls` not yet reached** → executes each tool, increments `totalToolCalls`, appends results, loops
   - **`maxToolCalls` reached** → tools disabled for subsequent requests (`tool_choice` omitted); AI produces final answer without further tool calls
   - **`finish_reason === "length"`** → explicit token-limit hit; sends a continue turn and loops
   - **Output looks truncated** (`getLooksCutOff`) → heuristic continue, regardless of `finish_reason`; loops
   - **Otherwise** → done; exits loop
3. Sets `workingObject.response` to the accumulated text of all turns
4. Persists all turns to MySQL context (unless `doNotWriteToContext=true`)

**Continue strategy (identical in all four core-ai modules):**
All modules use `getLooksCutOff` to detect mid-sentence truncation: if the response does not end with a sentence-closing character (`.!?:;"»)\]>*~\``) a continue turn is injected automatically. This fires regardless of `finish_reason` — local backends (Hermes, oobabooga) often return `"stop"` even when truncating mid-sentence. `maxLoops` acts as the safety cap against infinite false-positive loops. The continue message in completions is explicit:
*"Continue exactly where you stopped. Do not restart, do not summarize, do not repeat the previous text. Output only the missing continuation."*

**Logging:** Every AI turn logs `finish_reason`, `content_length`, and `tool_calls` count at `info` level, and a `Continue triggered` entry when the continue heuristic fires. Useful for diagnosing cut-off behaviour on local models.

#### core-ai-responses (01001) — Detailed flow

1. Translates MySQL history into Responses API format
2. Calls the Responses API; loops up to `maxLoops`:
   - **Tool calls present** → executes each tool, appends results, loops
   - **`status === "incomplete"` or `finish_reason === "length"`** → sends a continue turn and loops
   - **Output looks truncated** (`getLooksCutOff`) → heuristic continue, regardless of `finish_reason`; loops
   - **Otherwise** → done; exits loop
3. Appends reasoning tokens to `workingObject.reasoningSummary`
4. Persists images returned by tools to `./pub/documents/`
5. Sets `workingObject.response` to the accumulated text of all turns

**Logging:** Every AI turn logs `finish_reason`, `content_length`, and `tool_calls` count at `info` level. A `Continue triggered` entry is logged when continuation fires.

#### core-ai-pseudotoolcalls (01002) — Detailed flow

Designed for local models that do not support native function calling. The module parses `[tool:NAME]{...json...}` inline syntax emitted by the model and executes the matching tool.

**Activation:** `wo.useAiModule === "pseudotoolcalls"` or `"core-ai-pseudotoolcalls"`.

**Tool-call format in model output:**
```
[tool:getGoogle]{"query": "current weather Berlin"}[/tool]
```
Multiple calls can appear in a single response. The module extracts all occurrences, executes each tool, inserts the results as assistant continuations, and loops.

**Loop limits:**

| Parameter (workingObject) | Default | Description |
|---|---|---|
| `MaxToolCallsTotal` | `3` | Maximum tool calls across all turns |
| `MaxToolCallsPerTurn` | `1` | Maximum tool calls in a single model response |

**Agentic context awareness:** When `wo.agentType` is set, the module appends the agent type and depth to the system prompt. This allows the model to adapt its behavior when running as an orchestrator or specialist.

**`skipAiCompletions` flag:** If `wo.skipAiCompletions === true`, the module exits immediately without any LLM call.

#### core-ai-roleplay (01003) — Detailed flow

Two-pass generation for roleplay and narrative scenarios. Pass 1 generates the main text response with tool support. Pass 2 generates a single-line Stable Diffusion image prompt that reflects the scene in the response.

**Activation:** `wo.useAiModule === "roleplay"` or `"core-ai-roleplay"`.

**Pass 1 — Text generation:**
1. Builds system prompt from persona + optional agentic context (`agentType`, `agentDepth`)
2. Calls `POST /chat/completions` with tool support
3. Loops on tool calls and continue heuristic (same as completions module)
4. Sets `wo.response` to the accumulated text

**Pass 2 — Image prompt generation:**
1. Builds a secondary system prompt using `imagePromptRules` from `config["core-ai-roleplay"]`
2. Calls the model with limited tokens (`ImagePromptMaxTokens`, default 260) and low temperature (`ImagePromptTemperature`, default 0.35)
3. Passes the result to `getImageSD` (if configured) to generate an image
4. If pass 2 fails or returns empty, a fallback single-line prompt is generated from the response text

**Image prompt config (workingObject):**

| Parameter | Default | Description |
|---|---|---|
| `imagePromptRules` | `""` | Multiline string with SD prompt generation rules. **Must be configured** in `config["core-ai-roleplay"]` in `core.json` — the module produces no image if this is empty. |
| `ImagePromptMaxTokens` | `260` | Max tokens for the image prompt generation call |
| `ImagePromptTemperature` | `0.35` | Temperature for the image prompt call |
| `imagePersonaHint` | `""` | Visual description of the main character, prepended to the image prompt system |

**`skipAiCompletions` flag:** If `wo.skipAiCompletions === true`, both passes are skipped.

---

### 7.3 Output & Post-Processing (02xxx–08xxx)

| No. | File | Purpose |
|---|---|---|
| 02000 | `moderation-output` | Content filtering; can suppress or replace the response |
| 03000 | `discord-status-apply` | Applies the generated Discord presence status. Uses `wo.response` from the AI module; falls back to the `status:ai` registry cache, then to `placeholderText`. If the AI returns `[Empty AI response]` or `[Empty response]`, the presence is set to `"..."` instead of showing the literal marker string. Tool-call status (e.g. `"⏳ Generating an image …"`) takes priority over AI-generated text — but only if the originating flow matches `cfg.allowedFlows`. Set `allowedFlows` to `["discord","discord-voice"]` to prevent API/webpage tool calls from appearing in Discord presence. Default is `[]` (all flows shown). |
| 07000 | `core-add-id` | Appends `id=<callerChannelId>` to eligible artifact links; falls back to `wo.channelId` only when no caller channel is present |
| 08000 | `discord-text-output` | Formats the response as a Discord embed; creates reasoning thread if present |
| 08050 | `bard-label-output` | Parses `wo.response` from `core-ai-completions` in the `bard-label-gen` flow into a **6-position structured label array** `[location, situation, mood1, mood2, mood3, mood4]`. Applies **category-based position rescue**: scans all 6 AI values and assigns each to the correct slot by checking `wo._bardLocations` / `wo._bardSituations` regardless of where the AI placed them (e.g. `'',dungeon,joy,fun,tense,battle` → `dungeon,battle,joy,fun,tense,''`). Unknown words at positions 0/1 are accepted as fallback. Mood slots are validated against `wo._bardValidTags`; invalid entries are replaced with empty string. Writes `bard:labels:{channelId}` and `bard:lastrun:{channelId}` only on success (prevents context window from advancing on AI failure). |
| 08100 | `core-voice-tts` | Source-agnostic TTS renderer. Active in `discord-voice` and `webpage` flows. Parses `[speaker: <voice>]` tags in `wo.response` to split into voice segments, sanitizes text, calls the OpenAI TTS API for each segment (parallel, concurrency 2). Output format is controlled by `wo.ttsFormat` / `cfg.ttsFormat` (default `"opus"` for Discord, `"mp3"` for webpage). Outputs `wo.ttsSegments = [{voice, text, buffer}]` and `wo.ttsDefaultVoice` |
| 08110 | `discord-voice-tts-play` | Discord-specific TTS playback. Runs when `wo.ttsSegments` exists and a voice session is usable. Manages guild-level lock to prevent overlapping speech; plays each segment buffer sequentially via the @discordjs/voice AudioPlayer. Active only in `discord-voice` flow |
| 08200 | `discord-reaction-finish` | Removes the progress reaction; adds a completion reaction |
| 09300 | `webpage-output` | Sends the response back to the webpage flow caller (runs in output phase so it is not skipped by `wo.jump`). **Response logic:** when `wo.http.response.body` is null and `wo.response` is set → sends `{ response: wo.response }` as JSON; when both are absent → sends `{ ok: false, error: "Empty response" }`. Also serves `/documents/*` files: images (`png`, `jpg`, `gif`, `webp`, `avif`) get `Cache-Control: public, max-age=604800, immutable`; all other file types default to `no-store`. Supports `?w=N` on image requests to serve a JPEG thumbnail scaled to N px wide — thumbnail generated on first request and cached to `<imagedir>/thumbnails/{N}/{filename}.jpg` next to the source file; subsequent requests are served from cache (mtime-aware: regenerated if source is newer). `sharp` is a dynamic optional import — if not installed, thumbnail requests fall through to the full image. |
| 09320 | `webpage-voice-output` | Sends TTS audio back to the webpage voice caller. Triggered when `wo.isWebpageVoice === true` — runs regardless of `wo.stop`. Success: HTTP 200 with `Content-Type: audio/mpeg`, concatenated MP3 buffers from `wo.ttsSegments`, plus `X-Transcript` and `X-Response` headers. Error: HTTP 400 JSON |

#### discord-text-output (08000) — Details

- Renders the user's question as a Markdown code block in a Discord embed
- Truncates the response to the 4096-character Discord limit
- Extracts the first image URL from the response and sets it as the embed image
- If `reasoningSummary` is non-empty: creates a thread and posts reasoning there
- Supports webhook delivery for large responses

---

### 7.4 Final Logging (10xxx)

| No. | File | Purpose |
|---|---|---|
| 10000 | `core-output` | Universal logger; writes structured JSON to `logs/objects/<flowKey>/`, a human-readable event log to `logs/events/`, and `last-object.json` per flow |

**`10000-core-output` log files:**

| Path | Format | Rotation |
|---|---|---|
| `logs/events/events-N.log` | Human-readable, one line per log entry: `[ts] [LEVEL] module: prefix message ctx={…}` | 3 MB, 2 files |
| `logs/objects/<flowKey>/objects-N.log` | Full `coreData` JSON dump (sensitive keys redacted) | 3 MB, 2 files per flow |
| `logs/objects/<flowKey>/last-object.json` | Latest `coreData` for the flow (overwritten each run) | — |

**Pipeline diff log (`main.js`):**

Every time a module modifies the `workingObject`, `main.js` records a Unix-style diff of the before/after state:

| Path | Format | Rotation |
|---|---|---|
| `logs/pipeline/pipeline-N.log` | `--- module-name \| timestamp \| Xms ---` followed by `+`/`-` diff lines with 2-line context | 2 MB, 2 files |

Diffs are skipped for modules that leave the `workingObject` unchanged and for objects larger than 2 000 JSON lines.

**Activation:** Pipeline logging is **opt-in**. Set `tracePipeline: true` in `workingObject` in `core.json` to enable it. When `false` or absent, no snapshots are taken and no files are written (zero performance overhead). Hot-reload applies — no restart required.

**Flow filtering (blacklist):** High-frequency flows like `webpage` can fill the 2 MB limit almost immediately. Use `tracePipelineExcludeFlows` to exclude them:

```json
"workingObject": {
  "tracePipeline": true,
  "tracePipelineExcludeFlows": ["webpage*", "bard-*"]
}
```

Each entry is matched against `wo.flow` using glob-style wildcards — `*` matches any sequence of characters. Flows **not** matching any pattern are traced normally. Omit the key (or set it to `[]`) to trace all flows.

---

## 8. Tools — LLM-callable Functions

### Architecture

Tools live in `tools/`. A tool exports only `name` and `invoke`:

```javascript
// tools/myTool.js
export default {
  name:   "myTool",
  invoke: async (args, coreData) => {
    const wo     = coreData.workingObject;
    const cfg    = wo.toolsconfig?.myTool || {};
    // ... do work ...
    return { ok: true, result: "..." };
  }
};
```

**The `definition` export has been removed from all tools.** Tool definitions are maintained exclusively as manifests in `manifests/`.

---

### Manifests — Single Source of Truth

Every tool must have a corresponding manifest file at `manifests/<toolName>.json`. The manifest contains the JSON Schema that the AI receives:

```json
{
  "name": "myTool",
  "description": "What this tool does and when the AI should call it.",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "The search query."
      }
    },
    "required": ["query"]
  }
}
```

- If no manifest exists for a tool listed in `tools[]`, the tool is **loaded but not advertised to the AI** (a warning is logged).
- The outer `{ type: "function", function: <manifest> }` wrapper is added automatically by the core-ai modules.
- Editing a manifest changes what the AI sees without touching source code.

---

### Creating a New Tool — Checklist

1. **Create `tools/<toolName>.js`** — export `{ name, invoke }` only. No `definition`.
2. **Create `manifests/<toolName>.json`** — with `name`, `description`, `parameters`.
3. **Add toolsconfig** in `core.json` under `toolsconfig.<toolName>` for any admin-configurable values.
4. **Enable** by adding `"<toolName>"` to the `tools` array in the relevant flow's `workingObject` config.

#### Tool file structure

```javascript
/**************************************************************/
/* filename: "getMyTool.js"                                   */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/

import { getPrefixedLogger } from "../core/logging.js";
import { getSecret }         from "../core/secrets.js";

const MODULE_NAME = "getMyTool";

async function getInvoke(args, coreData) {
  const wo  = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);
  const cfg = wo?.toolsconfig?.[MODULE_NAME] || {};

  const apiKey = await getSecret(wo, String(cfg.apiKey || "").trim());
  const query  = String(args?.query || "").trim();

  if (!query) return { ok: false, error: "query is required" };

  log(`Calling external API for query: ${query}`);

  return { ok: true, result: "..." };
}

export default {
  name:   MODULE_NAME,
  invoke: getInvoke
};
```

**Rules:**
- `invoke` signature is always `async function(args, coreData)`.
- Return a plain object. On success include the relevant payload fields. On failure include `{ ok: false, error: "..." }`.
- Config comes from `wo.toolsconfig?.[MODULE_NAME]`. Never read from `coreData.config`.
- Secrets are resolved via `getSecret(wo, placeholder)` — never store real keys in `core.json`.
- Allowed imports: `core/` and `shared/` only. Do not import other tools or modules.
- All prompts come from `cfg.<promptKey>` (toolsconfig), not hardcoded in the file.

#### Manifest file structure

```json
{
  "name": "getMyTool",
  "description": "What this tool does and when the AI should call it. Always call fresh — never reuse results from conversation history.",
  "policyHint": "Optional. Plain-text instruction injected into the system prompt's channel awareness block whenever this tool is present in the channel's tool list. Use this to express tool-specific behavioral rules the primary assistant must follow (e.g. confirmation requirements). Leave out if no policy is needed.",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "The query string."
      }
    },
    "required": ["query"],
    "additionalProperties": false
  }
}
```

| Manifest field | Required | Description |
|---|---|---|
| `name` | Yes | Must match the tool file's `MODULE_NAME` and the filename |
| `description` | Yes | Shown to the AI as the tool's purpose and call conditions |
| `policyHint` | No | Behavioral rule injected into the system prompt when this tool is active |
| `parameters` | Yes | JSON Schema object describing the tool's arguments |

---

### Creating a New Module — Checklist

1. **Create `modules/NNNNN-my-module.js`** with a `Version 1.0` header and a default export function.
2. **Read config only from** `coreData.config["my-module"]` and the current `workingObject`.
3. **Do not import from `tools/` or other `modules/`**. Shared logic belongs in `core/` or `shared/`.
4. **If the module needs LLM reasoning**, route it through the internal API flow or the existing `core-ai-*` modules rather than calling the provider directly.
5. **Subscribe the module** by adding `config["my-module"].flow` in `core.json`.
6. **Document the module** in the module table and in `CORE_JSON.md` if it has config keys or public HTTP routes.
7. **Always return `coreData`** — even when exiting early.

#### Module file structure

```javascript
/**************************************************************/
/* filename: "00099-my-module.js"                             */
/* Version 1.0                                               */
/* Purpose: Short description of what this module does.     */
/**************************************************************/

import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "my-module";

export default async function getMyModule(coreData) {
  const wo  = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);
  const cfg = coreData?.config?.[MODULE_NAME] || {};

  if (wo.flow !== "discord") return coreData;

  const myParam = String(cfg.myParam || "default").trim();
  log(`Running with myParam="${myParam}"`);

  wo.response = "Hello from my module";

  return coreData;
}
```

**Pipeline control:**

| Field | Effect |
|---|---|
| `wo.stop = true` | Hard stop — skip all remaining modules **including** the output phase (≥9000). Use for full aborts (e.g. gate modules that deny the request). |
| `wo.jump = true` | Jump to output phase — skip normal loop modules but still run output modules (≥9000). Use after setting `wo.http.response` in webpage modules. |
| `wo.stopReason = "..."` | Diagnostic label logged alongside `wo.stop`. Has no effect on execution. |

**Config access:**
- Module config: `coreData?.config?.[MODULE_NAME]`
- Global runtime defaults: `coreData?.workingObject` (already merged with channel overrides by `core-channel-config`)
- Secrets: `await getSecret(wo, placeholder)` from `core/secrets.js`

**Important:** Config isolation is enforced by ESLint (`npm run lint`). A module may only access `config["its-own-key"]`. Cross-module config access causes a lint error.

---

### Writing Good Manifest Descriptions

The description is the primary way to control AI behaviour. Follow these conventions:

**Context-bias prevention** — Always include one of these phrases if the tool fetches live data:
- *"Always execute a fresh [operation] — never reuse results from conversation history."*
- *"Always call this tool for the current request — never repeat a previous answer from context."*

**Tool-chaining hints** — If a tool's output is commonly followed by another tool call, say so:
- `getImage` → *"Pass the returned URL to `getAnimatedPicture` if the user wants an animation."*
- `getTavily` → *"Use `getWebpage` on individual results for full article content."*

**Trigger clarity** — Be explicit about when NOT to call the tool, to prevent over-calling.

---

### Prompt Externalization

All hardcoded AI prompts — in both tools and modules — have been moved to `core.json`. Every key is optional; if absent or empty the built-in default is used.

#### Tool prompts (`toolsconfig.<toolName>`)

| Tool | Config key | Purpose |
|---|---|---|
| `getImage` | `toolsconfig.getImage.enhancerSystemPrompt` | Prompt enhancer system prompt |
| `getImageDescription` | `toolsconfig.getImageDescription.systemPrompt` | Vision analyst system prompt |
| `getWebpage` | `toolsconfig.getWebpage.systemPrompt` | Web analyst system prompt |
| `getYoutube` | `toolsconfig.getYoutube.systemPrompt` | Transcript analyst system prompt |
| `getHistory` | `toolsconfig.getHistory.systemPrompt` | History summarizer system prompt |


#### Module prompts (`config["<module-name>"]`)

| Module | Config key | Purpose |
|---|---|---|
| `core-ai-completions` | `policyPrompt` | Policy block appended to every system prompt |
| `core-ai-responses` | `policyPrompt` | Policy block appended to every system prompt |
| `core-ai-pseudotoolcalls` | `policyPrompt` | Policy block appended to every system prompt |
| `core-ai-pseudotoolcalls` | `toolContractPrompt` | Tool-call syntax contract shown to the model |
| `core-ai-pseudotoolcalls` | `continuationPrompt` | User message injected when output was cut off |
| `core-ai-roleplay` | `imagePromptRules` | Stable Diffusion image prompt generation rules |
| `bard-cron` | `prompt` | Full music-classifier prompt (supports `{{LOCATION_TAGS}}`, `{{SITUATION_TAGS}}`, `{{MOOD_TAGS}}`, `{{CURRENT_LABELS}}`, `{{EXAMPLE_LINES}}` placeholders) |
| `webpage-voice-record` | `diarizationSystemPrompt` | Speaker diarization system prompt |

Per-channel overrides for `policyPrompt`, `toolContractPrompt`, and `continuationPrompt` can also be set directly on `workingObject` (channel config `overrides` block) and take precedence over the module-level defaults.

Tool-specific policy hints are declared in the tool's manifest file as a `policyHint` string field. When a tool is present in the channel's tool list, its `policyHint` is automatically appended to the system prompt's channel awareness block. This keeps tool-specific guidance co-located with the tool definition and requires no module changes when tools are added or removed.

---

To enable a tool, add its name to `workingObject.tools`.
Configuration goes in `workingObject.toolsconfig.<toolName>`.

---

### getGoogle

**File:** `tools/getGoogle.js`
**Purpose:** Web search via Google Custom Search API

**LLM parameters (passed by the AI):**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | Search query |
| `num` | integer (1–10) | — | Number of results (default from toolsconfig) |
| `safe` | string | — | Safe search: `"off"` \| `"active"` \| `"high"` |
| `hl` | string | — | UI language hint, e.g. `"en"` |
| `lr` | string | — | Language restrict, e.g. `"lang_en"` |
| `cr` | string | — | Country restrict, e.g. `"countryUS"` |
| `gl` | string | — | Geolocation, e.g. `"us"` |

---

### getTavily

**File:** `tools/getTavily.js`
**Purpose:** Web search via [Tavily Search API](https://tavily.com) — AI-optimised results with topic and time-range filters. Complements `getGoogle`; useful when Google's CSE quota is exhausted or when news/finance-specific searches are needed.

**LLM parameters (passed by the AI):**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | Search query |
| `searchDepth` | string | — | `"basic"` (1 credit, default) · `"advanced"` (2 credits, more thorough) |
| `maxResults` | integer (1–20) | — | Number of results (default from toolsconfig) |
| `topic` | string | — | `"general"` · `"news"` · `"finance"` |
| `timeRange` | string | — | `"day"` · `"week"` · `"month"` · `"year"` |
| `includeAnswer` | boolean | — | Request a Tavily-generated answer alongside results |

**Admin-only toolsconfig keys** (not exposed to the LLM):

| Key | Description |
|---|---|
| `includeDomains` | Array of domains to restrict results to |
| `excludeDomains` | Array of domains to exclude |
| `country` | Boost results from a specific country (ISO code) |

**Return value:**

```json
{
  "ok": true,
  "query": "...",
  "total": 5,
  "answer": "...",
  "responseTime": 1.23,
  "results": [
    { "title": "...", "url": "...", "content": "...", "score": 0.97 }
  ]
}
```

**Setup:** Create a free account at [app.tavily.com](https://app.tavily.com), copy the API key, and set `toolsconfig.getTavily.apiKey` in `core.json`. Free tier includes 1 000 credits/month.

---

### getWebpage

**File:** `tools/getWebpage.js`
**Purpose:** Fetch a web page, extract text, optionally produce an AI summary

**LLM parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | Yes | Absolute URL (http/https) |
| `userPrompt` | string | Yes | User question/task against the page text (legacy alias: `user_prompt`) |
| `prompt` | string | — | Optional extra system instructions to bias the summary |

**Modes:**
- `dump`: page has fewer than `wordThreshold` words -> text returned directly
- `summary`: page exceeds `wordThreshold` -> AI summary

---

### getImage

**File:** `tools/getImage.js`
**Purpose:** Generate images via the OpenAI Images API, save locally, return public URL

**LLM parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `prompt` | string | Yes | Scene description |
| `size` | string | — | Explicit size `"WxH"`, e.g. `"1024x1024"` |
| `aspect` | string | — | Aspect preset: `"portrait"`, `"landscape"`, `"1:1"`, `"16:9"`, etc. |
| `targetLongEdge` | number | — | Target pixels for the long edge when `size` is omitted |
| `n` | integer (1–4) | — | Number of images |
| `strictPrompt` | boolean | — | `true` = use prompt exactly (skip enhancer) |
| `negative` | string/array | — | Negative tags |

**Prompt enhancement:** The tool automatically improves prompts with quality tags, camera/lens suggestions and negative tags. Use `strictPrompt: true` to pass the prompt unchanged.

---

### getImageDescription

**File:** `tools/getImageDescription.js`
**Purpose:** Analyse and describe an image URL using a vision model

**LLM parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `imageUrl` | string | Yes | Image URL (legacy alias: `imageURL`) |
| `prompt` | string | — | Specific analysis request |

---

### getImageSD

**File:** `tools/getImageSD.js`
**Purpose:** Generate images via a local Stable Diffusion API (AUTOMATIC1111)

**LLM parameters:**

| Parameter | Type | Description |
|---|---|---|
| `prompt` | string | Positive prompt |
| `negative_prompt` | string | Negative prompt (optional) |
| `size` | string | Image size `"WxH"` |
| `steps` | number | Inference steps |
| `cfg_scale` | number | CFG scale |
| `seed` | number | Seed (-1 = random) |

**Prerequisite:** A local AUTOMATIC1111 instance running at `baseUrl`.

---

### getAnimatedPicture

**File:** `tools/getAnimatedPicture.js`
**Purpose:** Animate a still image into a short video (image-to-video via Replicate WAN)

**LLM parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `image_url` | string | Yes | URL of the source image |
| `prompt` | string | — | Description of the motion/animation |
| `duration` | number | — | Video duration in seconds |

---

### getVideoFromText

**File:** `tools/getVideoFromText.js`
**Purpose:** Generate a video from a text prompt (text-to-video via Replicate / Veo-3)

**LLM parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `prompt` | string | Yes | Scene description for the video |
| `duration` | number | — | Video duration in seconds |
| `aspect_ratio` | string | — | Format: `"16:9"`, `"9:16"`, `"1:1"` |

---

### getYoutube

**File:** `tools/getYoutube.js`
**Purpose:** Fetch YouTube videos, extract transcripts, summarise or search

**LLM parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `mode` | string | — | `"transcript"` (default) or `"search"` |
| `videoUrl` | string | For transcript mode | YouTube URL or 11-character video ID (legacy alias: `video_url`) |
| `userPrompt` | string | — | Question/task against the transcript (QA mode; legacy alias: `user_prompt`) |
| `metaOnly` | boolean | — | Return only video metadata |
| `query` | string | For search mode | Search query |
| `maxResults` | number | — | Max search results (1–10, legacy alias: `max_results`) |
| `safeSearch` | string | — | `"none"` \| `"moderate"` \| `"strict"` (legacy alias: `safe_search`) |

---

### getJira

**File:** `tools/getJira.js`
**Purpose:** Jira Cloud proxy with full CRUD operations for issues

**LLM parameters (selection):**

| Parameter | Type | Description |
|---|---|---|
| `action` | string | Operation: `"create"`, `"get"`, `"update"`, `"search"`, `"transition"`, `"list_projects"` |
| `issue_key` | string | Issue key, e.g. `"PROJ-123"` |
| `summary` | string | Issue summary |
| `description` | string | Issue description |
| `issue_type` | string | Issue type, e.g. `"Task"`, `"Bug"` |
| `priority` | string | Priority, e.g. `"High"`, `"Medium"` |
| `jql` | string | JQL query for search |
| `transition_id` | string | Transition ID for status changes |

---

### getConfluence

**File:** `tools/getConfluence.js`
**Purpose:** Confluence Cloud proxy with full CRUD for pages (create/append/read/list/delete/move/upload)

**LLM parameters (selection):**

| Parameter | Type | Description |
|---|---|---|
| `action` | string | Operation: `"create"`, `"read"`, `"update"`, `"append"`, `"list"`, `"delete"`, `"move"`, `"upload"` |
| `page_id` | string | Page ID |
| `title` | string | Page title |
| `content` | string | Page content (Markdown is converted to Storage HTML) |
| `parent_id` | string | Parent page ID |
| `space_key` | string | Space key (overrides `toolsconfig.project`) |

---

### getPDF

**File:** `tools/getPDF.js`
**Purpose:** Convert HTML content to PDF, save, and return a public URL

**LLM parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `html` | string | Yes | Full HTML content |
| `filename` | string | — | Desired filename (without extension) |

---

### getText

**File:** `tools/getText.js`
**Purpose:** Generate a text/Markdown file, save, and return a public URL

**LLM parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `content` | string | Yes | File content |
| `filename` | string | — | Desired filename |
| `extension` | string | — | File extension, e.g. `"md"`, `"txt"`, `"py"` |

---

### getHistory

**File:** `tools/getHistory.js`
**Purpose:** Retrieve raw message rows from the conversation log for a given UTC time range. Returns results ordered chronologically. Supports pagination via `startCtxId`.

**LLM parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `start` | string | Yes | Start of the time range in UTC. Accepts ISO 8601, `YYYY-MM-DD`, or `DD.MM.YYYY`. If date-only, time defaults to `00:00:00 UTC`. |
| `end` | string | No | End of the time range in UTC. Same formats as `start`. If date-only, the end is exclusive at the next day's `00:00:00 UTC`. Defaults to now when omitted. |
| `prompt` | string | No | Additional focus instructions appended to the result (e.g. `"focus on decisions"`). |
| `startCtxId` | number | No | Pagination cursor — pass `next_start_ctx_id` from a previous response to fetch the next page. Aliases: `start_ctx_id`, `start_ctx`. |

**Response fields:**

| Field | Description |
|---|---|
| `rows` | Array of message rows, each with `ctx_id`, `ts` (ISO UTC), `channelId`, `role`, `text` |
| `count` | Number of rows returned |
| `has_more` | `true` when results were truncated by row or character cap |
| `next_start_ctx_id` | Cursor for the next page (only present when `has_more=true`) |
| `actual_start` / `actual_end` | ISO timestamps of the first and last returned row |

**Channel scope:** Automatically covers all channels in the working context (`callerChannelId`, `callerChannelIds`, `channelIds`). No per-call channel override — scope is set at the channel-config level.

**Timezone:** All timestamps stored and queried in UTC. The runtime info block in the system prompt provides `current_time_iso` and `timezone_hint` — always convert local times to UTC before passing.

**toolsconfig keys** (`toolsconfig.getHistory`):

| Key | Type | Default | Description |
|---|---|---|---|
| `maxRows` | number | `5000` | Maximum rows loaded from DB per call (hard cap, applied before char budget) |
| `pagesize` | number | `1000` | Internal DB page size for chunked loading |
| `dumpMaxChars` | number | `40000` | Character budget for returned row text. Rows are dropped from the end once the budget is reached, and `has_more` is set. |
| `includeToolRows` | boolean | `false` | Include rows with `role = "tool"` in results |
| `includeJson` | boolean | `false` | Include the raw stored JSON payload in each row |

---

### getLocation

**File:** `tools/getLocation.js`
**Purpose:** Generates a Street View image, an interactive Street View link, and a Google Maps link for one or more locations. Optional route mode adds turn-by-turn text.

**LLM parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `locations` | string[] | Yes | One or more addresses or `lat,lng` coordinates. The last item is used as destination. |
| `route` | boolean | No | When `true`, input is interpreted as origin → optional waypoints → destination. |
| `streetSize` | string | No | Static Street View image size (for example `640x400`). |
| `streetFov` | number | No | Camera field of view (1–120). |
| `streetHeading` | number | No | Camera heading in degrees. |
| `streetPitch` | number | No | Camera pitch in degrees. |

**Compatibility:** legacy snake_case parameter aliases are still accepted (`street_size`, `street_fov`, `street_heading`, `street_pitch`), but camelCase is the canonical interface.

---

### getTime

**File:** `tools/getTime.js`
**Purpose:** Return the current time and timezone information

**LLM parameters:**

| Parameter | Type | Description |
|---|---|---|
| `timezone` | string | Timezone, e.g. `"Europe/Berlin"` |

---

### getToken

**File:** `tools/getToken.js`
**Purpose:** Convert an image or video into an animated GIF token (for Discord stickers/emojis)

**LLM parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `source_url` | string | Yes | URL of source image or video |
| `size` | number | — | GIF target size in pixels |
| `borderPx` | number | — | Border in pixels |
| `fps` | number | — | Frames per second |

**Prerequisites:** `ffmpeg`, `convert` (ImageMagick), and `gifsicle` must be installed.

---

### getBan

**File:** `tools/getBan.js`
**Purpose:** Ban a user from Discord (admins only)

**LLM parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_id` | string | Yes | Discord user ID |
| `reason` | string | — | Reason for the ban |
| `delete_message_days` | number | — | Delete messages from the last N days (0–7) |

**Security:** Only executable when the calling user is listed in `modAdmin`.

---

### getGraph

**File:** `tools/getGraph.js`
**Purpose:** Microsoft 365 integration via the Microsoft Graph API — SharePoint files, OneDrive, Exchange mail, Azure AD/Entra users, and arbitrary Graph API calls.

**Authentication:** OAuth 2.0 **delegated** flow. Each Discord user must connect their Microsoft account once at `/graph-auth`. The access token is stored in the `graph_tokens` DB table and refreshed automatically by the `cron-graph-token-refresh` module. No app-level token is required in `toolsconfig.getGraph`. If a user has not authenticated, the tool returns `{ ok: false, error: "No Microsoft account connected ... Please authenticate at /graph-auth" }`.

**Auto-discovery:** When `defaultSiteId` is not configured, the tool discovers it from `defaultSharePointHostname`. The SharePoint site's drive ID is cached separately from the user's OneDrive — OneDrive operations always use `/me/drive` and are never redirected to SharePoint.

**`storageScope` — always set explicitly for file operations:**

| Value | Target | When to use |
|---|---|---|
| `onedrive` | User's personal OneDrive (`/me/drive`) | User says "OneDrive", "meine Dateien", "mein Laufwerk" |
| `sharepoint` | SharePoint document library | User says "SharePoint", "Dokumentenbibliothek", "Teamdateien" |
| `drive` | Explicit `driveId` | Only when a specific `driveId` is provided |

If the user does not specify a storage target, default to `storageScope='onedrive'`. Without an explicit `storageScope`, the tool may fall back to SharePoint when `defaultSharePointHostname` is configured.

#### Entra App Registration (required once per tenant)

To enable delegated auth you must register an **app** in [Azure Portal → Entra ID → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade).

**Step 1 — Create the registration**
1. Click **New registration**
2. Name: e.g. `Jenny Bot`
3. Supported account types: **Accounts in this organizational directory only** (single tenant) — or *multitenant* if needed
4. Redirect URI: **Web** → `https://yourdomain.com/graph-auth/callback`
5. Click **Register**; note the **Application (client) ID** and **Directory (tenant) ID**

**Step 2 — Add a client secret**
1. Go to **Certificates & secrets → New client secret**
2. Set a description and expiry
3. Copy the **Value** immediately — it is shown only once
4. Store as secrets: `graph_client_id`, `graph_client_secret`, `graph_tenant_id`

**Step 3 — Add delegated API permissions**

Navigate to **API permissions → Add a permission → Microsoft Graph → Delegated permissions** and add:

| Permission | Admin Consent Required | Purpose |
|---|---|---|
| `User.Read` | No | Read the signed-in user's profile (`/me`) |
| `offline_access` | No | Issue refresh tokens for long-lived sessions |
| `Mail.Read` | No | Read mailbox messages |
| `Mail.ReadWrite` | No | Read, modify, move and delete mailbox messages |
| `Mail.Send` | No | Send email as the user |
| `Files.ReadWrite.All` | **Yes** | Access all OneDrive files and SharePoint document libraries the user can reach |
| `Sites.ReadWrite.All` | **Yes** | Read and write all SharePoint site content |

> `openid` and `profile` are automatically included by Azure — no need to add them manually.

**Step 3a — Grant admin consent for permissions that require it**

`Files.ReadWrite.All` and `Sites.ReadWrite.All` require tenant-wide admin consent. Without it, non-admin users will receive an "Admin approval required" error when connecting their account.

1. On the **API permissions** page, click **Grant admin consent for \<your tenant\>**
2. Confirm the dialog
3. All permissions should show a green checkmark under **Status**

This is a one-time action. After granting, all users (including non-admins) can connect their accounts at `/graph-auth` without further approval.

**Step 4 — Store credentials as bot secrets**

```sql
INSERT INTO bot_secrets (name, value, description) VALUES
  ('graph_tenant_id',     '<Directory (tenant) ID>',      'Entra tenant ID'),
  ('graph_client_id',     '<Application (client) ID>',    'Entra app client ID'),
  ('graph_client_secret', '<Client secret value>',        'Entra app client secret');
```

**Step 5 — Configure modules in core.json**

```json
"webpage-graph-auth": {
  "port": 3124,
  "auth": {
    "tenantId":     "SECRET:graph_tenant_id",
    "clientId":     "SECRET:graph_client_id",
    "clientSecret": "SECRET:graph_client_secret",
    "redirectUri":  "https://yourdomain.com/graph-auth/callback",
    "scope":        "offline_access User.Read Mail.ReadWrite Mail.Send Files.ReadWrite.All Sites.ReadWrite.All"
  }
},
"cron-graph-token-refresh": {
  "auth": {
    "tenantId":     "SECRET:graph_tenant_id",
    "clientId":     "SECRET:graph_client_id",
    "clientSecret": "SECRET:graph_client_secret"
  },
  "refreshBufferMinutes": 10
},
"getGraph": {
  "defaultSharePointHostname": "mycompany.sharepoint.com",
  "defaultMailFolderId":       "inbox"
}
```

Also add `3124` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`, and add the cron job:

```json
"cron": {
  "jobs": [
{ "id": "cron-graph-token-refresh", "cron": "*/5 * * * *", "enabled": true, "channelId": "cron-graph-token-refresh" }
  ]
}
```

Add to `config["cron-graph-token-refresh"].flow = ["cron-graph-token-refresh"]` in the module subscription list.

**LLM parameter: `operation`** — selects the operation to execute. All others are optional depending on the operation.

#### Operation groups

**File / Drive operations**

| Operation | Purpose | Key args |
|---|---|---|
| `searchFiles` | Search files by name/content within a specific drive | `query`, `top`, `driveId`, `siteId`, `userId` |
| `showFile` | Get metadata of a single file or folder | `path`, `itemId`, `driveId`, `siteId`, `userId` |
| `listFiles` | List children of a folder | `path`, `itemId`, `top` |
| `downloadFile` | Download file content | `path`, `itemId`, `downloadMode` (`base64`/`text`/`auto`) |
| `uploadFile` | Upload a file ≤ 4 MB | `fileName`, `contentBase64`, `parentPath`, `contentType`, `conflictBehavior` |
| `createUploadSession` | Create a resumable upload session for large files | `fileName`, `parentPath`, `conflictBehavior` |
| `deleteFiles` | Delete one or more files/folders | `items[]` (each with `itemId` or `path`) |
| `renameFiles` | Rename one or more files | `items[]` (each with `itemId`/`path` + `newName`) |

**Mail operations** (scoped to the authenticated user via `/me`; optionally override with `userId`)

| Operation | Purpose | Key args |
|---|---|---|
| `searchEmails` | Search messages with a keyword | `query`, `mailFolderId`, `top` |
| `showEmails` | Fetch full message bodies | `messageIds[]`, `bodyType` (`text`/`html`) |
| `listMailFolders` | List all mail folders | `top` |
| `searchMailFolders` | Find mail folders by name | `query` |
| `deleteMails` | Delete messages | `messageIds[]` |
| `moveEmails` | Move messages to a folder | `messageIds[]`, `destinationFolderId` |
| `sendMail` | Send an email | `to[]`, `subject`, `body`, `cc[]`, `bcc[]`, `replyTo`, `bodyType`, `saveToSentItems` |

Well-known `mailFolderId` values: `inbox`, `sentitems`, `deleteditems`, `drafts`, `junkemail`

**User / Azure AD operations**

| Operation | Purpose | Key args |
|---|---|---|
| `searchUsers` | Full-text search across the directory | `query`, `top` |
| `showUser` | Get full profile of a user | `userId` |
| `createUser` | Create a new user | `user` (Graph user resource object) |
| `updateUser` | Update user properties | `userId`, `user` (partial) |
| `deleteUser` | Delete a user account | `userId` |

**Utility operations**

| Operation | Purpose | Key args |
|---|---|---|
| `fulltextSearch` | Search across drives and mail in one call | `query`, `entityTypes[]`, `size`, `from` |
| `resolveDefaultTargets` | Show the resolved IDs the tool would use | `includeSharePointLookup` |
| `graphRequest` | Call any Graph API endpoint | `request.path`, `request.method`, `request.query`, `request.body` |

#### Common parameters

| Parameter | Type | Description |
|---|---|---|
| `operation` | string | **Required.** One of the operations listed above |
| `storageScope` | string | Target hint: `onedrive`, `sharepoint`, or `drive` — auto-inferred when omitted |
| `userId` | string | User ID or UPN. Falls back to `defaultUserId` in config |
| `driveId` | string | Explicit drive ID. Auto-discovered when omitted |
| `siteId` | string | SharePoint site ID. Auto-discovered from configured hostname |
| `path` | string | Drive-relative file path, e.g. `Documents/Report.xlsx` |
| `itemId` | string | Drive item ID (alternative to `path`) |
| `top` | number | Max results for list/search operations |
| `select` | string | OData `$select` to restrict returned fields |
| `version` | string | Graph API version (`v1.0` or `beta`) |
| `timeoutMs` | number | Per-request timeout override in ms |
| `to` | array | Recipient email addresses for `sendMail` |
| `cc` | array | CC recipients for `sendMail` |
| `bcc` | array | BCC recipients for `sendMail` |
| `subject` | string | Email subject for `sendMail` |
| `body` | string | Email body for `sendMail` (plain text by default; use `bodyType: "html"` for HTML) |
| `replyTo` | string | Reply-To address for `sendMail` |
| `saveToSentItems` | boolean | Save sent message in Sent Items (default: `true`) |

#### Return values

Every operation returns an object with:
- `ok: boolean` — `true` on success
- `operation: string` — the operation that ran
- `status / statusText` — HTTP status from Graph API
- `error: string` — present only when `ok: false`
- Operation-specific fields (`item`, `result`, `messages`, `user`, etc.)

The tool never throws — if authentication fails or an ID cannot be resolved the AI always receives a structured `{ ok: false, error: "..." }` response.

---

### getSpotify

**File:** `tools/getSpotify.js`
**Purpose:** Spotify integration — playback control, device management, playlist operations, and search. This is the only music playback tool. The AI uses it for any music-related request regardless of whether the user mentions "Spotify" explicitly.

**Authentication:** OAuth 2.0 **delegated** flow. Each Discord user must connect their Spotify account once at `/spotify-auth`. The access token is stored in the `spotify_tokens` DB table and refreshed automatically by the `cron-spotify-token-refresh` module. No app-level token is required in `toolsconfig.getSpotify`. If a user has not authenticated, the tool returns `{ ok: false, error: "No Spotify account connected ... Please authenticate at /spotify-auth" }`.

**Spotify Premium:** Playback control operations (`play`, `pause`, `transferPlayback`) require an active Spotify Premium subscription. Free-tier users can still use `search`, `getPlayback`, `listDevices`, and playlist operations.

**Timeout:** The entire tool invocation is wrapped in a 20-second global timeout. If any internal operation hangs (DB query, HTTPS request), the tool returns `{ ok: false, error: "getSpotify timed out after 20s" }` and releases control back to the pipeline.

#### Supported Operations

| Operation | Description |
|---|---|
| `playByName` | Search for a track, album, or artist by name and play it in one step — combines `search` + `listDevices` + `play` internally. Use this for any "play X" request instead of chaining the individual operations. |
| `search` | Search Spotify for tracks, albums, artists, or playlists |
| `getPlayback` | Get current playback state (track, device, progress, shuffle, repeat) |
| `play` | Start or resume playback; optionally play a specific URI on a specific device |
| `pause` | Pause playback on the active or specified device |
| `setVolume` | Set playback volume (0–100) on the active or specified device. Requires Spotify Premium. |
| `listDevices` | List available Spotify Connect devices for the user |
| `transferPlayback` | Transfer playback to a specific device |
| `getPlaylists` | List the user's playlists |
| `createPlaylist` | Create a new playlist |
| `addToPlaylist` | Add one or more tracks to a playlist |
| `removeFromPlaylist` | Remove one or more tracks from a playlist |

#### Required Play Workflow

The AI must always follow this sequence when playing a named track:

1. **`search`** — search with exact track name and artist (`types: ["track"]`). After receiving results, find the result whose `name` field matches the requested track name. Do not blindly use the first result — verify name and artist match. If no result matches, retry with a simpler query (track name only).
2. **`listDevices`** — get available device IDs. Pick the active device, or the first available if none is active.
3. **`play`** — set `uris: [trackUri]` and `deviceId`. Never call `play` without a `deviceId` (fails if no device is currently active). Never use `contextUri` for a named track request — this lets Spotify decide what plays and ignores the requested song.
4. **Report success** immediately if `ok: true`. Do not call `getPlayback` to verify — mobile devices take 1–3 seconds to update state and `isPlaying: false` directly after `play` is normal, not an error.

`setVolume`, `pause`, `transferPlayback`: these operations take effect immediately on the active device and do not require a preceding `search` or `listDevices` call unless a specific device must be targeted.

#### Race Condition Notes

`makeRequest` uses a `settle` guard to ensure the HTTP response callback and the timeout handler cannot both resolve the same promise. When the timeout fires, the underlying HTTPS request is destroyed via `req.destroy()` — preventing Spotify from processing a timed-out request after the tool has already returned an error. The global 20-second `getInvoke` timeout clears itself with `clearTimeout` once `getInvokeInternal` resolves, preventing dangling timers.

#### LLM Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `operation` | string | Yes | One of the operations listed above |
| `track` | string | For `playByName` | Track name to search for and play |
| `album` | string | For `playByName` | Album name (optional, narrows the search) |
| `artist` | string | For `playByName` | Artist name (optional, narrows the search) |
| `query` | string | For `search` | Search query string |
| `types` | array | For `search` | Resource types: `track`, `album`, `artist`, `playlist` (default: `["track"]`) |
| `limit` | number | — | Number of results (default: 20, max: 50) |
| `offset` | number | — | Pagination offset (default: 0) |
| `market` | string | — | ISO 3166-1 alpha-2 market code (e.g. `DE`) — optional for search |
| `uris` | array | For `play`, `addToPlaylist`, `removeFromPlaylist` | Array of Spotify track URIs (`spotify:track:ID`) |
| `contextUri` | string | For `play` | Spotify context URI for album/playlist/artist playback — do not use for named track requests |
| `deviceId` | string | For `play`, `pause`, `transferPlayback` | Spotify Connect device ID (from `listDevices`) |
| `offsetIndex` | number | For `play` | Track index within context to start at |
| `positionMs` | number | For `play` | Seek position in milliseconds |
| `volumePercent` | number | For `setVolume` | Volume level 0–100 (required) |
| `play` | boolean | For `transferPlayback` | Start playing immediately after transfer (default: false) |
| `playlistId` | string | For playlist ops | Spotify playlist ID (not URI) |
| `position` | number | For `addToPlaylist` | Insert position (0 = top, default: append) |
| `snapshotId` | string | For `removeFromPlaylist` | Playlist snapshot ID for conflict detection |
| `name` | string | For `createPlaylist` | New playlist name |
| `description` | string | For `createPlaylist` | New playlist description |
| `public` | boolean | For `createPlaylist` | Whether the playlist is public (default: false) |

#### Response Shape

All responses follow `{ ok: boolean, error?: string, ...operationData }`:
- `ok: true` — operation succeeded; operation-specific fields are present
- `ok: false` — failure; `error` contains the reason (Spotify API message, auth error, or timeout)

The tool never throws — failures always return a structured `{ ok: false, error: "..." }` response.

#### Spotify URI Format

All Spotify resource identifiers use the URI format:
- Track: `spotify:track:4cOdK2wGLETKBW3PvgPWqT`
- Album: `spotify:album:2up3OPMp9Tb4dAKM2erWXQ`
- Playlist: `spotify:playlist:37i9dQZF1DXcBWIGoYBM5M`
- Artist: `spotify:artist:6XyY86QOPPrYVGvF9ch6wz`

Use the `id` field from search results for playlist operations; use the `uri` field for `play`.

---

### getApi

**File:** `tools/getApi.js`
**Purpose:** Generic HTTP REST API caller. Makes arbitrary HTTP requests with configurable authentication. Allows the AI to access any REST API — public or protected — without requiring a dedicated tool per provider.

**Authentication types:**

| `authType` | Mechanism | Where credentials are stored |
|---|---|---|
| `none` | No auth header | — |
| `apiKey` | `Authorization: Bearer <key>` | `bot_secrets` table, key = `authName` |
| `basic` | `Authorization: Basic base64(user:pass)` | `bot_secrets` table, value format `user:pass` |
| `oauth_cc` | OAuth2 Client Credentials (server-wide), `Authorization: Bearer <token>` | `oauth_registrations` table, token cached in `oauth_tokens` with `user_id = "__service__"` |
| `oauth_user` | OAuth2 Authorization Code (per-user), `Authorization: Bearer <token>` | `oauth_registrations` table (registration), `oauth_tokens` table (token per `wo.userId`) |

For `oauth_cc`: the tool fetches a new token automatically if none is cached or if the cached token has less than 60 seconds remaining. Tokens are persisted in the `oauth_tokens` table with `user_id = "__service__"`. See [OAuth Manager](#1619-oauth-manager-oauth) for registration.

For `oauth_user`: the tool uses the token for the Discord user who triggered the current request (`wo.userId`). If the token is expired and a `refresh_token` exists, it refreshes automatically. If the token is missing or expired with no refresh path, the call fails with an error telling the user to reconnect at `/connections`. See [OAuth Connections](#1621-oauth-connections-connections) for user flow.

**Discovery rules — how the AI finds the right `authName`:**

| `authType` | Discovery tool | When to call it |
|---|---|---|
| `oauth_cc` | `getOauthProviders` | Always, unless the name is already known from context |
| `apiKey`, `basic` | `getApiBearers` | Always, unless the name is already known from context |
| `oauth_user` | `getMyConnections` | Always — returns only providers the current user has actually connected |
| `none` | — | No discovery needed |

**Returns:** `{ ok, status, body }` on success; `{ ok: false, error, status, body }` on HTTP error.

**Response parsing:** `responseType=auto` (default) checks the `Content-Type` header — if it contains `application/json` the body is parsed as JSON, otherwise returned as plain text.

#### toolsconfig.getApi

No `toolsconfig` keys are required. The tool is stateless — all auth is resolved at call time.

```json
"getApi": {}
```

**Manifest parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | Yes | Full endpoint URL |
| `method` | string | No | GET / POST / PUT / PATCH / DELETE. Default: `GET` |
| `authType` | string | No | `none` / `apiKey` / `basic` / `oauth_cc` / `oauth_user`. Default: `none` |
| `authName` | string | No | Key in `bot_secrets` (apiKey/basic) or provider name in `oauth_registrations` (oauth_cc/oauth_user) |
| `body` | string | No | JSON body string for POST/PUT/PATCH |
| `headers` | string | No | Additional headers as JSON object string |
| `responseType` | string | No | `auto` / `json` / `text`. Default: `auto` |

**Example — public API:**
```
getApi(url: "https://api.github.com/repos/owner/repo/issues", method: "GET")
```

**Example — API key:**
```
getApi(url: "https://api.example.com/data", authType: "apiKey", authName: "EXAMPLE_API_KEY")
```
Requires a `bot_secrets` row with `name = "EXAMPLE_API_KEY"` and the actual key as `value`.

**Example — OAuth2 client credentials:**
```
getApi(url: "https://api.example.com/resource", authType: "oauth_cc", authName: "example-provider")
```
Requires an `oauth_registrations` row with `name = "example-provider"` registered via the [OAuth Manager](#1619-oauth-manager-oauth).

**Example — OAuth2 per-user token:**
```
getApi(url: "https://api.example.com/me", authType: "oauth_user", authName: "example-provider")
```
Requires an `oauth_registrations` row with `name = "example-provider"` (flow = `auth_code`) registered by an admin, and the requesting user must have connected their account at `/connections`.

---

### getShell

**File:** `tools/getShell.js`
**Purpose:** Executes a shell command on the server as the bot user and returns stdout/stderr. Enables the AI to perform server administration, check system status, list files, run scripts, and query service state.

**Security model:** Commands run as the bot's OS user with its existing filesystem and network permissions — no additional sandboxing is needed or added. `shell: false` is always enforced, which means shell operators (`&&`, `|`, `;`, `$()`) are not interpreted — all arguments must be passed in the `args` array. An optional allowlist restricts which executables are permitted.

**Returns:** `{ ok, exitCode, output, stdout, stderr }`. `ok` is `true` when `exitCode === 0`. On timeout: `{ ok: false, error: "timeout", exitCode: null, output, stdout, stderr }`.

| Field | Description |
|---|---|
| `ok` | `true` when exit code is 0 |
| `exitCode` | Numeric exit code; `null` on timeout or spawn error |
| `output` | **Primary field** — stdout and stderr combined in a single string. Stderr is prefixed with `[stderr]`. If both are empty: `"(no output)"`. The AI manifest requires this field to be relayed verbatim to the user. |
| `stdout` | Raw stdout string; `null` if empty |
| `stderr` | Raw stderr string; `null` if empty |

Output is truncated at `maxOutputBytes` (default 8192 bytes) per stream with a `[output truncated]` suffix. `stdio: ['ignore', 'pipe', 'pipe']` is set explicitly so both streams are always captured regardless of platform defaults.

#### toolsconfig.getShell

```json
"getShell": {
  "allowlist": ["ls", "df", "systemctl", "journalctl", "whoami", "python3"],
  "maxOutputBytes": 16384,
  "defaultTimeoutMs": 15000
}
```

| Key | Type | Default | Description |
|---|---|---|---|
| `allowlist` | string[] | `null` (all allowed) | If set, only listed executable names are permitted |
| `maxOutputBytes` | number | `8192` | Maximum combined stdout/stderr bytes before truncation |
| `defaultTimeoutMs` | number | `15000` | Default command timeout in milliseconds |

**Manifest parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `command` | string | Yes | Executable name (no path), e.g. `"ls"`, `"systemctl"`, `"python3"` |
| `args` | string[] | No | Argument array, e.g. `["-la", "/var/log"]`. Default: `[]` |
| `cwd` | string | No | Working directory for the command |
| `timeoutMs` | number | No | Override timeout for this specific call |

**Example channel config (admin-only shell access):**
```json
{
  "channelMatch": ["admin-shell"],
  "overrides": {
    "apiEnabled": 1,
    "apiSecret": "SECRET:admin_shell_secret",
    "persona": "You are a server admin assistant.",
    "tools": ["getShell"],
    "toolsconfig": {
      "getShell": {
        "allowlist": ["ls", "df", "free", "systemctl", "journalctl", "ps", "whoami", "uname"]
      }
    }
  }
}
```

---

### getOauthProviders

**File:** `tools/getOauthProviders.js`
**Purpose:** Discovery tool. Returns the list of OAuth2 client_credentials provider names (and metadata) that are currently exposed to the AI. Call this before `getApi` with `authType: "oauth_cc"` to discover available `authName` values.

**Returns:** `{ ok, providers: [{ name, description, scope }] }`. If no providers are exposed, returns an empty array with a note.

**No parameters required.**

**Exposure control:** Which providers appear in the result is controlled by the admin at [/oauth-exposure](#1622-oauth-provider-exposure-oauth-exposure). By default nothing is exposed — the admin must toggle each provider on.

#### toolsconfig.getOauthProviders

No `toolsconfig` keys. The tool is stateless and reads from the `tool_exposure` database table.

```json
"getOauthProviders": {}
```

**Typical AI usage flow:**
1. AI calls `getOauthProviders()` → receives `{ providers: [{ name: "discord", description: "Discord API" }] }`
2. AI calls `getApi(url: "https://discord.com/api/users/@me", authType: "oauth_cc", authName: "discord")`

---

### getApiBearers

**File:** `tools/getApiBearers.js`
**Purpose:** Discovery tool. Returns the list of API key names (bearer tokens / credentials) that are currently exposed to the AI. Call this before `getApi` with `authType: "apiKey"` or `"basic"` to discover available `authName` values. Key **values** are never returned — only names and descriptions.

**Returns:** `{ ok, bearers: [{ name, description }] }`. If no keys are exposed, returns an empty array with a note.

**No parameters required.**

**Exposure control:** Which key names appear in the result is controlled by the admin at [/bearer-exposure](#1623-api-key-exposure-bearer-exposure). By default nothing is exposed.

#### toolsconfig.getApiBearers

No `toolsconfig` keys. The tool reads exposed names from the `tool_exposure` table and cross-references with `bot_secrets`.

```json
"getApiBearers": {}
```

**Typical AI usage flow:**
1. AI calls `getApiBearers()` → receives `{ bearers: [{ name: "WEATHER_API", description: "OpenWeather API key" }] }`
2. AI calls `getApi(url: "https://api.openweathermap.org/data/3.0/...", authType: "apiKey", authName: "WEATHER_API")`

---

### getMyConnections

**File:** `tools/getMyConnections.js`
**Purpose:** Discovery tool for per-user OAuth2 connections. Returns the list of OAuth2 providers that the **current Discord user** has personally connected at `/connections`. The AI calls this before `getApi` with `authType: "oauth_user"` to find out which provider names are available for this specific user.

**Returns:** `{ ok, connections: [{ name, description, scope, status }] }`.

| `status` value | Meaning |
|---|---|
| `active` | Token is valid and can be used immediately |
| `expired_renewable` | Token is expired but a `refresh_token` exists — `getApi` will refresh it automatically |
| `expired` | Token is expired and has no refresh path — user must reconnect at `/connections` |

If the user has no connections or no `auth_code` providers are configured, returns an empty array with an explanatory note.

**No parameters required.**

**User context:** Uses `wo.userId` (the Discord user ID of the message sender). Returns an error if called outside a user-triggered conversation.

**No exposure control:** Unlike `getOauthProviders` and `getApiBearers`, this tool does not use the `tool_exposure` table — it always returns the actual connected providers for the current user. The relevant admin control is at `/oauth` (which providers exist) and at the user level (which ones they have connected).

#### toolsconfig.getMyConnections

No `toolsconfig` keys. The tool reads directly from `oauth_registrations` and `oauth_tokens`.

```json
"getMyConnections": {}
```

**Typical AI usage flow:**
1. User says "show me my Spotify playlists"
2. AI calls `getMyConnections()` → receives `{ connections: [{ name: "spotify", description: "Spotify", status: "active" }] }`
3. AI calls `getApi(url: "https://api.spotify.com/v1/me/playlists", authType: "oauth_user", authName: "spotify")`

---

## 9. Core Infrastructure

### 9.1 registry.js — In-Memory Key-Value Store

**Purpose:** Ephemeral runtime data storage (voice sessions, tool-call tracking, client references, etc.)

**API:**
```javascript
import { putItem, getItem, deleteItem, listKeys, clearAll } from "../core/registry.js";

putItem(object, id);       // Store object; returns the key
getItem(id);               // Retrieve object; null if expired or missing
deleteItem(id);            // Remove an entry
listKeys(prefix);          // List keys matching a prefix
clearAll();                // Clear the entire registry
```

**Properties:**
- Default TTL: 7 days (global; per-item override supported)
- LRU eviction: max 100,000 entries
- Garbage collection: every 1 second
- Touch-on-read: LRU timestamp updated on `getItem`

---

### 9.2 context.js — MySQL Conversation Storage

**Purpose:** Persistent conversation history with raw preservation, derived retrieval layers, and token budgeting

**Exported functions:**
```javascript
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

**Subchannel isolation:** `wo.subchannel` (UUID) is stored with every row written by `setContext`. All functions use an internal `getSubchannelFilter()` helper that applies a consistent WHERE clause:
  - `wo.subchannel` set → scope to that subchannel only
  - `wo.subchannel` not set + `subchannelFallback=false` (default) → only rows where `subchannel IS NULL`
  - `wo.subchannel` not set + `subchannelFallback=true` → no filter (full channel including all subchannels)

**Active context storage:** The current runtime uses the raw `context` table as the source of truth and `timeline_periods` as the only actively maintained derived summary layer. The older `context_turns`, `context_segments`, `context_nodes`, `context_index_*`, `context_anchor_*`, `context_embeddings`, `context_events`, and `context_mesh_*` tables are legacy artifacts and are not part of the active runtime architecture.

**Subchannel deletion (`setPurgeSubchannel`):** When a subchannel is deleted, non-frozen context entries are permanently deleted. Frozen entries are **promoted** to the main channel (their `subchannel` field is set to `NULL`) so they are preserved and become part of the main context.

**Purge/Freeze scoping:** `setPurgeContext` and `setFreezeContext` respect the same filter. The channel-wide timeline rows are only affected when targeting the full channel (not a specific subchannel).

**Timeline summary prompt source:** The active timeline summarizer prompt is configured in `core.json` under `config.context.timelineSummaryPrompt`. It is not hardcoded in `core/context.js`.

**`contextChannelId`:** Both `setContext` and `getContext` use `wo.contextChannelId || wo.channelId` as the storage key. Setting `wo.contextChannelId` redirects all context reads and writes to a different channel ID without changing `wo.channelId`. This is used in scenarios where one virtual channel (e.g. a subagent channel) should read or write history belonging to a different channel.

**`userId` resolution in `setContext`:** The `userId` stored in the DB is resolved automatically using the following priority chain — callers do **not** need to populate it manually:
1. `record.userId` (if the caller explicitly passes one)
2. `workingObject.webAuth?.userId` (set by `webpage-auth` for all authenticated web requests)
3. `workingObject.userId` (set directly for Discord/API flows)

This means `add-context` modules (00070, 00072) do not include `userId` in the record they pass to `setContext` — it is resolved centrally.

**Internal meta frames:** `setContext()` silently discards any record where `record.internal_meta === true`. Meta frames are generated dynamically at retrieval time by `getContext()` and injected into the AI context window; they are never stored in MySQL. This prevents ghost entries (e.g. `[assistant] Jenny` index strings) from appearing in the database or the chat UI.

**Retrieval flow:** `getContext()` resolves the effective scope, loads recent raw rows, matches indexed segments by payload features such as terms, entities, URLs, and project IDs, optionally adds higher-level node summaries, and returns standard GPT-style rows. The `core-ai-*` modules consume those rows but do not own retrieval policy.

**`getContextSince`** is used by the Bard cron job (`00036-bard-cron.js`) to read chat that occurred since the job last ran. This avoids a fixed time window and ensures no messages are missed even if the cron interval stretches.

```javascript
// Example: read context since a registry-stored timestamp
const lastRun = await getItem("bard:lastrun:channelId"); // { ts: "2026-03-07T..." }
const rows = lastRun?.ts
  ? await getContextSince(wo, lastRun.ts)          // since last run
  : await getContextLastSeconds(wo, 300);           // fallback: last 5 minutes
```

**Rolling summaries:**
- Raw rows are preserved unchanged in `context`
- Derived turns, segments, nodes, and indexes are rebuilt from raw rows
- Retrieval chooses recent raw rows plus relevant derived ranges instead of replacing stored messages

**Token budgeting:**
- Context is trimmed until it fits within `contextTokenBudget`
- Blocked users receive a token budget of 1

---

### 9.3 logging.js — Structured Logging

**Purpose:** Append structured log entries to `workingObject.logging[]`

**API:**
```javascript
import { getPrefixedLogger } from "../core/logging.js";

// workingObject = wo from coreData; import.meta.url derives the module name automatically.
const log = getPrefixedLogger(workingObject, import.meta.url);

log("Processing started");                       // default level: "info"
log("Rate limit hit", "warn");
log("API call failed", "error", { detail: "..." });
```

The module name/prefix is derived from the calling file's URL via `import.meta.url` — you do not need to pass a name manually.

**Log entry structure:**
```javascript
{
  ts:         "2026-03-07T12:34:56.789Z",
  level:      "info" | "warn" | "error",
  message:    "...",
  prefix:     "[00070:discord-add-context]",
  moduleName: "discord-add-context",
  context:    { /* optional metadata */ }
}
```

The final log is written by module `10000-core-output` to `logs/events/` (human-readable) and `logs/objects/<flowKey>/` (full JSON). See [Section 7.4](#74-final-logging-10xxx) for rotation details.

**`logs/json-error.log`:** Parse errors in `core.json` (startup and hot-reload) are written as newline-delimited JSON to `logs/json-error.log` in the bot root. Each entry has the shape `{ ts, context, error }` where `context` is `"startup"` or `"hot-reload"`. The log directory is created automatically.

---

### 9.4 secrets.js — Centralized Secret Store

**File:** `core/secrets.js`

All API keys, tokens, and other secrets are stored in the `bot_secrets` MySQL table rather than in `core.json`. `core.json` fields that previously held real key values now hold **symbolic placeholder names** (e.g. `"OPENAI"`, `"DISCORD"`). At runtime, every module that needs an API key calls `getSecret(wo, placeholder)`, which resolves the placeholder to its real value from the database.

#### How it works

1. `getSecret(wo, "OPENAI")` is called by a module or tool.
2. `secrets.js` looks up `"OPENAI"` in the `bot_secrets` table.
3. The real value stored behind the alias is returned and used for the API call.
4. The real value is never written to `core.json`, never logged, and never appears in the pipeline dump files.
5. Results are **TTL-cached** (60 seconds) per table to avoid repeated DB queries.

If a placeholder is not found in the database, `getSecret` returns the placeholder string as-is. This means the bot never crashes due to a missing secret — it will simply fail at the API level with an authentication error.

#### bot_secrets table

```sql
CREATE TABLE IF NOT EXISTS bot_secrets (
  name        VARCHAR(64)  NOT NULL,
  value       TEXT         NOT NULL,
  description VARCHAR(255) NULL,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

The table is also created automatically on first use by the Key Manager (`/key-manager`) and on bot startup. See Section 1 (Quickstart) for the full INSERT statement.

#### Placeholder names

| Placeholder | Used by |
|---|---|
| `OPENAI` | LLM completions, TTS, Whisper, DALL-E, avatar generation, image description, history, wiki image gen |
| `DISCORD` | Main Discord bot token (`config.discord.token`) |
| `BARD_DISCORD` | Bard music bot token (`config.bard.token`) |
| `DISCORD_CLIENT_SECRET` | OAuth2 SSO (`webpage-auth.clientSecret`) |
| `SESSION_SECRET` | Session cookie signing (`webpage-auth.sessionSecret`) |
| `TAVILY` | Tavily web search tool |
| `GOOGLE` | Google Custom Search API key |
| `GOOGLE_CSE_ID` | Google Custom Search Engine ID |
| `JIRA` | Jira API token |
| `JIRA_EMAIL` | Jira account email |
| `CONFLUENCE` | Confluence API token |
| `CONFLUENCE_EMAIL` | Confluence account email |
| `ANIMATED_PICTURE` | Animated picture generation |
| `VIDEO_FROM_TEXT` | Video-from-text generation |
| `REPLICATE` | Replicate API token (inpainting) |
| `API_SECRET` | Internal HTTP API bearer token |

#### Exported functions

| Function | Description |
|---|---|
| `getSecret(wo, placeholder)` | Resolve a placeholder to its real value. Returns the placeholder unchanged if not found. |
| `listSecrets(wo)` | Return all rows from `bot_secrets` as `[{name, value, description}]`. |
| `setSecret(wo, name, value, description)` | Insert or update a secret (upsert). Invalidates the cache. |
| `deleteSecret(wo, name)` | Delete a secret by name. Returns the number of affected rows. |
| `clearSecretsCache(table?)` | Force-expire the in-memory cache for a table (or all tables). |
| `setEnsureSecretsTable(wo)` | Create the `bot_secrets` table if it does not yet exist (idempotent). |

#### Redaction policy

Only `db.password` and fields whose key path ends in `.password` are redacted in pipeline log files. API key fields are no longer redacted because they contain only placeholder strings, not real key values.

#### wo.secretsTable

By default, secrets are read from the `bot_secrets` table. Set `wo.secretsTable` in `workingObject` (or via a channel override) to use a different table name.

---

### 9.5 fetch.js — HTTP Timeout Wrapper

**File:** `core/fetch.js`
**Purpose:** Centralized HTTP timeout wrapper used by all tools and AI modules.

```javascript
import { fetchWithTimeout } from "../core/fetch.js";

const res = await fetchWithTimeout(url, { method: "POST", body: "..." }, timeoutMs);
```

`fetchWithTimeout(url, options, timeoutMs)` wraps the native `fetch` call with an `AbortController` that fires after `timeoutMs` milliseconds. All tools and AI modules use this function instead of calling `fetch` directly to ensure consistent timeout behaviour across the codebase.

---

### 9.6 shared/webpage/ — Shared Web Helpers

All web modules (`modules/000xx-webpage-*.js`) should import shared helpers from `shared/webpage/` instead of duplicating them locally.

#### shared/webpage/interface.js

```javascript
import {
  getBody,          // Read full HTTP request body as UTF-8 string
  readJsonFile,     // Synchronously parse a JSON file → { ok, data } | { ok:false, error }
  writeJsonFile,    // Synchronously stringify + write a JSON file → { ok } | { ok:false, error }
  isAuthorized,     // Check Authorization header against a token (Bearer or Basic)
  getDb,            // Lazy-initialize + return a mysql2 connection pool
  getMenuHtml,      // Render the shared navigation menu HTML
  getThemeHeadScript, // Return <script> block for dark/light theme toggle
  escHtml           // HTML-escape a string (for safe template insertion)
} from "../shared/webpage/interface.js";
```

| Function | Signature | Notes |
|---|---|---|
| `getBody(req)` | `Promise<string>` | Reads all chunks; resolves as UTF-8 |
| `readJsonFile(filePath)` | `{ ok, data } \| { ok:false, error }` | Sync; catches parse errors |
| `writeJsonFile(filePath, data)` | `{ ok } \| { ok:false, error }` | Sync; pretty-prints with 2-space indent |
| `isAuthorized(req, token)` | `boolean` | Returns `true` when no token configured |
| `getDb(coreData)` | `Promise<Pool>` | Pool is created once and reused (singleton) |
| `getMenuHtml(menu, activePath, role, rightHtml?, extraDropdown?, userInfo?)` | `string` | Renders `<nav>` HTML; filters items by role |
| `getThemeHeadScript()` | `string` | Inline `<script>` that applies saved theme on load |
| `escHtml(s)` | `string` | Escapes `& < > " '` |

#### shared/webpage/utils.js

```javascript
import {
  setSendNow,          // Flush wo.http.response to the socket immediately
  setJsonResp,         // Set a JSON response on wo.http.response
  getUserRoleLabels,   // Extract all role labels from wo.webAuth (lower-cased, deduped)
  getIsAllowedRoles    // Return true if the user holds at least one required role
} from "../shared/webpage/utils.js";
```

| Function | Signature | Notes |
|---|---|---|
| `setSendNow(wo)` | `Promise<void>` | Guards `writableEnded`/`headersSent`; safe to call multiple times |
| `setJsonResp(wo, status, data)` | `void` | Sets `wo.http.response` with JSON body + Content-Type header |
| `getUserRoleLabels(wo)` | `string[]` | Returns `[primaryRole, ...roles]`, lower-cased, deduplicated |
| `getIsAllowedRoles(wo, allowedRoles)` | `boolean` | Empty `allowedRoles` → everyone allowed |

#### shared/webpage/style.css

Shared stylesheet included by all web module HTML pages via `<link rel="stylesheet">` or inline `<style>`. Provides base layout, dark/light theme variables, nav bar styling, and common UI components. Import path from a web module's served HTML: `/style.css` (the webpage flow serves static files from `shared/webpage/`).

#### Usage example (web module skeleton)

```javascript
import { getBody, getDb, getMenuHtml, getThemeHeadScript, escHtml } from "../shared/webpage/interface.js";
import { setSendNow, setJsonResp, getIsAllowedRoles } from "../shared/webpage/utils.js";

export default async function getMyWebModule(coreData) {
  const wo  = coreData.workingObject;
  const cfg = coreData?.config?.["my-web-module"] || {};

  // Only handle requests on the configured port and path
  if (wo.http?.port !== cfg.port) return coreData;
  if (wo.http?.path !== "/my-path") return coreData;

  // Role check
  if (!getIsAllowedRoles(wo, cfg.allowedRoles || [])) {
    wo.http.response = { status: 403, headers: { "Content-Type": "text/plain" }, body: "Forbidden" };
    await setSendNow(wo);
    wo.stop = true;
    return coreData;
  }

  // Handle API endpoint
  if (wo.http?.path === "/my-path/api/data" && wo.http?.method === "GET") {
    const db  = await getDb(coreData);
    const [rows] = await db.execute("SELECT * FROM my_table LIMIT 10");
    setJsonResp(wo, 200, { ok: true, rows });
    await setSendNow(wo);
    wo.stop = true;
    return coreData;
  }

  // Serve HTML page
  const menu = getMenuHtml(wo.web?.menu || [], "/my-path", wo.webAuth?.role);
  wo.http.response = {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: `<!DOCTYPE html><html><head>${getThemeHeadScript()}</head><body>${menu}<h1>My Module</h1></body></html>`
  };
  wo.jump = true;   // let 09300-webpage-output send the response
  return coreData;
}
```

---

## 10. GDPR & Consent Workflow

**Legal bases:** EU GDPR 2016/679, German BDSG

**Flow:**
1. On first contact in a channel the bot sends the user a **private DM** with the full GDPR notice (`gdprDisclaimer`).
2. The `disclaimer` flag is set to `1` (notice seen).
3. Processing is blocked until the user opts in via slash commands.

**Slash commands:**

| Command | Effect |
|---|---|
| `/gdpr text 1` | Enable text processing |
| `/gdpr text 0` | Disable text processing |
| `/gdpr voice 1` | Enable voice processing |
| `/gdpr voice 0` | Disable voice processing |

**MySQL table `gdpr`:**

| Column | Description |
|---|---|
| `user_id` | Discord user ID |
| `channel_id` | Discord channel ID |
| `chat` | 1 = text consent granted |
| `voice` | 1 = voice consent granted |
| `disclaimer` | 1 = notice has been seen |
| `updated_at` | Timestamp of last change |

---

## 11. Macro System

**Purpose:** User-defined text shortcuts

**Management (via `/macro` slash command):**

| Subcommand | Description |
|---|---|
| `/macro create <name> <text>` | Create or update a macro |
| `/macro delete <name>` | Delete a macro |
| `/macro list` | List all personal macros |
| `/macro run <name>` | Run a macro |

**Usage:** Type the macro name at the start of a message; the bot expands it before processing.

**Storage:** Per user in the registry with a configurable TTL.

---

## 12. Discord Slash Commands — Overview

| Command | Admin only | Description |
|---|---|---|
| `/macro create <name> <text>` | No | Create/update a macro |
| `/macro delete <name>` | No | Delete a macro |
| `/macro list` | No | List personal macros |
| `/macro run <name>` | No | Run a macro |
| `/avatar url <url>` | Yes | Set bot avatar from URL |
| `/avatar prompt <text>` | Yes | Generate bot avatar via DALL-E |
| `/avatar regen` | Yes | Regenerate avatar using current prompt |
| `/purge [count]` | Yes | Delete last N messages in channel |
| `/purgedb` | Yes | Delete conversation history from MySQL |
| `/freeze` | Yes | Mark last DB entries as frozen (protected) |
| `/rebuilddb` | Yes | Rebuild derived context tables for the current channel only |
| `/gdpr text <0\|1>` | No | Set GDPR consent for text |
| `/gdpr voice <0\|1>` | No | Set GDPR consent for voice |
| `/join` | No | Bot joins current voice channel |
| `/leave` | No | Bot leaves voice channel |
| `/bardstart` | No | Start the bard music scheduler for this server |
| `/bardstop` | No | Stop the bard music scheduler for this server |
| `/error` | No | Simulate an internal error (testing) |

---

## 13. Database Schema

### Table: context

| Column | Type | Description |
|---|---|---|
| `ctx_id` | BIGINT UNSIGNED AUTO_INCREMENT | Primary key (monotonic) |
| `ts` | TIMESTAMP | Insert timestamp |
| `id` | VARCHAR(128) | Channel ID |
| `json` | LONGTEXT | Full message JSON |
| `text` | TEXT | Plain-text content |
| `role` | VARCHAR(32) | `"user"` or `"assistant"` |
| `turn_id` | CHAR(26) | ULID of the conversation turn |
| `frozen` | TINYINT(1) | 1 = protected from deletion |
| `subchannel` | VARCHAR(128) NULL | Optional subchannel UUID; `NULL` = main channel |

### Timeline Summary Table

Chronological retrieval in the active runtime comes from:

- `context` for raw per-message context rows
- `timeline_periods` for compressed timeline summaries that span ranges of raw rows

The previously introduced `context_turns`, `context_segments`, `context_nodes`, `context_index_*`, `context_anchor_*`, `context_embeddings`, `context_events`, and `context_mesh_*` tables are legacy and are not required by the current runtime.

### Table: graph_tokens

Created automatically on first access to `/graph-auth` by module `00057-webpage-graph-auth.js`.

| Column | Type | Description |
|---|---|---|
| `user_id` | VARCHAR(64) PRIMARY KEY | Discord user ID (from `wo.webAuth.userId`) |
| `ms_user_id` | VARCHAR(128) | Microsoft user object ID from `/me` |
| `ms_email` | VARCHAR(256) | Microsoft account email (`mail` field from `/me`) |
| `ms_display_name` | VARCHAR(256) | Microsoft display name from `/me` |
| `access_token` | MEDIUMTEXT NOT NULL | Current OAuth2 access token |
| `refresh_token` | MEDIUMTEXT | OAuth2 refresh token (present when `offline_access` scope was granted) |
| `expires_at` | BIGINT NOT NULL | Token expiry as Unix epoch milliseconds |
| `scope` | TEXT | Scopes granted during this token |
| `created_at` | BIGINT NOT NULL | Row creation time (Unix epoch ms) |
| `updated_at` | BIGINT NOT NULL | Last update time (Unix epoch ms) |

```sql
CREATE TABLE IF NOT EXISTS graph_tokens (
  user_id          VARCHAR(64)   NOT NULL,
  ms_user_id       VARCHAR(128),
  ms_email         VARCHAR(256),
  ms_display_name  VARCHAR(256),
  access_token     MEDIUMTEXT    NOT NULL,
  refresh_token    MEDIUMTEXT,
  expires_at       BIGINT        NOT NULL,
  scope            TEXT,
  created_at       BIGINT        NOT NULL,
  updated_at       BIGINT        NOT NULL,
  PRIMARY KEY (user_id)
) CHARACTER SET utf8mb4;
```

### Table: graph_auth_states

Created automatically on first access to `/graph-auth` alongside `graph_tokens`. Stores CSRF state tokens for the OAuth2 Authorization Code flow.

| Column | Type | Description |
|---|---|---|
| `state_token` | VARCHAR(64) PRIMARY KEY | Random hex state token (48 chars) |
| `user_id` | VARCHAR(64) NOT NULL | Discord user ID that initiated the flow |
| `created_at` | BIGINT NOT NULL | Creation time (Unix epoch ms) |
| `expires_at` | BIGINT NOT NULL | Expiry time (Unix epoch ms; TTL = 10 minutes) |

```sql
CREATE TABLE IF NOT EXISTS graph_auth_states (
  state_token  VARCHAR(64)  NOT NULL,
  user_id      VARCHAR(64)  NOT NULL,
  created_at   BIGINT       NOT NULL,
  expires_at   BIGINT       NOT NULL,
  PRIMARY KEY (state_token)
) CHARACTER SET utf8mb4;
```

Rows are deleted on use (callback validates + deletes) and expired rows are cleaned up on each `/start` and callback request.

### Table: wiki_articles

Created automatically by `modules/00052-webpage-wiki.js` on first wiki page load. Stores AI-generated wiki articles per channel, with full-text search support.

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY | Internal row ID |
| `channel_id` | VARCHAR(128) NOT NULL | Discord channel ID — each channel has its own wiki |
| `slug` | VARCHAR(128) NOT NULL | URL-safe article identifier (unique per channel) |
| `title` | VARCHAR(512) NOT NULL | Article title |
| `intro` | TEXT | Introductory paragraph |
| `sections` | LONGTEXT | JSON array of article sections |
| `infobox` | TEXT | JSON infobox data |
| `categories` | TEXT | Comma-separated category list |
| `related` | TEXT | Related article references |
| `image_url` | VARCHAR(512) | URL of the article image |
| `image_prompt` | TEXT | Prompt used to generate the image |
| `created_at` | TIMESTAMP | Row creation timestamp |
| `updated_at` | TIMESTAMP NULL | Last manual edit timestamp; NULL = never manually edited (subject to TTL) |

```sql
CREATE TABLE IF NOT EXISTS wiki_articles (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  channel_id   VARCHAR(128)  NOT NULL,
  slug         VARCHAR(128)  NOT NULL,
  title        VARCHAR(512)  NOT NULL,
  intro        TEXT,
  sections     LONGTEXT,
  infobox      TEXT,
  categories   TEXT,
  related      TEXT,
  image_url    VARCHAR(512),
  image_prompt TEXT,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY ux_chan_slug (channel_id, slug),
  FULLTEXT KEY ft_search (title, intro, categories, related)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Table: gdpr

Created automatically by `modules/00025-discord-admin-gdpr.js`. Stores per-user GDPR consent flags for chat, voice recording, and disclaimer acknowledgment.

| Column | Type | Description |
|---|---|---|
| `user_id` | VARCHAR(64) NOT NULL | Discord user ID |
| `channel_id` | VARCHAR(64) NOT NULL | Discord channel ID |
| `chat` | TINYINT(1) NOT NULL DEFAULT 0 | User consents to chat data storage |
| `voice` | TINYINT(1) NOT NULL DEFAULT 0 | User consents to voice recording |
| `disclaimer` | TINYINT(1) NOT NULL DEFAULT 0 | User acknowledged the disclaimer |
| `updated_at` | TIMESTAMP | Last update time (auto-updated) |

Primary key is `(user_id, channel_id)`.

```sql
CREATE TABLE IF NOT EXISTS gdpr (
  user_id    VARCHAR(64) NOT NULL,
  channel_id VARCHAR(64) NOT NULL,
  chat       TINYINT(1)  NOT NULL DEFAULT 0,
  voice      TINYINT(1)  NOT NULL DEFAULT 0,
  disclaimer TINYINT(1)  NOT NULL DEFAULT 0,
  updated_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, channel_id),
  KEY idx_channel (channel_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Table: timeline_periods

Created automatically by `core/context.js`. Stores compressed timeline summaries derived from raw context rows for one channel at a time.

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY | Internal row ID |
| `channel_id` | VARCHAR(128) NOT NULL | Source channel ID for the summarized period |
| `start_idx` | BIGINT UNSIGNED NOT NULL | First raw `context.ctx_id` included in this summary block |
| `end_idx` | BIGINT UNSIGNED NOT NULL | Last raw `context.ctx_id` included in this summary block |
| `start_ts` | TIMESTAMP NULL | Timestamp of the first raw row covered by the block |
| `end_ts` | TIMESTAMP NULL | Timestamp of the last raw row covered by the block |
| `summary` | LONGTEXT NOT NULL | Structured summary text containing overview, topics, key events, locations, people, and timeframe anchors |
| `model` | VARCHAR(128) NULL | Model name used to generate the summary |
| `checksum` | CHAR(64) NOT NULL | Hash of the raw input range used to detect drift |
| `created_at` | TIMESTAMP | Row creation timestamp |
| `updated_at` | TIMESTAMP | Last regeneration timestamp |
| `frozen` | TINYINT(1) NOT NULL DEFAULT 0 | Whether this timeline row is protected from purge |

```sql
CREATE TABLE IF NOT EXISTS timeline_periods (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  channel_id VARCHAR(128)    NOT NULL,
  start_idx  BIGINT UNSIGNED NOT NULL,
  end_idx    BIGINT UNSIGNED NOT NULL,
  start_ts   TIMESTAMP       NULL,
  end_ts     TIMESTAMP       NULL,
  summary    LONGTEXT        NOT NULL,
  model      VARCHAR(128)    NULL,
  checksum   CHAR(64)        NOT NULL,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  frozen     TINYINT(1)      NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_timeline_channel_id (channel_id, id),
  KEY idx_timeline_channel_range (channel_id, start_idx, end_idx)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Table: chat_subchannels

Created automatically by `modules/00048-webpage-chat.js`. Stores named subchannels within a Discord channel for the web chat UI.

| Column | Type | Description |
|---|---|---|
| `subchannel_id` | CHAR(36) NOT NULL PRIMARY KEY | UUID v4 identifier |
| `channel_id` | VARCHAR(128) NOT NULL | Parent Discord channel ID |
| `name` | VARCHAR(255) NOT NULL DEFAULT '' | Display name of the subchannel |
| `created_at` | DATETIME NOT NULL | Creation timestamp |

```sql
CREATE TABLE IF NOT EXISTS chat_subchannels (
  subchannel_id CHAR(36)     NOT NULL,
  channel_id    VARCHAR(128) NOT NULL,
  name          VARCHAR(255) NOT NULL DEFAULT '',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (subchannel_id),
  KEY idx_csc_channel (channel_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Table: discord_macros

Created automatically by `modules/00065-discord-admin-macro.js`. Stores user-defined text shortcuts (macros) usable in Discord.

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY | Internal row ID |
| `user_id` | VARCHAR(64) NOT NULL | Discord user ID that owns the macro |
| `guild_id` | VARCHAR(64) NULL | Guild scope (NULL = all guilds) |
| `channel_id` | VARCHAR(64) NULL | Channel scope (NULL = all channels) |
| `name` | VARCHAR(100) NOT NULL | Macro name (unique per user) |
| `text` | TEXT NOT NULL | Macro body text |
| `created_at` | TIMESTAMP NOT NULL | Creation timestamp |
| `updated_at` | TIMESTAMP NOT NULL | Last update timestamp (auto-updated) |

```sql
CREATE TABLE IF NOT EXISTS discord_macros (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    VARCHAR(64)     NOT NULL,
  guild_id   VARCHAR(64)     NULL,
  channel_id VARCHAR(64)     NULL,
  name       VARCHAR(100)    NOT NULL,
  text       TEXT            NOT NULL,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_user_name (user_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Table: voice_speakers

Created automatically by `shared/voice/voice-diarize.js`. Stores speaker profiles used for voice diarization (speaker identification).

| Column | Type | Description |
|---|---|---|
| `id` | INT AUTO_INCREMENT PRIMARY KEY | Internal speaker ID |
| `channel_id` | VARCHAR(64) NOT NULL | Discord channel this speaker belongs to |
| `name` | VARCHAR(128) NOT NULL | Speaker display name |
| `sample_audio_path` | VARCHAR(512) | Path to reference audio sample |
| `sample_text` | TEXT | Reference transcript for this speaker |
| `created_at` | DATETIME | Creation timestamp |

```sql
CREATE TABLE IF NOT EXISTS voice_speakers (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  channel_id        VARCHAR(64)  NOT NULL,
  name              VARCHAR(128) NOT NULL,
  sample_audio_path VARCHAR(512),
  sample_text       TEXT,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_vs_channel (channel_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Table: voice_sessions

Created automatically by `shared/voice/voice-diarize.js`. Each voice recording session in a channel gets one row.

| Column | Type | Description |
|---|---|---|
| `id` | INT AUTO_INCREMENT PRIMARY KEY | Session ID |
| `channel_id` | VARCHAR(64) NOT NULL | Discord channel ID |
| `started_at` | DATETIME | Session start timestamp |

```sql
CREATE TABLE IF NOT EXISTS voice_sessions (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  channel_id VARCHAR(64) NOT NULL,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_vss_channel (channel_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Table: voice_chunks

Created automatically by `shared/voice/voice-diarize.js`. Stores audio segments within a voice session with their transcripts.

| Column | Type | Description |
|---|---|---|
| `id` | INT AUTO_INCREMENT PRIMARY KEY | Chunk ID |
| `session_id` | INT NOT NULL | References `voice_sessions.id` |
| `chunk_index` | INT NOT NULL DEFAULT 0 | Ordering index within the session |
| `transcript` | TEXT | Transcribed text for this chunk |
| `created_at` | DATETIME | Chunk creation timestamp |

```sql
CREATE TABLE IF NOT EXISTS voice_chunks (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  session_id  INT NOT NULL,
  chunk_index INT NOT NULL DEFAULT 0,
  transcript  TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_vc_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Table: voice_chunk_speakers

Created automatically by `shared/voice/voice-diarize.js`. Maps diarization labels within a chunk to identified speakers.

| Column | Type | Description |
|---|---|---|
| `id` | INT AUTO_INCREMENT PRIMARY KEY | Row ID |
| `chunk_id` | INT NOT NULL | References `voice_chunks.id` |
| `chunk_label` | VARCHAR(32) NOT NULL | Diarization speaker label (e.g. `SPEAKER_00`) |
| `speaker_id` | INT | References `voice_speakers.id`; NULL if unidentified |

```sql
CREATE TABLE IF NOT EXISTS voice_chunk_speakers (
  id          INT         AUTO_INCREMENT PRIMARY KEY,
  chunk_id    INT         NOT NULL,
  chunk_label VARCHAR(32) NOT NULL,
  speaker_id  INT,
  UNIQUE KEY uniq_vcs_chunk_label (chunk_id, chunk_label),
  INDEX idx_vcs_chunk (chunk_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Table: bot_secrets

Created automatically on first use by the Key Manager (`/key-manager`) and on bot startup (`core/secrets.js`). Stores all API key aliases used by the bot.

| Column | Type | Description |
|---|---|---|
| `name` | VARCHAR(64) NOT NULL PRIMARY KEY | Symbolic placeholder name (e.g. `OPENAI`, `DISCORD`) |
| `value` | TEXT NOT NULL | The real secret value |
| `description` | VARCHAR(255) NULL | Optional human-readable label |

```sql
CREATE TABLE IF NOT EXISTS bot_secrets (
  name        VARCHAR(64)  NOT NULL,
  value       TEXT         NOT NULL,
  description VARCHAR(255) NULL,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Table: spotify_tokens

Created automatically on first access to `/spotify-auth` by module `00061-webpage-spotify-auth.js`. Stores per-user delegated OAuth2 tokens for Spotify.

| Column | Type | Description |
|---|---|---|
| `user_id` | VARCHAR(64) PRIMARY KEY | Discord user ID |
| `sp_user_id` | VARCHAR(128) | Spotify user object ID |
| `sp_email` | VARCHAR(256) | Spotify account email |
| `sp_display_name` | VARCHAR(256) | Spotify display name |
| `access_token` | MEDIUMTEXT NOT NULL | Current OAuth2 access token |
| `refresh_token` | MEDIUMTEXT | OAuth2 refresh token |
| `expires_at` | BIGINT NOT NULL | Token expiry as Unix epoch milliseconds |
| `scope` | TEXT | Granted OAuth2 scopes |
| `created_at` | BIGINT NOT NULL | Row creation time (Unix epoch ms) |
| `updated_at` | BIGINT NOT NULL | Last update time (Unix epoch ms) |

```sql
CREATE TABLE IF NOT EXISTS spotify_tokens (
  user_id         VARCHAR(64)   NOT NULL,
  sp_user_id      VARCHAR(128),
  sp_email        VARCHAR(256),
  sp_display_name VARCHAR(256),
  access_token    MEDIUMTEXT    NOT NULL,
  refresh_token   MEDIUMTEXT,
  expires_at      BIGINT        NOT NULL,
  scope           TEXT,
  created_at      BIGINT        NOT NULL,
  updated_at      BIGINT        NOT NULL,
  PRIMARY KEY (user_id)
) CHARACTER SET utf8mb4;
```

### Table: spotify_auth_states

Created automatically alongside `spotify_tokens`. Stores CSRF state tokens for the Spotify OAuth2 Authorization Code flow.

| Column | Type | Description |
|---|---|---|
| `state_token` | VARCHAR(64) PRIMARY KEY | Random hex state token (TTL = 10 minutes) |
| `user_id` | VARCHAR(64) NOT NULL | Discord user ID that initiated the flow |
| `created_at` | BIGINT NOT NULL | Creation time (Unix epoch ms) |
| `expires_at` | BIGINT NOT NULL | Expiry time (Unix epoch ms) |

```sql
CREATE TABLE IF NOT EXISTS spotify_auth_states (
  state_token  VARCHAR(64)  NOT NULL,
  user_id      VARCHAR(64)  NOT NULL,
  created_at   BIGINT       NOT NULL,
  expires_at   BIGINT       NOT NULL,
  PRIMARY KEY (state_token)
) CHARACTER SET utf8mb4;
```

Rows are deleted on use (callback validates + deletes). Expired rows are cleaned up on each auth request.

### Table: oauth_registrations

Created automatically on first access to `/oauth` by module `00063-webpage-oauth-manager.js`. Stores OAuth2 provider configurations used by the `getApi` tool.

| Column | Type | Description |
|---|---|---|
| `name` | VARCHAR(64) PRIMARY KEY | Unique provider identifier, e.g. `"github"`, `"jira-cloud"` |
| `flow` | VARCHAR(32) NOT NULL | `"client_credentials"` or `"auth_code"` |
| `token_url` | TEXT NOT NULL | Token endpoint URL |
| `auth_url` | TEXT NULL | Authorization endpoint URL (only for `auth_code` flow) |
| `client_id` | TEXT NOT NULL | OAuth2 client ID |
| `client_secret` | TEXT NOT NULL | OAuth2 client secret |
| `scope` | TEXT NULL | Space-separated OAuth2 scopes |
| `description` | VARCHAR(255) NULL | Human-readable description |
| `created_at` | BIGINT NOT NULL | Creation time (Unix epoch ms) |
| `updated_at` | BIGINT NOT NULL | Last update time (Unix epoch ms) |

```sql
CREATE TABLE IF NOT EXISTS oauth_registrations (
  name          VARCHAR(64)  NOT NULL,
  flow          VARCHAR(32)  NOT NULL,
  token_url     TEXT         NOT NULL,
  auth_url      TEXT         NULL,
  client_id     TEXT         NOT NULL,
  client_secret TEXT         NOT NULL,
  scope         TEXT         NULL,
  description   VARCHAR(255) NULL,
  created_at    BIGINT       NOT NULL,
  updated_at    BIGINT       NOT NULL,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Table: oauth_tokens

Created automatically alongside `oauth_registrations`. Stores cached OAuth2 access tokens per provider and user.

| Column | Type | Description |
|---|---|---|
| `provider` | VARCHAR(64) NOT NULL | Provider name (matches `oauth_registrations.name`) |
| `user_id` | VARCHAR(64) NOT NULL | Discord user ID, or `"__service__"` for client_credentials tokens |
| `access_token` | MEDIUMTEXT NOT NULL | Current OAuth2 access token |
| `refresh_token` | MEDIUMTEXT NULL | OAuth2 refresh token (if issued) |
| `expires_at` | BIGINT NOT NULL | Token expiry as Unix epoch milliseconds |
| `scope` | TEXT NULL | Scopes granted for this token |
| `updated_at` | BIGINT NOT NULL | Last update time (Unix epoch ms) |

Primary key: `(provider, user_id)`.

```sql
CREATE TABLE IF NOT EXISTS oauth_tokens (
  provider      VARCHAR(64)  NOT NULL,
  user_id       VARCHAR(64)  NOT NULL,
  access_token  MEDIUMTEXT   NOT NULL,
  refresh_token MEDIUMTEXT   NULL,
  expires_at    BIGINT       NOT NULL,
  scope         TEXT         NULL,
  updated_at    BIGINT       NOT NULL,
  PRIMARY KEY (provider, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Table: oauth_auth_states

Created automatically alongside `oauth_registrations`. Stores CSRF state tokens for OAuth2 Authorization Code flows.

| Column | Type | Description |
|---|---|---|
| `state_token` | VARCHAR(64) PRIMARY KEY | Random CSRF state token (TTL = 10 minutes) |
| `provider` | VARCHAR(64) NOT NULL | Provider name that initiated the flow |
| `user_id` | VARCHAR(64) NOT NULL | Discord user ID that initiated the flow |
| `created_at` | BIGINT NOT NULL | Creation time (Unix epoch ms) |
| `expires_at` | BIGINT NOT NULL | Expiry time (Unix epoch ms) |

```sql
CREATE TABLE IF NOT EXISTS oauth_auth_states (
  state_token   VARCHAR(64)  NOT NULL,
  provider      VARCHAR(64)  NOT NULL,
  user_id       VARCHAR(64)  NOT NULL,
  created_at    BIGINT       NOT NULL,
  expires_at    BIGINT       NOT NULL,
  PRIMARY KEY (state_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Table: tool_exposure

Created automatically by `shared/tools/tool-exposure.js` on first request to `/oauth-exposure` or `/bearer-exposure`. Controls which OAuth providers and API key names are visible to the AI via `getOauthProviders` and `getApiBearers`.

| Column | Type | Description |
|---|---|---|
| `tool_name` | VARCHAR(64) NOT NULL | Tool that reads this entry: `"getOauthProviders"` or `"getApiBearers"` |
| `item_name` | VARCHAR(64) NOT NULL | Provider name or secret key name being exposed |

```sql
CREATE TABLE IF NOT EXISTS tool_exposure (
  tool_name  VARCHAR(64) NOT NULL,
  item_name  VARCHAR(64) NOT NULL,
  PRIMARY KEY (tool_name, item_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 14. Reverse Proxy (Caddy)

Jenny runs multiple HTTP servers on different ports. A reverse proxy (Caddy) consolidates them under a single domain with automatic HTTPS.

**File locations:**
- Linux production: `/etc/caddy/Caddyfile`
- Windows dev: `W:\etc\caddy\Caddyfile`

**Reload after changes:**
```bash
systemctl reload caddy          # Linux (graceful reload, no downtime)
caddy reload --config /etc/caddy/Caddyfile   # explicit path variant
```

Validate before reloading:
```bash
caddy validate --config /etc/caddy/Caddyfile
```

### IP Allowlist Snippet (`strictonly`)

For admin-only services that should only be reachable from internal IPs:

```caddy
(strictonly) {
    @allowed remote_ip 10.99.0.0/24 10.99.1.0/24 192.168.178.0/24 127.0.0.1/8
    handle @allowed {
        # set reverse_proxy here per host
    }
    handle {
        respond "Forbidden" 403
    }
}
```

Usage in a host block:
```caddy
admin.example.com {
    import strictonly
    reverse_proxy 127.0.0.1:10000
}
```

### Virtual host: jenny.ralfreschke.de / jenny.xbullseyegaming.de

Both domains share a single Caddyfile block. Caddy obtains a TLS certificate for each domain automatically via Let's Encrypt.

**Path routing table:**

| Path | Port | Module |
|---|---|---|
| `/auth`, `/auth/*` | 3111 | `webpage-auth` |
| `/config`, `/config/*` | 3111 | `webpage-config-editor` |
| `/chat`, `/chat/*` | 3112 | `webpage-chat` |
| `/inpainting`, `/inpainting/*` | 3113 | `webpage-inpainting` |
| `/bard`, `/bard/*` | 3114 | `webpage-bard` |
| `/dashboard`, `/dashboard/*` | 3115 | `webpage-dashboard` |
| `/docs`, `/docs/*` | 3116 | `webpage-documentation` |
| `/wiki`, `/wiki/*` | 3117 | `webpage-wiki` |
| `/context`, `/context/*` | 3118 | `webpage-context` |
| `/voice`, `/voice/*` | 3119 | `webpage-voice` |
| `/gallery`, `/gallery/*` | 3120 | `webpage-gallery` |
| `/gdpr`, `/gdpr/*` | 3121 | `webpage-gdpr` |
| `/key-manager`, `/key-manager/*` | 3122 | `webpage-keymanager` |
| `/live`, `/live/*` | 3123 | `webpage-live` |
| `/graph-auth`, `/graph-auth/*` | 3124 | `webpage-graph-auth` |
| `/spotify-auth`, `/spotify-auth/*` | 3125 | `webpage-spotify-auth` |
| `/manifests`, `/manifests/*` | 3126 | `webpage-manifests` |
| `/subagents`, `/subagents/*` | 3127 | `webpage-subagents` |
| `/timeline`, `/timeline/*` | 3128 | `webpage-timeline` |
| `/channels`, `/channels/*` | 3129 | `webpage-channel-config-manager` |
| `/oauth`, `/oauth/*` | 3130 | `webpage-oauth-manager` |
| `/connections`, `/connections/*` | 3131 | `webpage-oauth-connections` |
| `/oauth-exposure`, `/oauth-exposure/*` | 3132 | `webpage-oauth-exposure` |
| `/bearer-exposure`, `/bearer-exposure/*` | 3133 | `webpage-bearer-exposure` |
| `/setup`, `/setup/*` | 3400 | Main API (setup wizard) |
| `/api`, `/api/*` | 3400 | Main API |
| `/upload`, `/upload/*` | 3400 | Main API |
| `/toolcall`, `/toolcall/*` | 3400 | Main API |
| `/health`, `/health/*` | 3400 | Main API |
| `/documents/*` | 3000 | Static file server |
| `/` (root) | — | redirects to `/chat` (302) |

**Access control for unknown paths:**

- Requests from known VPN/LAN IP ranges (`10.99.0.0/24`, `10.99.1.0/24`, `192.168.178.0/24`, `127.0.0.1/8`) receive a `404 Not Found` response for any path not matched above.
- All other requests (public internet) receive an HTTP Basic Auth challenge (`401`) for any unmatched path. Only after successful Basic Auth do they receive `404 Not Found`.

**Caddyfile structure (jenny.* block):**

```
jenny.ralfreschke.de, jenny.xbullseyegaming.de {
    header -Alt-Svc

    @allowed remote_ip 10.99.0.0/24 10.99.1.0/24 192.168.178.0/24 127.0.0.1/8

    # ── Path matchers ────────────────────────────────────────────────
    @auth            { path /auth /auth/* }
    @config          { path /config /config/* }
    @chat            { path /chat /chat/* }
    @inpainting      { path /inpainting /inpainting/* }
    @bard            { path /bard /bard/* }
    @dashboard       { path /dashboard /dashboard/* }
    @docs            { path /docs /docs/* }
    @wiki            { path /wiki /wiki/* }
    @context         { path /context /context/* }
    @voice           { path /voice /voice/* }
    @gallery         { path /gallery /gallery/* }
    @gdpr            { path /gdpr /gdpr/* }
    @key-manager     { path /key-manager /key-manager/* }
    @live            { path /live /live/* }
    @graph-auth      { path /graph-auth /graph-auth/* }
    @spotify-auth    { path /spotify-auth /spotify-auth/* }
    @manifests       { path /manifests /manifests/* }
    @subagents       { path /subagents /subagents/* }
    @timeline        { path /timeline /timeline/* }
    @channels        { path /channels /channels/* }
    @oauth           { path /oauth /oauth/* }
    @connections     { path /connections /connections/* }
    @oauth-exposure  { path /oauth-exposure /oauth-exposure/* }
    @bearer-exposure { path /bearer-exposure /bearer-exposure/* }
    @setup           { path /setup /setup/* }
    @api             { path /api /api/* }
    @upload          { path /upload /upload/* }
    @toolcall        { path /toolcall /toolcall/* }
    @health          { path /health /health/* }

    # ── Route handlers ───────────────────────────────────────────────
    handle @auth            { reverse_proxy 127.0.0.1:3111 }
    handle @config          { reverse_proxy 127.0.0.1:3111 }
    handle @chat            { reverse_proxy 127.0.0.1:3112 }
    handle @inpainting      { reverse_proxy 127.0.0.1:3113 }
    handle @bard            { reverse_proxy 127.0.0.1:3114 }
    handle @dashboard       { reverse_proxy 127.0.0.1:3115 }
    handle @docs            { reverse_proxy 127.0.0.1:3116 }
    handle @wiki            { reverse_proxy 127.0.0.1:3117 }
    handle @context         { reverse_proxy 127.0.0.1:3118 }
    handle @voice           { reverse_proxy 127.0.0.1:3119 }
    handle @gallery         { reverse_proxy 127.0.0.1:3120 }
    handle @gdpr            { reverse_proxy 127.0.0.1:3121 }
    handle @key-manager     { reverse_proxy 127.0.0.1:3122 }
    handle @live            { reverse_proxy 127.0.0.1:3123 }
    handle @graph-auth      { reverse_proxy 127.0.0.1:3124 }
    handle @spotify-auth    { reverse_proxy 127.0.0.1:3125 }
    handle @manifests       { reverse_proxy 127.0.0.1:3126 }
    handle @subagents       { reverse_proxy 127.0.0.1:3127 }
    handle @timeline        { reverse_proxy 127.0.0.1:3128 }
    handle @channels        { reverse_proxy 127.0.0.1:3129 }
    handle @oauth           { reverse_proxy 127.0.0.1:3130 }
    handle @connections     { reverse_proxy 127.0.0.1:3131 }
    handle @oauth-exposure  { reverse_proxy 127.0.0.1:3132 }
    handle @bearer-exposure { reverse_proxy 127.0.0.1:3133 }
    handle @setup           { reverse_proxy 127.0.0.1:3400 }
    handle @api             { reverse_proxy 127.0.0.1:3400 }
    handle @upload          { reverse_proxy 127.0.0.1:3400 }
    handle @toolcall        { reverse_proxy 127.0.0.1:3400 }
    handle @health          { reverse_proxy 127.0.0.1:3400 }

    handle /documents/*     { reverse_proxy 127.0.0.1:3000 }

    redir / /chat 302

    handle @allowed {
        respond "Not Found" 404
    }

    handle {
        basicauth { ralf <bcrypt-hash> }
        respond "Not Found" 404
    }
}
```

> **Local development:** Add `tls internal` inside the block to use a self-signed certificate.
> **Production:** Caddy handles HTTPS automatically via Let's Encrypt — no extra configuration needed.

**Multi-domain OAuth callback (`redirectUri`):**

When `config["webpage-auth"].redirectUri` is set to an empty string `""`, the auth module derives the callback URL automatically from the HTTP `Host` header of each incoming request. This lets a single bot instance handle OAuth logins from multiple domains without any code changes.

You must register **every callback URL** in the Discord Developer Portal (App → OAuth2 → Redirects) before users can log in from that domain:

```
https://jenny.ralfreschke.de/auth/callback
https://jenny.xbullseyegaming.de/auth/callback
```

If `redirectUri` is set to a specific URL, only that domain is used for all OAuth callbacks regardless of the request host.

**Full port mapping:**

| Port | Path | Module / Service |
|---|---|---|
| 3000 | `/documents/*` | Static file server |
| 3111 | `/auth`, `/config` | `webpage-auth` + `webpage-config-editor` |
| 3112 | `/chat` | Chat SPA (`webpage-chat`) |
| 3113 | `/inpainting` | Inpainting SPA (`webpage-inpainting`) |
| 3114 | `/bard` | Bard UI (`webpage-bard`) |
| 3115 | `/dashboard` | Live Dashboard (`webpage-dashboard`) |
| 3116 | `/docs` | Documentation viewer (`webpage-documentation`) |
| 3117 | `/wiki` | AI Wiki (`webpage-wiki`) |
| 3118 | `/context` | Context Editor (`webpage-context`) |
| 3119 | `/voice` | Voice Interface (`webpage-voice`) |
| 3120 | `/gallery` | Gallery (`webpage-gallery`) |
| 3121 | `/gdpr` | GDPR Data Export (`webpage-gdpr`) |
| 3122 | `/key-manager` | Key Manager (`webpage-keymanager`) |
| 3123 | `/live` | Live Context Monitor (`webpage-live`) |
| 3124 | `/graph-auth` | Microsoft Graph Auth (`webpage-graph-auth`) |
| 3125 | `/spotify-auth` | Spotify Auth (`webpage-spotify-auth`) |
| 3126 | `/manifests` | Manifest viewer (`webpage-manifests`) |
| 3127 | `/subagents` | Subagent manager (`webpage-subagents`) |
| 3128 | `/timeline` | Timeline (`webpage-timeline`) |
| 3129 | `/channels` | Channel Config Manager (`webpage-channel-config-manager`) |
| 3130 | `/oauth` | OAuth Manager — client_credentials + auth_code admin (`webpage-oauth-manager`) |
| 3131 | `/connections` | User OAuth connections (`webpage-oauth-connections`) |
| 3132 | `/oauth-exposure` | OAuth Provider Exposure control (`webpage-oauth-exposure`) |
| 3133 | `/bearer-exposure` | API Key Exposure control (`webpage-bearer-exposure`) |
| 3400 | `/api`, `/upload`, `/toolcall`, `/health`, `/setup` | Main API server |

---

## 15. Discord Bot Permissions

### Gateway Intents

Configure intents in `core.json` under `workingObject.discord.intents[]`. The following intents are required:

| Intent | Privileged | Purpose |
|---|---|---|
| `Guilds` | No | Read guild/channel metadata |
| `GuildMessages` | No | Receive messages in guild channels |
| `MessageContent` | **Yes** | Read the text content of messages |
| `GuildVoiceStates` | No | Track user voice channel join/leave |
| `GuildMembers` | **Yes** | Resolve member roles for auth checks |
| `DirectMessages` | No | Receive DMs sent to the bot |

Privileged intents (`MessageContent`, `GuildMembers`) must be **manually enabled** in the Discord Developer Portal:

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Select your application → **Bot**
3. Under **Privileged Gateway Intents**, enable:
   - **Server Members Intent**
   - **Message Content Intent**
4. Save changes

### Bot Permissions

The following permissions are required in each guild the bot operates in:

| Permission | Bit | Purpose |
|---|---|---|
| View Channels | `1024` | Read channel messages |
| Send Messages | `2048` | Post replies |
| Send Messages in Threads | `274877906944` | Respond in threads |
| Read Message History | `65536` | Access past messages for context |
| Embed Links | `16384` | Send rich embeds |
| Attach Files | `32768` | Send generated images |
| Use Application Commands | `2147483648` | Enable slash commands |
| Connect | `1048576` | Join voice channels |
| Speak | `2097152` | Transmit audio in voice |
| Use Voice Activity | `33554432` | Voice activity detection |
| Manage Messages | `8192` | Delete or pin messages (moderation) |
| Kick Members | `2` | Kick members (moderation, optional) |
| Ban Members | `4` | Ban members (moderation, optional) |

### Invite URL

Replace `CLIENT_ID` with your bot's Application ID:

```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=8&scope=bot+applications.commands
```

`permissions=8` grants Administrator — the simplest setup for a private server. For a minimal invite, calculate the permission integer from the table above using the [Discord Permissions Calculator](https://discordapi.com/permissions.html).

### OAuth2 Scopes

| Scope | Required for |
|---|---|
| `bot` | Bot user presence in guild |
| `applications.commands` | Slash command registration |

---

## 16. Web Modules

### 16.1 Overview

| Module File | Port | URL Prefix | Config Key | Purpose |
|---|---|---|---|---|
| `00044-webpage-config-editor.js` | 3111 | `/config` | `webpage-config-editor` | Visual config editor — collapsible cards, tag chips, password fields, add/remove attributes and blocks |
| `00048-webpage-chat.js` | 3112 | `/chat` | `webpage-chat` | Chat history viewer and message sender |
| `00049-webpage-inpainting.js` | 3113 | `/inpainting` | `webpage-inpainting` | Image inpainting single-page app |
| `00043-webpage-bard.js` | 3114 | `/bard` | `webpage-bard` | Bard music library manager |
| `00051-webpage-dashboard.js` | 3115 | `/dashboard` | `webpage-dashboard` | Live bot telemetry dashboard |
| `00054-webpage-documentation.js` | 3116 | `/docs` | `webpage-documentation` | Renders the project documentation as HTML pages — collapsible file-navigation sidebar |
| `00052-webpage-wiki.js` | 3117 | `/wiki` | `webpage-wiki` | AI-driven Fandom-style wiki, per-channel, with DALL-E images |
| `00047-webpage-voice.js` | 3119 | `/voice` | `webpage-voice` | Browser push-to-talk voice interface |
| `00053-webpage-context.js` | 3118 | `/context` | `webpage-context` | Context DB editor — browse, search, search & replace, bulk-delete conversation rows |
| `00056-webpage-gallery.js` | 3120 | `/gallery` | `webpage-gallery` | Image gallery — browse, upload and delete the logged-in user's generated images |
| `00057-webpage-graph-auth.js` | 3124 | `/graph-auth` | `webpage-graph-auth` | Microsoft Graph OAuth2 delegated auth — connect/disconnect Microsoft account, stores token in `graph_tokens` |
| `00058-cron-graph-token-refresh.js` | — | — | `cron-graph-token-refresh` | Cron — refreshes expiring Microsoft Graph tokens in `graph_tokens` |
| `00059-webpage-live.js` | 3123 | `/live` | `webpage-live` | Live context monitor — real-time transcript stream, channel/field selection, autoscroll, collapsible settings sidebar |
| `00061-webpage-spotify-auth.js` | 3125 | `/spotify-auth` | `webpage-spotify-auth` | Spotify OAuth2 delegated auth — connect/disconnect Spotify account, stores token in `spotify_tokens` |
| `00062-cron-spotify-token-refresh.js` | — | — | `cron-spotify-token-refresh` | Cron — refreshes expiring Spotify tokens in `spotify_tokens` using Basic auth |
| `00066-webpage-manifests.js` | 3126 | `/manifests` | `webpage-manifests` | Admin-only manifest JSON editor — list, view, and save tool manifest files |

### How Web Modules Work

- All subscribe to flow: `webpage`
- `flows/webpage.js` starts one HTTP server per port listed in `config.webpage.ports[]`
- Each incoming request triggers the full module pipeline
- Modules check `wo.http.port` and skip if port does not match
- Shared utilities: `shared/webpage/interface.js` exports: `getMenuHtml`, `isAuthorized`, `getDb`, `readJsonFile`, `writeJsonFile`
- Shared CSS: `shared/webpage/style.css` — each module serves it at `/<basePath>/style.css`

### HTTP Routes per Module

### 16.2 Config Editor (`/config`)

**Config Editor (port 3111, /config):**
- `GET /config` — renders the visual config editor UI (role-gated via `allowedRoles`)
- `GET /config/style.css` — serves shared CSS
- `GET /config/api/config` — returns current `core.json` as JSON
- `POST /config/api/config` — accepts and atomically writes updated `core.json`

The editor renders each object as a collapsible card. Object titles are derived from: `_title` field (if present) → well-known field names (`name`, `label`, `id`, …) → raw property key. Flat primitive arrays render as tag chips (click `×` to remove, Enter/comma to add). Fields whose key matches `key|secret|token|password|bearer` render as password inputs with a show/hide toggle. Strings longer than 120 characters or containing newlines render as textareas.

**Editing features:**

| UI Element | Location | Action |
|---|---|---|
| ✏ pencil icon | Object header (only when `_title` exists) | Inline-edit the title — click to open input, Enter/Blur to save, Escape to cancel |
| `×` button | Object/array header | Delete the entire block or array (with confirmation) |
| `×` button | Field row (right edge) | Delete the attribute (with confirmation) |
| `+ Attribute` | Footer of every object block | Prompts for key name then initial value; adds a string field |
| `+ Block` | Footer of every object block | Prompts for a key name, adds an empty `{}` sub-object |
| `+ Add item` | Footer of every object array | Appends an empty `{}` item to the array |

All structural changes (add/remove) immediately re-render the tree and mark the config as dirty. After adding, the affected section automatically opens and scrolls into view. After deleting, the scroll position is preserved. Changes are not written to disk until **Save** is clicked (or Ctrl+S).

### 16.2a Manifest Editor (`/manifests`)

- `GET /manifests` — renders the manifest editor UI (role-gated via `allowedRoles`)
- `GET /manifests/style.css` — serves shared CSS
- `GET /manifests/api/list` — returns all manifest names from `manifests/*.json`
- `GET /manifests/api/get?name=...` — returns one manifest as parsed JSON
- `POST /manifests/api/save` — writes one manifest from `{name, data}`

The page uses the same collapsible JSON editing pattern as the config editor, but adds a manifest selector so admins can switch between tool manifests quickly.

### 16.2b Subagent Manager (`/subagents`)

- `GET /subagents` — renders the subagent manager UI (role-gated via `allowedRoles`)
- `GET /subagents/style.css` — serves shared CSS
- `GET /subagents/api/list` — lists all configured subagents
- `GET /subagents/api/get?type=...` — loads one subagent definition
- `POST /subagents/api/save` — saves `{previousTypeKey?, typeKey, channelId, title, manifestBlock, overrides}`
- `DELETE /subagents/api/delete?type=...` — deletes one subagent definition

Saving a subagent updates both `core.json` and the `xSubagents` areas inside `manifests/getSubAgent.json`. Deleting a subagent removes both the `core-channel-config` entry and the matching manifest block.

Prompt field convention for subagents:
- `persona` defines the subagent identity and job and is used as the `You are` block
- `systemPrompt` defines processing rules, workflow, and guardrails
- `instructions` defines response style, verbosity, language, length, and formatting

### 16.3 Chat SPA (`/chat`)

**Chat (port 3112, /chat):**
- `GET /chat` — renders the chat SPA
- `GET /chat/style.css` — serves shared CSS
- `GET /chat/api/chats` — returns list of available chat channels (role-filtered)
- `GET /chat/api/context?channelId=xxx` — fetches message history for a channel
- `POST /chat/api/chat` — receives a user message; `00048` forwards it to the internal API flow (`POST /api`) and returns `{ response }` directly as JSON
- `POST /chat/api/upload` — server-side file upload proxy; accepts raw binary body with `Content-Type` and `X-Filename` headers; forwards to `cfg.apiUrl` → `/upload` with optional Bearer token; returns `{ ok, url }` or error JSON
- Subchannel CRUD: `GET/POST/PATCH/DELETE /chat/api/subchannels`

**Architecture note:** `00048-webpage-chat` is a pure HTTP handler. On `POST /chat/api/chat` it makes an internal `POST http://localhost:3400/api` call with `channelId`, `payload`, `userId`, and `subchannel`. All AI processing (model, tools, persona, context write) happens inside the API pipeline — `00048` does not interact with AI or context directly. Channel config comes from `core-channel-config` (same entries used by Discord and the browser extension).

**File attachment UI:**
- 📎 attach button in the chat footer opens a file picker
- Selected file is shown in a preview bar above the footer with a ✕ clear button
- On send: images are uploaded via `POST /gallery/api/files` (same-origin, session cookie auth); non-images and gallery failures fall back to `POST /chat/api/upload` (server proxy)
- The uploaded file URL is prepended to the message payload (`url\nmessage text`) before sending to the AI
- Upload happens before the chat API call; the message is not sent if the upload fails

### 16.4 Inpainting SPA (`/inpainting`)

**Inpainting (port 3113, /inpainting):**
- `GET /inpainting` — renders the inpainting SPA
- `GET /inpainting/style.css` — serves shared CSS
- `POST /inpainting/api/inpaint` — handles image inpainting requests
- `GET /inpainting/auth/token` — generates auth token for deep links
- `GET /documents/*.<ext>` — redirected here by module 00042 (PNG, JPG, JPEG, WebP, GIF, BMP)

**Toolbar buttons:**
- **⬇ Download** — saves the current canvas as `image.png` (always available when an image is loaded)
- **🖼 Save to Gallery** — uploads the current canvas to `POST /gallery/api/files` with the session cookie. **Requires login** (`INPAINT_LOGGED_IN = true`). Button is disabled when the user is not authenticated.

### 16.4a Gallery (`/gallery`)

**Gallery (port 3120, /gallery):**
- `GET /gallery` — renders the gallery SPA (login required; unauthenticated users are redirected to `/`)
- `GET /gallery/style.css` — serves shared CSS (no auth)
- `GET /gallery/api/files` — lists all images for the logged-in user as `{ files: [{ filename, url }] }`
- `POST /gallery/api/files` — uploads an image for the logged-in user. Send raw image bytes as the request body with `X-Filename: <filename>` header. Accepted formats: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`. Returns `{ ok, url, filename }`.
- `DELETE /gallery/api/files` — deletes an image. Body: `{ filename }`. Returns `{ ok }`.

**core.json configuration:**
```json
"webpage-gallery": {
  "flow":          ["webpage"],
  "port":          3120,
  "basePath":      "/gallery",
  "inpaintingUrl": "https://jenny.example.com/inpainting"
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `flow` | array | — | Must include `"webpage"` |
| `port` | number | `3120` | HTTP port — must also be in `config.webpage.ports` and `config.webpage-auth.ports` |
| `basePath` | string | `"/gallery"` | URL base path |
| `inpaintingUrl` | string | `""` | Full public URL of the inpainting SPA, used to build the "Inpaint" deep-link. Must match `webpage-inpaint.inpaintHost` (with `https://` prefix). |

- Add `3120` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`
- Add `reverse_proxy /gallery* localhost:3120` to your Caddyfile
- Images are stored in `pub/documents/<userId>/` via `core/file.js`

---

### 16.4b GDPR Data Export (`/gdpr`)

**GDPR Export (port 3121, /gdpr):**
- `GET /gdpr` — renders the data-export SPA (login required)
- `GET /gdpr/style.css` — serves shared CSS (no auth)
- `GET /gdpr/export.xlsx` — generates and downloads an Excel file containing all personal data for the logged-in user

**Excel sheets:**

| Sheet | Content |
|---|---|
| **Context** | All rows from the `context` table where `id = userId` — conversation history entries keyed to the user's Discord ID |
| **GDPR Consent** | All rows from the GDPR consent table (`gdpr` by default) where `user_id = userId` — per-channel consent records |
| **Files** | All files in `pub/documents/<userId>/` — name, size in bytes, and last-modified timestamp |

**core.json configuration:**
```json
"webpage-gdpr": {
  "flow":      ["webpage"],
  "port":      3121,
  "basePath":  "/gdpr",
  "gdprTable": "gdpr"
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `flow` | array | — | Must include `"webpage"` |
| `port` | number | `3121` | HTTP port — must also be in `config.webpage.ports` and `config.webpage-auth.ports` |
| `basePath` | string | `"/gdpr"` | URL base path |
| `gdprTable` | string | `"gdpr"` | MySQL table name for GDPR consent records — must match `config.discord-gdpr-gate.table` |

**Setup:**
- Add `3121` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`
- Add `reverse_proxy /gdpr* localhost:3121` to your Caddyfile
- Requires the `exceljs` npm package (`npm install exceljs`)
- The module reads `wo.db` for the MySQL connection — database must be configured in `workingObject.db`

> **Note:** Context entries are only exported where `context.id = userId`. Guild channel history is keyed by channel ID and will not appear here unless the channel ID matches the user's Discord ID (e.g. DM channels). This is a limitation of the channel-keyed context store.

---

### 16.5 Bard Library Manager (`/bard`)

Access is **tiered** — roles grant rights additively:

| Role group | Access |
|---|---|
| Not in `allowedRoles` | Full deny — styled HTML 403 page |
| `allowedRoles` | Basic access — Now Playing card + audio stream |
| `adminRoles` | Full admin — upload, tag editing, track deletion, autotag |

Configure in `core.json["webpage-bard"]`:
- `allowedRoles: ["admin", "dnd"]` — grants access to all listeners
- `adminRoles: ["admin"]` — additionally grants upload and management rights

**Bard (port 3114, /bard):**
- `GET /bard` — renders the music library manager UI (requires any allowed role)
- `GET /bard/style.css` — serves shared CSS (public)
- `GET /bard/api/nowplaying` — current track info (requires any allowed role)
- `GET /bard/api/audio` — MP3 audio stream (requires any allowed role)
- `GET /bard/api/library` — track list + file list (admin only)
- `POST /bard/api/autotag-upload` — upload + AI-tag MP3 file (admin only). Queries Tavily for song context, then calls the **internal API** (`autoTag.apiUrl`) on the configured channel (`autoTag.channelId`) to generate 6 structured tags (`[location, situation, mood1, mood2, mood3, mood4]`). Optional bearer auth comes from `autoTag.apiSecret`. Writes library.xml entry. Requires `config["webpage-bard"].autoTag.enabled = true`.
- `POST /bard/api/tags` — updates track metadata: title, tags, volume (admin only)
- `DELETE /bard/api/track` — removes a track from the library and deletes the MP3 file (admin only)

### 16.6 Live Dashboard (`/dashboard`)

**Dashboard (port 3115, /dashboard):**
- `GET /dashboard` — renders the live bot telemetry dashboard (role-gated)
- Page auto-refreshes every `refreshSeconds` seconds (default: 5)
- Data source: `dashboard:state` registry key, written by `main.js` every 2 seconds

**Log Viewer (port 3115, /dashboard/logs):**
- `GET /dashboard/logs` — log viewer page with two tabs: **Events** and **Pipeline Diffs**
- Reads `logs/events/` and `logs/pipeline/` — file list is always fetched live from the API (never stale after log rotation)
- Lines are colour-coded client-side: `[ERROR]` = red, `[WARN]` = amber, `+` = green, `-` = red, `---` section headers = cyan
- **Auto-scroll checkbox** (default: on) — re-fetches the file list + current file every **3 seconds** and scrolls to the bottom; automatically follows log rotation to the newest file; uncheck to stop polling
- `GET /dashboard/logs/api?type=events|pipeline&file=N` — returns `{content: "..."}` (last 512 KB of the file)
- `GET /dashboard/logs/api?type=events|pipeline` (no `file`) — returns `{events: [...], pipeline: [...]}` with live file list

**core.json configuration:**
```json
"webpage-dashboard": {
  "flow": ["webpage"],
  "port": 3115,
  "basePath": "/dashboard",
  "allowedRoles": ["admin"],
  "refreshSeconds": 5
}
```

### 16.7 Documentation Browser (`/docs`)

**Documentation (port 3116, /docs):**
- `GET /docs` — renders the project documentation index
- `GET /docs/<page>` — renders individual documentation pages
- `GET /docs/style.css` — serves shared CSS

**core.json configuration:**
```json
"webpage-documentation": {
  "flow": ["webpage"],
  "port": 3116,
  "basePath": "/docs",
  "allowedRoles": []
}
```

### 16.8 AI Wiki (`/wiki`)

**AI Wiki (port 3117, /wiki):**
- `GET /wiki` — lists all configured channel wikis (public ones visible without auth)
- `GET /wiki/style.css` — shared CSS
- `GET /wiki/{channelId}` — channel homepage (search bar + recent article cards); card images load sequentially (concurrency 2) via a JS queue using the pre-generated 400 px thumbnail URL; if the thumbnail is missing the browser automatically falls back to the full-resolution image via `onerror`
- `GET /wiki/{channelId}/{slug}` — article page (Fandom-style layout)
- `GET /wiki/{channelId}/{slug}/edit` — editor/admin: edit form
- `GET /wiki/{channelId}/search?q=` — search; always shows results overview (even with a single hit); no hit triggers generation automatically for creator/admin
- `GET /wiki/{channelId}/images/{filename}` — serves uploaded images (`Cache-Control: public, max-age=604800, immutable`); supports `?w=N` query param to serve a JPEG thumbnail scaled to N px wide — thumbnail is cached to `pub/wiki/{channelId}/images/thumbnails/{N}/{filename}.jpg`; thumbnails are pre-generated eagerly at upload time and on image regen; on-demand generation via `?w=N` serves as fallback for older images without a cached thumbnail
- `POST /wiki/{channelId}/api/generate` — AJAX generate (creator/admin); body `{query, force?, promptAddition?}`; `promptAddition` is appended to the AI payload as `"\n\nAdditional context: …"` (never overwrites the system prompt); without `force`: returns `{ok,slug,existing:true}` or `{ok,results:[]}` if matches found; with `force:true`: always generates a new article; returns `{ok,slug,generated:true}`
- `POST /wiki/{channelId}/api/upload-image/{slug}` — editor/admin: upload image for article (JSON `{base64,ext}`)
- `POST /wiki/{channelId}/api/regen-image/{slug}` — editor/admin: regenerate the article image via AI; optional body `{promptAddition?}`; deletes old file + its `thumbnails/{w}/` caches for both `/wiki/{channelId}/images/` (uploaded) and `/documents/wiki/` (AI-generated); updates `image_url` in DB immediately; returns `{ok, image_url}`
- `POST /wiki/{channelId}/{slug}/edit` — editor/admin: save edited article (JSON body)
- `DELETE /wiki/{channelId}/api/article/{slug}` — editor/admin: delete article; deletes the image file + thumbnails from `pub/wiki/{channelId}/images/` (uploaded) or `pub/documents/wiki/` (AI-generated)

**core.json — `webpage-wiki` section:**
```jsonc
"webpage-wiki": {
  "flow": ["webpage"],
  "port": 3117,
  "basePath": "/wiki",
  "apiUrl": "http://localhost:3400/api",      // internal API endpoint for AI calls (default shown)
  "overrides": {                              // global defaults — apply to all channels (legacy; AI config now in api-channel-config)
    "useAiModule":      "completions",
    "model":            "gpt-4o-mini",
    "temperature":      0.7,
    "maxTokens":        4000,
    "maxLoops":         5,
    "requestTimeoutMs": 120000,
    "contextSize":      150,
    "tools":            ["getImage", "getTimeline"],
    "systemPrompt":     "",
    "persona":          "",
    "instructions":     ""
  },
  "channels": [
    {
      "_title":       "My Channel Wiki",
      "channelId":    "YOUR_DISCORD_CHANNEL_ID",
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

**Role hierarchy (highest to lowest privilege):**

| Role | Configured via | Can do |
|---|---|---|
| `admin` | `adminRoles` | Everything — implicitly includes all editor and creator rights |
| `editor` | `editorRoles` | Edit and delete existing articles |
| `creator` | `creatorRoles` | Generate new articles via search |
| *(reader)* | `allowedRoles` | Read articles only |

All role arrays default to `[]` — **no implicit defaults**. Empty = nobody has that role. Admin automatically includes editor and creator rights — no need to add admin to those lists.

**AI settings** are now configured in the `api-channel-config` entry (under `core-channel-config`) for the wiki's channel ID — exactly like the browser-extension channel. The `overrides` block in `config["webpage-wiki"]` is retained for backward compatibility but the primary AI config path is the API channel config. `apiUrl` (default `http://localhost:3400/api`) controls which internal API endpoint is used for article generation. Image generation requires `toolsconfig.getImage.publicBaseUrl` to be set — without it images are saved to disk but the URL stored in the DB is `null`.

| Parameter (`webpage-wiki`) | Type | Default | Description |
|---|---|---|---|
| `port` | number | `3117` | HTTP port |
| `basePath` | string | `"/wiki"` | URL base path |
| `overrides.useAiModule` | string | `"completions"` | AI module: `completions`, `responses`, or `pseudotoolcalls` |
| `overrides.model` | string | `"gpt-4o-mini"` | LLM model for article generation |
| `overrides.temperature` | number | `0.7` | Generation temperature |
| `overrides.maxTokens` | number | `4000` | Max tokens per article |
| `overrides.maxLoops` | number | `5` | Max tool-call loops |
| `overrides.requestTimeoutMs` | number | `120000` | AI request timeout in ms |
| `overrides.includeHistory` | boolean | `false` | Load channel chat history as AI context. **Default `false`** — see note below |
| `overrides.contextSize` | number | `150` | Number of recent messages loaded when `includeHistory: true` |
| `overrides.tools` | array | `["getImage","getTimeline"]` | Tools available to the AI |
| `overrides.systemPrompt` | string | *(built-in)* | Empty = use built-in prompt |
| `overrides.persona` | string | `""` | Persona string injected into the AI call |
| `overrides.instructions` | string | `""` | Instructions injected into the AI call |
| `channels[].channelId` | string | — | Discord channel ID; wiki sub-path and tool-call source |
| `channels[].allowedRoles` | array | `[]` | Roles that may read the wiki; `[]` = public |
| `channels[].adminRoles` | array | `[]` | Full admin access (implicitly includes editor + creator). Empty = no admin |
| `channels[].editorRoles` | array | `[]` | Roles that may edit and delete articles. Empty = only admins |
| `channels[].creatorRoles` | array | `[]` | Roles that may generate new articles via search. Empty = only admins |
| `channels[].maxAgeDays` | number | `7` | Article TTL in days (applies only to unedited articles). Manually edited articles never expire. `0` = never expire |
| `channels[].overrides` | object | `{}` | Per-channel override block — same keys as global `overrides`; channel values take precedence |

- Channel NOT listed in `channels[]` → 404
- `allowedRoles: []` → publicly accessible (no login required)
- `getTimeline` and **`getImage`** are both mandatory in the built-in prompt; AI uses **only tool results** as facts; events always in **chronological order**
- **Article expiry:** only articles that have **never been manually edited** (`updated_at IS NULL`) are subject to the TTL. Once an article is edited it is permanently retained. Expired articles are pruned on each request and in the background. All users always see a colour-coded expiry badge on unedited articles (green > 5 days, yellow ≤ 5 days, orange ≤ 2 days / expired); no badge on edited articles.
- **Edit form** (editor only): title, intro, sections (JSON), infobox (JSON), categories, related terms, image URL + drag-and-drop upload (max 8 MB) + **🔄 Regenerate Image via AI** button with a **"Replace base prompt entirely"** checkbox and a textarea below it. Without the checkbox: text is sent as `promptAddition` and appended to the article's base prompt. With the checkbox checked: text is sent as `promptOverride` and replaces the base prompt completely (useful when the original `infobox.imageAlt` triggers content filters). Old local image file is automatically deleted on successful regeneration; updates DB + preview immediately; save the article to persist the new URL
- **Search page:** creators see an optional **"Additional context for generation"** textarea before the results/generate section. Text entered here is sent as `promptAddition` with the generate request and appended to the AI payload. Non-creators never see this textarea. When no results are found, creators see a **"✨ Generate article"** button (not an auto-spinner) so they can fill in context before triggering generation.
- **Image generation** is mandatory per article (`getImage` is a required step in the AI prompt). AI-generated images → `pub/documents/wiki/` (isolated subdirectory, safe to delete); uploaded images → `pub/wiki/{channelId}/images/`. Both locations are served via `09300-webpage-output.js` under `/documents/wiki/` and `/wiki/{channelId}/images/`. Requires `toolsconfig.getImage.publicBaseUrl` to be configured. After every image save (article generation, AI regen, manual upload), a 400 px thumbnail is pre-generated eagerly (fire-and-forget) so the homepage card grid can serve it immediately.
- **Image deletion:** on article delete or image regen, the old image file + all `thumbnails/{w}/{file}.jpg` caches are removed. Covers both `pub/wiki/{channelId}/images/` (uploaded) and `pub/documents/wiki/` (AI-generated). Thumbnails are stored next to the source file at `<imagedir>/thumbnails/{width}/`.
- **DB migration** (one-off, run after deploying): existing AI-generated image URLs stored before this change point to `/documents/shared/` — run `UPDATE wiki_articles SET image_url = REPLACE(image_url, '/documents/shared/', '/documents/wiki/') WHERE image_url LIKE '%/documents/shared/%';` after physically moving the files.
- Articles stored in MySQL table `wiki_articles` (auto-created on first start; `model` column added automatically via migration)
- Add `3117` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`

#### AI Call Architecture (Article Generation)

The wiki module no longer imports AI modules directly. `callPipelineForArticle` makes an **HTTP POST to the internal API flow** (`cfg.apiUrl`, defaults to `http://localhost:3400/api`). Wiki channel AI configuration (systemPrompt, tools, model, temperature, maxTokens, etc.) lives in `core.json` `api-channel-config`, like the browser-extension channel. `cfg.apiUrl` in `core.json["webpage-wiki"]` configures the endpoint.

Key points:
- The wiki AI call is fully isolated from the Discord/API flow context
- All AI parameters come from the `api-channel-config` entry for the wiki's channel
- `channelId` is set to the wiki's channel ID for timeline and history tool calls
- Article generation never writes to the conversation context (`doNotWriteToContext: true` in the API payload)
- After the AI returns the article JSON, `callPipelineForArticle` reads the model from the wiki's own channel overrides (`channel.overrides.model` → `cfg.overrides.model`, same chain used by `callPipelineForImageOnly`) and stores it in `article._model`, which is persisted to `wiki_articles.model` and shown at the bottom of the article page as "Generated by …". This maps directly to `webpage-wiki.overrides.model` (global) or the per-channel `overrides.model` in `webpage-wiki.channels[]`.

**Image generation** is handled separately by the embedded `wikiGenImage` function (see below) — it is called after the AI returns the article JSON, not as an AI tool call. `callPipelineForImageOnly` (regen endpoint) also uses `wikiGenImage` directly.

> **⚠️ `includeHistory: true` and JSON format**
>
> When `includeHistory: true`, core-ai injects the channel's recent Discord conversation as message history into the AI context. This history consists of plain conversational turns (user/assistant chat). Some models pick up on this pattern and respond in conversational plain text instead of the required JSON — even though the system prompt mandates JSON output.
>
> The default is `includeHistory: false`. If you enable it and article generation fails with `"AI returned no valid JSON article"` and the response is plain prose, set it back to `false`. The AI will then receive context only via timeline and history tool calls, which is the safer default for JSON-format compliance.

#### Embedded Image Generation (`wikiGenImage`)

Image generation is **built into the wiki module** and does **not** depend on `tools/getImage.js` or any other plugin. It is called automatically after the AI returns the article JSON (article gen) and directly from the regen endpoint.

**Config keys** under `core.json["webpage-wiki"].imageGen`:

| Key | Default | Description |
|-----|---------|-------------|
| `apiKey` | — | **Required.** API key for the image endpoint |
| `endpoint` | `https://api.openai.com/v1/images/generations` | Image generation API URL |
| `model` | `gpt-image-1` | Model name (e.g. `dall-e-3`, `gpt-image-1`) |
| `size` | — | Explicit size like `1024x1024` (overrides `aspect`) |
| `aspect` | `1:1` | Aspect ratio: `1:1`, `16:9`, `portrait`, `landscape`, or `W:H` |
| `publicBaseUrl` | — | Prepended to image URL (omit for relative URLs) |

**Example config:**
```json
"webpage-wiki": {
  "imageGen": {
    "apiKey": "sk-...",
    "endpoint": "https://api.openai.com/v1/images/generations",
    "model": "dall-e-3",
    "aspect": "1:1"
  }
}
```

**Prompt enhancement:** The function automatically appends quality/style tags (digital painting, cinematic, etc.) to the raw prompt from `infobox.imageAlt`. No extra AI call is needed.

**Image source:** Article generation uses the AI-written `infobox.imageAlt` field as the image prompt (falling back to the article title). The system prompt explicitly instructs the AI to write a vivid, specific scene description in `imageAlt`.

**Failure handling:** If image generation fails during article creation, the article is saved without an image — no error is raised. The editor's "🔄 Regenerate Image via AI" button can be used afterwards. During regen the full error is returned to the browser.

**`wikiGenImage` and secret resolution:** `wikiGenImage(prompt, imgCfg, wo)` calls `getSecret(wo, imgCfg.apiKey)` to resolve the API key from the DB secrets table. The third argument **must be the full working object** (with `wo.db`). `callPipelineForArticle` passes the request's `wo` directly. `callPipelineForImageOnly` (regen) also passes the request's `wo`; if a channel-level `overrides.apiKey` is configured it is merged into `imgCfg` before the call (so the channel key takes precedence without replacing `wo`).

#### System Prompt

The configured system prompt for the wiki article pipeline should instruct the AI to call `getTimeline` and use `getHistory` when raw evidence is needed before outputting a JSON article. Image generation happens outside the AI pipeline and requires no `getImage` tool call.

**Tools active in the article pipeline:** `getTimeline` and optionally `getHistory` (configurable via `overrides.tools`).

**Recommended channel override for reliable article quality:**

```json
"overrides": {
  "maxLoops": 5
}
```

With `maxLoops: 5` there is enough budget for timeline retrieval, one targeted history lookup, and the final JSON response.

#### Article JSON Schema

The AI **must** output a single raw JSON object (no markdown fences, no surrounding prose). This object is parsed and stored directly in the `wiki_articles` table. Any deviation from the schema causes a `"AI returned no valid JSON article"` error.

```json
{
  "title": "Article Title",
  "intro": "One to two paragraphs of introduction text.",
  "sections": [
    {
      "heading": "Section Heading",
      "level": 2,
      "content": "Section body text. May use markdown."
    }
  ],
  "infobox": {
    "imageAlt": "Short description of the image (used as alt text)",
    "imageUrl": "https://…/pub/documents/….png",
    "fields": [
      { "label": "Label", "value": "Value" }
    ]
  },
  "categories": ["Category1", "Category2"],
  "relatedTerms": ["Term1", "Term2", "Term3"]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | yes | Article title shown in the header |
| `intro` | string | yes | Introductory text (rendered as plain paragraphs) |
| `sections` | array | yes | Body sections. Each has `heading` (string), `level` (2–4), and `content` (string, markdown supported) |
| `infobox.imageAlt` | string | — | Alt text / short image description |
| `infobox.imageUrl` | string\|null | yes | URL returned by `getImage` (top-level `url` field). **Must be set**; `null` only if `getImage` fails |
| `infobox.fields` | array | — | Key–value pairs displayed in the sidebar infobox |
| `categories` | array | — | Category tags (strings) |
| `relatedTerms` | array | — | Related article slugs or search terms shown as links |

`infobox.imageUrl` is also mapped to `article.image_url` in the DB (`wiki_articles.image_url`). If the AI returns the URL in `infobox.imageUrl` but not in a top-level `image_url`, the module copies it automatically.

**Model attribution:** The `wiki_articles` table includes a `model` column (VARCHAR 256, added automatically via `ALTER TABLE … ADD COLUMN IF NOT EXISTS` on first start). When an article is generated, the LLM model ID used (`wo.model` at the time of the AI call) is stored there. The article page renders a small *"Generated by \<model\>"* note at the bottom of the main content area. Manually edited articles retain the model value from their initial generation; the edit form does not overwrite it.

#### Wiki Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "🔄 Regenerate Image via AI" returns HTTP 401 with `Incorrect API key provided: OPENAI` | `callPipelineForImageOnly` was passing a minimal stub object `{ apiKey: "" }` as the `wo` parameter to `wikiGenImage`. `getSecret()` needs `wo.db` to look up the real key in the DB. Without a DB connection the lookup throws, the `catch` returns the placeholder name (`"OPENAI"`) as-is → Bearer OPENAI → 401. | Fixed: `callPipelineForImageOnly` now passes the real request `wo` to `wikiGenImage`. If a channel-level `overrides.apiKey` is set, it is merged into `imgCfg` beforehand so channel-specific keys still take effect. |
| "Generated by …" model footer missing from articles | `callPipelineForArticle` never read the model from the wiki config, so `article._model` was always `null`. | Fixed: `callPipelineForArticle` now reads `channel.overrides.model` → `cfg.overrides.model` (same override chain used by `callPipelineForImageOnly`) and stores it in `article._model` → `wiki_articles.model` → shown in article footer. Corresponds to `webpage-wiki.overrides.model` in `core.json`. |
| Image regeneration fails with content filter / safety error | The article's original `infobox.imageAlt` or `image_prompt` may contain story content that the image API's safety filter rejects. The editor only offered an "additional context" textarea which appends text — no way to replace the problematic base prompt. | Fixed: the editor's "🔄 Regenerate Image via AI" section now has a **"Replace base prompt entirely"** checkbox. When checked, the textarea content is sent as `promptOverride` in the request body and replaces the base prompt completely (body: `{ promptOverride: "…" }` instead of `{ promptAddition: "…" }`). The placeholder text of the textarea updates automatically to indicate override mode. |

### 16.9 Context Editor (`/context`)

**Context Editor (port 3118, /context):**
- `GET /context` — renders the Context DB editor SPA (admin only)
- `GET /context/style.css` — serves CSS
- `GET /context/api/channels` — returns `{channels: [{id, cnt}]}` — all distinct channel IDs with row counts, via SQL `GROUP BY`
- `GET /context/api/columns` — returns `{columns: [{name, type}]}` — column names and types from `INFORMATION_SCHEMA.COLUMNS`
- `GET /context/api/records?channel=&page=&limit=&fields=` — paginated record list; returns `{rows, total, page, pages}`
- `GET /context/api/search?q=&channel=&fields=&searchFields=` — full-text LIKE search; `searchFields` is a comma-separated list of columns to search (`text`, `json`, `role`, `turn_id`, `id`); defaults to `text` when omitted; UI sends `text,json` when the **JSON** checkbox is checked
- `DELETE /context/api/delete` — bulk-delete records; body: `{ids: [ctx_id, ...]}`; returns `{ok, deleted}`
- `POST /context/api/replace/find` — find all records matching a search string; body: `{search, channel?, fields}`; returns `{matches: [{ctx_id, channel, field, value}]}`
- `POST /context/api/replace/apply` — replace in a single record; body: `{ctx_id, field, search, replace, mode?}`; `mode` is `"partial"` (default, replaces matched substring) or `"full"` (overwrites entire field value); returns `{ok, affected}`
- `POST /context/api/replace/all` — replace all matches at once; body: `{search, replace, channel?, fields, mode?}`; same `mode` values; returns `{ok, updated}`

**SPA features:**

| Feature | Description |
|---|---|
| Channel sidebar | Lists all distinct `id` values from the `context` table with row counts. Click to filter records to that channel, or select "All channels". |
| Field selector | Dropdown showing all DB columns (fetched live via `INFORMATION_SCHEMA`). Toggle checkboxes to show/hide columns. Defaults: `ctx_id`, `ts`, `id`, `role`, `text`. |
| Record table | Paginated, 50 rows per page. Clicking long `text` or `json` cells opens a full-content expand overlay. |
| Multi-select delete | Checkbox per row + "Select All". Delete button enabled when ≥ 1 row selected. Confirmation required. |
| Search | Searches the `text` column by default. A **JSON** checkbox next to the search button adds the `json` column to the search (`searchFields=text,json`). Results replace the normal record list in-place with a "Clear" button to return. |
| Inline cell editing | Click any cell in an editable column (`text`, `json`, `role`, `turn_id`, `id`) to edit it directly in the table. Short fields (`role`, `turn_id`, `id`): **Enter** saves, **Esc** cancels. Long fields (`text`, `json`): textarea opens in-cell with a hint; **Ctrl+Enter** saves, **Esc** cancels. Blur also saves. Long `text`/`json` cells show a small **⤢** icon to open the full-content expand overlay without entering edit mode. NULL cells of editable columns are also clickable. |
| Edit modal (✏) | The per-row ✏ button still opens the full edit modal showing all fields of a record at once — useful when editing multiple fields in one go. |
| Search & Replace | Modal with separate "Find Matches" (preview per record with Replace/Skip buttons) and "Replace All (no confirm)" paths. Fields `text` and `json` selectable. Mode toggle: **Replace matched text only** (default, substring replace) or **Replace entire field value** (overwrites the whole field with the replacement). ⚠ `json` replacement operates on raw JSON strings. |

**core.json configuration:**
```json
"webpage-context": {
  "flow": ["webpage"],
  "port": 3118,
  "basePath": "/context",
  "allowedRoles": ["admin"]
}
```

Add `3118` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`.

---

### 16.9a Timeline Editor (`/timeline`)

**Timeline Editor (port 3128, /timeline):**
- `GET /timeline` — renders the Timeline DB editor SPA (admin only)
- `GET /timeline/style.css` — serves CSS
- `GET /timeline/api/channels` — returns `{channels: [{id, cnt}]}` for `timeline_periods.channel_id`
- `GET /timeline/api/columns` — returns `{columns: [{name, type}]}` from `INFORMATION_SCHEMA.COLUMNS`
- `GET /timeline/api/records?channel=&page=&limit=&fields=` — paginated timeline list; returns `{rows, total, page, pages}`
- `GET /timeline/api/search?q=&channel=&fields=&searchFields=` — LIKE search over `summary` and optional JSON summary columns
- `GET /timeline/api/record?ctx_id=` — loads one timeline row for editing
- `PATCH /timeline/api/record` — updates one editable field; body: `{ctx_id, field, value}`
- `DELETE /timeline/api/delete` — bulk-delete rows; body: `{ids: [id, ...]}`
- `DELETE /timeline/api/delete-channels` — bulk-delete rows by `channel_id`; body: `{channelIds: [...]}`

**Why this matters with purge/freeze:**
- `setPurgeContext` deletes non-frozen timeline rows for full-channel purges
- `setFreezeContext` marks timeline rows as frozen for full-channel freezes
- This prevents stale timeline summaries from surviving after raw context rows are removed

**core.json configuration:**
```json
"webpage-timeline": {
  "flow": ["webpage"],
  "port": 3128,
  "basePath": "/timeline",
  "allowedRoles": ["admin"]
}
```

Add `3128` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`.

---

### 16.9b Webpage Voice Interface (`/voice`)

**File:** `modules/00047-webpage-voice.js`
**Port:** 3119
**Config key:** `webpage-voice`
**DB helper:** `shared/voice/voice-diarize.js` (tables: `voice_speakers`, `voice_sessions`, `voice_chunks`, `voice_chunk_speakers`)

A browser-based voice interface with three tabs: **Voice** (always-on + meeting recorder), **Speakers** (register known voices with sample audio), and **Review** (inspect, correct, and apply diarized meeting transcripts).

**Concurrent use:** Always-on mode and the meeting recorder use independent microphone streams — stopping one never interrupts the other. The volume meter follows whichever mode is active.

#### HTTP Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/voice` | Serves the SPA (embedded HTML/CSS/JS, no external dependencies) |
| `GET` | `/voice/style.css` | Shared stylesheet |
| `POST` | `/voice/audio?channelId=<id>` | Always-on turn: receives short audio (webm/ogg/mp3), converts to 16kHz mono WAV, runs full transcription → AI → TTS pipeline, returns MP3 with `X-Transcript` / `X-Response` headers |
| `POST` | `/voice/audio?channelId=<id>&transcribeOnly=1` | Meeting recorder: receives full meeting audio, transcribes with `transcribeModelDiarize`, stores diarized session in DB, returns `{ "transcript": "...", "sessionId": N }` |
| `GET` | `/voice/api/speakers?channelId=<id>` | List registered speakers for a channel |
| `POST` | `/voice/api/speakers` | Create speaker: `{ name, channelId }` |
| `DELETE` | `/voice/api/speakers/:id` | Delete speaker + sample file |
| `POST` | `/voice/api/sample/:speakerId` | Upload audio sample → transcribe → store in `pub/documents/voice-samples/sample_<id>.wav` |
| `GET` | `/voice/api/sessions?channelId=<id>` | List diarized sessions (most recent first) |
| `GET` | `/voice/api/session/:id` | Get chunks + speaker mappings for a session |
| `DELETE` | `/voice/api/session/:id` | Delete session + all chunks + speaker assignments |
| `POST` | `/voice/api/session/:id/apply` | Apply session: rebuild transcript with resolved speaker names, write to channel context, delete session |
| `POST` | `/voice/api/assign` | Update speaker assignment: `{ chunkId, chunkLabel, speakerId }` |
| `POST` | `/voice/api/speakers/new-and-assign` | Create new speaker and assign: `{ name, channelId, chunkId, chunkLabel }` |

#### SPA tabs

**Voice tab:**

| Button | Behaviour |
|---|---|
| **Mic button** (always-on) | Click once to start continuous listening. Jenny sends audio after silence and plays the response back. Click again to stop. |
| **REC button** (meeting recorder) | Click to start recording. Click again to stop. The full audio is transcribed with the diarize model, a session is created in the DB, and the result appears in the Review tab for inspection before applying to the channel. |

**Speakers tab:**

- Add, rename, and delete speaker profiles per channel.
- Click 🎤 next to a speaker to record a voice sample with the currently selected microphone. The sample is stored as `pub/documents/voice-samples/sample_<id>.wav` and transcribed for preview text.
- During meeting transcription, all speakers with saved samples are prepended as a preamble to the meeting audio. The diarization model labels the preamble segments; those labels are mapped to known speaker IDs. Recognised speakers appear by name in the transcript; unrecognised speakers receive a generic label.
- **FFmpeg note:** Silence gaps between preamble segments are generated in pure Node.js (no `lavfi`/`anullsrc` required). All FFmpeg builds are supported.

**Review tab:**

- After a meeting recording finishes on the **Record** tab, the SPA automatically switches to the Review tab and loads the new session — no manual navigation required.
- The session list has a **🔄** button next to the "Sessions" heading. Click it to manually reload the list at any time — useful when a recording was made on another device with the same channel selected.
- Select a session from the left list to view its chunks. Both lists scroll independently.
- Each chunk shows one block per unique speaker label. Use the dropdown to assign a known speaker or create one inline. If the stored label already matches a known speaker name, the matching speaker is preselected automatically. If a stored chunk contains plain transcript text without `Speaker: text` prefixes, the UI renders it as a generic `Transcript` block instead of hiding it.
- **💾 Save All:** Persists all speaker assignments currently shown in the chunk panel to the database in one pass. Does not write to channel context.
- **✓ Apply to Channel:** First saves all assignments (same as Save All), then rebuilds the transcript using DB-resolved speaker names, writes one context row per speaker line with `authorName` set to the speaker name, applies the transcript to the session's stored channel ID from `voice_sessions.channel_id`, optionally purges existing non-frozen context rows if that channel is listed in `clearContextChannels` (configured in `webpage-voice` and `webpage-voice-record`), and deletes the session from the review list. On failure, the API returns `apply_failed` plus a `detail` message.
- 🗑️ deletes a session without writing to context.

> **Cross-device usage:** Sessions are stored in the database keyed by `channel_id`. A session recorded on one device is visible on any other device that has the same channel selected in the dropdown. Use the 🔄 refresh button to reload the list after a remote recording finishes.

> **Context purge scope:** `clearContextChannels` purges context only when a transcript is **applied** (Apply to Channel) or when a full recording is submitted via `POST /voice/record`. Always-on voice turns never purge context, so follow-up questions about a stored transcript continue to work.

#### Diarization with speaker samples (preamble approach)

When `?transcribeOnly=1` is sent and at least one speaker has a sample, `getDiarizeWithSamples` in `00030` follows this pipeline:

1. Query `voice_speakers` for speakers with `sample_audio_path` for this `channelId`.
2. Build a preamble WAV: sample 1 + 2 s silence + sample 2 + 2 s silence + … (`buildSamplePreamble`).
3. Split the meeting audio into 16 kHz mono WAV chunks and concatenate the preamble before each chunk via FFmpeg.
4. Send combined file to the diarize model (`gpt-4o-transcribe-diarize`).
5. `resolveSpeakerMapping`: first tries the classic time-based split (`start < preambleDurationS` for the preamble, `start >= preambleDurationS` for the meeting). If the provider timestamps the returned speech without the preamble offset, it additionally matches returned segment text against the stored `sample_text` values to recover the label→speaker mapping.
6. Store session, chunks, and `voice_chunk_speakers` in the DB.
7. On **Apply**, the endpoint rebuilds the transcript using DB speaker names (not raw labels).

#### Database tables (auto-created on first request)

| Table | Purpose |
|---|---|
| `voice_speakers` | Speaker profiles: `id`, `channel_id`, `name`, `sample_audio_path`, `sample_text` |
| `voice_sessions` | One row per meeting recording: `id`, `channel_id`, `started_at` |
| `voice_chunks` | Audio chunks within a session: `id`, `session_id`, `chunk_index`, `transcript` |
| `voice_chunk_speakers` | Label → speaker ID mapping per chunk: `chunk_id`, `chunk_label`, `speaker_id` |

#### WorkingObject fields set by this module

| Field | Value | Description |
|---|---|---|
| `wo.channelId` | from `?channelId=` | Channel for AI context |
| `wo.audioFile` | path to converted WAV | Input for `core-voice-transcribe` |
| `wo.transcribeAudio` | `true` | Triggers transcription |
| `wo.synthesizeSpeech` | `true` | Triggers TTS (always-on only) |
| `wo.ttsFormat` | `"mp3"` | Browser playback requires MP3 |
| `wo.isWebpageVoice` | `true` | Triggers voice pipeline modules |
| `wo.transcribeOnly` | `true` | Set when `?transcribeOnly=1` |
| `wo.isAlwaysOn` | `true` | Set when `?alwaysOn=1` |

#### Full always-on pipeline

```
POST /voice/audio?channelId=<id>
 → 00028-webpage-voice-input    (set wo fields)
 → 00030-core-voice-transcribe  (transcribe WAV → wo.payload, model: transcribeModel)
 → 00031-webpage-voice-add-context  (always-on path only: write one DB entry per speaker turn — skips when transcribeOnly)
 → 00070-discord-add-context    (load context window for AI)
 → core-ai-completions          (generate response → wo.response)
 → 08100-core-voice-tts         (render TTS → wo.ttsSegments, format: mp3)
 → 09320-webpage-voice-output   (send MP3 audio as HTTP response)
```

#### Meeting recorder pipeline

```
POST /voice/audio?channelId=<id>&transcribeOnly=1
 → 00028-webpage-voice-input       (set wo fields, wo.transcribeOnly=true)
 → 00030-core-voice-transcribe     (getDiarizeWithSamples: build preamble, transcribe,
                                    resolve speaker mapping, retry the raw chunk without
                                    preamble when only preamble segments are detected,
                                    store session+chunks in DB
                                    → wo.payload, wo.voiceDiarizeSessionId)
 → 00033-webpage-voice-transcribe-gate  (send HTTP 200 {transcript, sessionId}, set wo.stop=true)
[AI and TTS skipped — user reviews and applies from the Review tab]

User clicks "Apply to Channel" in Review tab:
POST /voice/api/session/:id/apply
 → rebuild transcript with DB speaker names
 → setContext (+ optionally setPurgeContext) → channel context DB
 → deleteSession → session removed from DB
```

#### core.json configuration

```json
"webpage-voice": {
  "flow":                   ["webpage"],
  "port":                   3119,
  "basePath":               "/voice",
  "silenceTimeoutMs":       2500,
  "maxDurationMs":          30000,
  "clearContextChannels":   [],
  "sampleModel":            "gpt-4o-mini-transcribe",
  "transcribeApiKey":       "",
  "transcribeEndpoint":     "",
  "allowedRoles":           [],
  "channels": [
    { "id": "YOUR_CHANNEL_ID", "label": "General" }
  ]
},
"core-voice-transcribe": {
  "flow":                   ["discord-voice", "webpage"],
  "transcribeModel":        "gpt-4o-mini-transcribe",
  "transcribeModelDiarize": "gpt-4o-transcribe-diarize",
  "chunkDurationS":         300,
  "diarizeChunkMB":         1,
  "opusBitrateKbps":        32,
  "transcribeApiKey":       ""
},
"webpage-voice-output": {
  "flow": ["webpage"]
}
```

- Add `3119` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`
- Add `reverse_proxy /voice* localhost:3119` to your Caddyfile
- See `config.webpage-router` to assign flow-specific `core-channel-config` overrides to `/voice` requests
- `clearContextChannels: ["your-channel-id"]` purges all non-frozen context rows for the listed channels before each transcript is stored — useful for "start-of-session" mode. Frozen rows are never deleted. Configure this in `webpage-voice`, `webpage-voice-record`, and `webpage-voice-add-context` independently.
- The diarize model (`gpt-4o-transcribe-diarize`) is used automatically for `?transcribeOnly=1`; the regular model is used for always-on turns
- Speaker samples are stored in `pub/documents/voice-samples/`. Ensure this path is writable.

---

#### Inpainting SPA — Extended Details

The inpainting module provides a browser-based image editing tool that lets users load an image, paint a mask over areas they want to change, write a prompt, and submit the request to a Stable Diffusion inpainting backend.

**File:** `modules/00049-webpage-inpainting.js`
**Port:** 3113 (configured via `config["webpage-inpainting"].port`)
**URL:** `/inpainting`

### How it works

1. User loads an image (drag-and-drop, file picker, or `?src=` / `?image=` query parameter)
2. User paints a mask (brush tool) over the region to inpaint
3. User enters a prompt and clicks **Inpaint**
4. The module proxies the request to the configured SD A1111 API endpoint
5. The result image is displayed and can be downloaded or used further

### Deep-link via URL parameters

| Parameter | Description |
|-----------|-------------|
| `?src=<url>` | Pre-load an external image (converted to a proxy URL to bypass CORS) |
| `?image=<url>` | Alias for `?src=` |
| `?url=<url>` | Alias for `?src=` |
| `?id=<channelId>` | Sets the callback channel ID for origin whitelisting |

External images are automatically routed through `/inpainting/proxy?url=<encoded>` to bypass browser CORS restrictions.

### Auth system

Auth can be disabled for local-only setups (`"auth": { "enabled": false }`). When disabled:
- All users are treated as logged in
- Proxy bypasses the host whitelist
- Upload accepts all requests

When auth is enabled, users log in via the webpage-auth session cookie. The `imageWhitelist` config controls which external hosts are allowed as image sources.

### core.json configuration

```json
"webpage-inpainting": {
  "flow": ["webpage"],
  "port": 3113,
  "basePath": "/inpainting",
  "allowedRoles": [],
  "auth": {
    "enabled": false,
    "tokenTtlMinutes": 720,
    "users": []
  },
  "imageWhitelist": {
    "hosts": ["jenny.ralfreschke.de"],
    "paths": ["/documents/"]
  }
}
```

### Caddy reverse proxy (required for `/documents` redirect)

```caddy
handle /inpainting* {
    reverse_proxy localhost:3113
}
handle /documents/* {
    header Vary "Sec-Fetch-Dest"
    reverse_proxy localhost:3000
}
```

Module `00042-webpage-inpaint.js` redirects `GET /documents/*.<ext>` requests (PNG, JPG, JPEG, WebP, GIF, BMP) to the inpainting SPA so that images served by the bot can be opened directly in the editor.

**`Vary: Sec-Fetch-Dest` is required** on the `/documents/*` Caddy block. Without it, the browser caches the raw image response (loaded inline by the web chat SPA via `<img>`) and serves subsequent navigation requests from cache, bypassing the bot and never triggering the redirect. With `Vary: Sec-Fetch-Dest`, the browser keeps separate cache entries per fetch type — a direct navigation (`Sec-Fetch-Dest: document`) always misses the cache and hits the server, which then issues the redirect.

**`inpaintHost` configuration (module `00042`):**

```json
"webpage-inpaint": {
  "flow":        ["webpage"],
  "inpaintHost": "jenny.ralfreschke.de/inpainting"
}
```

Set `inpaintHost` to the domain where users are authenticated (where the session cookie is valid). The redirect must go to the same domain the user is logged into, otherwise the inpainting SPA appears logged out. Use a path-only value (`"/inpainting"`) only when all image links and the inpainting SPA share the same domain.

When `inpaintHost` contains a hostname (does not start with `/`), the redirect target is derived directly from that value. When `inpaintHost` starts with `/`, it is appended to the hostname from the incoming HTTP request.

---

### 16.10 Authentication & SSO (`/auth`)

**File:** `modules/00040-webpage-auth.js`
**Config key:** `webpage-auth`

Provides Discord OAuth2 SSO (Single Sign-On) for all web modules. Runs as a **passive module** — it processes every request on listed ports, sets `wo.webAuth` if a valid session cookie is present, and lets the request continue normally. It does not block or respond unless the URL is an `/auth/*` route.

`wo.userId` is set to `wo.webAuth.userId` by this module after the session is resolved. This makes the authenticated user ID available to tools that look up per-user credentials (e.g. `getGraph` delegated token, `getSpotify` OAuth token).

**Routes:**
- `GET /auth/login` — redirects to Discord OAuth2 authorize URL
- `GET /auth/callback` — handles OAuth2 code exchange, sets session cookie, redirects to `/`
- `GET /auth/logout` — clears session cookie, redirects to `/`

**`wo.webAuth` object (set on authenticated requests):**
```json
{ "username": "alice", "userId": "123456789", "guildId": "406902788317118465", "role": "admin", "roles": ["admin", "staff"] }
```
`guildId` contains the Discord Guild ID of the guild through which the user authenticated (the first guild in `guilds[]` where membership and `allowRoleIds` both matched). It is stored in the session cookie and shown in the profile dropdown. **Existing sessions created before this field was added will not contain `guildId` — users must log out and back in to receive a new token.**

If no valid session exists, `wo.webAuth` is not set.

**core.json configuration:**
```json
"webpage-auth": {
  "flow":        ["webpage"],
  "clientId":    "YOUR_DISCORD_CLIENT_ID",
  "clientSecret": "YOUR_DISCORD_CLIENT_SECRET",
  "redirectUri": "",
  "loginPort":   3111,
  "ports":       [3111, 3112, 3113, 3114, 3115, 3116, 3117, 3118, 3119],
  "sessionTtlMs": 86400000,
  "users": [
    { "discordId": "YOUR_DISCORD_USER_ID", "role": "admin" }
  ]
}
```

| Parameter | Type | Description |
|---|---|---|
| `clientId` | string | Discord application client ID |
| `clientSecret` | string | Discord application client secret |
| `redirectUri` | string | OAuth2 callback URL. Empty string = auto-derived from HTTP `Host` header (supports multiple domains) |
| `loginPort` | number | The port that handles `/auth/*` routes (login, callback, logout) |
| `ports` | array | All ports where the module runs passively to set `wo.webAuth` |
| `sessionTtlMs` | number | Session cookie lifetime in milliseconds (default: 24 h) |
| `users[].discordId` | string | Discord user ID |
| `users[].role` | string | Role string (`"admin"`, `"editor"`, etc.) assigned to this user |

> **Multi-domain setup:** Set `redirectUri: ""` to auto-detect the callback URL from the `Host` header. Register every domain's callback URL in the Discord Developer Portal under OAuth2 → Redirects.

---

### 16.11 Navigation Menu

**File:** `modules/00041-webpage-menu.js`
**Config key:** `webpage-menu`

Sets `wo.web.menu` for every webpage request. Menu items are defined globally in `config["webpage-menu"].items[]` and filtered by the user's role before being passed to individual modules. Each module calls `getMenuHtml(wo)` to render the nav bar.

**core.json configuration:**
```json
"webpage-menu": {
  "flow": ["webpage"],
  "items": [
    { "text": "💬 Chat",          "link": "/chat"      },
    { "text": "🖼 Inpainting",    "link": "/inpainting"},
    { "text": "🎵 Bard",          "link": "/bard",        "roles": ["admin"] },
    { "text": "📊 Dashboard",     "link": "/dashboard",   "roles": ["admin"] },
    { "text": "⚙️ Config",         "link": "/config",      "roles": ["admin"] },
    { "text": "📚 Docs",           "link": "/docs"        },
    { "text": "📖 Wiki",           "link": "/wiki"        },
    { "text": "🗄 Context",        "link": "/context",     "roles": ["admin"] },
    { "text": "🔑 Key Manager",    "link": "/key-manager", "roles": ["admin"] },
    { "text": "📡 Live",           "link": "/live",        "roles": ["admin"] }
  ]
}
```

| Parameter | Type | Description |
|---|---|---|
| `items[].text` | string | Display label for the menu item (supports emoji) |
| `items[].link` | string | URL path the item links to |
| `items[].roles` | array | If set, only users with a matching role see this item. Omit or leave empty for public items |

**Visibility rules:**
- Items without `roles` → always shown
- Items with `roles` → only shown if `wo.webAuth.role` matches one of the listed roles
- Unauthenticated users see only items without role restrictions

---

### 16.12 Permission Concept

Jenny's web modules use a layered permission system. Three independent components decide what a user can see and access:

### Authentication (`00040-webpage-auth.js`)

This module runs for every request on ports listed in `config["webpage-auth"].ports`. It reads session cookies, looks up the user in the configured user store, and sets `wo.webAuth`:

```json
{ "username": "alice", "userId": "123", "role": "admin", "roles": ["admin", "staff"] }
```

If no valid session cookie is present, `wo.webAuth` is not set (or has empty fields). Unauthenticated users can still access the site — individual modules decide whether to allow or deny them.

### Navigation Menu (`00041-webpage-menu.js`)

**Layout:** The header shows a `···` dropdown button on the left (all nav items inside), followed by the page title (`<h1>`, always right next to `···`), and a **role badge** on the far right (`margin-left:auto`). Clicking the role badge opens a profile panel showing username, User ID, Guild ID (from the authenticated guild), a dark/light mode toggle, and a logout link. The three elements are direct `<header>` flex children ordered via CSS (`nav-wrap` order:0 → `h1` order:1 → `nav-right-slot` order:2) so all page templates remain unchanged.

**`getMenuHtml(menu, activePath, role, rightHtmlOpt, extraDropdownHtml, userInfo)`** — renders the nav bar. `userInfo` is optional (`wo.webAuth`) and enables the profile panel with user/guild info. Without it the profile panel still shows role + theme toggle + logout, but no IDs.

Menu items are defined in `config["webpage-menu"].items[]`. Each item can have an optional `roles` array:

```json
{ "text": "⚙️ Config",    "link": "/config",    "roles": ["admin"] },
{ "text": "🎵 Bard",      "link": "/bard",       "roles": ["admin"] }
```

**Menu visibility rules:**

| Condition | Result |
|---|---|
| `roles` not set or empty array | **Always shown** — no restriction |
| User has no role (unauthenticated) | **Always shown** — fallback, does not restrict unauthenticated users |
| Role is `"admin"` | **Always shown** — admin sees everything |
| Role matches one of `roles` | **Shown** |
| Role does not match any of `roles` | **Hidden** |

> **Important:** An unauthenticated user (no `wo.webAuth.role`) always sees all menu items, regardless of the `roles` config. The menu is purely cosmetic — the actual page may still deny access.

### Page Access (`allowedRoles` in each module)

Each web module independently controls access to its pages using a `getIsAllowed` helper that checks `cfg.allowedRoles`:

```javascript
function getIsAllowed(wo, allowedRoles) {
  if (!allowedRoles.length) return true;             // no restriction → always accessible
  const have = getUserRoleLabels(wo);                // roles from wo.webAuth
  return allowedRoles.some(r => have.has(r));        // must match at least one role
}
```

**Page access rules:**

| `allowedRoles` config | Session state | Result |
|---|---|---|
| Empty array `[]` or not set | any | **Always accessible** (public) |
| Non-empty, e.g. `["admin"]` | Logged in, role matches | **Accessible** |
| Non-empty, e.g. `["admin"]` | Logged in, role does not match | **403** — styled HTML deny page (with menu) |
| Non-empty, e.g. `["admin"]` | Not logged in | **302 redirect** to `/auth/login?next=<path>` |

Every module applies this two-step deny: first check `wo.webAuth?.userId` to distinguish "not logged in" from "wrong role", then respond accordingly. This ensures users are always sent to the login page rather than seeing a dead-end 403 when they simply have no session yet.

### Summary

| Component | Empty roles config | Not logged in | Wrong role |
|---|---|---|---|
| Menu item | Always shown | Shown (fallback) | Hidden |
| Page content | Always accessible | Always accessible | Always accessible |
| Page content (roles set) | N/A | Redirect to login | Styled 403 |

### Example Configurations

**Public page** (no auth required):
```json
"webpage-bard": { "allowedRoles": [] }
```

**Admin-only page** (authenticated admin required):
```json
"webpage-config-editor": { "allowedRoles": ["admin"] }
```

**Menu item visible to all** (no roles key):
```json
{ "text": "💬 Chat", "link": "/chat" }
```

**Menu item visible to admins only**:
```json
{ "text": "⚙️ Config", "link": "/config", "roles": ["admin"] }
```

---

### 16.13 Creating a New Web Module

The following template shows the standard pattern for a new webpage module including the mandatory auth flow.

```javascript
/************************************************************************************/
/* filename: 000xx-webpage-mymodule.js                                              */
/* Version 1.0                                                                      */
/* Purpose: Description of what this module does. Reads config only from            */
/*          config["webpage-my-module"].                                             */
/*                                                                                  */
/* Routes:                                                                          */
/*   GET  /mymodule              Main SPA page                                      */
/*   GET  /mymodule/style.css    Shared stylesheet (public)                         */
/*   GET  /mymodule/api/data     Example JSON endpoint                              */
/************************************************************************************/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMenuHtml, getThemeHeadScript } from "../shared/webpage/interface.js";
import { setSendNow, setJsonResp, getIsAllowedRoles } from "../shared/webpage/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const MODULE_NAME = "webpage-my-module";

function getStr(v) { return v == null ? "" : String(v); }

export default async function getWebpageMyModule(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "webpage") return coreData;

  const cfg          = coreData?.config?.[MODULE_NAME] || {};
  const port         = Number(cfg.port ?? 3120);
  const basePath     = getStr(cfg.basePath ?? "/mymodule");
  const allowedRoles = Array.isArray(cfg.allowedRoles) ? cfg.allowedRoles : [];

  if (Number(wo.http?.port) !== port) return coreData;

  const method  = getStr(wo.http?.method ?? "GET").toUpperCase();
  const urlPath = getStr(wo.http?.path ?? "/").split("?")[0];

  if (method === "GET" && urlPath === basePath + "/style.css") {
    const cssFile = new URL("../shared/webpage/style.css", import.meta.url);
    wo.http.response = { status: 200, headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" },
      body: fs.readFileSync(cssFile, "utf-8") };
    wo.web.useLayout = false; wo.jump = true; await setSendNow(wo); return coreData;
  }

  const isAllowed = getIsAllowedRoles(wo, allowedRoles);

  if (method === "GET" && (urlPath === basePath || urlPath === basePath + "/")) {
    if (!isAllowed) {
      if (!wo.webAuth?.userId) {
        wo.http.response = { status: 302, headers: { "Location": "/auth/login?next=" + encodeURIComponent(urlPath) }, body: "" };
      } else {
        const menuHtml = getMenuHtml(wo.web?.menu || [], urlPath, wo.webAuth?.role || "", null, null, wo.webAuth);
        wo.http.response = {
          status: 403,
          headers: { "Content-Type": "text/html; charset=utf-8" },
          body: "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\">" +
                "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
                "<title>My Module</title>" + getThemeHeadScript() +
                "<link rel=\"stylesheet\" href=\"" + basePath + "/style.css\"></head><body>" +
                "<header><h1>My Module</h1>" + menuHtml + "</header>" +
                "<div style=\"margin-top:var(--hh);padding:1.5rem;display:flex;align-items:center;justify-content:center;min-height:calc(100vh - var(--hh))\">" +
                "<div style=\"text-align:center;color:var(--txt)\">" +
                "<div style=\"font-size:2rem;margin-bottom:0.5rem\">\uD83D\uDD12</div>" +
                "<div style=\"font-weight:600;margin-bottom:0.5rem\">Access denied</div>" +
                "<a href=\"/\" style=\"font-size:0.85rem;color:var(--acc)\">← Back to home</a>" +
                "</div></div></body></html>"
        };
      }
      wo.web.useLayout = false; wo.jump = true; await setSendNow(wo); return coreData;
    }
    wo.http.response = { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: "<html>...</html>" };
    wo.web.useLayout = false; wo.jump = true; await setSendNow(wo); return coreData;
  }

  if (!isAllowed) {
    setJsonResp(wo, wo.webAuth?.userId ? 403 : 401, { error: wo.webAuth?.userId ? "forbidden" : "unauthorized" });
    wo.jump = true; await setSendNow(wo); return coreData;
  }

  if (method === "GET" && urlPath === basePath + "/api/data") {
    setJsonResp(wo, 200, { ok: true });
    wo.jump = true; await setSendNow(wo); return coreData;
  }

  return coreData;
}

export const fn = getWebpageMyModule;
```

**Auth deny pattern — rule:**

| Situation | Check | Response |
|---|---|---|
| Not logged in | `!wo.webAuth?.userId` | `302` → `/auth/login?next=<urlPath>` |
| Logged in, wrong role | `wo.webAuth?.userId` set | `403` styled HTML page (with menu + lock icon) |
| API endpoint, not logged in | `!wo.webAuth?.userId` | JSON `401 unauthorized` |
| API endpoint, wrong role | `wo.webAuth?.userId` set | JSON `403 forbidden` |

This pattern is **mandatory** for all web modules. Never return a plain-text or bare-HTML 403 for the main page; always redirect unauthenticated users to login first.

**core.json configuration entry:**
```json
"webpage-my-module": {
  "flow": ["webpage"],
  "port": 3120,
  "basePath": "/mymodule",
  "allowedRoles": ["admin"]
}
```

**Steps to register the module:**

1. **Add port** to `config.webpage.ports[]` and `config["webpage-auth"].ports[]` in core.json.

2. **Add Caddy route** (before the default `reverse_proxy`):
   ```
   @mymodule { path /mymodule /mymodule/* }
   handle @mymodule { reverse_proxy 127.0.0.1:3120 }
   ```

3. **Add menu entry** in `config["webpage-menu"].items[]`:
   ```json
   { "text": "My Module", "link": "/mymodule", "roles": ["admin"] }
   ```

4. **Set `allowedRoles`**:
   - `"allowedRoles": []` — public (no login required)
   - `"allowedRoles": ["admin"]` — admin only; unauthenticated users are redirected to login

See [§16.12 Permission Concept](#1612-permission-concept) for the full rules.

---

### 16.14 Key Manager (`/key-manager`)

**Module:** `modules/00058-webpage-keymanager.js`
**Port:** 3122 (default, set via `config["webpage-keymanager"].port`)
**Base path:** `/key-manager`
**Default roles:** `["admin"]`

The Key Manager is an admin-only web UI for managing the `bot_secrets` database table. It lets you view, add, edit, and delete secret mappings (placeholder name → real value) without touching MySQL directly.

#### Features

- Lists all secrets in a compact two-column table: **Name & Value** (stacked) + **Description**
- Value is shown below the placeholder name, masked by default
- **👁** — toggle reveal/hide the value inline (truncated with ellipsis)
- **📋** — copy the real value to the clipboard without revealing it on screen; shows ✓ briefly
- **✏️** — pre-fills the edit form below; name is read-only during edit
- **🗑️** — delete with confirmation dialog
- Automatically creates the `bot_secrets` table on first visit (idempotent)
- Responsive: description column hidden on mobile; table fits without horizontal scroll

#### Configuration

```jsonc
"webpage-keymanager": {
  "flow": ["webpage"],
  "port": 3122,
  "basePath": "/key-manager",
  "allowedRoles": ["admin"]
}
```

The port must also be listed in `config.webpage.ports` so the webpage flow accepts connections on it.

| Key | Type | Default | Description |
|---|---|---|---|
| `port` | number | `3122` | HTTP port to serve the Key Manager on |
| `basePath` | string | `"/key-manager"` | URL prefix |
| `allowedRoles` | array | `["admin"]` | Roles allowed to access the page |

#### API endpoints (internal)

| Method | Path | Description |
|---|---|---|
| `GET` | `/key-manager/api/list` | Return all secrets as `{ok, secrets:[{name,value,description}]}` |
| `POST` | `/key-manager/api/set` | Upsert a secret. Body: `{name, value, description?}` |
| `POST` | `/key-manager/api/delete` | Delete a secret. Body: `{name}` |

---

### 16.14a Channel Config Manager (`/channels`)

**Module:** `modules/00068-webpage-channel-config-manager.js`  
**Port:** 3129 (default, set via `config["webpage-channel-config-manager"].port`)  
**Base path:** `/channels`  
**Default roles:** `["admin"]`

This page is the focused admin editor for `config["core-channel-config"].channels`. It is designed for daily channel override work and avoids the overhead of editing the entire `core.json` tree when you only want to adjust one channel definition.

#### Features

- Search the configured channel entries by title, match value, or tool count
- Open one channel config at a time in a dedicated editor
- Create a new entry from scratch
- Duplicate an existing entry as a starting point
- Delete an entry with confirmation
- Edit the primary channel match and additional channel matches separately
- Edit the top-level entry title directly from the focused form
- Edit the main `overrides` object through a collapsible tree editor with inline support for arrays, nested objects, booleans, and scalar values
- Edit `flows` through the same collapsible tree editor so nested flow overrides stay compact and scrollable
- Preserve uncommon top-level entry fields through the `Miscellaneous top-level fields` JSON editor
- Save validation errors directly in the UI before the file is written

#### Configuration

```json
"webpage-channel-config-manager": {
  "flow": ["webpage"],
  "port": 3129,
  "basePath": "/channels",
  "allowedRoles": ["admin"]
}
```

Also add `3129` to `config.webpage.ports[]` and `config["webpage-auth"].ports[]`.

#### API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/channels` | Render the SPA |
| `GET` | `/channels/style.css` | Serve the shared stylesheet |
| `GET` | `/channels/api/list` | Return `{items:[{index,title,meta,toolCount}]}` |
| `GET` | `/channels/api/item?index=<n>` | Return one split entry as `{index,title,channelMatch,overrides,flows,extra}` |
| `POST` | `/channels/api/save` | Upsert one entry. Body: `{index?, item}` |
| `POST` | `/channels/api/delete` | Delete one entry by index |

#### Menu integration

Add an admin-only menu item such as:

```json
{ "text": "Administrator\\Channels", "iconKey": "config", "link": "/channels", "roles": ["admin"] }
```

---

### 16.15 Microsoft Graph Auth (`/graph-auth`)

**Module:** `modules/00057-webpage-graph-auth.js`
**Port:** 3124 (default; override with `cfg.port`)
**Flow:** `webpage`

Allows logged-in users to connect or disconnect their personal Microsoft account to the bot. Once connected, the `getGraph` tool can access that user's OneDrive, Exchange mailbox, and SharePoint on their behalf.

#### Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/graph-auth` | Status page — shows connected account or a "Connect" button |
| `GET` | `/graph-auth/start` | Starts OAuth2 Authorization Code flow → redirects to Microsoft login |
| `GET` | `/graph-auth/callback` | OAuth2 callback — exchanges code for tokens, fetches `/me`, stores in DB |
| `GET` | `/graph-auth/disconnect` | Deletes the `graph_tokens` row for the current user |

#### Flow

1. User visits `/graph-auth/start` → redirected to `login.microsoftonline.com`
2. Microsoft redirects back to `/graph-auth/callback?code=...&state=...`
3. Module exchanges the code for `access_token` + `refresh_token`
4. Calls `GET /me?$select=id,mail,displayName` to enrich the row
5. Upserts into `graph_tokens` keyed by Discord `user_id`
6. Redirects to `/graph-auth` (status page)

CSRF protection: a random `state` token is stored in the `graph_auth_states` DB table with a 10-minute TTL and validated on callback. Using the DB (instead of an in-memory Map) ensures correctness across bot restarts and between the `/start` and `/callback` requests.

Both tables (`graph_tokens` and `graph_auth_states`) are created automatically on first page load (idempotent `CREATE TABLE IF NOT EXISTS`). Multiple users can each connect their own Microsoft account — tokens are keyed by Discord `user_id` and are fully independent.

#### core.json config

```json
"webpage-graph-auth": {
  "port": 3124,
  "auth": {
    "tenantId":     "SECRET:graph_tenant_id",
    "clientId":     "SECRET:graph_client_id",
    "clientSecret": "SECRET:graph_client_secret",
    "redirectUri":  "https://yourdomain.com/graph-auth/callback",
    "scope":        "offline_access User.Read Mail.ReadWrite Mail.Send Files.ReadWrite.All Sites.ReadWrite.All"
  }
}
```

| Parameter | Type | Description |
|---|---|---|
| `port` | number | `3124` | HTTP port — must also be in `config.webpage.ports[]` and `config.webpage-auth.ports[]` |
| `auth.tenantId` | string | **Required.** Azure AD / Entra tenant ID or secret reference |
| `auth.clientId` | string | **Required.** App registration client ID or secret reference |
| `auth.clientSecret` | string | **Required.** App registration client secret or secret reference |
| `auth.redirectUri` | string | **Required.** Must exactly match the redirect URI registered in Entra |
| `auth.scope` | string | OAuth2 scopes to request (default: `offline_access User.Read`) |

**Setup:**
- Add `3124` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`
- Add `handle @graph-auth { reverse_proxy 127.0.0.1:3124 }` to Caddyfile
- Register the Entra app — see [Entra App Registration](#entra-app-registration-required-once-per-tenant) in the getGraph tool section

### 16.16 Token Refresh Cron (`cron-graph-token-refresh`)

**Module:** `modules/00058-cron-graph-token-refresh.js`
**Flow:** `cron-graph-token-refresh`

Automatically refreshes Microsoft Graph tokens before they expire. Runs every 5 minutes (or whichever interval the cron job specifies).

**Behavior:**
- Queries `graph_tokens WHERE expires_at < (NOW + bufferMs) AND refresh_token IS NOT NULL`
- For each row: calls `POST .../oauth2/v2.0/token` with `grant_type=refresh_token`
- On success: updates `access_token`, `refresh_token` (if a new one is returned), `expires_at`, `updated_at`
- On failure: logs the error and skips — does **not** delete the row

#### core.json config

```json
"cron-graph-token-refresh": {
  "auth": {
    "tenantId":     "SECRET:graph_tenant_id",
    "clientId":     "SECRET:graph_client_id",
    "clientSecret": "SECRET:graph_client_secret"
  },
  "refreshBufferMinutes": 10
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `auth.tenantId` | string | — | **Required.** Entra tenant ID or secret reference |
| `auth.clientId` | string | — | **Required.** App client ID or secret reference |
| `auth.clientSecret` | string | — | **Required.** App client secret or secret reference |
| `refreshBufferMinutes` | number | `10` | Refresh tokens that expire within this many minutes |

Add the cron job to `core.json`:

```json
"cron": {
  "jobs": [
{ "id": "cron-graph-token-refresh", "cron": "*/5 * * * *", "enabled": true, "channelId": "cron-graph-token-refresh" }
  ]
}
```

And add the module subscription:

```json
"cron-graph-token-refresh": {
  "flow": ["cron-graph-token-refresh"]
}
```

---

### 16.17 Spotify Auth (`/spotify-auth`)

**Module:** `modules/00061-webpage-spotify-auth.js`
**Port:** 3125 (default; override with `cfg.port`)
**Flow:** `webpage`

Allows logged-in users to connect or disconnect their personal Spotify account to the bot. Once connected, the `getSpotify` tool can control playback, manage playlists, and search Spotify on behalf of the user. Spotify Premium is required for playback control operations (play, pause, transfer).

#### Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/spotify-auth` | Status page — shows connected account or a "Connect" button |
| `GET` | `/spotify-auth/start` | Starts OAuth2 Authorization Code flow → redirects to Spotify login |
| `GET` | `/spotify-auth/callback` | OAuth2 callback — exchanges code for tokens, fetches `/me`, stores in DB |
| `GET` | `/spotify-auth/disconnect` | Deletes the `spotify_tokens` row for the current user |

#### Flow

1. User visits `/spotify-auth/start` → redirected to `accounts.spotify.com/authorize`
2. Spotify redirects back to `/spotify-auth/callback?code=...&state=...`
3. Module exchanges the code using `Authorization: Basic base64(clientId:clientSecret)` — credentials are **not** sent in the POST body (Spotify-specific requirement)
4. Calls `GET https://api.spotify.com/v1/me` to enrich the row with Spotify user ID, email, and display name
5. Upserts into `spotify_tokens` keyed by Discord `user_id`
6. Redirects to `/spotify-auth` (status page)

CSRF protection: a random `state` token is stored in the `spotify_auth_states` DB table with a 10-minute TTL and validated on callback.

Both tables (`spotify_tokens` and `spotify_auth_states`) are created automatically on first page load (idempotent `CREATE TABLE IF NOT EXISTS`).

#### DB Tables

```sql
CREATE TABLE IF NOT EXISTS spotify_tokens (
  user_id         VARCHAR(64)   NOT NULL,
  sp_user_id      VARCHAR(128),
  sp_email        VARCHAR(256),
  sp_display_name VARCHAR(256),
  access_token    MEDIUMTEXT    NOT NULL,
  refresh_token   MEDIUMTEXT,
  expires_at      BIGINT        NOT NULL,
  scope           TEXT,
  created_at      BIGINT        NOT NULL,
  updated_at      BIGINT        NOT NULL,
  PRIMARY KEY (user_id)
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS spotify_auth_states (
  state_token  VARCHAR(64)  NOT NULL,
  user_id      VARCHAR(64)  NOT NULL,
  created_at   BIGINT       NOT NULL,
  expires_at   BIGINT       NOT NULL,
  PRIMARY KEY (state_token)
) CHARACTER SET utf8mb4;
```

#### core.json config

```json
"webpage-spotify-auth": {
  "port": 3125,
  "auth": {
    "clientId":     "SECRET:spotify_client_id",
    "clientSecret": "SECRET:spotify_client_secret",
    "redirectUri":  "https://yourdomain.com/spotify-auth/callback",
    "scope":        "user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private"
  }
}
```

| Parameter | Type | Description |
|---|---|---|
| `port` | number | `3125` — must also be in `config.webpage.ports[]` and `config.webpage-auth.ports[]` |
| `auth.clientId` | string | **Required.** Spotify app client ID or secret reference |
| `auth.clientSecret` | string | **Required.** Spotify app client secret or secret reference |
| `auth.redirectUri` | string | **Required.** Must exactly match the redirect URI registered in the Spotify Developer Dashboard |
| `auth.scope` | string | OAuth2 scopes to request (defaults to full playback + playlist set shown above) |

#### Spotify App Registration (required once)

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and log in
2. Click **Create app**
3. Fill in App name and description
4. Set **Redirect URI**: `https://yourdomain.com/spotify-auth/callback`
5. Enable the required APIs: check **Web API** (and **Web Playback SDK** if needed)
6. Click **Save**; note the **Client ID** and **Client Secret**
7. Store them as secrets and reference via `SECRET:spotify_client_id` / `SECRET:spotify_client_secret`

#### Required Spotify OAuth2 Scopes

| Scope | Purpose |
|---|---|
| `user-read-playback-state` | Read current playback state and active devices |
| `user-modify-playback-state` | Control playback (play, pause, seek, volume, transfer) |
| `user-read-currently-playing` | Read currently playing track |
| `playlist-read-private` | List private playlists |
| `playlist-read-collaborative` | List collaborative playlists |
| `playlist-modify-public` | Add/remove tracks in public playlists, create public playlists |
| `playlist-modify-private` | Add/remove tracks in private playlists, create private playlists |

**Setup:**
- Add `3125` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`
- Add the Caddy block (see Caddy section) for `/spotify-auth → 127.0.0.1:3125`
- Register the Spotify app and configure secrets

---

### 16.18 Spotify Token Refresh Cron (`cron-spotify-token-refresh`)

**Module:** `modules/00062-cron-spotify-token-refresh.js`
**Flow:** `cron-spotify-token-refresh`

Automatically refreshes Spotify tokens before they expire. Runs every 5 minutes (or whichever interval the cron job specifies).

**Behavior:**
- Queries `spotify_tokens WHERE expires_at < (NOW + bufferMs) AND refresh_token IS NOT NULL`
- For each row: calls `POST https://accounts.spotify.com/api/token` with `grant_type=refresh_token` using `Authorization: Basic base64(clientId:clientSecret)` header
- On success: updates `access_token`, `refresh_token` (Spotify may issue a new refresh token — always stored if present), `expires_at`, `updated_at`
- On failure: logs the error and skips — does **not** delete the row

#### core.json config

```json
"cron-spotify-token-refresh": {
  "auth": {
    "clientId":     "SECRET:spotify_client_id",
    "clientSecret": "SECRET:spotify_client_secret"
  },
  "refreshBufferMinutes": 10
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `auth.clientId` | string | — | **Required.** Spotify app client ID or secret reference |
| `auth.clientSecret` | string | — | **Required.** Spotify app client secret or secret reference |
| `refreshBufferMinutes` | number | `10` | Refresh tokens that expire within this many minutes |

Add the cron job to `core.json`:

```json
"cron": {
  "jobs": [
{ "id": "cron-spotify-token-refresh", "cron": "*/5 * * * *", "enabled": true, "channelId": "cron-spotify-token-refresh" }
  ]
}
```

And add the module subscription:

```json
"cron-spotify-token-refresh": {
  "flow": ["cron-spotify-token-refresh"]
}
```

---

### 16.19 OAuth Manager (`/oauth`)

**Module:** `modules/00063-webpage-oauth-manager.js`
**Flow:** `webpage`

Admin UI for managing server-to-server OAuth2 provider registrations (`client_credentials` flow). These are bot-wide service tokens used by `getApi` with `authType: "oauth_cc"`. For user-specific connections (`auth_code` flow), see [OAuth Connections](#1621-oauth-connections-connections).

#### What it does

- **Provider list:** Shows all registered `client_credentials` OAuth2 providers (name, token URL, scope, description) in a table.
- **Add/Edit form:** Create or update a provider registration. The client secret field is write-only on edit (leave blank to keep the existing secret).
- **Delete:** Removes the registration and all associated cached tokens from `oauth_tokens`.
- **Service token status panel:** Shows which providers currently have a cached `__service__` token and when it expires. Refreshes every 30 seconds.

#### Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/oauth` | Admin page HTML |
| `GET` | `/oauth/api/registrations` | List `client_credentials` registrations (client_secret omitted) |
| `POST` | `/oauth/api/registrations` | Create or update a registration |
| `DELETE` | `/oauth/api/registrations/:name` | Delete registration and its tokens |
| `GET` | `/oauth/api/token-status` | List all cached token rows (provider, user_id, expires_at) |

#### core.json config

```json
"webpage-oauth-manager": {
  "flow": ["webpage"],
  "port": 3130,
  "basePath": "/oauth",
  "roles": ["admin"]
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `basePath` | string | `"/oauth"` | URL prefix for all OAuth manager routes |
| `roles` | string[] | `[]` (all allowed) | Discord roles allowed to access this page |

#### How to add a new OAuth provider (client_credentials)

1. Open `/oauth` in the admin panel.
2. Click **+ Add Provider**.
3. Fill in:
   - **Name:** unique identifier used as `authName` in `getApi` calls (e.g. `"github"`)
   - **Token URL:** the provider's token endpoint
   - **Client ID / Client Secret:** app credentials from the provider's developer console
   - **Scope:** space-separated scopes (optional, provider-dependent)
4. Click **Save**.
5. Use in `getApi`: `authType: "oauth_cc", authName: "github"`.

The first `getApi` call will fetch and cache the token. Subsequent calls use the cached token until it expires (with a 60-second early-refresh window).

#### How to add a user connection provider (auth_code)

The `/oauth` admin page has a second section — **User Connection Providers (auth_code)** — below the service token section.

1. Open `/oauth` in the admin panel.
2. Scroll to **User Connection Providers** and click **+ Add Provider**.
3. Fill in:
   - **Name:** unique identifier used as `authName` in `getApi` calls (e.g. `"discord"`)
   - **Authorization URL:** the provider's OAuth2 authorization endpoint (where users are redirected to log in)
   - **Token URL:** the provider's token endpoint
   - **Client ID / Client Secret:** app credentials from the provider's developer console
   - **Scope:** space-separated scopes (optional, provider-dependent)
4. Click **Save**.
5. Register `https://jenny.ralfreschke.de/connections/<name>/callback` as a redirect URI in the provider's developer console.
6. Users visit `/connections`, click **Connect** next to the provider, and authorize.

| API Route | Description |
|---|---|
| `GET /oauth/api/user-providers` | List auth_code registrations (client_secret omitted) |
| `POST /oauth/api/user-providers` | Create or update an auth_code registration |
| `DELETE /oauth/api/user-providers/:name` | Delete registration and all user tokens |

---

### 16.20 OAuth Token Refresh Cron (`cron-oauth-token-refresh`)

**Module:** `modules/00064-cron-oauth-token-refresh.js`
**Flow:** `cron-oauth-token-refresh`

Automatically refreshes OAuth2 tokens before they expire. Works for any provider registered in `oauth_registrations` that issues a `refresh_token`. Handles both service tokens (`user_id = "__service__"` from `client_credentials` flow) and user tokens (Discord user IDs from `auth_code` flow).

**Behavior:**
- Queries `oauth_tokens WHERE expires_at < (NOW + bufferMs) AND refresh_token IS NOT NULL`
- For each row: looks up the `oauth_registrations` entry for `provider`
- POSTs `grant_type=refresh_token` to the provider's `token_url` with `Authorization: Basic base64(clientId:clientSecret)`
- On success: updates `access_token`, `refresh_token` (if the provider issues a new one), `expires_at`, `updated_at`
- On failure: logs the error and skips — does **not** delete the row

#### core.json config

```json
"cron-oauth-token-refresh": {
  "refreshBufferMinutes": 10
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `refreshBufferMinutes` | number | `10` | Refresh tokens expiring within this many minutes |

Add the cron job to `core.json`:

```json
"cron": {
  "jobs": [
    { "id": "cron-oauth-token-refresh", "cron": "*/5 * * * *", "enabled": true, "channelId": "cron-oauth-token-refresh" }
  ]
}
```

And add the module subscription:

```json
"cron-oauth-token-refresh": {
  "flow": ["cron-oauth-token-refresh"]
}
```

---

### 16.21 OAuth Connections (`/connections`)

**Module:** `modules/00069-webpage-oauth-connections.js`
**Flow:** `webpage`
**Port:** 3131

User-facing page for managing personal OAuth2 account connections (authorization code flow). Each user connects their own account independently — the token is scoped to their Discord user ID. Once connected, `getApi` with `authType: "oauth_user"` uses their token automatically.

#### What it does

- **Connection overview:** Shows all registered `auth_code` OAuth2 providers with the current user's connection status (connected / not connected, token expiry).
- **Connect:** Initiates the OAuth2 authorization code flow — redirects the user to the provider's `auth_url`, captures the code on callback, exchanges it for a token, and stores it in `oauth_tokens` keyed by `(provider, discordUserId)`.
- **Disconnect:** Deletes the user's token row from `oauth_tokens` for that provider.
- **Renew:** Manually triggers a token refresh using the stored `refresh_token`. The **Renew** button is shown on the provider card only when the user is connected and a `refresh_token` is available. If the `refresh_token` is missing (provider does not issue one, or was not stored), the button is not shown and the user must disconnect and reconnect to get a fresh token.

#### Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/connections` | Overview page — all auth_code providers + per-user status |
| `GET` | `/connections/:provider/login` | Initiate auth code flow (redirect to provider auth_url) |
| `GET` | `/connections/:provider/callback` | OAuth2 callback — exchange code, store token, redirect to `/connections` |
| `GET` | `/connections/:provider/disconnect` | Delete user's token for provider, redirect to `/connections` |
| `GET` | `/connections/:provider/renew` | Refresh access token using stored refresh_token, redirect to `/connections` |

#### core.json config

```json
"webpage-oauth-connections": {
  "flow": ["webpage"],
  "port": 3131,
  "roles": ["member", "admin"]
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `port` | number | `3131` | Port this module listens on |
| `roles` | string[] | `[]` (all allowed) | Discord roles allowed to access this page |
| `redirectUriBase` | string | auto (from request Host) | Base URL for callback redirect URIs, e.g. `"https://jenny.ralfreschke.de/connections"`. If omitted, constructed as `https://{Host}/connections`. |

#### How to set up a user-connectable provider

1. Open `/oauth` in the admin panel, scroll to **User Connection Providers** and click **+ Add Provider**. See [OAuth Manager — How to add a user connection provider](#how-to-add-a-user-connection-provider-authcode) for details.
2. Register the callback URL `https://jenny.ralfreschke.de/connections/myprovider/callback` in the OAuth provider's developer console.
3. Users visit `/connections`, click **Connect** next to the provider, and authorize the app.
4. The AI can now call `getApi(url: "...", authType: "oauth_user", authName: "myprovider")` to make requests on behalf of that user.

#### Security notes

- CSRF state tokens are 48 hex characters, stored in `oauth_auth_states`, valid for 10 minutes.
- State is validated on callback: wrong provider or expired state → error page, no token stored.
- Users can only disconnect their own token (scoped by `wo.webAuth.userId`).
- The page requires login — unauthenticated requests receive a "Login Required" page.

---

### 16.22 OAuth Provider Exposure (`/oauth-exposure`)

**Module:** `modules/00070-webpage-oauth-exposure.js`
**Flow:** `webpage`
**Port:** 3132

Admin UI for controlling which OAuth2 `client_credentials` providers are visible to the AI via the `getOauthProviders` tool. Only exposed providers are returned by that tool — by default nothing is exposed.

#### What it does

Displays a table of all registered `client_credentials` providers (from `oauth_registrations`). Each row has an **Expose / Hide** toggle button. The state is persisted in the `tool_exposure` database table under `tool_name = "getOauthProviders"`.

#### Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/oauth-exposure` | Admin page HTML |
| `GET` | `/oauth-exposure/api/providers` | List all client_credentials providers + currently exposed set |
| `POST` | `/oauth-exposure/api/providers` | Toggle a provider: `{ name, expose: true/false }` |

#### core.json config

```json
"webpage-oauth-exposure": {
  "flow": ["webpage"],
  "port": 3132,
  "roles": ["admin"]
}
```

Add port 3132 to `config.webpage.ports[]` and `config.webpage-auth.ports[]`. Add the Caddy block: `@oauth-exposure { path /oauth-exposure /oauth-exposure/* }` → `reverse_proxy 127.0.0.1:3132`.

#### Database

Uses the shared `tool_exposure` table (created by `shared/tools/tool-exposure.js` on first request — no manual migration required):

```sql
CREATE TABLE IF NOT EXISTS tool_exposure (
  tool_name  VARCHAR(64) NOT NULL,
  item_name  VARCHAR(64) NOT NULL,
  PRIMARY KEY (tool_name, item_name)
)
```

---

### 16.23 API Key Exposure (`/bearer-exposure`)

**Module:** `modules/00071-webpage-bearer-exposure.js`
**Flow:** `webpage`
**Port:** 3133

Admin UI for controlling which API key names from `bot_secrets` are visible to the AI via the `getApiBearers` tool. Key values are never exposed — only the name (and description) are returned to the AI. By default nothing is exposed.

#### What it does

Displays a table of all stored secrets from `bot_secrets`. Each row has an **Expose / Hide** toggle. The state is persisted in the `tool_exposure` database table under `tool_name = "getApiBearers"`. The module has **no dependency on the OAuth tables** — it only uses `listSecrets` and the `tool_exposure` table, so it operates independently even if no OAuth providers are configured.

#### Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/bearer-exposure` | Admin page HTML |
| `GET` | `/bearer-exposure/api/keys` | List all bot_secrets names + currently exposed set |
| `POST` | `/bearer-exposure/api/keys` | Toggle a key: `{ name, expose: true/false }` |

#### core.json config

```json
"webpage-bearer-exposure": {
  "flow": ["webpage"],
  "port": 3133,
  "roles": ["admin"]
}
```

Add port 3133 to `config.webpage.ports[]` and `config.webpage-auth.ports[]`. Add the Caddy block: `@bearer-exposure { path /bearer-exposure /bearer-exposure/* }` → `reverse_proxy 127.0.0.1:3133`.

---

## 17. Bard Music System

### Overview

The bard music system automatically plays mood-appropriate background music for tabletop RPG sessions. It runs as a **headless scheduler** — no second Discord bot is required. A cron job analyzes the chat context at every run using an LLM, generates 6 structured labels (`location, situation, mood1–4`), and stores them in the registry. `flows/bard.js` polls the registry every 5 seconds (configurable via `pollIntervalMs`) and switches music when the current track no longer matches the active labels. Audio is served to the browser via the web player at `/bard` or `/bard-stream`.

### Architecture

```
/bardstart command [discord-admin: slash command | discord/webpage/api: /bardstart text message]
  -> 00035-bard-join.js
  -> creates a headless channel-based session in the registry (no voice channel connection needed)
  -> stores bard:session:{channelId} = { textChannelId, status: "ready", ... }
  -> multiple sessions can run simultaneously on the same Discord server (one per channel)
  -> does NOT write bard:labels — empty labels cause getSelectSong to pick a random
     track on the first poll, which is the correct startup behaviour. The cron job
     writes real structured labels (location/situation/moods) on its first run.

/bardstop command
  -> 00035-bard-join.js
  -> cancels the track advancement timer (session._trackTimer)
  -> removes bard:session:{channelId}, bard:labels:{channelId}, bard:lastrun:{channelId},
     bard:nowplaying:{channelId}, bard:stream:{channelId} from registry
  -> bard:lastrun is deleted so the next /bardstart fetches fresh context from scratch
     (without it the cron would only look at context since the old timestamp, finding
      nothing and generating no labels until new conversation happens)

Note on the api flow:
  The webpage-chat SPA proxies messages to localhost:3400/api. The api flow reads guildId
  from the request body (set by 00048-webpage-chat) and writes it to wo.guildId, enabling
  bard-join and other modules to identify the originating guild. Commands in 00035 use
  wo.payload (in addition to wo.message) to detect /bardstart and /bardstop in the api flow.

Cron job (every N minutes, flow: bard-label-gen)
  -> 00036-bard-cron.js (preparer)
     - reads bard:lastrun:{channelId} from registry
     - reads chat context since that timestamp via getContextSince()
       (fallback: last 5 minutes on first run)
     - does NOT write lastrun yet — stores key+ts in wo._bardLastRunKey / wo._bardLastRunTs
       (written only after successful label generation; prevents stuck-lastrun bug)
     - builds wo.systemPrompt = prompt template + {{TAGS}} list + current labels (for reference)
     - builds wo.payload = formatted conversation text
     - sets wo.useAiModule = "completions", wo.doNotWriteToContext = true, wo.includeHistory = false
  -> 01000-core-ai-completions.js (shared AI pipeline, flow: bard-label-gen)
     - calls LLM with wo.systemPrompt + wo.payload
     - writes result to wo.response
  -> 08050-bard-label-output.js (output)
     - parses wo.response into a 6-position label array [location, situation, mood1, mood2, mood3, mood4]
     - three-pass rescue:
         Pass 1 (category rescue): scans ALL positions; first known location word → loc slot,
           first known situation word → sit slot. Positions 0–1 never go to mood slots.
         Change-preference: if the first-found loc/sit equals the previous known value, scans for
           a DIFFERENT known word elsewhere in the output — the AI may have repeated the old value
           from the prompt while signalling a scene change with a new word later.
         Pass 2 (mood assignment): positions 2–5 only, pure mood words (not loc/sit words).
         Pass 3 (position fallback): novel words at positions 0/1 accepted as-is.
     - carry-forward rules (differ by slot type):
         Location: AI empty → prev labels[0] → current song's trackTags[0] → random from locationSet
         Situation: AI empty → left empty (wildcard). No carry-forward, no random init.
           Rationale: situations change rapidly (combat starts/ends); carrying forward a situation
           causes a self-reinforcing loop (battle track → songTags="battle" → bard:labels="battle"
           → new battle track → …). Empty situation = wildcard in the selector → any track matches.
     - writes bard:labels:{channelId} to registry
     - writes bard:lastrun:{channelId} only on success (prevents context window from advancing on AI failure)

flows/bard.js (polls every N seconds, min 5 s) — headless scheduler
  -> reloads library.xml from disk on every cycle (picks up newly added tracks without restart)
  -> no active sessions → stop
  -> for each active session:
     - reads bard:labels:{channelId} for current mood
     - reads bard:nowplaying:{channelId} for current track
     - checks session._trackEndAt: if Date.now() < _trackEndAt → track is still playing
     - compares new AI labels vs previous active labels (nowPlaying.labels):
       · location changed (both non-empty, different) → switch
       · situation changed (both non-empty, different) → switch
       · >50% of new mood labels are not in previous mood labels → switch
       · either list is empty → skip that rule
       · if no switch rule fires → keep playing, refresh nowPlaying.labels + bard:stream.labels for UI
       if switch triggered → getSelectSong selects best-fit track by tier+mood; if current is already
         tied-best → stay (null returned), update UI only
     - if track ended (timer expired): select next track
     - song found: writes bard:stream:{channelId} and bard:nowplaying:{channelId},
       calls ffprobe to get duration, schedules setTimeout(triggerPoll, durationMs + 200)
     - no song found: clears bard:stream:{channelId}

Track end timer — song ended naturally
  -> setTimeout fires after ffprobe duration + 200 ms
  -> clears session._trackEndAt, calls triggerPoll()
  -> poll selects next track and overwrites bard:stream:{channelId} and bard:nowplaying:{channelId}
     atomically. bard:stream is never cleared on song-end — the poll overwrites it when the
     next track starts. This prevents the browser Now Playing card from briefly seeing null.
```

### Registry Keys

| Key | Contents |
|-----|---------|
| `bard:registry` | `{ list: ["bard:session:{channelId}"] }` |
| `bard:session:{channelId}` | `{ textChannelId, status, _trackEndAt, _trackTimer, _lastPlayedFile, _lastLabels }` |
| `bard:labels:{channelId}` | `{ labels: ["tavern","combat","dark","tense","intense","battle"], rejected: ["unknowntag"], updatedAt, channelId }` — written by the cron job after each LLM classification. `labels[0]` = location, `labels[1]` = situation, `labels[2–5]` = 4 mood tags; empty string = wildcard. `rejected` = mood tokens returned by the LLM that are not in the library (up to 5). **Not written on `/bardstart`** — absence of labels causes the first poll to prefer a `default`-tagged track (see below), or a random track if none is tagged `default`. Deleted on `/bardstop`. |
| `bard:nowplaying:{channelId}` | `{ file, title, labels, startedAt }` |
| `bard:stream:{channelId}` | `{ channelId, file, title, labels, trackTags, rejectedLabels, startedAt, musicDir }` — `labels` = current AI mood tags; `trackTags` = the track's own tags from `library.xml`; `rejectedLabels` = LLM tokens not in the library (shown red in Now Playing). Overwritten atomically when a new track starts. **Never cleared on song-end** — the poll overwrites it when the next track begins. Only removed on `/bardstop` or when the library is empty and nothing can be played. Read by the Now Playing card in `webpage-bard`. |
| `bard:lastrun:{channelId}` | `{ ts: "2026-03-07T...", channelId }` — timestamp written by `bard-label-output` **only after a successful label write**. On AI failure the timestamp is not updated, so the next run retries from the same context window. **Deleted on `/bardstop`** — this forces the next `/bardstart` + cron run to fetch fresh context (last 300 s) instead of looking only at conversation after the old timestamp. |

### Music Library (library.xml)

Located at: `assets/bard/library.xml` (configurable via `config["webpage-bard"].musicDir` in `core.json`)

**Auto-creation:** If `library.xml` (or the music directory itself) does not exist when the bard flow starts, both are created automatically. The new file contains an empty `<library>` element. No manual setup is required; simply drop MP3 files into the music directory and add tracks via the Bard UI.

**Hot-reload:** `library.xml` is read from disk on every poll cycle. Song-end triggers an immediate poll, so newly added tracks are picked up within milliseconds after the current song finishes. No restart required.

Format:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<library>
  <track file="Battle1.mp3" title="Battle March">
    <tags>battlefield,battle,dark,intense,tense,epic</tags>
    <volume>0.8</volume>
  </track>
  <track file="Tavern.mp3" title="Tavern Evening">
    <tags>tavern,rest,calm,cozy,warm,relaxing</tags>
    <volume>1.0</volume>
  </track>
  <track file="Ambient.mp3" title="Ambient Drift">
    <tags>,,ambient,calm,peaceful,mysterious</tags>
    <volume>0.9</volume>
  </track>
</library>
```

Fields:
- `file`: MP3 filename, relative to musicDir
- `title`: Display name shown in logs and now-playing info
- `tags`: **6-position** comma-separated list: `location,situation,mood1,mood2,mood3,mood4`
  - Position 0 (location): WHERE the scene takes place — e.g. `tavern`, `dungeon`, `battlefield`
  - Position 1 (situation): WHAT is happening — e.g. `combat`, `rest`, `exploration`
  - Positions 2–5 (moods): atmosphere words — e.g. `dark`, `tense`, `calm`, `epic`
  - **Empty position** = wildcard — the track matches any AI value for that slot
  - A track with `,,calm,peaceful` matches any location and any situation
  - In the **Bard UI**, wildcard positions are displayed as `*` and must be entered as `*`. Example: entering `*,*,released,free,joy` leaves positions 0 and 1 empty (wildcard) and sets three moods. Raw XML uses leading commas (`,,released,free,joy`); the UI converts between the two automatically.
  - **Special tag `default`**: a track tagged `default` (in any position) is played first when no AI labels are available yet (e.g. after `/bardstart` before the first cron run, or after `/bardstop`+`/bardstart`). Use this to define the "startup track" — e.g. a neutral ambient piece to play while the AI hasn't classified the scene yet. If multiple tracks carry the `default` tag one is picked at random; if none do, normal random selection is used as fallback.
- `volume`: Playback volume multiplier, 0.1–4.0 (default: 1.0)

### Tag Vocabulary

The allowed-list sets (`locationSet`, `situationSet`, `moodSet`) are built dynamically from `library.xml` at cron runtime — position 0 of each track feeds `locationSet`, position 1 feeds `situationSet`, positions 2–5 feed `moodSet`. No manual list is maintained.

**For the rescue logic to work correctly**, every concept the AI might use as a location should appear at position 0 in at least one track, and every situation concept at position 1. If a word is only ever used as a mood (positions 2–5), the rescue cannot identify it as a location/situation.

### Song Switch Logic

**Two distinct "empty" semantics:**

| Source | Empty means |
|--------|-------------|
| `library.xml` track tag | **Wildcard** — the track fits any location/situation |
| AI output label (location) | **Unknown** — carry-forward applied (location rarely changes) |
| AI output label (situation) | **Unknown** — left empty (wildcard). No carry-forward. |

**Label processing pipeline** (`bard-label-output`):

1. **Position rescue** — three passes over the raw 6-value AI response:
   - *Pass 1*: scans all positions for known library location/situation words (by set membership). First location word found → slot 0; first situation word found → slot 1. Positions 0–1 are never added to mood slots.
   - *Change-preference*: if the rescued location/situation equals the **previous** known value, the rescue continues scanning for a **different** known word elsewhere. This handles the common AI pattern of repeating the old value (from `{{CURRENT_LABELS}}` in the prompt) while signalling a change later in the output.
   - *Pass 2*: positions 2–5 only; pure mood words (not in locationSet/situationSet).
   - *Pass 3*: novel words at AI positions 0/1 accepted as-is (new concepts not yet in library).

2. **Carry-forward** for empty slots:
   - **Location** (three-level): previous `bard:labels[0]` → current song's `trackTags[0]` (skipped if the current song was *selected as default*, i.e. `bard:stream.selectedAsDefault = true` — not just because it carries the `default` tag. A track that happens to carry `default` but was selected normally by the scoring algorithm contributes its location like any other track.) → random from `locationSet`
   - **Situation** (none): if the AI outputs empty/unclear for situation, the slot stays empty (= wildcard in the selector). No carry-forward, no random init. This prevents the self-reinforcing battle-loop: if a battle track is playing and the AI no longer detects combat, the situation goes to wildcard and the selector opens up to all tracks again.

   Mood slots are **not** filled — empty mood = "unknown this cycle."

**Mid-song switch detection** compares the new AI labels (after carry-forward) against the previous active labels (`nowPlaying.labels`). Carry-forward ensures empty AI slots are never different from the previous value, so only genuine changes trigger a switch.

**Switch rules (any one fires → immediate track switch):**

| Rule | Condition |
|------|-----------|
| **Location changed** | new and previous location are both non-empty and differ |
| **Situation changed** | new and previous situation are both non-empty and differ |
| **Mood drift >50%** | >50% of new mood labels are not present in the previous mood labels (skipped if either list is empty) |
| **Track mismatch** | AI has active labels (location or situation non-empty) AND the currently-playing track fits neither the active location nor the active situation (both `trackLoc ≠ newLoc` and `trackSit ≠ newSit`, ignoring wildcard tracks whose own tag is empty). This catches the case where a track was selected from Tier 3 (random fallback) at a time when labels were already specific — the track never fit but there was no label *change* to trigger the other rules. |
| **Wildcard location upgrade** | The currently-playing track has an empty location tag (wildcard — fits all locations) AND the AI now reports a specific location. A potential switch is triggered; `getSelectSong` then decides whether a better-fitting track exists. If one does, the switch happens. If the wildcard track is already the best available match (e.g. no tracks tagged with the new location exist), `getSelectSong` returns `null` and the wildcard track keeps playing. |

If `getSelectSong` returns `null` after a switch trigger (current track is tied-best in its tier), the switch is suppressed and only the UI labels are refreshed.

`bard:nowplaying.labels` and `bard:stream.labels` are refreshed on every poll regardless, so the UI always shows the current mood context even when no switch occurs.

### Song Selection Algorithm (`getSelectSong`)

Used to find the best-matching track whenever a switch is triggered or a new track is needed.

**Pool tiers** (first non-empty tier wins):

| Tier | Criteria |
|------|----------|
| **1** | Songs matching **both** location **and** situation |
| **2** | Songs matching location **or** situation |
| **3** | All songs |

Empty library tag = wildcard → always satisfies the match condition for that position.

**Mood scoring:** within the winning tier, tracks are ranked by how many AI mood labels appear in the track's own mood tags. Highest count wins.

**Tie-breaking:**
- If the **currently playing track** is among the highest-scoring candidates → return `null` (no switch — current track is as good as any alternative).
- Otherwise → **random pick** from the tied-best candidates. The recently-played file is excluded for variety where possible.

**Default track (startup behaviour):**
When no AI labels are active (labels array is empty — e.g. immediately after `/bardstart` or after `/bardstop`+`/bardstart`), `getSelectSong` first checks whether any candidate track has the literal tag `default` in any tag position. If found, one of those tracks is chosen at random. If no track carries `default`, a fully random track is used as fallback. Once the cron job has generated real labels, the normal tier+mood logic takes over and the default track may be replaced by a better-fitting one.

**Full lifecycle:**
1. **Scheduler started** (`/bardstart`) — no labels written. First poll picks a `default`-tagged track (if any) or a random track. The cron job writes real structured labels on its first run.
2. **Track playing** — every poll compares new AI labels vs `nowPlaying.labels`. If any switch rule fires, `getSelectSong` finds the best track in its tier and starts it immediately. Otherwise, `nowPlaying.labels` and `bard:stream.labels` are refreshed for the UI only.
3. **Song ends naturally** — `setTimeout` fires (ffprobe duration + 200 ms), calls `triggerPoll()` immediately. The next poll runs `getSelectSong` with the current labels and starts the best-matching track.

### Commands

| Command | Flow | Description |
|---|---|---|
| `/bardstart` | discord-admin (slash command) | Start the bard music scheduler for this server |
| `/bardstop` | discord-admin (slash command) | Stop the bard music scheduler for this server |
| `/bardstart` | discord, webpage (text message) | Start the bard music scheduler — send as a text message with the configured `commandPrefix` (default: `/`) |
| `/bardstop` | discord, webpage (text message) | Stop the bard music scheduler — send as a text message with the configured `commandPrefix` |

### Bard UI

Accessible at `/bard`. Features:
- Edit track title, tags, and volume per track. Tags are entered as comma-separated values in the fixed 6-position schema: `location,situation,mood1,mood2,mood3,mood4`. Use `*` for any position that should be a wildcard (matches any AI value). Example: `*,combat,dark,tense,intense,battle` = any location, combat situation, four moods.
- Delete tracks (removes both library entry and MP3 file)
- **Preview** any track with the ▶ button — plays directly in the browser without going through Discord
- **Bulk Auto-Tag Upload** — drop multiple MP3 files at once and have tags generated automatically (see below)
- **Now Playing** card shows the currently active bard track (live, from `bard:stream:{channelId}`). Labels are colour-coded: **green** = tag appears on both the track and the active mood; **blue** = track tag not in the current mood; **gray** = mood label not present on the current track; **red** = LLM token not found in library.xml (rejected). Sync behaviour:
  - **Regular polling:** every 2 seconds.
  - **On song end:** an immediate poll fires after 300 ms; retries every 500 ms (up to 10×) until the server reports a new track, then returns to the 2-second cycle. This minimises the gap between tracks in the browser player.
  - **On label change mid-song:** When `getShouldSwitch` fires (location, situation or mood drift), `bard:stream` is updated immediately with the new track. The browser picks up the change on its next poll cycle. If no switch rule fires, playback continues and only `nowPlaying.labels` is refreshed (UI update only).
  - **On "▶ Click to listen" (start button):** the elapsed position is recalculated at the exact moment the user clicks, so the stream is in sync even if the user waited on the page before pressing play. The catch-up seek happens at button-press time, not at the next track change.

Filenames are preserved as-is, including spaces. Only characters outside `[a-zA-Z0-9 ._-]` are replaced with `_`.

### Bulk Auto-Tag Upload

The **Bulk Auto-Tag Upload** card lets you drop multiple MP3 files at once. For each file, the server:

1. Derives the track title from the filename (strips `.mp3`, converts `_`/`-` to spaces, title-cases)
2. Queries Tavily with `"<Title>" song music mood genre atmosphere RPG tabletop` to retrieve genre/mood context
3. Sends title + search snippet + the list of tags already used in the library to an LLM
4. LLM returns exactly 6 structured tags: `[location, situation, mood1, mood2, mood3, mood4]`
   - `location` — where this music fits (e.g. `tavern`, `dungeon`), or `""` for universal tracks
   - `situation` — type of scene (e.g. `combat`, `rest`), or `""` for universal tracks
   - `mood1–mood4` — four mood/atmosphere words ordered by fit; empty slots padded with `ambient`
5. Saves the MP3 and writes/updates the entry in `library.xml`

Files are processed **sequentially** (one at a time) to avoid library.xml write conflicts. The progress list shows per-file status and the assigned tags on completion.

**Setup:**

```json
"webpage-bard": {
  "autoTag": {
    "enabled": true,
    "tavilyApiKey": "tvly-…",
    "tavilyMaxResults": 5,
    "tavilyTimeoutMs": 15000,
    "endpoint": "https://api.openai.com/v1/chat/completions",
    "apiKey": "sk-…",
    "model": "gpt-4o-mini",
    "temperature": 0.2,
    "maxTokens": 200,
    "llmTimeoutMs": 30000,
    "systemPrompt": "You are a music tagging assistant …",
    "userPrompt": "Track title: \"{title}\" …"
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `false` | Must be `true` for the endpoint to accept requests |
| `tavilyApiKey` | `""` | Tavily API key (get one at tavily.com) |
| `tavilyMaxResults` | `5` | Number of Tavily results to use for context (1–20) |
| `tavilyTimeoutMs` | `15000` | Tavily request timeout in ms |
| `endpoint` | OpenAI chat completions | LLM API endpoint (OpenAI-compatible) |
| `apiKey` | `""` | LLM API key |
| `model` | `"gpt-4o-mini"` | LLM model |
| `temperature` | `0.2` | LLM temperature (lower = more consistent tags) |
| `maxTokens` | `200` | Max tokens for LLM response |
| `llmTimeoutMs` | `30000` | LLM request timeout in ms |
| `systemPrompt` | *(built-in)* | LLM system prompt for tag generation. Overrides the built-in instruction when set to a non-empty string. The built-in prompt automatically injects the known locations, situations and moods from `library.xml` into the prompt (per position), so the LLM reuses existing tags. Custom prompts must instruct the LLM to output a JSON array of exactly 6 strings: `[location, situation, mood1, mood2, mood3, mood4]`. |
| `userPrompt` | *(built-in)* | LLM user prompt template. Available placeholders: `{title}` (track name), `{tavilySnippet}` (web search results). Falls back to the built-in template when empty. |

> **Tip:** If Tavily fails or finds nothing for a track, the LLM still generates tags from the title alone — the feature degrades gracefully. Tags always come out as exactly 6 entries (`[location, situation, mood1–4]`); empty mood slots are padded with `"ambient"`.

### Label Generation Prompt

The LLM prompt used by `00036-bard-cron.js` to classify mood tags is resolved in this priority order:

| Priority | Source | How to set |
|----------|--------|-----------|
| 1 (highest) | `config["bard-cron"].prompt` | Set in `core.json` under `bard-cron` — static override for all sessions |
| 2 (lowest) | Built-in default | Hardcoded in `00036-bard-cron.js` (`DEFAULT_PROMPT_TEMPLATE`) |

The prompt template may contain five placeholders replaced at runtime:

| Placeholder | Replaced with |
|---|---|
| `{{LOCATION_TAGS}}` | Comma-separated list of all unique location tags found in `library.xml` (position 0 of each track's tag string) |
| `{{SITUATION_TAGS}}` | Comma-separated list of all unique situation tags found in `library.xml` (position 1) |
| `{{MOOD_TAGS}}` | Comma-separated list of all unique mood tags found in `library.xml` (positions 2+) |
| `{{CURRENT_LABELS}}` | The 6 labels currently active for this guild, or `none` if no labels have been set yet |
| `{{EXAMPLE_LINES}}` | Four dynamically generated example lines built from real library tags (first two known locations/situations + first four moods). Falls back to generic placeholder values when the library is empty. This prevents the LLM from learning made-up tags from hardcoded examples. |

The built-in default prompt instructs the LLM to output **exactly 6 comma-separated values** in this fixed structure:

```
location,situation,mood1,mood2,mood3,mood4
```

- **Position 1 (location):** physical place — e.g. `tavern`, `dungeon`, `forest`. Empty if unclear. **Never** a situation or mood word.
- **Position 2 (situation):** type of activity — e.g. `combat`, `exploration`, `rest`. Empty if unclear. **Never** a location or mood word.
- **Positions 3-6 (mood × 4):** always exactly 4 mood words ordered by fit (most fitting first). **Never** a location or situation word. Empty mood slots fall back to `ambient`.

> **Important:** The 6 positions are **fixed and independent**. An empty position 1 does **not** shift position 2 left — each position is decided separately. The prompt explicitly enforces this to prevent the LLM from placing location words (e.g. `dungeon`) into the situation slot when the location is uncertain.

**Track tag format** in `library.xml` mirrors this structure: `location,situation,mood1,mood2,...`. An empty slot (leading/trailing comma) means "matches any value" (wildcard):

```xml
<tags>tavern,rest,cozy,calm,warm</tags>       <!-- tavern, rest, 3 moods -->
<tags>,combat,intense,dark,battle</tags>       <!-- any location, combat, 3 moods -->
<tags>forest,,mysterious,eerie,calm</tags>     <!-- forest, any situation, 3 moods -->
<tags>,,dark,eerie,mysterious,tense</tags>     <!-- any location, any situation, 4 moods -->
```

**Track scoring:** `getSelectSong` uses structured scoring:

| Match type | Score |
|---|---|
| Location mismatch (both non-empty, different) | excluded (score = −1) |
| Situation mismatch (both non-empty, different) | excluded (score = −1) |
| Location match (both non-empty, equal) | +100 bonus |
| Situation match (both non-empty, equal) | +50 bonus |
| Empty location or situation (either side) | neutral (no penalty, no bonus) |
| Mood match | position-weighted: `(aiMoodIdx weight) × (trackMoodIdx weight)` |

Tracks excluded by location or situation don't compete in the primary round. If **all** tracks are excluded (e.g. AI says `city` but the library has no city tracks), the hard filter is dropped and all tracks compete on mood score alone. If no moods match either, all tracks score 0 and one is picked at random.

**Song-switch logic:** Songs are **never interrupted mid-playback**. When the current track ends, `getSelectSong` selects the next track based on the current AI labels at that moment. Empty positions in `library.xml` are wildcards — they auto-match any AI value (neither excluded nor given a bonus).

### bard-label-gen Flow (Pipeline Overview)

The `bard-label-gen` flow uses the **standard AI pipeline** instead of its own inline LLM call:

```
Cron trigger (bard-label-gen)
  └─> 00036-bard-cron       — prepares payload, systemPrompt, AI params
  └─> 01000-core-ai-completions — calls the LLM, writes wo.response
  └─> 08050-bard-label-output  — parses response, writes bard:labels:{channelId}
```

This means the label-gen AI call:
- Inherits `model`, `endpoint`, `apiKey` from `workingObject` (global defaults) unless overridden in `config["bard-cron"]`
- Runs with `temperature: 0.3`, `maxTokens: 80`, no tools, no history
- Does **not** write to the conversation context (`doNotWriteToContext: true`)

**One guild per cron tick.** If the cron job's `channelId` matches a session's text channel ID, that guild is processed. Otherwise the first session with new context is chosen. For multi-guild setups, configure one cron job per guild with a different `channelId`.

### Setup

1. Start the main bot — the bard flow initializes automatically on startup
2. On first start, `assets/bard/` and `library.xml` are created automatically if they do not exist
3. Add MP3 files to `assets/bard/` and manage the track catalog via the Bard UI at `/bard`
4. Use `/bardstart` in Discord to activate the scheduler for this server

> **Note:** `assets/bard/` (music files and `library.xml`) is listed in `.gitignore` and is not tracked by git. Only `assets/bard/library.xml.example` is committed as a reference template. Copy it to `library.xml` to pre-populate the catalog, or let the bot create an empty one automatically.

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No audio in browser player | Scheduler not started | Use `/bardstart` in Discord |
| "Nothing playing right now" despite `/bardstart` | `getItem` import missing in `00043-webpage-bard.js` — `GET /bard/api/nowplaying` would silently return `null` because `ReferenceError: getItem is not defined` was caught by `try/catch` | Ensure `import { getItem } from "../core/registry.js"` is present in `00043-webpage-bard.js` |
| After `/bardstop` + `/bardstart`, labels still feel like the old session | `bard:lastrun` was not deleted on `/bardstop`, so the next label-gen run found no new context and skipped — old labels were effectively carried over | Fixed: `/bardstop` now deletes `bard:lastrun:{channelId}`. After a fresh `/bardstart`, the cron fetches the last 300 s of context and generates new labels on the first run. |
| Stuck in one situation (e.g. only battle tracks after a combat scene) | Situation carry-forward loop: battle track's `trackTags[1]="battle"` was carried into `bard:labels[1]`, which caused the selector to keep picking battle/wildcard-situation tracks, whose tags fed back into the next cycle | Fixed: `bard-label-output` no longer carries forward the situation slot. If the AI outputs empty for situation, it stays empty (wildcard), allowing all tracks to be candidates until the AI identifies the new situation. |
| Wrong track keeps playing despite completely mismatched AI labels (e.g. `rural/relaxing` track while AI labels say `battlefield/battle`) | The switch logic only compared label *changes*; it never checked whether the currently-playing track actually fits the current labels. If a Tier 3 fallback track was selected when labels were already specific, `nowPlaying.labels` stored those specific labels — so every subsequent poll saw no label change and no switch. | Fixed: a 4th "track-mismatch" switch rule was added in `flows/bard.js`. When AI has active labels and the current track matches neither the active location nor the active situation (both tags differ from the AI labels, ignoring wildcards), an immediate mid-song switch is forced. |
| Labels not updating | Cron job disabled or AI failure | Enable `bard-label-gen` job in `core.json`. Check logs for AI errors — if the AI call fails, `bard:lastrun` is not advanced and the next run retries automatically. |
| Same song repeats | Only one track matches labels | Add more tracks or broaden their tags |
| Gap between tracks | Library empty or no matching tracks | Song-end triggers an immediate server poll. If no matching track is found, `bard:stream` is cleared and nothing plays until the next poll. |
| First few seconds of next track missing (browser player) | Browser detected the new track late | Browser poll interval is 2 s; the browser retries every 500 ms (up to 10×) after `ended` until the server reports the new track. If the gap persists, check the browser console for errors in `pollNowPlaying`. |
| Stream out of sync after delayed play button press | Elapsed position was calculated at page-load time | The catch-up seek is recalculated at the moment the user clicks "▶ Click to listen", so the stream is always in sync regardless of how long the user waited before pressing play. |

---

## 18. Dependencies

| Package | Version | Purpose |
|---|---|---|
| `discord.js` | ^14.x | Discord client (messages, guilds, voice) |
| `@discordjs/voice` | ^0.19.x | Voice connection and audio pipeline (used for voice transcription) |
| `@snazzah/davey` | ^0.1.x | DAVE E2EE dispatcher — required by `@discordjs/voice` 0.19+ for voice encryption/decryption. Install with `npm install`; the correct platform binary is selected automatically. |
| `@snazzah/davey-linux-x64-gnu` | ^0.1.x | Linux x64 native binary for DAVE E2EE (`optionalDependency` — installed automatically on Linux) |
| `@snazzah/davey-win32-x64-msvc` | ^0.1.x | Windows x64 native binary for DAVE E2EE (`optionalDependency` — installed automatically on Windows) |
| `@discordjs/opus` | ^0.10.x | Opus audio codec |
| `opusscript` | ^0.0.8 | Pure-JS Opus fallback |
| `prism-media` | ^1.3.x | Audio transcoding (OggOpus -> MP3) |
| `fluent-ffmpeg` | ^2.1.x | Audio processing; ffprobe used by bard scheduler for track duration |
| `mysql2` | ^3.x | MySQL driver (Promise API) |
| `axios` | ^1.x | HTTP client |
| `node-fetch` | ^2.7.x | Fetch API polyfill |
| `nanoid` | ^5.x | Unique ID generation |
| `cron-parser` | ^5.x | Cron expression parsing |
| `puppeteer` | ^24.x | Headless browser (webpage scraping, PDF) |
| `youtube-transcript-plus` | ^1.1.x | YouTube transcript extraction |

---

## Agentic System (Synchronous Orchestrator & Specialists)

### Overview

The agentic system provides **synchronous** multi-agent coordination via two LLM-callable tools: `getOrchestrator` and `getSpecialists`. Unlike the async `getSubAgent` tool (which returns immediately and delivers results later), these tools **block the calling AI** until all agent work is complete and then return the results directly into the ongoing tool loop. This enables true multi-step reasoning: the orchestrator can plan, delegate to specialists, receive their outputs, synthesize, and respond — all within a single user-facing interaction.

```
User request
    └─ Main AI (calls getOrchestrator)
           └─ Orchestrator pipeline (full module pipeline on virtual channel)
                  └─ getSpecialists([{type, jobID, prompt}, ...])
                         ├─ Specialist A (parallel)
                         ├─ Specialist B (parallel)
                         └─ Specialist C (parallel)
                  ← all specialist results returned
           ← synthesized orchestrator result returned
    ← final answer to user
```

### Key Differences from Async Subagents

| Aspect | Synchronous (Orchestrator/Specialists) | Async (getSubAgent) |
|---|---|---|
| **Blocking** | Yes — caller waits for completion | No — returns jobId immediately |
| **Delivery** | Result returned in tool loop | Result delivered as Discord message later |
| **Use case** | Complex reasoning that needs intermediate results | Long-running tasks that can run in background |
| **Status** | Tool status visible in Discord during execution | Acknowledged with "Working on it..." message |

### How It Works

**`getOrchestrator`:**
1. The AI calls `getOrchestrator(type, prompt)`.
2. The tool looks up the base channel ID from `toolsconfig.getOrchestrator.types[type]`.
3. A unique channel ID is generated: `<baseChannelId>-<6-byte-hex>`.
4. The tool posts `{ channelId, payload: prompt, userId, guildId, callerChannelId, callerChannelIds }` to `apiUrl/api`.
5. The tool waits (up to `timeoutMs`) for the API response.
6. Returns `{ ok: true, rows: [responseText] }`.

The orchestrator channel runs a full module pipeline. Its system prompt, persona, and tools are configured in `config["core-channel-config"]` (same as any other virtual channel). The `callerChannelId` is forwarded so the orchestrator knows where to report tool status and so `getSpecialists` can propagate it further.

**`getSpecialists`:**
1. The orchestrator AI calls `getSpecialists(specialists: [{type, jobID, prompt}])`.
2. The tool resolves each specialist's channel ID from `toolsconfig.getSpecialists.types[type]`.
3. Specialists are dispatched in batches of `maxConcurrent` via `Promise.all`.
4. Each specialist gets its own unique channel ID and receives `callerChannelId` from the orchestrator.
5. The tool waits for all specialists to complete, then returns an array of `{ jobID, type, ok, response?, error? }`.

### workingObject Fields in Agentic Contexts

When a pipeline runs as an orchestrator or specialist, the following `workingObject` fields are set:

| Field | Set by | Value |
|---|---|---|
| `agentType` | `getOrchestrator` / `getSpecialists` dispatch | `"orchestrator"` or `"specialist"` (set in the channel config overrides) |
| `agentDepth` | Channel config override | `1` for orchestrators, `2` for specialists, `3` for nested specialists |
| `callerChannelId` | API flow via request body | The originating user channel ID |
| `callerChannelIds` | API flow via request body | Full channel ID chain (enables `getHistory` to query the correct source) |
| `aborted` | `flows/api.js` socket close | `true` if client disconnected; orchestrator/specialists exit immediately |

The AI modules (`core-ai-completions`, `core-ai-pseudotoolcalls`, `core-ai-roleplay`) embed `agentType` and `agentDepth` into the system prompt, allowing the model to adapt its behavior (e.g. never ask clarifying questions, format output for consumption by the caller AI, not by a human).

### Configuring Orchestrator and Specialist Channels

Each orchestrator and specialist type is a virtual channel configured in `config["core-channel-config"]`. Example:

```json
{
  "channelMatch": ["subagent-orchestrator-generic-"],
  "matchMode": "prefix",
  "overrides": {
    "botName": "Jenny",
    "agentType": "orchestrator",
    "agentDepth": 1,
    "persona": "You are a planning orchestrator...",
    "systemPrompt": "...",
    "useAiModule": "completions",
    "model": "gpt-4o",
    "apiKey": "OPENAI",
    "doNotWriteToContext": true,
    "includeHistory": false,
    "maxLoops": 20,
    "maxToolCalls": 15,
    "tools": ["getSpecialists", "getTavily"],
    "apiEnabled": 1,
    "apiSecret": "API_SECRET"
  }
}
```

Use `matchMode: "prefix"` so both the base channel ID and the dynamically suffixed IDs (`-<hex>`) match the same config block.

### Adding a New Orchestrator or Specialist Type

1. Add the type to `toolsconfig.getOrchestrator.types` or `toolsconfig.getSpecialists.types` in `core.json`.
2. Add a `core-channel-config` block with `matchMode: "prefix"` matching the base channel name.
3. Set `agentType` and `agentDepth` in the overrides.
4. List the tools the agent should have access to.
5. Update the `manifests/getOrchestrator.json` or `manifests/getSpecialists.json` enum with the new type name.

---

## Subagent System

### Overview

The subagent system allows the main AI to delegate tasks to isolated sub-processes, each running the full module pipeline with a dedicated tool palette. Subagents are invoked via the `getSubAgent` tool and communicate through the internal API endpoint (`/api` on port 3400).

### How It Works

1. The main AI calls `getSubAgent(type, task)`.
2. `getSubAgent` sends a POST to `http://localhost:3400/api/spawn` with the virtual channel ID for the requested type.
3. The API flow loads `core-channel-config` for that virtual channel, and the spawned subagent uses the target virtual channel's own `systemPrompt`, `persona`, and `instructions`.
4. The tool returns `{ jobId, projectId, status: "started" }` immediately; final delivery then happens via the subagent poll flows to the originating channel. Web delivery may apply a final caller-channel persona pass before returning the answer to the user.

The caller's channel ID (`wo.channelId`) and channel ID list (`wo.channelIds`) are forwarded automatically. When the tool call sets `includeCallerContext: true`, the spawned subagent preloads the original caller context source (`callerContextChannelId` plus grouped `callerChannelIds`) using the target subagent channel's own `contextSize` and `compressedContextElements` overrides. Caller persona, caller system prompt, and caller instructions are not injected into the spawned subagent. The subagent answers in its own target-channel role, and only the later delivery layer may restyle that output for the caller channel.

If the subagent task text omits source URLs that are still present in the caller payload, `getSubAgent` automatically appends those missing URLs in a `[SOURCE URLS]` block before spawning. This keeps webpage, browser-extension, and similar URL-driven requests grounded in the original link even when the main AI compresses the task too aggressively.

The manifest description for `getSubAgent` also treats this as a mandatory caller rule: when a user request contains a concrete URL or artifact link, the exact URL must be copied into the `task` string instead of being replaced with vague wording.

### Context and Statefulness

Subagent calls use `doNotWriteToContext: true` — no context DB entries are written for the subagent turn. Subagent channels are **stateless/virtual**: the same channel name (e.g. `subagent-research`) can serve multiple concurrent users without context collision. The full task context is passed via the payload (orchestration block) rather than being read from the DB. Caller context is opt-in per tool call via `includeCallerContext`; by default subagents stay context-light and rely only on the supplied task plus caller channel metadata.

### Available Subagent Types

| Type | Virtual Channel | Tools | Use when |
|------|----------------|-------|----------|
| `history` | `subagent-history` | getHistory, getTime, getSubAgent | Questions about persons, places, events, chronology, or deeper older history from prior session context |
| `research` | `subagent-research` | getYoutube, getWebpage, getLocation, getTavily, getTime, getSubAgent | General knowledge, current events, web research, YouTube, route planning, and location lookups |
| `generate` | `subagent-generate` | getPDF, getText, getFile, getZIP, getSubAgent | PDF or text document generation |
| `media` | `subagent-media` | getImage, getAnimatedPicture, getVideoFromText, getImageDescription, getToken, getZIP | Image, video, token generation, and media analysis |
| `atlassian` | `subagent-atlassian` | getJira, getConfluence, getZIP, getSubAgent | Jira/Confluence tasks |
| `microsoft` | `subagent-microsoft` | getGraph, getZIP, getSubAgent | Microsoft 365/Graph |
| `develop` | `subagent-develop` | getFile, getZIP, getTavily, getWebpage, getTime, getSubAgent | Code generation — writes files to persistent storage via getFile, returns ZIP; uses getSubAgent(type: media) for image assets |
| `patch` | `subagent-patch` | getFile, getZIP | One targeted patch to one file artifact |
| `orchestrate` | `subagent-orchestrate` | getSubAgent, getTavily, getWebpage, getTime | Requests with truly independent parts needing different tool sets; handles simple tasks directly without spawning |
| `test` | `subagent-test` | getTestA, getTestB | Internal pipeline smoke tests |
| `generic` | `subagent-generic` | getGoogle, getTavily, getWebpage, getHistory, getYoutube, getImage, getImageDescription, getTime, getToken, getLocation | General-purpose fallback when no specialist fits better |

### Routing Logic for Main Channels

Main channels typically keep direct tools lightweight and escalate only when needed. Routing logic:

- **Simple web search** (facts, current events) → `getTavily` directly — no subagent needed
- **Simple image generation** → `getImage` directly — no subagent needed
- **Session history questions** (who is X, what happened at Y, when did Z) → `getSubAgent(type: history, includeCallerContext: true)`
- **General knowledge / YouTube / route planning / location queries** → `getSubAgent(type: research)`
- **Code / development requests** → `getSubAgent(type: develop)`
- **Complex media** (animated token, video generation, multi-step image) → `getSubAgent(type: media)`
- **If the answer is in the current conversation context** → answer directly without tool call

**Convention:** Subagent descriptions must explicitly list each tool in the type's palette so the caller AI understands what capabilities are available. Keep these updated whenever tools are added or removed.

### Subagent Architecture

`history` must never spawn another `history` subagent. `media` is typically treated as a leaf node for simple asset work. `orchestrate` has only `getSubAgent` plus lightweight direct tools (`getTavily`, `getWebpage`, `getTime`) so it can coordinate without duplicating specialist work.

```
Main AI (tools: getSubAgent, getTavily, getImage)
  ├─ getTavily(...)                    ← direct for simple searches
  ├─ getImage(...)                     ← direct for simple single image (no further steps)
  └─ getSubAgent(type: generate)       ← for PDFs/documents WITH images
       ├─ getSubAgent(type: media)     ← STEP 1: get image URL first
       └─ getPDF(html+imageUrl)        ← STEP 2: only after image URL is in hand

Main AI
  └─ getSubAgent(type: orchestrate)    ← only for multi-tool requests
       ├─ getSubAgent(type: media, orchestration: {...})     ← STEP 1: owns image
       └─ getSubAgent(type: generate, orchestration: {...})  ← STEP 2: receives image URL
```

The caller's channel ID set is forwarded at every level so `getHistory` can query the correct source channel regardless of nesting depth. Tool call status is also mirrored to the caller's Discord channel ID so the status display works correctly, and the final poll delivery clears any remaining tool status for that caller channel.

### Creating a New Subagent — Checklist

1. **Add the type mapping** under `workingObject.toolsconfig.getSubAgent.types` in `core.json`.
2. **Add or update the manifest entry** in `manifests/getSubAgent.json` so the AI can discover the type.
3. **Create a dedicated virtual channel override** under `config["core-channel-config"].channels[]` with its own tools, model, prompts, and context settings.
4. **Keep prompt text in config or manifests only**. Do not store subagent prompts in the database.
5. **Decide whether caller context should ever be preloaded**. Default remains off; callers opt in via `includeCallerContext: true`.
6. **Document the new type** in this subagent section and in `CORE_JSON.md`.

**Subagent spawn timeout:** `toolsconfig.getSubAgent.spawnTimeoutMs` controls only the initial HTTP spawn request. The job then continues asynchronously and is delivered by `discord-subagent-poll`.

### Orchestration Context (Multi-Subagent Coordination)

When multiple subagents are involved in a single user request, each `getSubAgent` call should include an `orchestration` parameter to prevent duplicate side effects (e.g. two subagents each generating the same portrait image).

**The problem it solves:** Without orchestration context, each subagent receives only its own task and may reconstruct the global goal — then conclude it also needs to generate the image, write the PDF, or do other steps already assigned to other agents.

**Core rules:**
- **One deliverable = one owner.** Only one subagent may produce a given artifact (image, PDF, etc.).
- **Sequential dependencies must be resolved by the caller.** If B needs A's output, call A first, wait for the result, then pass it explicitly in B's task. Never let B discover the dependency itself.
- **Pass `orchestration` to every subagent call** when more than one subagent is involved.

**Orchestration object schema:**
```json
{
  "globalGoal": "User's original request",
  "yourTask": "Exact deliverable this subagent must produce",
  "yourRole": "e.g. 'portrait image generation'",
  "doOnly": ["generate portrait image of Melissa"],
  "doNot": ["create character sheet", "generate PDF", "spawn additional media subagents"],
  "existingArtifacts": {
    "portrait_image": "https://example.com/portrait.png"
  },
  "assignedToOthers": ["PDF assembly → generate agent"],
  "toolLocks": {
    "getImage": "portrait already generated by media agent"
  }
}
```

**`callerTurnId` propagation:** `wo.turnId` is forwarded as `callerTurnId` to every spawned subagent via `api.js`. Each subagent receives it in `wo.callerTurnId`. The orchestration block injected into the subagent's task also includes the `turnId` for traceability.

**`buildOrchestrationBlock` (in `getSubAgent.js`):** Serialises the orchestration object into a human-readable block that is prepended to the subagent's task payload:
```
[ORCHESTRATION CONTEXT]
turnId: 01JXYZ...
globalGoal: "Create character sheet with portrait for Melissa"
yourTask: "Generate portrait image"
...
[/ORCHESTRATION CONTEXT]

[YOUR TASK]
Generate a portrait of Melissa...
[/YOUR TASK]
```

### File Tools (getFile, getZIP)

These tools enable subagents to generate, read, and bundle files:

| Tool | Purpose |
|------|---------|
| `getFile` | Saves text or binary content to `pub/documents/{userId}/path`. Supports subdirectory paths (e.g. `src/main.js`). Returns public URL. Also supports `overwrite: true` to replace an existing file. |
| `getZIP` | Downloads one or more files by URL and packages them into a ZIP archive. A `baseUrl` parameter preserves the relative directory structure inside the archive. |

**`getFile` parameters:**
- `content` (required) — UTF-8 text or base64-encoded binary; for code files, raw source code only
- `filename` — desired path including subdirectories, e.g. `src/components/Button.js`
- `encoding` — `"text"` (default) or `"base64"`
- `contentType` — MIME type hint for extension inference when filename is omitted
- `overwrite` — if `true`, replaces an existing file at the exact path instead of generating a unique name

**`getZIP` parameters:**
- `urls` (required) — array of public URLs to include
- `baseUrl` — reference URL prefix; each file's path relative to this prefix becomes its path inside the ZIP (e.g. baseUrl `https://x.de/documents/shared/` + file URL `https://x.de/documents/shared/src/main.js` → ZIP path `src/main.js`)
- `filename` — base name for the ZIP (default `archive`)
- `timeoutMs` — per-file download timeout (default 30 s)

### File Recovery Workflow ("fix this file")

When a user supplies a file URL to fix or improve, the `develop` subagent follows this workflow:

1. **Read** — The AI reads the file content (passed in the task description, or downloaded via getFile if a URL is given).
2. **Edit** — The AI analyses the content and produces the corrected version.
3. **Overwrite** — `getFile(content, filename, overwrite: true)` writes the fixed content back to the same path. The `filename` is extracted from the URL (the path after the userId segment).
4. **Bundle** *(optional)* — `getZIP([fixedUrl, ...otherUrls], baseUrl)` to redeliver the full project.

Example prompt:
> "Jenny, fix this file — the Tetris collision detection is broken: https://xbullseyegaming.de/documents/shared/src/game.js"

The develop subagent will read `game.js`, identify the bug, write the corrected version back to the same path via `getFile(overwrite: true)`, and return the updated link.

### getTimeline Return Format

`getTimeline` returns `{ timeline, meta }`.

**Timeline entries** — each entry has a `type` field:

| Type | Has snippets? | start_ts / end_ts | Meaning |
|------|-------------|-------------------|---------|
| `detail` | Yes (`snippets[]`) | From derived context segment ranges | Keyword matches found in this period |
| `period` | No | From derived context segment or node summaries | No matches — coarse summary only |
| `unplaced` | Yes (`snippets[]`) | Derived from snippet timestamps | Matches not covered by any known period |

Each snippet in `snippets[]` has: `channel_id`, `rn`, `ts`, `sender`, `content`.

### Deep-Context Pattern (getHistory)

When the AI needs to retrieve historical content that is not in the current context window, it calls `getHistory` with appropriate `start`/`end` time ranges to retrieve the actual message rows from that period. The history-oriented subagent implements this pattern internally, reading as much of the conversation history as needed to answer the question.

### Tools Called Directly (No Subagent)

These tools are available in the main AI's tool palette and are preferred for simple single-step tasks — no subagent needed:

| Tool | Purpose |
|------|---------|
| `getSubAgent` | Spawns a subagent for complex or multi-step tasks |
| `getTavily` | Web search — use directly for simple lookup questions |
| `getImage` | Generates images — use directly for simple single-image requests |

### Subagent Tool Status in Discord

When a subagent executes a tool call, the tool status is written to:
- `status:tool:{subagent-channel-id}` (e.g. `status:tool:subagent-develop`)
- `status:tool:{caller-channel-id}` — the original Discord channel that triggered the request

The second key ensures the Discord status module (which watches the real channel ID) shows the correct tool name even when the tool is running inside a subagent. This is handled in `01000-core-ai-completions.js` via `wo.callerChannelId`.

### EventEmitter MaxListeners

Node.js default `maxListeners` is 10. With concurrent subagent HTTP calls each registering a close listener, this limit is exceeded. The global limit is raised to 30 in `main.js`:

```js
EventEmitter.defaultMaxListeners = 30;
```

### Async Subagent Mode

`getSubAgent` is always asynchronous. It returns immediately and the result is delivered to the Discord channel when the subagent finishes.

**How it works:**
1. The AI calls `getSubAgent(type, task)` (and optionally `mode: "resume"` with `projectId` to continue an existing project).
2. `getSubAgent` posts to `/api/spawn` (configured via `toolsconfig.getSubAgent.asyncSpawnPath`).
3. The API flow stores a `"job:<jobId>"` entry in the registry with `status: "running"`, then starts the pipeline as a fire-and-forget async IIFE.
4. The `discord-subagent-poll` flow polls the registry every `pollIntervalMs` ms, finds completed/failed jobs, removes them, and runs a `discord` pipeline pass with `wo.deliverSubagentJob` set.
5. The Discord output module sends the result as a message in the original channel.

**`getSubAgent` return value (async mode):**
```json
{
  "ok": true,
  "jobId": "01JXXX...",
  "projectId": "01JYYY...",
  "status": "started",
  "message": "Working on it — result will be delivered when complete.",
  "type": "develop",
  "channelId": "subagent-develop"
}
```

**`projectId` resume:** If `projectId` is passed and a job with that project ID is already `"running"`, `getSubAgent` returns an error instead of spawning a duplicate. Use the `projectId` from the previous async response to continue a project.

**Config keys** (`toolsconfig.getSubAgent`):

| Key | Default | Description |
|-----|---------|-------------|
| `asyncSpawnPath` | `"/api/spawn"` | Path appended to `apiUrl` for async spawning |
| `spawnTimeoutMs` | `10000` | HTTP timeout for the spawn request (ms). The subagent runs beyond this. |

**`discord-subagent-poll` config** (`config["discord-subagent-poll"]`):

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `false` | Must be set to `true` to activate the poller |
| `pollIntervalMs` | `5000` | How often to scan the registry (ms) |
| `callerFlowPattern` | `["discord","discord-voice"]` | Only deliver jobs whose `callerFlow` starts with one of these prefixes |
| `maxJobAgeMs` | `86400000` | Jobs still `"running"` after this many ms are expired as errors |

**Activation:** Set `config["discord-subagent-poll"].enabled = true` in `core.json`. The flow auto-starts on bot startup.

---

### Pipeline Abort Mechanism

When a subagent's HTTP connection is closed by the client (e.g. because `getSubAgent` timed out), the server-side pipeline stops at the next AI loop iteration via `wo.aborted`.

**How it works:**
- `flows/api.js` and `flows/webpage.js` register `req.socket.on("close", ...)` at the start of each request. If the socket is destroyed before the response is sent (`!res.writableEnded`), `wo.aborted` is set to `true`.
- All AI modules (`01000`–`01005`) check `wo.aborted` at the start of each loop iteration and return immediately if set.
- `getSubAgent` also checks `wo.aborted` before making the outbound API call, preventing new subagents from being spawned after the parent is aborted.

**Flows without abort mechanism** (not needed — no HTTP connection to close):
- `discord` — Discord gateway events are fire-and-forget
- `discord-voice` — registry polling, no external connection
- `discord-admin` — Discord slash command callbacks
- `bard` — internal timer-driven scheduler
- `cron` — timer-triggered jobs

### Adding a New Subagent Type

**Step 1** — Register the type in `core.json` under `workingObject.toolsconfig.getSubAgent.types`:

```json
"types": {
  "research": "subagent-research",
  "mytype":   "subagent-mytype"
}
```

**Step 2** — Add a channel config block in `config["core-channel-config"].channels`:

```json
{
  "channelMatch": ["subagent-mytype"],
  "overrides": {
    "botName": "Jenny",
    "persona": "Who the subagent is and what its job is.",
    "systemPrompt": "How the subagent must process the task and which guardrails apply.",
    "instructions": "How the subagent should format and style its final answer.",
    "contextSize": 5,
    "useAiModule": "completions",
    "model": "gpt-4o",
    "apiKey": "OPENAI",
    "doNotWriteToContext": true,
    "includeHistory": false,
    "maxLoops": 10,
    "maxToolCalls": 8,
    "tools": ["toolA", "toolB"],
    "apiEnabled": 1,
    "apiSecret": "API_SECRET"
  },
  "_title": "Subagent: MyType"
}
```

**Step 3** — Add the new type to the `enum` array in `manifests/getSubAgent.json`.

No Discord channel is required. The channel name is virtual and only needs to match between `types` and `channelMatch`.

### Tool Definition Format

All tool manifests in `manifests/` must follow this structure:

```json
{
  "name": "toolName",
  "description": "What the tool does and when to call it.",
  "parameters": {
    "type": "object",
    "properties": {
      "paramName": {
        "type": "string",
        "description": "Parameter description."
      }
    },
    "required": ["paramName"],
    "additionalProperties": false
  }
}
```

Rules:
- `name` must match the tool filename (`getSubAgent` → `tools/getSubAgent.js`)
- `additionalProperties: false` is required on every `parameters` object
- `required` must list all mandatory parameters
- All text in English
- Each tool describes only itself — no references to other tool names
- If a tool requires a prerequisite result (e.g. an image URL), describe the requirement in a `requirements:` section inside the `description` string:

```json
{
  "name": "getToken",
  "description": "Convert an image URL into a round-masked token.\nrequirements:\n- for animated tokens: an animated video or GIF URL as input\n- for static tokens: a static image URL",
  ...
}
```

The AI infers tool chains from each tool's own description and requirements — never from explicit tool name references. This keeps the system modular: tools remain independent and composable without hard-coded dependencies.

---

*End of Administrator Manual*
*Generated: 2026-03-11 · Jenny Discord AI Bot v1.0*
