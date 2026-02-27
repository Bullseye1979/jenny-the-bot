# Jenny Discord AI Bot — Administrator Manual

> **Version:** 1.0 · **Date:** 2026-02
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
   - 5.3 [Voice / TTS / Whisper](#53-voice--tts--whisper)
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
   - 6.7 [webpage](#67-webpage)
7. [Module Pipeline](#7-module-pipeline)
   - 7.1 [Pre-Processing (00xxx)](#71-pre-processing-00xxx)
   - 7.2 [AI Processing (01xxx)](#72-ai-processing-01xxx)
   - 7.3 [Output & Post-Processing (02xxx–08xxx)](#73-output--post-processing-02xxx08xxx)
   - 7.4 [Final Logging (10xxx)](#74-final-logging-10xxx)
8. [Tools — LLM-callable Functions](#8-tools--llm-callable-functions)
   - [getGoogle](#getgoogle)
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
14. [Dependencies](#14-dependencies)

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
  json     LONGTEXT NOT NULL,
  text     TEXT NULL,
  role     VARCHAR(32) NOT NULL DEFAULT 'user',
  turn_id  CHAR(26) NULL,
  frozen   TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_id_ctx (id, ctx_id),
  KEY idx_role (role),
  KEY idx_turn (turn_id),
  KEY idx_id_turn (id, turn_id)
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
CREATE TABLE gdpr_consent (
  user_id    VARCHAR(64) NOT NULL,
  channel_id VARCHAR(128) NOT NULL,
  chat       TINYINT(1) NOT NULL DEFAULT 0,
  voice      TINYINT(1) NOT NULL DEFAULT 0,
  disclaimer TINYINT(1) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, channel_id)
);
```

### Step 3: Create and Fill core.json

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
/gdpr text 1    ← enable text processing
/gdpr voice 1   ← enable voice processing (optional)
```

---

## 2. Architecture Overview

Jenny uses a **pipeline-based modular architecture**:

```
Event source (Discord / HTTP API / Cron / Voice / Webpage)
        │
        ▼
   Flow Handler
   ┌─────────────────────────────────────────┐
   │ Creates workingObject with event data    │
   │ Calls runFlow()                          │
   └─────────────────────────────────────────┘
        │
        ▼
   Module Pipeline (ordered execution 00xxx → 10xxx)
   ┌────────────┬────────────┬────────────┬────────────┐
   │ 00xxx      │ 01xxx      │ 02–08xxx   │ 10xxx      │
   │ Pre-Proc.  │ AI Module  │ Output     │ Logging    │
   └────────────┴────────────┴────────────┴────────────┘
        │
        ▼
   Storage
   ┌─────────────────┬────────────────────────┐
   │ MySQL (context) │ In-Memory (registry)   │
   └─────────────────┴────────────────────────┘
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
├── ADMIN_MANUAL.md          # This file
├── core/
│   ├── registry.js          # In-memory KV store with TTL/LRU
│   ├── context.js           # MySQL conversation storage
│   └── logging.js           # Structured logging
├── flows/
│   ├── discord.js           # Discord message listener
│   ├── discord-admin.js     # Slash command handler
│   ├── discord-voice.js     # Voice channel handler
│   ├── api.js               # HTTP API server
│   ├── cron.js              # Scheduled jobs
│   ├── toolcall.js          # Registry-triggered flow
│   └── webpage.js           # Puppeteer web scraping
├── modules/                 # 30 modules (ordered 00xxx–10xxx)
├── tools/                   # 19 LLM-callable tools
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
| `apiSecret` | string | `""` | Shared secret for the HTTP API token gate. When set, every POST `/api` request must supply `Authorization: Bearer <secret>`. Leave empty to disable the gate (open access). |
| `botsAllow` | array | `[]` | List of Discord bot IDs permitted to trigger the bot |

#### AI Model

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | string | `"gpt-4o-mini"` | LLM model ID |
| `endpoint` | string | OpenAI URL | Chat completions endpoint |
| `endpointResponses` | string | OpenAI URL | Responses API endpoint |
| `apiKey` | string | — | API key for LLM calls |
| `useAiModule` | string | `"completions"` | AI module to use: `"completions"` \| `"responses"` \| `"pseudotoolcalls"` |
| `temperature` | number | `0.2` | Sampling temperature (0–2) |
| `maxTokens` | number | `2000` | Max tokens per response |
| `requestTimeoutMs` | number | `1000000` | HTTP timeout for AI requests (ms) |

#### Responses API (useAiModule = "responses")

| Parameter | Type | Default | Description |
|---|---|---|---|
| `reasoning` | string | — | Reasoning effort: `"low"` \| `"medium"` \| `"high"` |
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
| `allowArtifactGeneration` | boolean | `true` | Allow image/file generation |
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

### 5.3 Voice / TTS / Whisper

| Parameter | Type | Default | Description |
|---|---|---|---|
| `useVoiceChannel` | number | `0` | Voice channel mode (0 = disabled) |
| `ttsModel` | string | `"gpt-4o-mini-tts"` | Text-to-speech model |
| `ttsVoice` | string | `"nova"` | TTS voice name |
| `ttsEndpoint` | string | OpenAI URL | TTS API endpoint |
| `ttsApiKey` | string | — | API key for TTS (if different from `apiKey`) |
| `whisperModel` | string | `"whisper-1"` | Speech-to-text model |
| `whisperLanguage` | string | `""` | Force language (ISO 639-1; empty = auto-detect) |
| `whisperEndpoint` | string | OpenAI base URL | Whisper API base URL |
| `whisperApiKey` | string | — | API key for Whisper (if different from `apiKey`) |

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

---

### 5.6 toolsconfig — Per-Tool Configuration

All tool configurations live under `workingObject.toolsconfig.<toolName>`:

---

#### toolsconfig.getGoogle

Performs web searches using the **Google Custom Search JSON API**. The AI calls this tool to search the internet and receive a ranked list of results including titles, snippets, and URLs. Requires a Google Cloud API key with the Custom Search API enabled and a configured Custom Search Engine (CSE) ID.

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

Fetches and reads the content of any web page by URL. For pages below the `wordThreshold` the raw extracted text is returned directly (**dump mode**); for longer pages the content is compressed by an AI model (**summary mode**). The AI uses this tool to access current online information, documentation, news, or articles that are not in its training data.

```json
"getWebpage": {
  "user_agent":    "Mozilla/5.0 ...",
  "timeoutMs":     30000,
  "maxInputChars": 240000,
  "model":         "gpt-4.1",
  "temperature":   0.2,
  "max_tokens":    18000,
  "aiTimeoutMs":   45000,
  "wordThreshold": 2000,
  "endpoint":      "https://api.openai.com/v1/chat/completions",
  "apiKey":        "YOUR_OPENAI_API_KEY"
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `user_agent` | string | Chrome UA | HTTP User-Agent for page requests |
| `timeoutMs` | number | `30000` | HTTP timeout for page fetch (ms) |
| `maxInputChars` | number | `240000` | Hard character cap on extracted page text |
| `wordThreshold` | number | `2000` | Below this word count: dump mode; above: AI summary |
| `endpoint` | string | — | **Required for summary mode.** Chat completions endpoint |
| `apiKey` | string | — | **Required for summary mode.** API key |
| `model` | string | — | **Required for summary mode.** Model ID |
| `temperature` | number | `0.2` | Sampling temperature for AI summary |
| `max_tokens` | number | `18000` | Max tokens for AI summary |
| `aiTimeoutMs` | number | `45000` | Timeout for AI call (ms) |

---

#### toolsconfig.getImage

Generates images from a natural-language prompt using an **OpenAI-compatible Images API** (e.g. DALL-E 3 or gpt-image-1). Before the prompt is sent to the image model, an optional second AI call automatically enhances it with quality, style, camera, and negative tags to improve output quality. Generated files are saved to `pub/documents/` and returned as public URLs. Works with any OpenAI-compatible image endpoint.

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

Sends an image URL to a **vision-capable language model** and returns a detailed text description of its content. The AI uses this tool when a user shares an image and asks questions about it, or when a previously generated image needs to be analysed for downstream processing.

```json
"getImageDescription": {
  "apiKey":      "YOUR_OPENAI_API_KEY",
  "model":       "gpt-4o-mini",
  "endpoint":    "https://api.openai.com/v1/chat/completions",
  "temperature": 0.2,
  "max_tokens":  1000,
  "timeout_ms":  60000
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `apiKey` | string | — | **Required.** API key |
| `model` | string | `"gpt-4o-mini"` | Vision model |
| `endpoint` | string | — | **Required.** Chat completions endpoint |
| `temperature` | number | `0.2` | Sampling temperature |
| `max_tokens` | number | `1000` | Max tokens |
| `timeout_ms` | number | `60000` | Timeout (ms) |

---

#### toolsconfig.getImageSD

Generates images via a **locally running Stable Diffusion instance** (AUTOMATIC1111 WebUI API). An alternative to cloud-based image generation that runs entirely on your own hardware. Requires a local Stable Diffusion server reachable at `base_url`. Useful for uncensored or fine-tuned checkpoint models that are not available via the OpenAI API.

```json
"getImageSD": {
  "base_url":          "http://127.0.0.1:7860",
  "publicBaseUrl":     "https://myserver.com",
  "size":              "512x512",
  "n":                 1,
  "steps":             15,
  "cfg_scale":         7,
  "sampler":           "Euler a",
  "seed":              -1,
  "model":             "realisticVisionV60B1_v51HyperVAE.safetensors",
  "negative_extra":    "overprocessed, muddy colors",
  "timeoutMs":         1400000,
  "networkTimeoutMs":  14400000
}
```

| Parameter | Type | Description |
|---|---|---|
| `base_url` | string | Local Stable Diffusion API URL (e.g. AUTOMATIC1111) |
| `publicBaseUrl` | string | Public base URL for generated images |
| `size` | string | Image size `"WxH"` |
| `n` | number | Number of images |
| `steps` | number | Inference steps |
| `cfg_scale` | number | CFG scale |
| `sampler` | string | Sampler name |
| `seed` | number | Seed (-1 = random) |
| `model` | string | Checkpoint filename |
| `negative_extra` | string | Extra negative prompts |
| `timeoutMs` | number | Timeout per generation (ms) |
| `networkTimeoutMs` | number | Network timeout (ms) |

---

#### toolsconfig.getAnimatedPicture

Animates a still image into a **short video clip** using an image-to-video model on Replicate (default: WAN 2.5 i2v). The AI provides a source image URL and an optional motion prompt; the job is submitted asynchronously and polled until complete. The resulting video is saved to `pub/documents/` and returned as a public URL. Requires a Replicate API token.

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

Generates a **short video from a text prompt** using a text-to-video model on Replicate (default: Google Veo 3). The job is submitted asynchronously and polled until complete; the finished video file is saved to `pub/documents/` and returned as a public URL. Requires a Replicate API token.

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

Searches YouTube for videos and/or fetches a video's **full transcript**. Short transcripts are returned verbatim (dump mode); long transcripts are answered or summarised by an AI model. Useful for letting the bot answer questions about specific YouTube content, summarise lectures or tutorials, or find relevant videos on a topic. The Google API key is only needed for the search mode.

```json
"getYoutube": {
  "googleApiKey":         "YOUR_GOOGLE_API_KEY",
  "endpoint":             "https://api.openai.com/v1/chat/completions",
  "apiKey":               "YOUR_OPENAI_API_KEY",
  "model":                "gpt-4.1",
  "temperature":          0.2,
  "max_tokens":           8000,
  "dump_threshold_chars": 20000,
  "transcriptLangs":      ["en", "de"],
  "regionCode":           "US",
  "relevanceLanguage":    "en",
  "searchMaxResults":     5,
  "aiTimeoutMs":          300000
}
```

| Parameter | Type | Description |
|---|---|---|
| `googleApiKey` | string | Google Data API v3 key (for search and metadata) |
| `endpoint` | string | Chat completions endpoint for AI summary |
| `apiKey` | string | API key for AI summary |
| `model` | string | Model for AI summary |
| `temperature` | number | Temperature for AI summary |
| `max_tokens` | number | Max tokens for AI response |
| `dump_threshold_chars` | number | Below this char count: dump mode; above: AI summary |
| `transcriptLangs` | array | Preferred transcript languages (falls back to `en`) |
| `regionCode` | string | YouTube region code, e.g. `"US"` |
| `relevanceLanguage` | string | Relevance language for search, e.g. `"en"` |
| `searchMaxResults` | number | Max search results (1–10) |
| `aiTimeoutMs` | number | Timeout for AI call (ms) |

---

#### toolsconfig.getJira

Provides **full CRUD access to Jira Cloud** issues via the Atlassian REST API. The AI can create, read, update, and transition issues, execute JQL searches, and list projects. Ideal for integrating the bot into software development workflows — users can ask the bot to file bugs, check sprint status, or update ticket descriptions directly from Discord.

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

Provides **full CRUD access to Confluence Cloud pages** via the Atlassian REST API. The AI can read existing pages, create new ones, append content, list child pages, move pages, delete pages, and upload attachments. Useful for maintaining a living knowledge base that the bot can both read from and write to on behalf of users.

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

Renders an HTML string into a **PDF file** using Puppeteer (headless Chromium). The generated PDF is saved to `pub/documents/` and returned as a public download URL. The AI uses this tool to export formatted reports, formatted documents, invoices, or any other printable content that a user requests. Requires Chromium/Puppeteer to be installed.

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

Saves any text or Markdown content to a **plain-text file** in `pub/documents/` and returns a public download URL. The AI uses this tool to deliver code files, configuration templates, Markdown documents, or any other text-based artifact that would exceed Discord's 2000-character message limit. No external API is required.

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

Queries the bot's **MySQL conversation history** for a channel and returns a paginated excerpt. Short result sets are returned as raw text (dump mode); larger result sets are answered or summarised by an AI model. This enables the bot to recall past conversations that fall outside the active context window — useful for long-running projects or when a user asks "what did we discuss last week?".

```json
"getHistory": {
  "pagesize":          1000,
  "max_rows":          4000,
  "threshold":         800,
  "model":             "gpt-4.1",
  "temperature":       0,
  "max_tokens":        8000,
  "aiTimeoutMs":       45000,
  "endpoint":          "https://api.openai.com/v1/chat/completions",
  "apiKey":            "YOUR_OPENAI_API_KEY",
  "include_tool_rows": false,
  "chunk_max_tokens":  600
}
```

| Parameter | Type | Description |
|---|---|---|
| `pagesize` | number | Rows per page when reading from MySQL |
| `max_rows` | number | Maximum total rows loaded |
| `threshold` | number | Below this char count: dump; above: AI summary |
| `model` | string | Model for AI summary |
| `temperature` | number | Temperature (0 = deterministic) |
| `max_tokens` | number | Max tokens for AI response |
| `aiTimeoutMs` | number | Timeout for AI call (ms) |
| `endpoint` | string | Chat completions endpoint |
| `apiKey` | string | API key |
| `include_tool_rows` | boolean | Include tool-call rows in history |
| `chunk_max_tokens` | number | Max tokens per history chunk |

---

#### toolsconfig.getInformation

Performs a **semantic cluster search** over the stored conversation log to surface relevant past messages, events, or decisions. Unlike `getHistory` (which is strictly chronological), this tool groups thematically related entries and scores them by relevance to the query, then pads the hits with surrounding context rows. No external API is required — all processing runs in-memory against MySQL data.

```json
"getInformation": {
  "cluster_rows":         200,
  "pad_rows":             20,
  "token_window":         5,
  "max_log_chars":        6000,
  "max_output_lines":     1000,
  "min_coverage":         1,
  "event_gap_minutes":    45,
  "max_timeline_periods": 30,
  "strip_code":           false
}
```

| Parameter | Type | Description |
|---|---|---|
| `cluster_rows` | number | Rows per cluster |
| `pad_rows` | number | Context rows around matching hits |
| `token_window` | number | Search window for token matching |
| `max_log_chars` | number | Max characters in log output |
| `max_output_lines` | number | Max output lines |
| `min_coverage` | number | Minimum coverage for a cluster |
| `event_gap_minutes` | number | Time gap in minutes between events |
| `max_timeline_periods` | number | Max timeline periods |
| `strip_code` | boolean | Strip code blocks from log |

---

#### toolsconfig.getLocation

Generates **Google Maps links and Google Street View images** for a given address or set of coordinates. The bot saves the Street View photograph locally and returns a public URL alongside an interactive Google Maps link. Requires a Google Maps Platform API key with the Street View Static API enabled.

```json
"getLocation": {
  "googleApiKey":  "YOUR_GOOGLE_API_KEY",
  "publicBaseUrl": "https://myserver.com",
  "street_size":   "800x600",
  "street_fov":    90,
  "timeoutMs":     20000
}
```

| Parameter | Type | Description |
|---|---|---|
| `googleApiKey` | string | **Required.** Google Maps API key |
| `publicBaseUrl` | string | **Required.** Public base URL for Street View images |
| `street_size` | string | Street View image dimensions |
| `street_fov` | number | Field of view (degrees) |
| `timeoutMs` | number | HTTP timeout (ms) |

---

#### toolsconfig.getToken

Converts a still image or video clip into a **small animated GIF** suitable for use as a Discord emoji or sticker. The tool decodes the source with `ffmpeg` and `ImageMagick`, then applies an iterative lossy-compression fallback chain (via `gifsicle`) to meet the `maxMb` size limit, automatically reducing FPS, scale, and colour palette as needed. The result is saved to `pub/documents/` and returned as a public URL. Requires `ffmpeg`, `convert` (ImageMagick), and `gifsicle` to be installed on the host.

```json
"getToken": {
  "publicBaseUrl":      "https://myserver.com",
  "magickPath":         "convert",
  "size":               512,
  "border_px":          10,
  "ffmpegPath":         "ffmpeg",
  "maxMb":              10,
  "fpsList":            [12, 10, 8],
  "scaleList":          [512, 384, 320],
  "maxColorsList":      [128, 96, 64, 48, 32],
  "ditherList":         ["bayer:bayer_scale=3:diff_mode=rectangle", "bayer:bayer_scale=5:diff_mode=rectangle", "none"],
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
| `border_px` | number | Border in pixels |
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

Configures and starts the **Discord.js gateway client** that listens for all incoming messages, reactions, and slash command interactions across every guild and DM the bot has access to. This is the primary event source for the bot. The `token` and `intents` are forwarded directly to the Discord.js `Client` constructor.

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

Starts a lightweight **HTTP API server** that exposes the full bot pipeline to external applications. Any service capable of making an HTTP POST can submit a message and receive the bot's response — useful for browser extensions, web applications, home-automation integrations, or internal tooling. Remove this block entirely to disable the HTTP API.

**Token gating:** Set `workingObject.apiSecret` to a strong random string and enable the `api-token-gate` module (see section 7.1) to protect the endpoint. Every request must then include the header `Authorization: Bearer <secret>`; missing or wrong tokens receive HTTP 401. The `/health` endpoint is never gated.

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

#### config.cron

Runs **scheduled background jobs** at defined intervals using a simple cron expression engine. On each tick the scheduler checks whether any enabled job is due; if so, it triggers the full module pipeline for the configured target channel — allowing the bot to post autonomous status updates, daily reports, or reminders without any user input. Leave the `jobs` array empty to run the flow infrastructure without scheduling any jobs.

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

Controls the **rolling-summary backend** that compresses ageing conversation history into AI-generated period summaries. When a time window (`periodSize` seconds) closes, the raw messages within it are sent to an LLM, which writes a concise summary to the `timeline_periods` table. The raw rows are then replaced by the summary, keeping the MySQL `context` table lean while preserving long-term memory. This model and key are used solely for summary generation and can differ from the bot's main model.

```json
"context": {
  "endpoint":   "https://api.openai.com/v1/chat/completions",
  "model":      "gpt-4o-mini",
  "apiKey":     "YOUR_OPENAI_API_KEY",
  "periodSize": 600
}
```

| Parameter | Type | Description |
|---|---|---|
| `endpoint` | string | Endpoint for rolling summary generation |
| `model` | string | Model for rolling summary generation |
| `apiKey` | string | API key for rolling summaries |
| `periodSize` | number | Time window in seconds for rolling periods |

---

#### config.toolcall

Wires up the internal **tool-call status tracking flow**. When the AI invokes a tool, the tool's name is written to the registry under `registryKey`. The toolcall flow polls that key and passes the value to `discord-status-apply`, so the bot's Discord activity indicator updates to show which tool is currently running (e.g. "⏳ Generating an image …") in near-real time. This flow runs independently of the main pipeline.

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

#### config.discord-status-prepare

Module that **reads recent conversation history** from the specified `allowedChannels` and asks the LLM to produce a short (≤5 word) activity string describing what the bot is currently doing or discussing. The result is stored in `workingObject` and consumed by `discord-status-apply`. Runs exclusively on the `discord-status` flow, which is triggered by a cron job at a configurable interval.

```json
"discord-status-prepare": {
  "flow":            ["discord-status"],
  "allowedChannels": ["CHANNEL_ID"],
  "prompt":          "Summarize the context in 5 words or less."
}
```

| Parameter | Type | Description |
|---|---|---|
| `flow` | array | Active flows for this module |
| `allowedChannels` | array | Channel IDs whose history is used for the status |
| `prompt` | string | Prompt for status summarization |

---

#### config.discord-status-apply

**Applies the Discord bot presence/activity text.** It operates in two modes: (1) during normal conversation it sets the activity to the AI-generated string from `discord-status-prepare`; (2) while a tool is executing it reads the tool name from the registry and substitutes a human-readable placeholder from the `mapping` table. A `minUpdateGapMs` guard prevents the Discord API from being hit too frequently. Set `placeholderEnabled: false` if you do not want the "working" status texts.

```json
"discord-status-apply": {
  "flow":               ["discord-status", "toolcall"],
  "status":             "online",
  "placeholderEnabled": true,
  "placeholderText":    " // myserver.com // ",
  "minUpdateGapMs":     800,
  "mapping": {
    "getImage":   "⏳ Generating an image …",
    "getGoogle":  "⏳ Searching with Google …"
  }
}
```

| Parameter | Type | Description |
|---|---|---|
| `flow` | array | Active flows |
| `status` | string | Discord presence status: `"online"` \| `"idle"` \| `"dnd"` |
| `placeholderEnabled` | boolean | Show placeholder status when no tool is active |
| `placeholderText` | string | Placeholder status text |
| `minUpdateGapMs` | number | Min gap between status updates (ms) |
| `mapping` | object | Tool name → status text mapping |

---

#### config.discord-voice-transcribe

Controls the **voice recording and silence-detection engine**. Opus audio frames arriving from Discord's gateway are accumulated in a session buffer. When silence has been detected for at least `silenceMs` milliseconds (or the recording reaches `maxCaptureMs`), the captured audio is submitted to OpenAI Whisper for speech-to-text transcription. The resulting text becomes the turn's `payload` and the full module pipeline continues from there. Parameters like `snrDbThreshold` and `minVoicedMs` suppress background noise and accidental triggers.

```json
"discord-voice-transcribe": {
  "flow":            ["discord-voice"],
  "pollMs":          1000,
  "silenceMs":       1500,
  "maxCaptureMs":    25000,
  "minVoicedMs":     1000,
  "snrDbThreshold":  3.8,
  "frameMs":         20,
  "startDebounceMs": 600
}
```

| Parameter | Type | Description |
|---|---|---|
| `pollMs` | number | Audio frame poll interval (ms) |
| `silenceMs` | number | Silence duration before recording ends (ms) |
| `maxCaptureMs` | number | Max recording duration (ms) |
| `minVoicedMs` | number | Min voice activity for a valid recording (ms) |
| `snrDbThreshold` | number | Signal-to-noise threshold (dB) |
| `frameMs` | number | Audio frame length (ms) |
| `startDebounceMs` | number | Debounce before recording starts (ms) |

---

#### config.webpage-inpaint

Enables **AI-based image inpainting** for content received through the webpage flow. When the bot processes a web page that contains an image, this module can route that image to an external inpainting service (at `inpaintHost`) for content replacement, object removal, or background fill. The result is then forwarded back into the pipeline. Set `enabled: false` to bypass this step.

```json
"webpage-inpaint": {
  "flow":        ["webpage"],
  "enabled":     true,
  "inpaintHost": "inpainting.myserver.com"
}
```

| Parameter | Type | Description |
|---|---|---|
| `flow` | array | Active flows |
| `enabled` | boolean | Inpainting enabled |
| `inpaintHost` | string | Hostname of the inpainting service |

---

#### config.core-add-id

Tags each outgoing response with a **reference URL** linking back to the full debug log for that turn. The URL is assembled from one of the configured `servers` and the turn's ULID, making it easy to trace any bot message back to its complete internal JSON log in `pub/debug/`. This is purely for diagnostic purposes and has no effect on the response sent to the user.

```json
"core-add-id": {
  "flow":    ["discord", "discord-voice", "api"],
  "servers": ["myserver.com", "anotherserver.com"]
}
```

| Parameter | Type | Description |
|---|---|---|
| `flow` | array | Active flows |
| `servers` | array | Server URLs registered as public endpoints |

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
| `core-channel-config` | discord, discord-voice, discord-admin, discord-status, api |
| `discord-channel-gate` | discord, discord-voice, discord-admin, api |
| `api-token-gate` | api |
| `discord-gdpr-gate` | discord, discord-voice, discord-admin |
| `discord-add-context` | discord, discord-voice |
| `discord-trigger-gate` | discord, discord-voice |
| `discord-reaction-start/finish` | discord |
| `discord-text-output` | all |
| `discord-voice-tts` | discord-voice |
| `discord-voice-transcribe` | discord-voice |
| `core-ai-completions` | discord-status, discord, discord-voice, api |
| `core-ai-responses` | discord-status, discord, discord-voice, api |
| `core-output` | all |

---

### 5.8 core-channel-config — Channel/Flow/User Overrides

The three-level hierarchy allows fine-grained configuration:

```
Channel override
  └── Flow override
        └── User override
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

**channelMatch:** Can contain channel IDs or channel names. The special value `"browser"` matches all API requests.

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
| `id` | Channel ID |
| `userid` / `userId` | Discord user ID of the author |
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
1. Record audio frames into voice session (stored in registry)
2. Transcribe audio via Whisper API (module `00030`)
3. Run the full module pipeline
4. Synthesise TTS reply (module `08100`)

**Activation:** User runs `/join`, bot enters the voice channel.

---

### 6.4 api

**File:** `flows/api.js`
**Purpose:** HTTP API server for external requests

**Endpoints:**

| Method | Path | Description |
|---|---|---|
| `POST` | `/api` | Submit a request; returns JSON `{ turn_id, response }` |
| `GET` | `/toolcall` | Poll tool-call status from registry |

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
  "turn_id":  "01JXXXXXXXXXXXXXXXXXXXXX",
  "response": "The weather in Berlin is..."
}
```

---

### 6.5 cron

**File:** `flows/cron.js`
**Purpose:** Executes scheduled jobs based on cron expressions

**Cron format:** `* * * * *` (minute, hour, day, month, weekday).
Also supports `*/N * * * *` (every N minutes).

**Job configuration:** See `config.cron.jobs[]`

---

### 6.6 toolcall

**File:** `flows/toolcall.js`
**Purpose:** Registry-triggered flow for async tool-call tracking

**Flow:**
1. A tool result is deposited into the `status:tool` registry key
2. The flow is triggered and retrieves the result
3. Updates the Discord presence status via `discord-status-apply`

---

### 6.7 webpage

**File:** `flows/webpage.js`
**Purpose:** Puppeteer-based web scraping

**Trigger:** Called during web-fetch operations
**Flow:** Renders a page via Puppeteer, extracts DOM content, injects into `workingObject`

---

## 7. Module Pipeline

Modules execute in **strict numeric order**. Naming convention: `NNNNN-PREFIX-NAME.js`

Every module is an async function:
```javascript
export default async function myModule(coreData) {
  const { workingObject, logging } = coreData;
  // Read from workingObject, do work, write results back
  // Optional: workingObject.stop = true → halt pipeline
}
```

---

### 7.1 Pre-Processing (00xxx)

| No. | File | Purpose |
|---|---|---|
| 00005 | `discord-status-prepare` | Reads Discord context; prepares AI-generated status update |
| 00010 | `core-channel-config` | Applies hierarchical channel/flow/user overrides (deep-merge) |
| 00020 | `discord-channel-gate` | Checks whether the bot is allowed to respond in this channel |
| 00021 | `api-token-gate` | Verifies the Bearer token for HTTP API requests; blocks with HTTP 401 if wrong or missing (no-op when `apiSecret` is empty) |
| 00022 | `discord-gdpr-gate` | Enforces GDPR consent; sends disclaimer DM on first contact |
| 00025 | `discord-admin-gdpr` | Handles admin GDPR management commands |
| 00030 | `discord-voice-transcribe` | Transcribes voice audio via Whisper API |
| 00032 | `discord-add-files` | Extracts file attachments and URLs from Discord messages |
| 00040 | `discord-admin-join` | Processes `/join` and `/leave` commands for voice channels |
| 00045 | `webpage-inpaint` | Image inpainting for web content |
| 00050 | `discord-admin-commands` | Processes slash commands and DM admin commands |
| 00055 | `core-admin-commands` | Core admin operations (purge, freeze, DB commands) |
| 00060 | `discord-admin-avatar` | Generates or uploads a bot avatar via DALL-E or URL |
| 00065 | `discord-admin-macro` | Macro management (create, list, delete, run) |
| 00070 | `discord-add-context` | Loads conversation history from MySQL into the context window |
| 00072 | `api-add-context` | Loads context for API flow requests |
| 00075 | `discord-trigger-gate` | Filters messages based on trigger words |
| 00080 | `discord-reaction-start` | Adds a progress reaction emoji to the user's message |

---

### 7.2 AI Processing (01xxx)

Only **one** of these modules runs per turn, selected by `workingObject.useAiModule`:

| No. | File | useAiModule | Purpose |
|---|---|---|---|
| 01000 | `core-ai-completions` | `"completions"` | Simple `chat/completions` runner; no tool calling |
| 01001 | `core-ai-responses` | `"responses"` | Full Responses API with iterative tool calling, reasoning, image persistence |
| 01002 | `core-ai-pseudotoolcalls` | `"pseudotoolcalls"` | Text-based pseudo tool calling (for local models) |
| 01003 | `core-ai-roleplay` | — | Character/persona injection for roleplay |

#### core-ai-responses (01001) — Detailed flow

1. Translates MySQL history into Responses API format
2. Calls the LLM; if tool calls are present:
   - Invokes each tool
   - Appends results to context
   - Loops (max `maxLoops`)
3. Once no more tool calls: sets `workingObject.response`
4. Appends reasoning tokens to `workingObject.reasoningSummary`
5. Persists images returned by tools to `./pub/documents/`

---

### 7.3 Output & Post-Processing (02xxx–08xxx)

| No. | File | Purpose |
|---|---|---|
| 02000 | `moderation-output` | Content filtering; can suppress or replace the response |
| 03000 | `discord-status-apply` | Applies the generated Discord presence status |
| 07000 | `core-add-id` | Tags the response with a context ID before writing to MySQL |
| 08000 | `discord-text-output` | Formats the response as a Discord embed; creates reasoning thread if present |
| 08100 | `discord-voice-tts` | Synthesises TTS audio with speaker-tagged voice selection |
| 08200 | `discord-reaction-finish` | Removes the progress reaction; adds a completion reaction |
| 08300 | `webpage-output` | Sends the response back to the webpage flow caller |

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
| `query` | string | ✓ | Search query |
| `num` | integer (1–10) | — | Number of results (default from toolsconfig) |
| `safe` | string | — | Safe search: `"off"` \| `"active"` \| `"high"` |
| `hl` | string | — | UI language hint, e.g. `"en"` |
| `lr` | string | — | Language restrict, e.g. `"lang_en"` |
| `cr` | string | — | Country restrict, e.g. `"countryUS"` |
| `gl` | string | — | Geolocation, e.g. `"us"` |

**Return value:**
```json
{
  "ok": true,
  "query": "...",
  "total": 5,
  "searchInformation": { "formattedSearchTime": "...", "formattedTotalResults": "..." },
  "items": [
    { "title": "...", "snippet": "...", "link": "...", "displayLink": "...", "mime": "..." }
  ]
}
```

---

### getWebpage

**File:** `tools/getWebpage.js`
**Purpose:** Fetch a web page, extract text, optionally produce an AI summary

**LLM parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | ✓ | Absolute URL (http/https) |
| `user_prompt` | string | ✓ | User question/task against the page text |
| `prompt` | string | — | Optional extra system instructions to bias the summary |

**Modes:**
- `dump`: page has fewer than `wordThreshold` words → text returned directly
- `summary`: page exceeds `wordThreshold` → AI summary

---

### getImage

**File:** `tools/getImage.js`
**Purpose:** Generate images via the OpenAI Images API, save locally, return public URL

**LLM parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `prompt` | string | ✓ | Scene description |
| `size` | string | — | Explicit size `"WxH"`, e.g. `"1024x1024"` |
| `aspect` | string | — | Aspect preset: `"portrait"`, `"landscape"`, `"1:1"`, `"16:9"`, etc. |
| `targetLongEdge` | number | — | Target pixels for the long edge when `size` is omitted |
| `n` | integer (1–4) | — | Number of images |
| `strictPrompt` | boolean | — | `true` = use prompt exactly (skip enhancer) |
| `negative` | string/array | — | Negative tags |
| `enhancerEndpoint` | string | — | Endpoint for the prompt enhancer |
| `enhancerApiKey` | string | — | API key for the enhancer |
| `enhancerModel` | string | — | Model for the enhancer |
| `enhancerTemperature` | number | — | Temperature for the enhancer |
| `enhancerMaxTokens` | number | — | Max tokens for the enhancer |
| `preferDigitalPainting` | boolean | — | Prefer a digital painting style (default: true) |

**Prompt enhancement:** The tool automatically improves prompts with quality tags, camera/lens suggestions and negative tags. Use `strictPrompt: true` to pass the prompt unchanged.

---

### getImageDescription

**File:** `tools/getImageDescription.js`
**Purpose:** Analyse and describe an image URL using a vision model

**LLM parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | ✓ | Image URL |
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

**Prerequisite:** A local AUTOMATIC1111 instance running at `base_url`.

---

### getAnimatedPicture

**File:** `tools/getAnimatedPicture.js`
**Purpose:** Animate a still image into a short video (image-to-video via Replicate WAN)

**LLM parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `image_url` | string | ✓ | URL of the source image |
| `prompt` | string | — | Description of the motion/animation |
| `duration` | number | — | Video duration in seconds |

---

### getVideoFromText

**File:** `tools/getVideoFromText.js`
**Purpose:** Generate a video from a text prompt (text-to-video via Replicate / Veo-3)

**LLM parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `prompt` | string | ✓ | Scene description for the video |
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

**Modes:**
- `transcript` + short transcript → dump mode (text returned directly)
- `transcript` + long transcript + `user_prompt` → QA mode (AI answer)
- `transcript` + long transcript → summary mode (AI summary)
- `search` → YouTube search results

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
| `html` | string | ✓ | Full HTML content |
| `filename` | string | — | Desired filename (without extension) |

---

### getText

**File:** `tools/getText.js`
**Purpose:** Generate a text/Markdown file, save, and return a public URL

**LLM parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `content` | string | ✓ | File content |
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
**Purpose:** Cluster and retrieve information from the context log

**LLM parameters:**

| Parameter | Type | Description |
|---|---|---|
| `query` | string | Search query / topic |
| `channel_id` | string | Channel ID (optional) |
| `max_results` | number | Max results |

---

### getLocation

**File:** `tools/getLocation.js`
**Purpose:** Google Maps Street View, interactive panorama, and map URL generation

**LLM parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `location` | string | ✓ | Address or coordinates |
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
| `source_url` | string | ✓ | URL of source image or video |
| `size` | number | — | GIF target size in pixels |
| `border_px` | number | — | Border in pixels |
| `fps` | number | — | Frames per second |

**Prerequisites:** `ffmpeg`, `convert` (ImageMagick), and `gifsicle` must be installed.

---

### getBan

**File:** `tools/getBan.js`
**Purpose:** Ban a user from Discord (admins only)

**LLM parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_id` | string | ✓ | Discord user ID |
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
import { getAddContext, getWriteContext, getDeleteContext } from "./core/context.js";

getAddContext(workingObject);               // Load history into workingObject
getWriteContext(workingObject, record);     // Persist a turn to MySQL
getDeleteContext(workingObject, channelId); // Delete messages for a channel
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
  ts:         "2026-02-26T12:34:56.789Z",
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

**MySQL table `gdpr_consent`:**

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

### Table: gdpr_consent

| Column | Type | Description |
|---|---|---|
| `user_id` | VARCHAR(64) | Discord user ID |
| `channel_id` | VARCHAR(128) | Discord channel ID |
| `chat` | TINYINT(1) | 1 = text consent granted |
| `voice` | TINYINT(1) | 1 = voice consent granted |
| `disclaimer` | TINYINT(1) | 1 = notice seen |
| `updated_at` | TIMESTAMP | Last change timestamp |

---

## 14. Dependencies

| Package | Version | Purpose |
|---|---|---|
| `discord.js` | ^14.x | Discord client (messages, guilds, voice) |
| `@discordjs/voice` | ^0.18.x | Voice connection and audio pipeline |
| `@discordjs/opus` | ^0.10.x | Opus audio codec |
| `opusscript` | ^0.0.8 | Pure-JS Opus fallback |
| `prism-media` | ^1.3.x | Audio transcoding (OggOpus → MP3) |
| `fluent-ffmpeg` | ^2.1.x | Audio processing |
| `mysql2` | ^3.x | MySQL driver (Promise API) |
| `axios` | ^1.x | HTTP client |
| `node-fetch` | ^2.7.x | Fetch API polyfill |
| `nanoid` | ^5.x | Unique ID generation |
| `cron-parser` | ^5.x | Cron expression parsing |
| `puppeteer` | ^24.x | Headless browser (webpage scraping, PDF) |
| `youtube-transcript-plus` | ^1.1.x | YouTube transcript extraction |

---

*End of Administrator Manual*
*Generated: 2026-02 · Jenny Discord AI Bot v1.0*
