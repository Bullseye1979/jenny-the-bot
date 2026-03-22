# Jenny Discord AI Bot — Administrator Manual

> **Version:** 1.0 · **Date:** 2026-03-20
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
   - [getInformation](#getinformation)
   - [getLocation](#getlocation)
   - [getTime](#gettime)
   - [getTimeline](#gettimeline)
   - [getToken](#gettoken)
   - [getBan](#getban)
9. [Core Infrastructure](#9-core-infrastructure)
   - 9.1 [registry.js — In-Memory Key-Value Store](#91-registryjs--in-memory-key-value-store)
   - 9.2 [context.js — MySQL Conversation Storage](#92-contextjs--mysql-conversation-storage)
   - 9.3 [logging.js — Structured Logging](#93-loggingjs--structured-logging)
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
   - 16.9a [Webpage Voice Interface (`/voice`)](#169a-webpage-voice-interface-voice)
   - 16.10 [Authentication & SSO (`/auth`)](#1610-authentication--sso-auth)
   - 16.11 [Navigation Menu](#1611-navigation-menu)
   - 16.12 [Permission Concept](#1612-permission-concept)
   - 16.13 [Creating a New Web Module](#1613-creating-a-new-web-module)
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

-- Rolling summary periods
CREATE TABLE timeline_periods (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  channel_id   VARCHAR(128) NOT NULL,
  start_idx    INT NOT NULL,
  end_idx      INT NOT NULL,
  start_ts     DATETIME NULL,
  end_ts       DATETIME NULL,
  summary      TEXT NOT NULL,
  model        VARCHAR(64) NOT NULL,
  checksum     CHAR(64) NOT NULL,
  frozen       TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY ux_timeline (channel_id, start_idx, end_idx)
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
| `workingObject.apiKey` | OpenAI API key (or compatible provider) |
| `workingObject.db.host` | MySQL host |
| `workingObject.db.user` | MySQL user |
| `workingObject.db.password` | MySQL password |
| `workingObject.db.database` | MySQL database name |
| `config.discord.token` | Discord bot token |
| `workingObject.modAdmin` | Discord user ID of the administrator |
| `workingObject.baseUrl` | Public base URL of the server (for file links) |

A minimal example file is provided as `core.json.example` in the same directory.
Copy it to `core.json` and replace all `YOUR_*` placeholders with real values.

```bash
cp core.json.example core.json
# Now edit core.json and fill in all YOUR_* placeholders
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
│   └── logging.js           # Structured logging
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
├── shared/
│   └── webpage/
│       ├── interface.js     # Shared web utilities (menu, auth, DB, file I/O)
│       └── style.css        # Shared CSS for all web modules
├── assets/
│   └── bard/
│       └── library.xml      # Bard music catalog
├── pub/
│   ├── documents/           # Generated images, PDFs, videos
│   └── debug/               # Debug logs
└── logs/                    # Log directory
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
| `persona` | string | `"Default AI Assistant"` | Persona description injected into the system prompt |
| `systemPrompt` | string | `"You are a helpful assistant."` | Primary LLM system instruction |
| `instructions` | string | `"Answer concisely."` | Behavioural rules appended after `systemPrompt` |
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
| `toolChoice` | string | `"auto"` | Tool selection mode: `"auto"` \| `"none"` \| `"required"` |
| `maxLoops` | number | `15` | Max tool-call iterations per turn |
| `maxToolCalls` | number | `7` | Max individual tool calls per iteration |

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
| `doNotWriteToContext` | boolean | `false` | Skip writing to MySQL (e.g. for status flows) |

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
| `transcribeModel` | string | `"gpt-4o-mini-transcribe"` | Global fallback transcription model. Prefer setting `transcribeModel` in `config["core-voice-transcribe"]` for explicit control. |
| `transcribeLanguage` | string | `""` | Force language (ISO 639-1; empty = auto-detect). |
| `transcribeEndpoint` | string | `""` | Transcription API base URL. |
| `transcribeApiKey` | string | — | API key for transcription (if different from `apiKey`). |

---

### 5.4 Avatar Generation

| Parameter | Type | Default | Description |
|---|---|---|---|
| `avatarApiKey` | string | — | API key for avatar generation |
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
  "userAgent":     "Mozilla/5.0 ...",
  "timeoutMs":     30000,
  "maxInputChars": 240000,
  "model":         "gpt-4.1",
  "temperature":   0.2,
  "maxTokens":     18000,
  "aiTimeoutMs":   45000,
  "wordThreshold": 2000,
  "endpoint":      "https://api.openai.com/v1/chat/completions",
  "apiKey":        "YOUR_OPENAI_API_KEY"
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `userAgent` | string | Chrome UA | HTTP User-Agent for page requests |
| `timeoutMs` | number | `30000` | HTTP timeout for page fetch (ms) |
| `maxInputChars` | number | `240000` | Hard character cap on extracted page text |
| `wordThreshold` | number | `2000` | Below this word count: dump mode; above: AI summary |
| `endpoint` | string | — | **Required for summary mode.** Chat completions endpoint |
| `apiKey` | string | — | **Required for summary mode.** API key |
| `model` | string | — | **Required for summary mode.** Model ID |
| `temperature` | number | `0.2` | Sampling temperature for AI summary |
| `maxTokens` | number | `18000` | Max tokens for AI summary |
| `aiTimeoutMs` | number | `45000` | Timeout for AI call (ms) |

---

#### toolsconfig.getImage

Generates images from a natural-language prompt using an OpenAI-compatible Images API.

```json
"getImage": {
  "apiKey":               "YOUR_OPENAI_API_KEY",
  "endpoint":             "https://api.openai.com/v1/images/generations",
  "model":                "dall-e-3",
  "size":                 "1024x1024",
  "n":                    1,
  "publicBaseUrl":        "https://myserver.com/",
  "targetLongEdge":       1152,
  "aspect":               "",
  "enhancerEndpoint":     "https://api.openai.com/v1/chat/completions",
  "enhancerApiKey":       "YOUR_OPENAI_API_KEY",
  "enhancerModel":        "gpt-4o-mini",
  "enhancerTemperature":  0.2,
  "enhancerMaxTokens":    350,
  "enhancerTimeoutMs":    60000
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
| `enhancerEndpoint` | string | Chat URL | Endpoint for the prompt enhancer |
| `enhancerApiKey` | string | — | API key for the prompt enhancer |
| `enhancerModel` | string | `"gpt-4o-mini"` | Model for the prompt enhancer |
| `enhancerTemperature` | number | `0.2` | Temperature for the enhancer |
| `enhancerMaxTokens` | number | `350` | Max tokens for the enhancer |
| `enhancerTimeoutMs` | number | `60000` | Timeout for the enhancer (ms) |

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

Conversation history retrieval and summarisation.

```json
"getHistory": {
  "pagesize":       1000,
  "maxRows":        4000,
  "threshold":      800,
  "model":          "gpt-4.1",
  "temperature":    0,
  "maxTokens":      8000,
  "aiTimeoutMs":    45000,
  "endpoint":       "https://api.openai.com/v1/chat/completions",
  "apiKey":         "YOUR_OPENAI_API_KEY",
  "includeToolRows": false,
  "chunkMaxTokens": 600
}
```

| Parameter | Type | Description |
|---|---|---|
| `pagesize` | number | Rows per page when reading from MySQL |
| `maxRows` | number | Maximum total rows loaded |
| `threshold` | number | Below this char count: dump; above: AI summary |
| `model` | string | Model for AI summary |
| `temperature` | number | Temperature (0 = deterministic) |
| `maxTokens` | number | Max tokens for AI response |
| `aiTimeoutMs` | number | Timeout for AI call (ms) |
| `endpoint` | string | Chat completions endpoint |
| `apiKey` | string | API key |
| `includeToolRows` | boolean | Include tool-call rows in history |
| `chunkMaxTokens` | number | Max tokens per history chunk |

---

#### toolsconfig.getInformation

Semantic cluster search over the stored conversation log.

```json
"getInformation": {
  "clusterRows":           400,
  "padRows":               20,
  "tokenWindow":           5,
  "maxLogChars":           6000,
  "maxOutputLines":        800,
  "minCoverage":           1,
  "eventGapMinutes":       45,
  "stripCode":             false,
  "includeAnsweredTurns":  false,
  "includeAssistantTurns": false
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `clusterRows` | number | `400` | Rows per cluster window |
| `padRows` | number | `20` | Extra context rows to fetch above/below each cluster |
| `tokenWindow` | number | `5` | Token-proximity window for `parts` scoring |
| `maxLogChars` | number | `6000` | Hard per-line character limit (truncates longer content) |
| `maxOutputLines` | number | `800` | Total output line budget across all clusters |
| `minCoverage` | number | `1` | Minimum distinct keyword groups required for a cluster to be included |
| `eventGapMinutes` | number | `45` | Minimum gap (minutes) between clusters to emit a `NEW EVENT` separator |
| `stripCode` | boolean | `false` | Collapse large triple-backtick code blocks (>30 lines) to `«code N lines»` |
| `includeAnsweredTurns` | boolean | `false` | When `true`, skips the `answered_turns` filter — returns ALL user/agent rows including those that already received a bot reply. Required for voice transcripts (discord-voice always generates bot replies). |
| `includeAssistantTurns` | boolean | `false` | When `true`, also includes `role=assistant` rows. Implies `includeAnsweredTurns`. |

> **Context overflow warning:** The defaults (`maxOutputLines: 800`, `maxLogChars: 6000`) can produce very large tool results when a topic appears frequently in the context log. If the AI pipeline hits a context-length error (HTTP 400, 128k tokens exceeded), reduce these values:
> ```json
> "getInformation": { "maxOutputLines": 250, "maxLogChars": 1500, "stripCode": true }
> ```
> The wiki flow applies **hard caps** — values from `core.json` are clamped to wiki-safe maximums:
> - `getInformation`: `maxOutputLines` ≤ 150, `maxLogChars` ≤ 800, `stripCode: true`
> - `getTimeline`: `maxTimelinePeriods` ≤ 10
>
> `getInformation` no longer returns timeline data. Call `getTimeline` separately to get the chronological event history.

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
| `file` | string | *(project root core.json)* | Absolute path to the JSON file to edit. Alias: `configPath` |
| `allowedRoles` | array | `["admin"]` | Roles allowed to view and save the config. Empty array = public |

---

#### config.webpage-chat

Serves the **AI chat SPA** (`GET /chat`) on a dedicated port. AI completions are processed directly within the flow — no external API proxy. Subchannels allow scoped conversation threads per channel, stored in the `chat_subchannels` DB table.

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
      "channelID": "DISCORD_CHANNEL_ID"
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
| `jobs[].channelID` | string | Target Discord channel ID |

---

#### config.context

Controls the rolling-summary backend.

```json
"context": {
  "endpoint":           "https://api.openai.com/v1/chat/completions",
  "model":              "gpt-4o-mini",
  "apiKey":             "YOUR_OPENAI_API_KEY",
  "periodSize":         600,
  "subchannelFallback": false
}
```

| Parameter | Type | Description |
|---|---|---|
| `endpoint` | string | Endpoint for rolling summary generation |
| `model` | string | Model for rolling summary generation |
| `apiKey` | string | API key for rolling summaries |
| `periodSize` | number | Time window in seconds for rolling periods |
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
| `chunkDurationS` | number | `300` | Duration (seconds) of each chunk when splitting large audio files. Files >20 MB are split automatically. |
| `overlapDurationS` | number | `60` | Seconds of audio overlap between consecutive chunks when splitting large files in diarize mode. The overlap is used to match speaker labels across chunks; the overlapping audio is excluded from the final transcript to avoid duplicate text. |
| `transcribeLanguage` | string | `""` | Force a specific language (ISO 639-1). Empty = auto-detect. |
| `transcribeEndpoint` | string | `""` | Base URL for the transcription API. Falls back to `workingObject.transcribeEndpoint` then `OPENAI_BASE_URL`. |
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
  "TTSFetchTimeoutMs": 30000
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `ttsModel` | string | `"gpt-4o-mini-tts"` | TTS model. Falls back to `workingObject.ttsModel` if not set |
| `ttsVoice` | string | `"alloy"` | Default TTS voice. Falls back to `workingObject.ttsVoice` if not set |
| `ttsEndpoint` | string | `""` | TTS API endpoint. Falls back to `workingObject.ttsEndpoint` |
| `ttsApiKey` | string | `""` | API key for TTS. Falls back to `workingObject.ttsApiKey` then `workingObject.apiKey` |
| `ttsFormat` | string | `"opus"` | Audio format. Use `"mp3"` for webpage voice; `"opus"` for Discord playback |
| `TTSFetchTimeoutMs` | number | `30000` | HTTP timeout for TTS API calls (ms) |

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

Browser-based always-on voice interface with meeting recorder. Serves the SPA at `GET /voice` and accepts audio at `POST /voice/audio` (both always-on turns and meeting recordings). The meeting recorder uses `?transcribeOnly=1` to skip AI/TTS and return only the transcript.

```json
"webpage-voice": {
  "flow":                          ["webpage"],
  "port":                          3119,
  "basePath":                      "/voice",
  "silenceTimeoutMs":              2500,
  "maxDurationMs":                 30000,
  "allowedRoles":                  [],
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
| `maxDurationMs` | number | `30000` | Hard cap on a single always-on audio segment (ms) |
| `allowedRoles` | array | `[]` | Roles that may access the voice interface. Empty array = public |
| `channels` | array | `[]` | Channel list shown in the SPA dropdown. Each entry: `{ "id": "...", "label": "..." }`. If empty, a free-text input is shown instead. |

---

#### config.webpage-voice-add-context

Writes the voice transcription to the context DB immediately after transcription (position 00031, before the pipeline stop at 00032). Reads config from `config["webpage-voice-add-context"]`.

```json
"webpage-voice-add-context": {
  "flow": ["webpage"],
  "clearContextBeforeTranscription": false
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `flow` | array | — | Must include `"webpage"` |
| `clearContextBeforeTranscription` | boolean | `false` | When `true`, purges all non-frozen context rows for the channel before storing the transcript. Useful for start-of-session recording. |

---

#### config.webpage-voice-output

Sends TTS audio back to the webpage voice caller. Triggered unconditionally when `wo.isWebpageVoice === true`.

```json
"webpage-voice-output": {
  "flow": ["webpage"]
}
```

| Parameter | Type | Description |
|---|---|---|
| `flow` | array | Must include `"webpage"` |

---

#### config.webpage-router

Maps HTTP endpoints (by port + path prefix) to named flows and sets `wo.channelID` from the request. This runs before `core-channel-config` (module 00010), allowing per-flow `core-channel-config` overrides to apply to web endpoints the same way they apply to Discord channels.

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
| `routes[].channelIdSource` | string | How `wo.channelID` is derived. Strategies: `"query:<param>"` — from URL query string param; `"path:<N>"` — path segment N after the prefix (0-based); any other string — treated as a literal static channel ID |

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
| `ssoPartners` | array | `[]` | List of partner base URLs for cross-domain SSO chaining (e.g. `["https://other.example.com"]`). After login the session is forwarded to each partner using a short-lived single-use token. Leave empty to disable. |

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
| `discord-channel-gate` | discord, discord-voice, discord-admin, api |
| `api-token-gate` | api |
| `discord-gdpr-gate` | discord, discord-voice, discord-admin, webpage |
| `discord-add-context` | discord, discord-voice |
| `discord-trigger-gate` | discord, discord-voice, webpage |
| `discord-reaction-start/finish` | discord |
| `discord-text-output` | all |
| `discord-voice-capture` | discord-voice |
| `core-voice-transcribe` | discord-voice, webpage |
| `core-voice-tts` | discord-voice, webpage |
| `discord-voice-tts-play` | discord-voice |
| `core-ai-completions` | discord-status, discord, discord-voice, api, **bard-label-gen**, webpage |
| `core-ai-responses` | discord-status, discord, discord-voice, api, webpage |
| `core-ai-pseudotoolcalls` | discord-status, discord, discord-voice, api, webpage |
| `core-ai-roleplay` | discord-status, discord, discord-voice, api, webpage |
| `core-output` | all |
| `bard-join` | discord-admin |
| `bard-cron` | bard-label-gen |
| `bard-label-output` | bard-label-gen |
| `webpage-bard` | webpage |
| `webpage-config-editor` | webpage |
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
| `turn_id` | Monotonic ULID (26 characters) |
| `payload` | Message content |
| `channelID` | Channel ID |
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

| Method | Path | Description |
|---|---|---|
| `POST` | `/api` | Submit a request; returns JSON `{ turn_id, response }` |
| `GET` | `/toolcall` | Poll global tool-call status from registry |
| `GET` | `/toolcall?channelID=<id>` | Poll **channel-specific** tool-call status (used by browser extension and chat UI) |

**POST /api request:**
```json
{
  "payload":   "What is the weather in Berlin?",
  "channelID": "optional-channel-id",
  "userId":    "optional-user-id"
}
```

**POST /api response:**
```json
{
  "turn_id":   "01JXXXXXXXXXXXXXXXXXXXXX",
  "channelID": "optional-channel-id",
  "response":  "The weather in Berlin is..."
}
```

---

### 6.5 cron

**File:** `flows/cron.js`
**Purpose:** Executes scheduled jobs based on cron expressions

**Cron format:** `* * * * *` (minute, hour, day, month, weekday).
Also supports `*/N * * * *` (every N minutes).

**Job configuration:** See `config.cron.jobs[]`

**Parallel execution:** Each job runs as a fire-and-forget async IIFE with its own `running` flag. This means long-running jobs (e.g. `discord-status`) do not delay other jobs (e.g. `bard-label-gen`) — all due jobs start concurrently.

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
1. A tool result is deposited into the `status:tool` registry key
2. The flow is triggered and retrieves the result
3. Updates the Discord presence status via `discord-status-apply`

---

### 6.7 webpage (chat module)

**Files:** `flows/webpage.js` + `modules/00048-webpage-chat.js`
**Purpose:** The webpage flow serves **multiple ports simultaneously** (configured via `config.webpage.ports`). Admin modules route by URL path.

**Multi-port:** `config.webpage.ports` is an array — one HTTP server is started per port. Each incoming request sets `wo.http.port` so modules can route by port.

**Chat** (`modules/00048-webpage-chat.js`, `GET /chat`)
- Channel dropdown populated from `webpage-chat.chats[]`
- AI completions processed directly using the global workingObject credentials — no external API proxy
- **Subchannels:** create, rename, and delete separate conversation threads from the UI; each subchannel has its own isolated context history stored in the `chat_subchannels` DB table
- AI behaviour controlled by `systemPrompt`, `contextSize`, `maxTokens` keys in `webpage-chat` config (no separate `ai.*` sub-object)
- Last N context entries loaded from MySQL on channel/subchannel select (controlled by `contextSize`)
- Large scrollable message window (top) + auto-resize input (bottom)
- Enter = send, Shift+Enter = newline
- **Thinking indicator with tool name:** the currently active tool is shown next to the animated dots; polled from `/api/toolcall?channelID=<id>` every 800 ms (per-channel)
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
| `wo.http.requestKey` | string | Registry key where `{ req, res }` is stored |
| `wo.http.response` | object | Set `{ status, headers, body }` here — `webpage-output` sends it |
| `wo.web.menu` | array | Modules push `{ label, port, path }` here for nav cross-linking |
| `wo.jump` | boolean | Set to `true` to stop the normal pipeline loop and jump directly to the ≥9000 output phase (e.g. `core-output`). Use after `setSendNow()` in webpage modules. |
| `wo.stop` | boolean | Hard stop — breaks the normal loop **and** skips the output phase (≥9000). Use when the flow should be aborted entirely with no logging. |

---

### 6.8.1 Adding a new webpage module

New web tools can be added by dropping a single file into `modules/`. No flow changes required.

**Step 1 — Create the module file**

```
modules/NNNNN-webpage-myapp.js
```

Use a number between `00045` and `00049` to run before AI processing, or higher if needed.

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
| **Toolcall display** | Active tool name shown next to the animated thinking dots; polled from `/toolcall?channelID=<id>` every 800 ms (per-channel) |
| **Gallery upload** | Upload images to the bot's Gallery via drag-and-drop or click. Requires `webBaseUrl` to be configured and an active login session on the Jenny web interface. |
| **Auth status bar** | Displays the logged-in username (from the Jenny web session) at the top of the popup. Shows a **Login** link when not authenticated and a **Logout** link when logged in. Requires `webBaseUrl` to be configured. |
| **Options page** | `apiUrl`, `channelID`, `apiSecret`, `webBaseUrl` stored in `chrome.storage.sync` |

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

Add `{ "label": "Browser Extension", "channelID": "browser-extension", "roles": [] }` to `webpage-chat.chats[]` to monitor the extension's chat history in the admin panel.

---

## 7. Module Pipeline

Modules execute in **strict numeric order**. Naming convention: `NNNNN-PREFIX-NAME.js`

Every module is an async function:
```javascript
export default async function myModule(coreData) {
  const { workingObject, logging } = coreData;
  // Read from workingObject, do work, write results back
  // Optional: workingObject.stop = true -> halt pipeline
}
```

---

### 7.1 Pre-Processing (00xxx)

| No. | File | Purpose |
|---|---|---|
| 00005 | `discord-status-prepare` | Reads Discord context; prepares AI-generated status update |
| 00007 | `webpage-router` | Maps HTTP port + path to a named flow and sets `wo.channelID`. Runs before `core-channel-config` so that flow-specific overrides (e.g. different trigger word for `/voice`) can be applied. Config key: `webpage-router`. Active only in `webpage` flow. |
| 00010 | `core-channel-config` | Applies hierarchical channel/flow/user overrides (deep-merge) |
| 00019 | `bard-voice-gate` | Gates the discord-voice flow: if the speaking user is the Bard bot itself (detected by matching user ID against a configured bot ID), the pipeline is stopped so the bot's own music audio is not transcribed |
| 00020 | `discord-channel-gate` | Checks whether the bot is allowed to respond in this channel |
| 00021 | `api-token-gate` | Two-stage API gate: (1) blocks the channel entirely when `apiEnabled=0`; (2) verifies the Bearer token when `apiSecret` is set |
| 00022 | `discord-gdpr-gate` | Enforces GDPR consent; sends disclaimer DM on first contact |
| 00025 | `discord-admin-gdpr` | Handles admin GDPR management commands |
| 00029 | `discord-voice-capture` | Captures PCM from the Discord voice receiver (Opus → PCM via prism-media), applies RMS/ZCR-based VAD, extracts voiced frames, and combines them into a single 16kHz mono WAV. Outputs `wo.audioFile`, `wo.audioStats = {snrDb, usefulMs}`, and `wo.transcribeAudio = true`. Does not make quality decisions — deferred to the transcription module. Only runs when `wo.voiceIntent.action === "describe_and_transcribe"` |
| 00030 | `core-voice-transcribe` | Source-agnostic transcription module. Runs when `wo.transcribeAudio === true`. When `wo.audioStats` is set, applies a quality gate before calling the API. Large files (>20 MB) are split into overlapping chunks (`overlapDurationS` seconds overlap, default 60s); for diarize models, speaker labels are stitched across chunk boundaries by matching speakers in the overlap region to global labels from the previous chunk — matched speakers keep their label (A, B, …), unmatched speakers receive an offset label (e.g. `C_2`). The overlap region is excluded from the output to prevent duplicate text. When `wo.transcribeOnly === true`, uses `transcribeModelDiarize` (default `gpt-4o-transcribe-diarize`). Active in `discord-voice` and `webpage` flows |
| 00031 | `webpage-voice-add-context` | Writes the voice transcription to the context DB immediately after transcription (before 00032 stops the pipeline). Active when `wo.isWebpageVoice === true` and `wo.payload` is set. Reads config from `config["webpage-voice-add-context"]`. Diarized transcripts (`A: text`, `A_2: text`, or legacy `speaker_N: text` lines) are parsed into one DB entry per speaker turn with `role: "user"`, plain text `content`, `userId` = speaker label, `authorName: ""`, `source: "voice-transcribe"`. Offset labels (`A_2`) are stored as-is. When `clearContextBeforeTranscription === true`, purges non-frozen context for the channel first. |
| 00032 | `webpage-voice-transcribe-gate` | For `POST /voice/audio?transcribeOnly=1` (meeting recorder): sends the HTTP 200 JSON response with the transcript directly, then sets `wo.stop = true` so AI and TTS never run. This module runs before `discord-add-files` (which also has prefix 00032 but gates on Discord messages). Active only in `webpage` flow when `wo.isWebpageVoice && wo.transcribeOnly`. |
| 00032 | `discord-add-files` | Extracts file attachments and URLs from Discord messages |
| 00035 | `bard-join` | Processes `/bardstart` and `/bardstop` commands — creates or removes a headless bard session in the registry |
| 00036 | `bard-cron` | Prepares `wo.payload` and AI params for the bard-label-gen flow; hands off to `core-ai-completions` |
| 00040 | `discord-admin-join` | Processes `/join` and `/leave` commands for voice channels |
| 00041 | `webpage-auth` | Discord OAuth2 SSO for webpage ports. Runs passively on every request — reads session cookies and sets `wo.webAuth` (username, userId, role, roles). Login/logout routes handled on the configured `loginPort`. Handles OAuth2 callback and session cookie lifecycle. Non-`/auth/*` requests pass through unchanged. Scope controlled via `cfg.ports` |
| 00043 | `webpage-menu` | Global menu provider for webpage flows. Reads `config["webpage-menu"].items[]`, filters items by `wo.webAuth.role`, and sets `wo.web.menu`. If no role is set, all items without role restriction are shown. Runs before any page module to ensure the menu is always populated |
| 00044 | `webpage-landing` | Landing page at `GET /` on the configured port (default 3111). Renders the role-filtered navigation menu (`wo.web.menu`) and a welcome message with username and role. Unauthenticated requests are redirected to `/auth/login`. Config key: `webpage-landing`. |
| 00045 | `webpage-inpaint` | Redirect `GET /documents/*.png` to the inpainting SPA. The target host is taken from `config["webpage-inpaint"].inpaintHost` — when the value contains a hostname, it is used directly; when it starts with `/`, it is appended to the request's own hostname. |
| 00046 | `webpage-bard` | Bard music library manager SPA (port 3114, `/bard`) — bulk auto-tag upload, tag editor, play-preview buttons, live Now Playing card |
| 00047 | `webpage-config-editor` | JSON config editor SPA; serves `GET /config` and `GET|POST /config/api/config` on the configured port within the webpage flow |
| 00048 | `webpage-chat` | AI chat SPA; serves `GET /chat`, `/chat/api/chats`, `/chat/api/context`, `POST /chat/api/chat`, and subchannel CRUD endpoints (`GET/POST/PATCH/DELETE /chat/api/subchannels`). Before calling any AI module, delegates user-message context writing to `00073-webpage-add-context`. Subchannel names stored in `chat_subchannels` table. |
| 00049 | `webpage-inpainting` | Inpainting SPA; serves `GET /inpainting` and API routes on port 3113 |
| 00050 | `discord-admin-commands` | Processes slash commands and DM admin commands |
| 00051 | `webpage-dashboard` | Live bot telemetry dashboard (port 3115, `/dashboard`) |
| 00052 | `webpage-wiki` | AI-driven Fandom-style wiki (port 3117, `/wiki`) |
| 00053 | `webpage-context` | Context DB editor SPA (port 3118, `/context`) — channel browser, field selector, search, search & replace, bulk delete |
| 00054 | `webpage-documentation` | Documentation viewer (port 3116, `/docs`) |
| 00055 | `core-admin-commands` | Core admin operations (purge, freeze, DB commands) |
| 00056 | `webpage-gallery` | Image gallery SPA (port 3120, `/gallery`) — lists, uploads, and deletes the logged-in user's images stored in `pub/documents/<userId>/`. Integrates with the inpainting SPA via the `inpaintingUrl` config key. |
| 00057 | `webpage-gdpr` | GDPR data-export SPA (port 3121, `/gdpr`) — allows logged-in users to download an Excel file containing their context history, consent records, and stored files. Requires `exceljs` npm package. |
| 00060 | `discord-admin-avatar` | Generates or uploads a bot avatar via DALL-E or URL |
| 00065 | `discord-admin-macro` | Macro management (create, list, delete, run) |
| 00070 | `discord-add-context` | Writes the incoming Discord user message to the context DB (role=user) |
| 00072 | `api-add-context` | Writes the incoming API user message to the context DB (role=user) |
| 00073 | `webpage-add-context` | Writes the incoming webpage chat user message to the context DB (role=user). Called directly by `00048-webpage-chat` before any AI module runs. `userId` is resolved automatically by `setContext` from `wo.webAuth.userId`. |
| 00075 | `discord-trigger-gate` | Filters messages based on trigger words |
| 00080 | `discord-reaction-start` | Adds a progress reaction emoji to the user's message |

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

#### core-ai-completions (01000) — Detailed flow

1. Builds the message array: system prompt → history (if `includeHistory=true`) → current user turn
2. Calls `POST /chat/completions`; loops up to `maxLoops` (default 20):
   - **Tool calls present** → executes each tool, appends results, loops
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

---

### 7.3 Output & Post-Processing (02xxx–08xxx)

| No. | File | Purpose |
|---|---|---|
| 02000 | `moderation-output` | Content filtering; can suppress or replace the response |
| 03000 | `discord-status-apply` | Applies the generated Discord presence status |
| 07000 | `core-add-id` | Tags the response with a context ID before writing to MySQL |
| 08000 | `discord-text-output` | Formats the response as a Discord embed; creates reasoning thread if present |
| 08050 | `bard-label-output` | Parses `wo.response` from `core-ai-completions` in the `bard-label-gen` flow into a **6-position structured label array** `[location, situation, mood1, mood2, mood3, mood4]`. Applies **category-based position rescue**: scans all 6 AI values and assigns each to the correct slot by checking `wo._bardLocations` / `wo._bardSituations` regardless of where the AI placed them (e.g. `'',dungeon,joy,fun,tense,battle` → `dungeon,battle,joy,fun,tense,''`). Unknown words at positions 0/1 are accepted as fallback. Mood slots are validated against `wo._bardValidTags`; invalid entries are replaced with empty string. Writes `bard:labels:{guildId}` and `bard:lastrun:{guildId}` only on success (prevents context window from advancing on AI failure). |
| 08100 | `core-voice-tts` | Source-agnostic TTS renderer. Active in `discord-voice` and `webpage` flows. Parses `[speaker: <voice>]` tags in `wo.response` to split into voice segments, sanitizes text, calls the OpenAI TTS API for each segment (parallel, concurrency 2). Output format is controlled by `wo.ttsFormat` / `cfg.ttsFormat` (default `"opus"` for Discord, `"mp3"` for webpage). Outputs `wo.ttsSegments = [{voice, text, buffer}]` and `wo.ttsDefaultVoice` |
| 08110 | `discord-voice-tts-play` | Discord-specific TTS playback. Runs when `wo.ttsSegments` exists and a voice session is usable. Manages guild-level lock to prevent overlapping speech; plays each segment buffer sequentially via the @discordjs/voice AudioPlayer. Active only in `discord-voice` flow |
| 08200 | `discord-reaction-finish` | Removes the progress reaction; adds a completion reaction |
| 09300 | `webpage-output` | Sends the response back to the webpage flow caller (runs in output phase so it is not skipped by `wo.jump`) |
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
| 10000 | `core-output` | Universal logger; writes the final `workingObject` as JSON to `./pub/debug/` |

---

## 8. Tools — LLM-callable Functions

All tools live in `tools/`. They follow this format:

```javascript
export default {
  name:       "toolName",
  definition: { type: "function", function: { name, description, parameters } },
  invoke:     async (args, coreData) => { /* ... */ return result; }
};
```

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
| `user_prompt` | string | Yes | User question/task against the page text |
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
| `url` | string | Yes | Image URL |
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
| `video_url` | string | For transcript mode | YouTube URL or 11-character video ID |
| `user_prompt` | string | — | Question/task against the transcript (QA mode) |
| `metaOnly` | boolean | — | Return only video metadata |
| `query` | string | For search mode | Search query |
| `max_results` | number | — | Max search results (1–10) |
| `safe_search` | string | — | `"none"` \| `"moderate"` \| `"strict"` |

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
**Purpose:** Retrieve and summarise conversation history from MySQL

**LLM parameters:**

| Parameter | Type | Description |
|---|---|---|
| `channel_id` | string | Channel ID (empty = current channel) |
| `limit` | number | Max rows |
| `user_prompt` | string | Specific question/task against the history |
| `mode` | string | `"dump"` \| `"summary"` \| `"chunks"` |
| `include_tools` | boolean | Include tool-call rows |

---

### getInformation

**File:** `tools/getInformation.js`
**Purpose:** Cluster-based keyword search over the stored conversation log. Returns ranked snippets from fixed-size context windows.

**LLM parameters:**

| Parameter | Type | Description |
|---|---|---|
| `keyword_groups` | array | Preferred: each group has `base`, `variants[]`, and optional `parts[]`. Variants are searched via LIKE for initial candidate selection; parts are used only for proximity scoring within selected clusters. |
| `keywords` | array | Fallback: plain search phrases. Each phrase is used as a full-form LIKE token (no internal splitting). |

**Search behaviour:**

- **SQL candidate scan** (`LIKE '%token%'`) uses **only `variants`** — `parts` are excluded from the SQL scan to avoid false-positive noise from short substrings.
- **`parts`** are used exclusively in `getAnalyzeClusterRows` for proximity scoring: two parts found within `tokenWindow` tokens of each other score as a full hit.
- **`CONTENT_EXPR`** uses JSON-first `COALESCE`: tries `$.content`, `$.message.content`, `$.data.content`, `$.delta.content` from the `json` column, then falls back to the `text` column. This ensures full content is searched, not just the truncated `text` column (which is capped at 500 chars by the indexer).
- **`answered_turns` filter** (default `on`): excludes user/agent rows whose `turn_id` also has a matching `assistant` row in the same channel. This keeps the result set focused on raw, unprocessed transcriptions. Set `includeAnsweredTurns: true` (or `includeAssistantTurns: true`) to disable this filter — required when searching voice transcriptions in channels where the bot always produces a reply.
- **Results ranking:** coverage (distinct keyword groups found) → total hits → multi-group rows → any-group rows; then sorted chronologically per channel for output.
- **Output budget:** controlled by `maxOutputLines` and `maxLogChars`. Clusters below `minCoverage` are silently dropped. A `NEW EVENT` separator is emitted between clusters with a time gap ≥ `eventGapMinutes`.
- **No timeline data** — `getInformation` does not return timeline periods. Call `getTimeline` separately to get the full chronological event history.

**Wiki usage note:**

The wiki flow forces `includeAnsweredTurns: true` and applies hard caps (`maxOutputLines` ≤ 150, `maxLogChars` ≤ 800, `stripCode: true`) to avoid AI context overflow. User config values are clamped to these maximums. See [toolsconfig.getInformation](#toolsconfiggetinformation) for all parameters.

---

### getLocation

**File:** `tools/getLocation.js`
**Purpose:** Google Maps Street View, interactive panorama, and map URL generation

**LLM parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `location` | string | Yes | Address or coordinates |
| `heading` | number | — | Viewing direction (0–360 degrees) |
| `pitch` | number | — | Tilt (-90–90 degrees) |
| `fov` | number | — | Field of view (10–120 degrees) |
| `mode` | string | — | `"streetview"` \| `"map"` \| `"both"` |

---

### getTime

**File:** `tools/getTime.js`
**Purpose:** Return the current time and timezone information

**LLM parameters:**

| Parameter | Type | Description |
|---|---|---|
| `timezone` | string | Timezone, e.g. `"Europe/Berlin"` |

---

### getTimeline

**File:** `tools/getTimeline.js`
**Purpose:** Generate a historical timeline from context data

**LLM parameters:**

| Parameter | Type | Description |
|---|---|---|
| `channel_id` | string | Channel ID (optional) |
| `query` | string | Topic/time-range filter |
| `max_periods` | number | Max time periods |

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

## 9. Core Infrastructure

### 9.1 registry.js — In-Memory Key-Value Store

**Purpose:** Ephemeral runtime data storage (voice sessions, tool-call tracking, client references, etc.)

**API:**
```javascript
import { putItem, getItem, deleteItem, listKeys, clearAll } from "./core/registry.js";

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

**Purpose:** Persistent conversation history with rolling summaries and token budgeting

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

**Subchannel deletion (`setPurgeSubchannel`):** When a subchannel is deleted, non-frozen context entries are permanently deleted. Frozen entries are **promoted** to the main channel (their `subchannel` field is set to `NULL`) so they are preserved and become part of the main context.

**Purge/Freeze scoping:** `setPurgeContext` and `setFreezeContext` respect the same filter. The channel-wide timeline rows are only affected when targeting the full channel (not a specific subchannel).

**Internal meta frames:** `setContext()` silently discards any record where `record.internal_meta === true`. Meta frames are generated dynamically at retrieval time by `getContext()` and injected into the AI context window; they are never stored in MySQL. This prevents ghost entries (e.g. `[assistant] Jenny` index strings) from appearing in the database or the chat UI.

**`getContextSince`** is used by the Bard cron job (`00036-bard-cron.js`) to read chat that occurred since the job last ran. This avoids a fixed time window and ensures no messages are missed even if the cron interval stretches.

```javascript
// Example: read context since a registry-stored timestamp
const lastRun = await getItem("bard:lastrun:guildId"); // { ts: "2026-03-07T..." }
const rows = lastRun?.ts
  ? await getContextSince(wo, lastRun.ts)          // since last run
  : await getContextLastSeconds(wo, 300);           // fallback: last 5 minutes
```

**Rolling summaries:**
- Messages are grouped into time windows (`periodSize` seconds)
- After a period closes, an LLM summary is generated
- Raw messages are replaced by the summary (storage optimisation)

**Token budgeting:**
- Context is trimmed until it fits within `contextTokenBudget`
- Blocked users receive a token budget of 1

---

### 9.3 logging.js — Structured Logging

**Purpose:** Append structured log entries to `workingObject.logging[]`

**API:**
```javascript
import { getLog } from "./core/logging.js";

const log = getLog("my-module");
log.info("Processing started", { userId });
log.warn("Rate limit hit");
log.error("API call failed", err);
```

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

The final log is written to `./pub/debug/` by module `10000-core-output`.

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

### Table: timeline_periods

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED AUTO_INCREMENT | Primary key |
| `channel_id` | VARCHAR(128) | Discord channel ID |
| `start_idx` | INT | First ctx_id of this period |
| `end_idx` | INT | Last ctx_id of this period |
| `start_ts` | DATETIME | Period start timestamp |
| `end_ts` | DATETIME | Period end timestamp |
| `summary` | TEXT | AI-generated summary |
| `model` | VARCHAR(64) | Summary model used |
| `checksum` | CHAR(64) | SHA256 of the original messages |
| `frozen` | TINYINT(1) | 1 = protected from deletion |

### Table: gdpr

| Column | Type | Description |
|---|---|---|
| `user_id` | VARCHAR(64) | Discord user ID |
| `channel_id` | VARCHAR(128) | Discord channel ID |
| `chat` | TINYINT(1) | 1 = text consent granted |
| `voice` | TINYINT(1) | 1 = voice consent granted |
| `disclaimer` | TINYINT(1) | 1 = notice seen |
| `updated_at` | TIMESTAMP | Last change timestamp |

---

## 14. Reverse Proxy (Caddy)

Jenny runs multiple HTTP servers on different ports. A reverse proxy (Caddy) consolidates them under a single domain with automatic HTTPS.

The Caddyfile lives at `/etc/caddy/Caddyfile` (Linux) or `W:\etc\caddy\Caddyfile` (Windows dev). Reload with `systemctl reload caddy` after changes.

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
| `/` (root) | — | redirects to `/chat` (302) |

**Access control for unknown paths:**

- Requests from known VPN/LAN IP ranges (`10.99.0.0/24`, `10.99.1.0/24`, `192.168.178.0/24`, `127.0.0.1/8`) receive a `404 Not Found` response for any path not matched above.
- All other requests (public internet) receive an HTTP Basic Auth challenge (`401`) for any unmatched path. Only after successful Basic Auth do they receive `404 Not Found`.

**Caddyfile structure (jenny.* block):**

```
jenny.ralfreschke.de, jenny.xbullseyegaming.de {
    header -Alt-Svc

    @allowed remote_ip 10.99.0.0/24 10.99.1.0/24 192.168.178.0/24 127.0.0.1/8

    @auth      { path /auth /auth/* }
    @config    { path /config /config/* }
    @chat      { path /chat /chat/* }
    @inpainting{ path /inpainting /inpainting/* }
    @bard      { path /bard /bard/* }
    @dashboard { path /dashboard /dashboard/* }
    @docs      { path /docs /docs/* }
    @wiki      { path /wiki /wiki/* }
    @context   { path /context /context/* }
    @voice     { path /voice /voice/* }

    handle @auth       { reverse_proxy 127.0.0.1:3111 }
    handle @config     { reverse_proxy 127.0.0.1:3111 }
    handle @chat       { reverse_proxy 127.0.0.1:3112 }
    handle @inpainting { reverse_proxy 127.0.0.1:3113 }
    handle @bard       { reverse_proxy 127.0.0.1:3114 }
    handle @dashboard  { reverse_proxy 127.0.0.1:3115 }
    handle @docs       { reverse_proxy 127.0.0.1:3116 }
    handle @wiki       { reverse_proxy 127.0.0.1:3117 }
    handle @context    { reverse_proxy 127.0.0.1:3118 }
    handle @voice      { reverse_proxy 127.0.0.1:3119 }

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

| Port | Service |
|---|---|
| 3400 | Main API + health endpoint (`ralfreschke.de/api`, `/health`, `/toolcall`) |
| 3111 | Config Editor (`/config`) + Auth (`/auth`) |
| 3112 | Chat SPA (`/chat`) |
| 3113 | Inpainting SPA (`/inpainting`) + document serving |
| 3114 | Bard UI (`/bard`, `/bard-admin`) |
| 3115 | Live Dashboard (`/dashboard`) |
| 3116 | Documentation (`/docs`) |
| 3117 | AI Wiki (`/wiki`) |
| 3118 | Context Editor (`/context`) |
| 3119 | Webpage Voice Interface (`/voice`) |

---

## 15. Discord Bot Permissions

### Jenny the Bot (main bot)

- In the Discord Developer Portal, enable **Message Content Intent** under Privileged Gateway Intents.
- Intents used: `Guilds`, `GuildMessages`, `MessageContent`, `GuildVoiceStates`, `DirectMessages`
- Required bot permissions: Send Messages, Read Message History, Embed Links, Attach Files, Use Slash Commands, Connect, Speak, Use Voice Activity
- Recommended invite: use Administrator permission for the simplest setup.

Invite URL template:
```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=8&scope=bot+applications.commands
```

---

## 16. Web Modules

### 16.1 Overview

| Module File | Port | URL Prefix | Config Key | Purpose |
|---|---|---|---|---|
| `00047-webpage-config-editor.js` | 3111 | `/config` | `webpage-config-editor` | Visual config editor — collapsible cards, tag chips, password fields, add/remove attributes and blocks |
| `00048-webpage-chat.js` | 3112 | `/chat` | `webpage-chat` | Chat history viewer and message sender |
| `00049-webpage-inpainting.js` | 3113 | `/inpainting` | `webpage-inpainting` | Image inpainting single-page app |
| `00046-webpage-bard.js` | 3114 | `/bard` | `webpage-bard` | Bard music library manager |
| `00051-webpage-dashboard.js` | 3115 | `/dashboard` | `webpage-dashboard` | Live bot telemetry dashboard |
| `00054-webpage-documentation.js` | 3116 | `/docs` | `webpage-documentation` | Renders the project documentation as HTML pages |
| `00052-webpage-wiki.js` | 3117 | `/wiki` | `webpage-wiki` | AI-driven Fandom-style wiki, per-channel, with DALL-E images |
| `00047-webpage-voice.js` | 3119 | `/voice` | `webpage-voice` | Browser push-to-talk voice interface |
| `00053-webpage-context.js` | 3118 | `/context` | `webpage-context` | Context DB editor — browse, search, search & replace, bulk-delete conversation rows |
| `00056-webpage-gallery.js` | 3120 | `/gallery` | `webpage-gallery` | Image gallery — browse, upload and delete the logged-in user's generated images |
| `00057-webpage-gdpr.js` | 3121 | `/gdpr` | `webpage-gdpr` | GDPR data export — download personal data as Excel (context, consent, files) |

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

### 16.3 Chat SPA (`/chat`)

**Chat (port 3112, /chat):**
- `GET /chat` — renders the chat SPA
- `GET /chat/style.css` — serves shared CSS
- `GET /chat/api/chats` — returns list of available chat channels (role-filtered)
- `GET /chat/api/messages?channelID=xxx` — fetches message history for a channel
- `POST /chat/api/messages` — sends a message to a Discord channel

### 16.4 Inpainting SPA (`/inpainting`)

**Inpainting (port 3113, /inpainting):**
- `GET /inpainting` — renders the inpainting SPA
- `GET /inpainting/style.css` — serves shared CSS
- `POST /inpainting/api/inpaint` — handles image inpainting requests
- `GET /inpainting/auth/token` — generates auth token for deep links
- `GET /documents/*.png` — redirected here by module 00045

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

**Bard (port 3114, /bard):**
- `GET /bard` — renders the music library manager UI
- `GET /bard/style.css` — serves shared CSS
- `GET /bard/api/library` — returns `{tracks: [...], files: [...]}`
- `POST /bard/api/autotag-upload` — bulk upload: saves MP3, queries Tavily for song context, calls LLM to generate 6 structured tags (`[location, situation, mood1, mood2, mood3, mood4]`), writes library.xml entry. Returns `{ok, filename, title, tags}`. Requires `config["webpage-bard"].autoTag.enabled = true`.
- `POST /bard/api/tags` — updates track metadata (title, tags, volume)
- `DELETE /bard/api/track` — deletes a track and its MP3 file

### 16.6 Live Dashboard (`/dashboard`)

**Dashboard (port 3115, /dashboard):**
- `GET /dashboard` — renders the live bot telemetry dashboard (role-gated)
- Page auto-refreshes every `refreshSeconds` seconds (default: 5)
- Data source: `dashboard:state` registry key, written by `main.js` every 2 seconds

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
- `GET /wiki/{channelId}` — channel homepage (search bar + recent articles)
- `GET /wiki/{channelId}/{slug}` — article page (Fandom-style layout)
- `GET /wiki/{channelId}/{slug}/edit` — editor/admin: edit form
- `GET /wiki/{channelId}/search?q=` — search; always shows results overview (even with a single hit); no hit triggers generation automatically for creator/admin
- `GET /wiki/{channelId}/images/{filename}` — serves uploaded images
- `POST /wiki/{channelId}/api/generate` — AJAX generate (creator/admin); body `{query, force?}`; without `force`: returns `{ok,slug,existing:true}` or `{ok,results:[]}` if matches found; with `force:true`: always generates a new article, ignoring existing matches; returns `{ok,slug,generated:true}`
- `POST /wiki/{channelId}/api/upload-image/{slug}` — editor/admin: upload image for article (JSON `{base64,ext}`)
- `POST /wiki/{channelId}/{slug}/edit` — editor/admin: save edited article (JSON body)
- `DELETE /wiki/{channelId}/api/article/{slug}` — editor/admin: delete article row

**core.json — `webpage-wiki` section:**
```jsonc
"webpage-wiki": {
  "flow": ["webpage"],
  "port": 3117,
  "basePath": "/wiki",
  "overrides": {                              // global defaults — apply to all channels
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

**AI settings** are configured via the `overrides` block in `config["webpage-wiki"]`. A **global `overrides`** block sets defaults for all channels; each channel may additionally define its own `overrides` block — channel values win. All keys are optional — unset values fall back to the built-in defaults. The module reads exclusively from its own config section and never from `core-channel-config`. Image generation requires `toolsconfig.getImage.publicBaseUrl` to be set — without it images are saved to disk but the URL stored in the DB is `null`.

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
| `overrides.tools` | array | `["getImage","getTimeline","getInformation"]` | Tools available to the AI |
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
- `getInformation`, `getTimeline`, and **`getImage`** are all **mandatory** in the built-in prompt; AI uses **only tool results** as facts; events always in **chronological order**
- **Article expiry:** only articles that have **never been manually edited** (`updated_at IS NULL`) are subject to the TTL. Once an article is edited it is permanently retained. Expired articles are pruned on each request and in the background. All users always see a colour-coded expiry badge on unedited articles (green > 5 days, yellow ≤ 5 days, orange ≤ 2 days / expired); no badge on edited articles.
- **Edit form** (editor only): title, intro, sections (JSON), infobox (JSON), categories, related terms, image URL + drag-and-drop upload (max 8 MB)
- **Search page:** non-creators see results only; auto-generation spinner only shown to creators
- **Image generation** is mandatory per article (`getImage` is a required step in the AI prompt). AI-generated images → `pub/documents/`; uploaded images → `pub/wiki/{channelId}/images/`. Requires `toolsconfig.getImage.publicBaseUrl` to be configured.
- Articles stored in MySQL table `wiki_articles` (auto-created on first start; `model` column added automatically via migration)
- Add `3117` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`

#### WorkingObject Handling (Article Generation)

The wiki module does **not** use the main `workingObject` for its AI calls. Instead, `callPipelineForArticle` constructs a **synthetic `workingObject`** by spreading the merged overrides (global `overrides` + channel `overrides`, channel wins) and passing it directly to the selected core-ai module. This means:

- The wiki AI call is fully isolated from the Discord/API flow context
- All AI parameters (`model`, `temperature`, `maxTokens`, `tools`, `systemPrompt`, `persona`, `instructions`, `contextSize`, …) come exclusively from the merged overrides
- `wo.useAiModule` selects the AI backend (`completions` / `responses` / `pseudotoolcalls`)
- `wo.channelID` is set to the wiki's channel ID for `getInformation` / `getTimeline` tool calls and for native context loading
- `wo.doNotWriteToContext = true` — article generation never writes to the conversation context
- `wo.includeHistory` — controlled by `overrides.includeHistory` (default `false`); when `true`, core-ai loads recent channel messages as context via `channelID` (see warning below)
- `wo.payload` = `"Topic: <query>"` (becomes the article subject)
- `wo.flow = "webpage"` — tools like `getInformation` and `getTimeline` use `wo.channelID` directly

This pattern allows the wiki to reuse the shared AI pipeline (with full tool-call support, multi-loop retries, etc.) without coupling its AI parameters to the global `workingObject` defaults.

> **⚠️ `includeHistory: true` and JSON format**
>
> When `includeHistory: true`, core-ai injects the channel's recent Discord conversation as message history into the AI context. This history consists of plain conversational turns (user/assistant chat). Some models pick up on this pattern and respond in conversational plain text instead of the required JSON — even though the system prompt mandates JSON output.
>
> The default is `includeHistory: false`. If you enable it and article generation fails with `"AI returned no valid JSON article"` and the response is plain prose, set it back to `false`. The AI will then receive context only via `getInformation` and `getTimeline` tool calls, which is the safer default for JSON-format compliance.

#### System Prompt and Image Generation

The built-in system prompt (`DEFAULT_WIKI_SYSTEM_PROMPT`) instructs the AI to call `getInformation`, `getTimeline`, and `getImage` — in that order — before writing the article. **`getImage` is mandatory**: the AI is explicitly told that an article without `imageUrl` is incomplete.

**Why images are sometimes skipped:** The default prompt tells the AI to use `imageAlt` (an output field it has not yet written) as the `getImage` prompt. Under tight `maxLoops` budgets the AI may defer `getImage` to a later loop and then run out of budget. The fix is a custom `systemPrompt` that instructs `getImage` to be called in step 3 with an independently composed prompt — not tied to the output JSON.

**Recommended channel override for reliable image generation:**

```json
"overrides": {
  "maxLoops": 7,
  "systemPrompt": "<paste custom prompt here>"
}
```

The custom prompt should:
1. Call `getInformation` first (up to 2 times with alternate keywords if needed)
2. Call `getTimeline`
3. Call `getImage` in step 3 — with a prompt composed directly from topic name + key traits found in steps 1–2 — **before writing any article text**
4. Only then write and output the JSON article

With `maxLoops: 7` there is enough budget for 2× `getInformation` + `getTimeline` + `getImage` + the final JSON response. At `maxLoops: 5`, if the AI uses two `getInformation` calls, `getImage` may be cut due to budget exhaustion.

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
| `infobox.imageUrl` | string\|null | yes | URL returned by `getImage` (`files[0].url`). **Must be set**; `null` only if `getImage` fails |
| `infobox.fields` | array | — | Key–value pairs displayed in the sidebar infobox |
| `categories` | array | — | Category tags (strings) |
| `relatedTerms` | array | — | Related article slugs or search terms shown as links |

`infobox.imageUrl` is also mapped to `article.image_url` in the DB (`wiki_articles.image_url`). If the AI returns the URL in `infobox.imageUrl` but not in a top-level `image_url`, the module copies it automatically.

**Model attribution:** The `wiki_articles` table includes a `model` column (VARCHAR 256, added automatically via `ALTER TABLE … ADD COLUMN IF NOT EXISTS` on first start). When an article is generated, the LLM model ID used (`wo.model` at the time of the AI call) is stored there. The article page renders a small *"Generated by \<model\>"* note at the bottom of the main content area. Manually edited articles retain the model value from their initial generation; the edit form does not overwrite it.

### 16.9 Context Editor (`/context`)

**Context Editor (port 3118, /context):**
- `GET /context` — renders the Context DB editor SPA (admin only)
- `GET /context/style.css` — serves CSS
- `GET /context/api/channels` — returns `{channels: [{id, cnt}]}` — all distinct channel IDs with row counts, via SQL `GROUP BY`
- `GET /context/api/columns` — returns `{columns: [{name, type}]}` — column names and types from `INFORMATION_SCHEMA.COLUMNS`
- `GET /context/api/records?channel=&page=&limit=&fields=` — paginated record list; returns `{rows, total, page, pages}`
- `GET /context/api/search?q=&channel=&fields=&searchFields=` — full-text search in `text` and/or `json` column; paginated
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
| Search | Searches the `text` column (default). Results replace the normal record list in-place with a "Clear" button to return. |
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

### 16.9a Webpage Voice Interface (`/voice`)

**File:** `modules/00047-webpage-voice.js`
**Port:** 3119
**Config key:** `webpage-voice`

A browser-based voice interface with two modes: **always-on continuous listening** and a **meeting recorder**. Both modes can run simultaneously. Both use the same `POST /voice/audio` endpoint. Always-on runs the full transcription → AI → TTS pipeline and returns spoken audio; the meeting recorder uses `?transcribeOnly=1` to skip AI/TTS and return only the diarized transcript.

**Concurrent use:** When both modes are active, each uses its own independent microphone stream so that stopping one mode never interrupts the other. The volume meter is driven by whichever mode is currently active (rec takes over when always-on is stopped).

#### HTTP Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/voice` | Serves the SPA (embedded HTML/CSS/JS, no external dependencies) |
| `POST` | `/voice/audio?channelId=<id>` | Always-on turn: receives a short audio segment (webm/ogg/mp3), converts to 16kHz mono WAV, runs the full transcription → AI → TTS pipeline, returns MP3 with `X-Transcript` and `X-Response` headers |
| `POST` | `/voice/audio?channelId=<id>&transcribeOnly=1` | Meeting recorder: receives the full meeting audio, transcribes with `transcribeModelDiarize` (default `gpt-4o-transcribe-diarize`), writes speaker-labelled transcript to context DB, returns `{ "transcript": "A: ...\nB: ..." }` |

#### SPA buttons

| Button | Behaviour |
|---|---|
| **Mic button** (always-on) | Click once to start continuous listening mode. Jenny sends audio automatically after silence and plays the response back. Click again to stop. Pulsing animation and volume meter indicate active state. |
| **REC button** (meeting recorder) | Click to start recording. Click again to stop and trigger transcription. The recorder always opens its own microphone stream independently of the always-on mic, so both modes can run simultaneously without interfering. The volume meter stays active as long as either mode is recording. The spinner shows while the transcript is being processed. The diarized transcript is stored in the channel context DB — one entry per speaker paragraph, with `userId` = speaker label (`A`, `B`, `A_2` for uncertain cross-chunk speakers, …) and `content` = spoken text. |

#### WorkingObject fields set by this module

| Field | Value | Description |
|---|---|---|
| `wo.channelID` | from `?channelId=` query param | Channel for AI context |
| `wo.audioFile` | path to converted WAV | Input for `core-voice-transcribe` |
| `wo.transcribeAudio` | `true` | Triggers transcription |
| `wo.synthesizeSpeech` | `true` | Triggers TTS rendering (always set; 00032 stops the pipeline before TTS runs for `transcribeOnly`) |
| `wo.ttsFormat` | `"mp3"` | Overrides the default `"opus"` — browser playback requires MP3 |
| `wo.isWebpageVoice` | `true` | Triggers voice pipeline modules |
| `wo.transcribeOnly` | `true` | Set when `?transcribeOnly=1`; stops pipeline after transcription |
| `wo.isAlwaysOn` | `true` | Set when `?alwaysOn=1` (always-on mic mode) |

#### Full always-on pipeline

```
POST /voice/audio?channelId=<id>
 → 00028-webpage-voice-input    (set wo.audioFile, wo.channelID, wo.synthesizeSpeech, etc.)
 → 00030-core-voice-transcribe  (transcribe WAV → wo.payload, model: transcribeModel)
 → 00031-webpage-voice-add-context  (write one DB entry per speaker turn to context DB)
 → 00070-discord-add-context    (load context window for AI)
 → core-ai-completions          (generate response → wo.response)
 → 08100-core-voice-tts         (render TTS → wo.ttsSegments, format: mp3)
 → 09320-webpage-voice-output   (send MP3 audio as HTTP response)
```

#### Meeting recorder pipeline

```
POST /voice/audio?channelId=<id>&transcribeOnly=1
 → 00028-webpage-voice-input    (set wo.audioFile, wo.channelID, wo.transcribeOnly=true)
 → 00030-core-voice-transcribe  (transcribe WAV → wo.payload, model: transcribeModelDiarize)
 → 00031-webpage-voice-add-context  (purge if configured, write one DB entry per speaker turn)
 → 00032-webpage-voice-transcribe-gate  (send HTTP 200 {transcript: ...}, set wo.stop=true)
 [AI and TTS skipped]
```

#### core.json configuration

```json
"webpage-voice": {
  "flow":                            ["webpage"],
  "port":                            3119,
  "basePath":                        "/voice",
  "silenceTimeoutMs":                2500,
  "maxDurationMs":                   30000,
  "clearContextBeforeTranscription": false,
  "allowedRoles":                    [],
  "channels": [
    { "id": "YOUR_CHANNEL_ID", "label": "General" }
  ]
},
"core-voice-transcribe": {
  "flow":                   ["discord-voice", "webpage"],
  "transcribeModel":        "gpt-4o-mini-transcribe",
  "transcribeModelDiarize": "gpt-4o-transcribe-diarize",
  "chunkDurationS":         300,
  "transcribeApiKey":       ""
},
"webpage-voice-output": {
  "flow": ["webpage"]
}
```

- Add `3119` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`
- Add `reverse_proxy /voice* localhost:3119` to your Caddyfile
- See `config.webpage-router` to assign flow-specific `core-channel-config` overrides to `/voice` requests
- `clearContextBeforeTranscription: true` purges all non-frozen context rows for the channel before the meeting transcript is stored — useful for "start-of-session" mode
- The diarize model (`gpt-4o-transcribe-diarize`) is used automatically when `?transcribeOnly=1`; the regular model is used for always-on turns

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
| `?id=<channelID>` | Sets the callback channel ID for origin whitelisting |

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
reverse_proxy /inpainting*  localhost:3113
reverse_proxy /documents*   localhost:3113
```

Module `00045-webpage-inpaint.js` redirects `GET /documents/*.png` requests to the inpainting SPA so that images served by the bot can be opened directly in the editor.

**`inpaintHost` configuration (module `00045`):**

```json
"webpage-inpaint": {
  "flow":        ["webpage"],
  "inpaintHost": "jenny.example.com/inpainting"
}
```

When `inpaintHost` contains a hostname (does not start with `/`), the redirect target is derived directly from that value. When `inpaintHost` starts with `/`, it is appended to the hostname from the incoming HTTP request. This allows the same config to work whether you access the bot via `http://localhost` during development or via `https://jenny.example.com` in production.

Set `inpaintHost` to match the public URL of the inpainting SPA (without `https://`), e.g. `"jenny.example.com/inpainting"`.

---

### 16.10 Authentication & SSO (`/auth`)

**File:** `modules/00041-webpage-auth.js`
**Config key:** `webpage-auth`

Provides Discord OAuth2 SSO (Single Sign-On) for all web modules. Runs as a **passive module** — it processes every request on listed ports, sets `wo.webAuth` if a valid session cookie is present, and lets the request continue normally. It does not block or respond unless the URL is an `/auth/*` route.

`userId` is **not** copied to `wo.userId` by this module. Instead, `setContext` in `core/context.js` reads `wo.webAuth.userId` directly when writing to the DB, so no per-module fallback chains are needed.

**Routes:**
- `GET /auth/login` — redirects to Discord OAuth2 authorize URL
- `GET /auth/callback` — handles OAuth2 code exchange, sets session cookie, redirects to `/`
- `GET /auth/logout` — clears session cookie, redirects to `/`

**`wo.webAuth` object (set on authenticated requests):**
```json
{ "username": "alice", "userId": "123456789", "role": "admin", "roles": ["admin", "staff"] }
```

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

**File:** `modules/00043-webpage-menu.js`
**Config key:** `webpage-menu`

Sets `wo.web.menu` for every webpage request. Menu items are defined globally in `config["webpage-menu"].items[]` and filtered by the user's role before being passed to individual modules. Each module calls `getMenuHtml(wo)` to render the nav bar.

**core.json configuration:**
```json
"webpage-menu": {
  "flow": ["webpage"],
  "items": [
    { "text": "💬 Chat",          "link": "/chat"      },
    { "text": "🖼 Inpainting",    "link": "/inpainting"},
    { "text": "🎵 Bard",          "link": "/bard",       "roles": ["admin"] },
    { "text": "📊 Dashboard",     "link": "/dashboard",  "roles": ["admin"] },
    { "text": "⚙️ Config",         "link": "/config",     "roles": ["admin"] },
    { "text": "📚 Docs",           "link": "/docs"       },
    { "text": "📖 Wiki",           "link": "/wiki"       },
    { "text": "🗄 Context",        "link": "/context",    "roles": ["admin"] }
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

### Authentication (`00041-webpage-auth.js`)

This module runs for every request on ports listed in `config["webpage-auth"].ports`. It reads session cookies, looks up the user in the configured user store, and sets `wo.webAuth`:

```json
{ "username": "alice", "userId": "123", "role": "admin", "roles": ["admin", "staff"] }
```

If no valid session cookie is present, `wo.webAuth` is not set (or has empty fields). Unauthenticated users can still access the site — individual modules decide whether to allow or deny them.

### Navigation Menu (`00043-webpage-menu.js`)

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

| `allowedRoles` config | User has matching role | Result |
|---|---|---|
| Empty array `[]` or not set | — | **Always accessible** (public) |
| Non-empty, e.g. `["admin"]` | Yes | **Accessible** |
| Non-empty, e.g. `["admin"]` | No | **Access Denied** (403 or HTML error page) |
| Non-empty, e.g. `["admin"]` | No role (unauthenticated) | **Access Denied** |

> **Key difference from menu:** The page access check does **not** have a fallback for unauthenticated users. If `allowedRoles` is set, users without a matching role are denied — including unauthenticated users.

### Summary

| Component | Empty roles config | Unauthenticated fallback |
|---|---|---|
| Menu item | Always shown | Always shown (fallback) |
| Page content | Always accessible | Always accessible (no restriction) |
| Page content (roles set) | N/A | Access Denied |

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

The following template shows the standard pattern for a new webpage module.

```javascript
/************************************************************************************/
/* filename: webpage-mymodule.js                                                    */
/* Version 1.0                                                                      */
/* Purpose: Description of what this module does.                                   */
/************************************************************************************/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMenuHtml, isAuthorized } from "../shared/webpage/interface.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const MODULE_NAME = "webpage-my-module";

export default async function getWebpageMyModule(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "webpage") return coreData;
  const cfg = coreData?.config?.[MODULE_NAME] || {};
  const port = Number(cfg.port ?? 3116); // pick the next available port
  if (Number(wo.http?.port) !== port) return coreData;

  const method  = String(wo.http?.method ?? "GET").toUpperCase();
  const urlPath = String(wo.http?.path ?? "/").split("?")[0];
  const basePath = String(cfg.basePath ?? "/mymodule");

  /* --- CSS --- */
  if (method === "GET" && urlPath === basePath + "/style.css") {
    wo.http.response = { status: 200, headers: { "Content-Type": "text/css" },
      body: fs.readFileSync(path.resolve(__dirname, "../shared/webpage/style.css"), "utf-8") };
    wo.jump = true;
    return coreData;
  }

  /* --- Main page --- */
  if (method === "GET" && (urlPath === basePath || urlPath === basePath + "/")) {
    wo.http.response = { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" },
      body: "<html>...</html>" };
    wo.jump = true;
    return coreData;
  }

  return coreData;
}
```

**core.json configuration entry:**
```json
"webpage-my-module": {
  "flow": ["webpage"],
  "port": 3116,
  "basePath": "/mymodule",
  "allowedRoles": ["admin"]
}
```

**Steps to register the module:**

1. **Add port** to `config.webpage.ports[]` in core.json:
   ```json
   "webpage": { "ports": [3000, 3111, 3112, 3113, 3114, 3115, 3116] }
   ```

2. **Add Caddy route** (prepend to the existing block, before `reverse_proxy * localhost:3400`):
   ```
   reverse_proxy /mymodule*  localhost:3117
   ```

3. **Add menu entry** in `config["webpage-menu"].items[]`:
   ```json
   { "text": "My Module", "link": "/mymodule", "roles": ["admin"] }
   ```
   Omit `"roles"` (or leave it as `[]`) to make the menu item visible to everyone.

4. **Set `allowedRoles`** in the module config:
   - `"allowedRoles": []` — page is public (no login required)
   - `"allowedRoles": ["admin"]` — only users with the `admin` role can access the page

See [§16.12 Permission Concept](#1612-permission-concept) for the full rules.

---

## 17. Bard Music System

### Overview

The bard music system automatically plays mood-appropriate background music for tabletop RPG sessions. It runs as a **headless scheduler** — no second Discord bot is required. A cron job analyzes the chat context at every run using an LLM, generates 6 structured labels (`location, situation, mood1–4`), and stores them in the registry. `flows/bard.js` polls the registry every 5 seconds (configurable via `pollIntervalMs`) and switches music when the current track no longer matches the active labels. Audio is served to the browser via the web player at `/bard` or `/bard-stream`.

### Architecture

```
/bardstart command
  -> 00035-bard-join.js
  -> creates a headless session in the registry (no voice channel connection needed)
  -> stores bard:session:{guildId} = { guildId, textChannelId, status: "ready", ... }
  -> does NOT write bard:labels — empty labels cause getSelectSong to pick a random
     track on the first poll, which is the correct startup behaviour. The cron job
     writes real structured labels (location/situation/moods) on its first run.

/bardstop command
  -> 00035-bard-join.js
  -> cancels the track advancement timer (session._trackTimer)
  -> removes bard:session:{guildId}, bard:labels:{guildId}, bard:nowplaying:{guildId},
     bard:stream:{guildId} from registry

Cron job (every N minutes, flow: bard-label-gen)
  -> 00036-bard-cron.js (preparer)
     - reads bard:lastrun:{guildId} from registry
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
     - carry-forward for empty slots: prev labels → current song's trackTags → random from allowed list
     - writes bard:labels:{guildId} to registry
     - writes bard:lastrun:{guildId} only on success (prevents context window from advancing on AI failure)

flows/bard.js (polls every N seconds, min 5 s) — headless scheduler
  -> reloads library.xml from disk on every cycle (picks up newly added tracks without restart)
  -> no active sessions → stop
  -> for each active session:
     - reads bard:labels:{guildId} for current mood
     - reads bard:nowplaying:{guildId} for current track
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
     - song found: writes bard:stream:{guildId} and bard:nowplaying:{guildId},
       calls ffprobe to get duration, schedules setTimeout(triggerPoll, durationMs + 200)
     - no song found: clears bard:stream:{guildId}

Track end timer — song ended naturally
  -> setTimeout fires after ffprobe duration + 200 ms
  -> clears session._trackEndAt, calls triggerPoll()
  -> poll selects next track and overwrites bard:stream:{guildId} and bard:nowplaying:{guildId}
     atomically. bard:stream is never cleared on song-end — the poll overwrites it when the
     next track starts. This prevents the browser Now Playing card from briefly seeing null.
```

### Registry Keys

| Key | Contents |
|-----|---------|
| `bard:registry` | `{ list: ["bard:session:{guildId}"] }` |
| `bard:session:{guildId}` | `{ guildId, textChannelId, status, _trackEndAt, _trackTimer, _lastPlayedFile, _lastLabels }` |
| `bard:labels:{guildId}` | `{ labels: ["tavern","combat","dark","tense","intense","battle"], rejected: ["unknowntag"], updatedAt, guildId }` — written by the cron job after each LLM classification. `labels[0]` = location, `labels[1]` = situation, `labels[2–5]` = 4 mood tags; empty string = wildcard. `rejected` = mood tokens returned by the LLM that are not in the library (up to 5). **Not written on `/bardstart`** — absence of labels causes the first poll to pick a random track. Deleted on `/bardstop`. |
| `bard:nowplaying:{guildId}` | `{ file, title, labels, startedAt }` |
| `bard:stream:{guildId}` | `{ guildId, file, title, labels, trackTags, rejectedLabels, startedAt, musicDir }` — `labels` = current AI mood tags; `trackTags` = the track's own tags from `library.xml`; `rejectedLabels` = LLM tokens not in the library (shown red in Now Playing). Overwritten atomically when a new track starts. **Never cleared on song-end** — the poll overwrites it when the next track begins. Only removed on `/bardstop` or when the library is empty and nothing can be played. Read by the Now Playing card in `webpage-bard`. |
| `bard:lastrun:{guildId}` | `{ ts: "2026-03-07T...", guildId }` — timestamp written by `bard-label-output` **only after a successful label write**. On AI failure the timestamp is not updated, so the next run retries from the same context window. |

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
- `volume`: Playback volume multiplier, 0.1–4.0 (default: 1.0)

### Tag Vocabulary

The allowed-list sets (`locationSet`, `situationSet`, `moodSet`) are built dynamically from `library.xml` at cron runtime — position 0 of each track feeds `locationSet`, position 1 feeds `situationSet`, positions 2–5 feed `moodSet`. No manual list is maintained.

**For the rescue logic to work correctly**, every concept the AI might use as a location should appear at position 0 in at least one track, and every situation concept at position 1. If a word is only ever used as a mood (positions 2–5), the rescue cannot identify it as a location/situation.

### Song Switch Logic

**Two distinct "empty" semantics:**

| Source | Empty means |
|--------|-------------|
| `library.xml` track tag | **Wildcard** — the track fits any location/situation |
| AI output label | **Unknown** — treated as unchanged (carry-forward applied) |

**Label processing pipeline** (`bard-label-output`):

1. **Position rescue** — three passes over the raw 6-value AI response:
   - *Pass 1*: scans all positions for known library location/situation words (by set membership). First location word found → slot 0; first situation word found → slot 1. Positions 0–1 are never added to mood slots.
   - *Change-preference*: if the rescued location/situation equals the **previous** known value, the rescue continues scanning for a **different** known word elsewhere. This handles the common AI pattern of repeating the old value (from `{{CURRENT_LABELS}}` in the prompt) while signalling a change later in the output.
   - *Pass 2*: positions 2–5 only; pure mood words (not in locationSet/situationSet).
   - *Pass 3*: novel words at AI positions 0/1 accepted as-is (new concepts not yet in library).

2. **Carry-forward** for empty slots (three-level):
   - Previous active labels (`bard:labels`) — AI uncertain, assume unchanged
   - Current song's own tag (`bard:stream.trackTags`) — ground truth fallback
   - Random from allowed list — initialization only, no prior history

   Mood slots are **not** filled — empty mood = "unknown this cycle."

**Mid-song switch detection** compares the new AI labels (after carry-forward) against the previous active labels (`nowPlaying.labels`). Carry-forward ensures empty AI slots are never different from the previous value, so only genuine changes trigger a switch.

**Switch rules (any one fires → immediate track switch):**

| Rule | Condition |
|------|-----------|
| **Location changed** | new and previous location are both non-empty and differ |
| **Situation changed** | new and previous situation are both non-empty and differ |
| **Mood drift >50%** | >50% of new mood labels are not present in the previous mood labels (skipped if either list is empty) |

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

**Full lifecycle:**
1. **Scheduler started** (`/bardstart`) — no labels written. First poll picks a random track from tier 3. The cron job writes real structured labels on its first run.
2. **Track playing** — every poll compares new AI labels vs `nowPlaying.labels`. If any switch rule fires, `getSelectSong` finds the best track in its tier and starts it immediately. Otherwise, `nowPlaying.labels` and `bard:stream.labels` are refreshed for the UI only.
3. **Song ends naturally** — `setTimeout` fires (ffprobe duration + 200 ms), calls `triggerPoll()` immediately. The next poll runs `getSelectSong` with the current labels and starts the best-matching track.

### Slash Commands

| Command | Description |
|---|---|
| `/bardstart` | Start the bard music scheduler for this server |
| `/bardstop` | Stop the bard music scheduler for this server |

### Bard UI

Accessible at `/bard`. Features:
- Edit track title, tags, and volume per track. Tags are entered as comma-separated values in the fixed 6-position schema: `location,situation,mood1,mood2,mood3,mood4`. Use `*` for any position that should be a wildcard (matches any AI value). Example: `*,combat,dark,tense,intense,battle` = any location, combat situation, four moods.
- Delete tracks (removes both library entry and MP3 file)
- **Preview** any track with the ▶ button — plays directly in the browser without going through Discord
- **Bulk Auto-Tag Upload** — drop multiple MP3 files at once and have tags generated automatically (see below)
- **Now Playing** card shows the currently active bard track (live, from `bard:stream:{guildId}`). Labels are colour-coded: **green** = tag appears on both the track and the active mood; **blue** = track tag not in the current mood; **gray** = mood label not present on the current track; **red** = LLM token not found in library.xml (rejected). Sync behaviour:
  - **Regular polling:** every 2 seconds.
  - **On song end:** an immediate poll fires after 300 ms; retries every 500 ms (up to 10×) until the server reports a new track, then returns to the 2-second cycle. This minimises the gap between tracks in the browser player.
  - **On label change mid-song:** When `getShouldSwitch` fires (location, situation or mood drift), `bard:stream` is updated immediately with the new track. The browser picks up the change on its next poll cycle. If no switch rule fires, playback continues and only `nowPlaying.labels` is refreshed (UI update only).
  - **On "▶ Zum Anhören klicken" (start button):** the elapsed position is recalculated at the exact moment the user clicks, so the stream is in sync even if the user waited on the page before pressing play. The catch-up seek happens at button-press time, not at the next track change.

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
  └─> 08050-bard-label-output  — parses response, writes bard:labels:{guildId}
```

This means the label-gen AI call:
- Inherits `model`, `endpoint`, `apiKey` from `workingObject` (global defaults) unless overridden in `config["bard-cron"]`
- Runs with `temperature: 0.3`, `maxTokens: 80`, no tools, no history
- Does **not** write to the conversation context (`doNotWriteToContext: true`)

**One guild per cron tick.** If the cron job's `channelID` matches a session's text channel ID, that guild is processed. Otherwise the first session with new context is chosen. For multi-guild setups, configure one cron job per guild with a different `channelID`.

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
| Labels not updating | Cron job disabled or AI failure | Enable `bard-label-gen` job in `core.json`. Check logs for AI errors — if the AI call fails, `bard:lastrun` is not advanced and the next run retries automatically. |
| Same song repeats | Only one track matches labels | Add more tracks or broaden their tags |
| Gap between tracks | Library empty or no matching tracks | Song-end triggers an immediate server poll. If no matching track is found, `bard:stream` is cleared and nothing plays until the next poll. |
| First few seconds of next track missing (browser player) | Browser detected the new track late | Browser poll interval is 2 s; the browser retries every 500 ms (up to 10×) after `ended` until the server reports the new track. If the gap persists, check the browser console for errors in `pollNowPlaying`. |
| Stream out of sync after delayed play button press | Elapsed position was calculated at page-load time | The catch-up seek is recalculated at the moment the user clicks "▶ Zum Anhören klicken", so the stream is always in sync regardless of how long the user waited before pressing play. |

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

*End of Administrator Manual*
*Generated: 2026-03-11 · Jenny Discord AI Bot v1.0*
