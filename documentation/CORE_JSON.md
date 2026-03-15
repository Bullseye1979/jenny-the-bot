# core.json — Complete Reference

> **Version:** 1.0 · **Date:** 2026-03-15

`core.json` is the single configuration file for the entire Jenny bot. It is loaded at startup and watched at runtime — any change triggers an automatic hot-reload within seconds. No restart is required.

The file has two top-level sections:

```jsonc
{
  "workingObject": { ... },  // Runtime defaults merged into every pipeline run
  "config":        { ... }   // Module wiring, flow subscriptions, and overrides
}
```

All key names follow **camelCase** throughout.

> **Tip:** Add a `_title` key to any object in `core.json` to give it a readable name in the Config Editor UI. The value is shown as the section header instead of the raw property key. `_title` is never sent to the bot at runtime and has no effect on bot behaviour.

---

## Table of Contents

1. [workingObject](#workingobject)
   - [Core AI Settings](#core-ai-settings)
   - [Voice (TTS / Whisper)](#voice-tts--whisper)
   - [Avatar Generation](#avatar-generation)
   - [Discord Settings](#discord-settings)
   - [Database (db)](#database-db)
   - [Tool Configuration (toolsconfig)](#tool-configuration-toolsconfig)
     - [getImage](#getimage)
     - [getImageSD](#getimagesd)
     - [getImageDescription](#getimagedescription)
     - [getAnimatedPicture](#getanimatedpicture)
     - [getVideoFromText](#getvideofromtext)
     - [getGoogle](#getgoogle)
     - [getTavily](#gettavily)
     - [getWebpage](#getwebpage)
     - [getYoutube](#getyoutube)
     - [getHistory](#gethistory)
     - [getInformation](#getinformation)
     - [getConfluence](#getconfluence)
     - [getJira](#getjira)
     - [getPDF](#getpdf)
     - [getText](#gettext)
     - [getToken](#gettoken)
     - [getLocation](#getlocation)
     - [getTime](#gettime)
     - [getTimeline](#gettimeline)
     - [getBan](#getban)
2. [config](#config)
   - [discord](#discord)
   - [api](#api)
   - [webpage-config-editor](#webpage-config-editor)
   - [webpage-chat](#webpage-chat)
   - [webpage-bard](#webpage-bard)
   - [webpage-wiki](#webpage-wiki)
   - [webpage-context](#webpage-context)
   - [webpage-auth](#webpage-auth)
   - [webpage-menu](#webpage-menu)
   - [webpage-dashboard](#webpage-dashboard)
   - [webpage-documentation](#webpage-documentation)
   - [webpage-inpainting](#webpage-inpainting)
   - [bard](#bard)
   - [bard-join](#bard-join)
   - [bard-cron](#bard-cron)
   - [cron](#cron)
   - [context](#context)
   - [webpage](#webpage)
   - [discord-admin](#discord-admin)
   - [discord-voice](#discord-voice)
   - [toolcall](#toolcall)
   - [Module Flow Subscriptions](#module-flow-subscriptions)
   - [core-channel-config — Channel Overrides](#core-channel-config--channel-overrides)
3. [Complete Annotated Template](#complete-annotated-template)

---

## workingObject

`workingObject` holds the **runtime defaults** for every pipeline invocation. When a flow fires, a fresh copy of `workingObject` is created and passed through all modules. Any key here can be overridden per-channel, per-flow, or per-user via `config.core-channel-config`.

---

### Core AI Settings

| Key | Type | Example | Description |
|---|---|---|---|
| `botName` | string | `"Jenny"` | Display name and identity of the bot |
| `systemPrompt` | string | `"You are a helpful assistant."` | System-level instruction prepended to every LLM call |
| `persona` | string | `"Default AI Assistant"` | Short persona descriptor (used in context injection) |
| `instructions` | string | `"Answer concisely."` | Behavioural instructions appended after the system prompt |
| `reasoning` | boolean | `false` | Enable extended reasoning / chain-of-thought output |
| `model` | string | `"gpt-5"` | LLM model identifier |
| `endpoint` | string | `"https://api.openai.com/v1/chat/completions"` | URL for the chat completions API |
| `endpointResponses` | string | `"https://api.openai.com/v1/responses"` | URL for the Responses API |
| `apiKey` | string | `"sk-proj-..."` | OpenAI (or compatible) API key |
| `useAiModule` | string | `"responses"` | AI pipeline to use: `"responses"` · `"completions"` · `"pseudotoolcalls"` |
| `temperature` | number | `0.2` | Sampling temperature (0.0–2.0) |
| `maxTokens` | number | `2000` | Maximum tokens the LLM may generate per reply |
| `maxLoops` | number | `15` | Maximum tool-call iterations per turn before forcing a final answer |
| `maxToolCalls` | number | `7` | Maximum individual tool invocations per turn |
| `toolChoice` | string | `"auto"` | Tool selection mode: `"auto"` · `"none"` · `"required"` |
| `tools` | array | `["getGoogle","getImage",...]` | Names of tools the LLM may call this turn |
| `includeHistory` | boolean | `true` | Include previous conversation history in the context window |
| `includeHistoryTools` | boolean | `false` | Include tool-call rows when loading history |
| `includeRuntimeContext` | boolean | `true` | Inject runtime metadata (timestamp, user, channel) into the system prompt |
| `detailedContext` | boolean | `true` | Load full message JSON from MySQL (vs. text-only) |
| `contextTokenBudget` | number | `60000` | Maximum tokens allocated for conversation history |
| `contextSize` | number | `20` | Number of context rows to load from MySQL |
| `requestTimeoutMs` | number | `1000000` | HTTP request timeout in milliseconds for LLM calls |
| `triggerWordWindow` | number | `3` | Words scanned at the start of a message for the trigger word |
| `trigger` | string | `"jenny"` | Trigger word that activates the bot (empty = always active) |
| `doNotWriteToContext` | boolean | `false` | Skip writing this turn to MySQL (useful for status flows) |
| `showReactions` | boolean | `true` | Add emoji reactions to Discord messages during processing |
| `timezone` | string | `"Europe/Berlin"` | Default timezone for time-aware modules and tools |
| `baseUrl` | string | `"https://yourserver.example.com"` | Public base URL for serving generated files (images, PDFs, etc.) |
| `modAdmin` | string | `"406901027665870848"` | Discord user ID with elevated bot admin rights |
| `modSilence` | string | `"[silence]"` | If this token appears in the AI response, output is suppressed |
| `apiSecret` | string | `""` | Shared secret for the HTTP API token gate. When set, every `POST /api` request must supply `Authorization: Bearer <secret>`. Leave empty to disable token checking. |
| `apiEnabled` | number | `1` | Controls whether this channel can be reached via the HTTP API. `0` = always blocked (regardless of token). `1` = allowed when token matches or no secret is set. Can be overridden per channel via `core-channel-config`. |
| `gdprDisclaimer` | string | Long legal text | Full GDPR disclaimer text sent as a DM on first contact |
| `fileUrls` | array | `[]` | Attachment URLs extracted from the current Discord message |
| `response` | string | `""` | Final AI-generated response text (written by AI modules) |
| `reasoningSummary` | string | `""` | Accumulated chain-of-thought reasoning (written by AI modules) |
| `payload` | string | `""` | The user's input message for this turn |

---

### Voice (TTS / Whisper)

| Key | Type | Example | Description |
|---|---|---|---|
| `useVoiceChannel` | integer | `0` | Whether voice channel is active (set at runtime) |
| `ttsModel` | string | `"gpt-4o-mini-tts"` | Text-to-speech model |
| `ttsVoice` | string | `"nova"` | TTS voice name |
| `ttsEndpoint` | string | `"https://api.openai.com/v1/audio/speech"` | TTS API endpoint |
| `ttsApiKey` | string | `"sk-proj-..."` | API key for TTS calls |
| `whisperApiKey` | string | `"sk-proj-..."` | API key for Whisper transcription |
| `whisperModel` | string | `"whisper-1"` | Whisper model identifier |
| `whisperLanguage` | string | `""` | Force a specific transcription language (ISO 639-1, or empty for auto) |
| `whisperEndpoint` | string | `"https://api.openai.com"` | Base URL for the Whisper API |

---

### Avatar Generation

| Key | Type | Example | Description |
|---|---|---|---|
| `avatarApiKey` | string | `"sk-proj-..."` | API key for avatar image generation |
| `avatarEndpoint` | string | `"https://api.openai.com/v1/images/generations"` | Endpoint for avatar generation |
| `avatarModel` | string | `"dall-e-3"` | Image model used for avatar generation |
| `avatarSize` | string | `"1024x1024"` | Avatar dimensions |
| `avatarPrompt` | string | `""` | Persistent prompt prefix for avatar generation (appended text is added per-request) |

---

### Discord Settings

The `discord-admin` sub-object configures slash commands:

```jsonc
"discord-admin": {
  "slash": {
    "silent":    true,
    "ephemeral": false,
    "definitions": [ ... ]
  }
}
```

| Key | Type | Description |
|---|---|---|
| `slash.silent` | boolean | Suppress the "Bot is thinking…" message |
| `slash.ephemeral` | boolean | Make slash command responses visible only to the invoking user |
| `slash.definitions` | array | Array of slash command definition objects (Discord API format) |

Each definition object contains `name`, `description`, optional `admin` (array of allowed user IDs), and `options` (Discord interaction option objects).

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

### Database (db)

```jsonc
"db": {
  "host":     "localhost",
  "user":     "discord_bot",
  "password": "secret",
  "database": "discord_ai"
}
```

| Key | Type | Description |
|---|---|---|
| `host` | string | MySQL server hostname or IP |
| `port` | number | MySQL port (default `3306`) |
| `user` | string | MySQL user |
| `password` | string | MySQL password |
| `database` | string | MySQL database name |

---

### Tool Configuration (toolsconfig)

All tool-specific settings are grouped under `workingObject.toolsconfig`. Each key is the exact tool name.

#### getImage

OpenAI DALL-E image generation.

| Key | Type | Example | Description |
|---|---|---|---|
| `apiKey` | string | `"sk-proj-..."` | API key |
| `endpoint` | string | `"https://api.openai.com/v1/images/generations"` | Generation endpoint |
| `model` | string | `"dall-e-3"` | Image model |
| `size` | string | `"1024x1024"` | Output image dimensions |
| `n` | number | `1` | Number of images to generate |
| `publicBaseUrl` | string | `"https://yourserver.example.com/"` | Public base URL for serving generated images |
| `targetLongEdge` | number | `1152` | Target pixel length for the long edge when downscaling |
| `aspect` | string | `""` | Aspect ratio hint (passed to the model) |
| `enhancerEndpoint` | string | OpenAI completions URL | LLM endpoint for prompt enhancement |
| `enhancerApiKey` | string | `"sk-proj-..."` | API key for the prompt enhancer |
| `enhancerModel` | string | `"gpt-4o-mini"` | Model used to enhance/rewrite the image prompt |
| `enhancerTemperature` | number | `0.2` | Temperature for prompt enhancement |
| `enhancerMaxTokens` | number | `350` | Max tokens for prompt enhancement |
| `enhancerTimeoutMs` | number | `60000` | Timeout for the enhancer call |

#### getImageSD

Local Stable Diffusion image generation.

| Key | Type | Example | Description |
|---|---|---|---|
| `baseUrl` | string | `"http://127.0.0.1:7860"` | Base URL of the Stable Diffusion Web UI API |
| `publicBaseUrl` | string | `"https://yourserver.example.com"` | Public URL for serving output images |
| `size` | string | `"256x256"` | Output image dimensions |
| `n` | number | `1` | Number of images |
| `steps` | number | `15` | Diffusion steps |
| `cfgScale` | number | `7` | Guidance scale |
| `sampler` | string | `"Euler a"` | Sampler algorithm |
| `seed` | number | `-1` | Seed (-1 = random) |
| `model` | string | `"realisticVisionV60B1_v51HyperVAE.safetensors"` | Checkpoint model filename |
| `negativeExtra` | string | `"overprocessed, muddy colors"` | Extra negative prompt text |
| `timeoutMs` | number | `1400000` | Request timeout in milliseconds |
| `networkTimeoutMs` | number | `14400000` | Network-level timeout in milliseconds |

#### getImageDescription

Vision model — describe an image.

| Key | Type | Example | Description |
|---|---|---|---|
| `apiKey` | string | `"sk-proj-..."` | API key |
| `model` | string | `"gpt-4o-mini"` | Vision model |
| `endpoint` | string | OpenAI completions URL | API endpoint |
| `temperature` | number | `0.2` | Sampling temperature |
| `maxTokens` | number | `1000` | Max tokens in the description |
| `timeoutMs` | number | `60000` | Request timeout |

#### getAnimatedPicture

Animate a still image into a short video (WAN / Replicate).

| Key | Type | Example | Description |
|---|---|---|---|
| `videoApiToken` | string | `"r8_..."` | Replicate API token |
| `videoBaseUrl` | string | `"https://api.replicate.com/v1"` | Replicate API base URL |
| `videoModel` | string | `"wan-video/wan-2.5-i2v"` | Replicate model identifier |
| `videoPollIntervalMs` | number | `5000` | Polling interval while waiting for video completion |
| `videoTimeoutMs` | number | `600000` | Maximum wait time for video generation |
| `videoPublicBaseUrl` | string | `"https://yourserver.example.com"` | Public base URL for serving the output video |

#### getVideoFromText

Generate a video from a text prompt (Veo-3 / Replicate).

| Key | Type | Example | Description |
|---|---|---|---|
| `videoApiToken` | string | `"r8_..."` | Replicate API token |
| `videoBaseUrl` | string | `"https://api.replicate.com/v1"` | Replicate API base URL |
| `videoModel` | string | `"google/veo-3"` | Replicate model identifier |
| `videoPollIntervalMs` | number | `5000` | Polling interval while waiting for video completion |
| `videoTimeoutMs` | number | `600000` | Maximum wait time |
| `videoPublicBaseUrl` | string | `"https://yourserver.example.com"` | Public base URL for the output video |

#### getGoogle

Google Custom Search Engine.

| Key | Type | Example | Description |
|---|---|---|---|
| `apiKey` | string | `"AIza..."` | Google API key |
| `cseId` | string | `"646890f6ce8ff49f5"` | Custom Search Engine ID |
| `num` | number | `10` | Results per query |
| `safe` | string | `"off"` | Safe search (`"off"` · `"medium"` · `"high"`) |
| `hl` | string | `"de"` | Interface language |
| `lr` | string | `"lang_de"` | Restrict results to language |
| `cr` | string | `"countryDE"` | Restrict results to country |
| `gl` | string | `"de"` | Geolocation for results |
| `timeoutMs` | number | `20000` | Request timeout |

#### getTavily

Tavily Search API — AI-optimised web search with topic and time-range filters.

| Key | Type | Example | Description |
|---|---|---|---|
| `apiKey` | string | `"tvly-..."` | Tavily API key (get at [app.tavily.com](https://app.tavily.com)) |
| `searchDepth` | string | `"basic"` | Default depth: `"basic"` (1 credit) · `"advanced"` (2 credits) |
| `maxResults` | number | `5` | Default number of results (1–20) |
| `topic` | string | `"general"` | Default topic: `"general"` · `"news"` · `"finance"` |
| `timeoutMs` | number | `20000` | Request timeout |
| `includeDomains` | array | `["example.com"]` | Restrict results to these domains (optional) |
| `excludeDomains` | array | `["spam.com"]` | Exclude these domains from results (optional) |
| `country` | string | `"de"` | Boost results from this country (optional) |
| `includeAnswer` | boolean | `false` | Request a Tavily-generated LLM answer alongside results (optional) |

#### getWebpage

Web page fetcher and AI post-processor.

| Key | Type | Example | Description |
|---|---|---|---|
| `userAgent` | string | `"Mozilla/5.0 ..."` | HTTP User-Agent header |
| `timeoutMs` | number | `30000` | Fetch timeout in milliseconds |
| `maxInputChars` | number | `240000` | Maximum characters of page content to process |
| `model` | string | `"gpt-4.1"` | LLM model for AI post-processing |
| `temperature` | number | `0.2` | Sampling temperature |
| `maxTokens` | number | `18000` | Max tokens for AI post-processing |
| `aiTimeoutMs` | number | `45000` | LLM call timeout |
| `wordThreshold` | number | `2000` | Minimum word count before AI post-processing is triggered |
| `endpoint` | string | OpenAI completions URL | LLM endpoint |
| `apiKey` | string | `"sk-proj-..."` | API key |

#### getYoutube

YouTube search and transcript fetcher.

| Key | Type | Example | Description |
|---|---|---|---|
| `googleApiKey` | string | `"AIza..."` | Google API key (YouTube Data API v3) |
| `endpoint` | string | OpenAI completions URL | LLM endpoint for transcript summarisation |
| `apiKey` | string | `"sk-proj-..."` | API key |
| `model` | string | `"gpt-4.1"` | LLM model for summarisation |
| `temperature` | number | `0.2` | Sampling temperature |
| `maxTokens` | number | `8000` | Max tokens for summarisation |
| `dumpThresholdChars` | number | `20000` | Character threshold above which full transcript is truncated |
| `transcriptLangs` | array | `["de","en"]` | Preferred transcript languages (ordered by priority) |
| `regionCode` | string | `"DE"` | YouTube search region |
| `relevanceLanguage` | string | `"de"` | Language hint for YouTube search results |
| `searchMaxResults` | number | `5` | Maximum video search results |
| `aiTimeoutMs` | number | `300000` | LLM call timeout |

#### getHistory

Conversation history retrieval and summarisation.

| Key | Type | Example | Description |
|---|---|---|---|
| `pagesize` | number | `1000` | Rows fetched per page from MySQL |
| `maxRows` | number | `4000` | Absolute maximum rows to read |
| `threshold` | number | `800` | Token count above which a page is summarised |
| `model` | string | `"gpt-4.1"` | Summarisation model |
| `temperature` | number | `0` | Temperature (0 = deterministic for summaries) |
| `maxTokens` | number | `8000` | Max tokens for each summary |
| `aiTimeoutMs` | number | `45000` | LLM call timeout |
| `endpoint` | string | OpenAI completions URL | LLM endpoint |
| `apiKey` | string | `"sk-proj-..."` | API key |
| `includeToolRows` | boolean | `false` | Include tool-call rows in history |
| `chunkMaxTokens` | number | `600` | Maximum token size of each chunk before summarising |

#### getInformation

Information clustering and retrieval from the context log.

| Key | Type | Example | Description |
|---|---|---|---|
| `clusterRows` | number | `200` | Number of context rows to cluster |
| `padRows` | number | `20` | Rows of padding added around a cluster |
| `tokenWindow` | number | `5` | Token window for clustering |
| `maxLogChars` | number | `6000` | Maximum characters from the log to include |
| `maxOutputLines` | number | `1000` | Maximum output lines |
| `minCoverage` | number | `1` | Minimum coverage threshold |
| `eventGapMinutes` | number | `45` | Minutes between events before a new cluster starts |
| `stripCode` | boolean | `false` | Strip code blocks from context before clustering |

#### getConfluence

Atlassian Confluence integration.

| Key | Type | Example | Description |
|---|---|---|---|
| `baseUrl` | string | `"https://yourorg.atlassian.net/wiki"` | Confluence base URL |
| `email` | string | `"user@example.com"` | Atlassian account email |
| `token` | string | `"ATATT3x..."` | Atlassian API token |
| `project` | string | `"ST"` | Default Confluence space key |
| `mainPageId` | string | `"119046402"` | Root page ID to traverse |
| `useV2` | boolean | `true` | Use Confluence API v2 |

#### getJira

Atlassian Jira integration.

| Key | Type | Example | Description |
|---|---|---|---|
| `baseUrl` | string | `"https://yourorg.atlassian.net"` | Jira base URL |
| `email` | string | `"user@example.com"` | Atlassian account email |
| `token` | string | `"ATATT3x..."` | Atlassian API token |
| `projectKey` | string | `"ST"` | Default project key |
| `defaultIssueType` | string | `"Task"` | Default issue type when creating |
| `defaultAssignee` | string | `""` | Default assignee account ID |
| `defaultPriority` | string | `"Medium"` | Default issue priority |
| `timeoutMs` | number | `60000` | API request timeout |
| `defaults.fields` | object | `{summary:"",description:"",priority:{name:"Medium"}}` | Default field values for new issues |
| `customFields` | object | `{epicLink:"customfield_10014",storyPoints:"customfield_10016"}` | Custom field mappings |
| `search.maxResults` | number | `50` | Maximum JQL search results |
| `transitions` | object | `{open:"",inProgress:"",done:""}` | Transition IDs for status changes |

#### getPDF

HTML → PDF generator.

| Key | Type | Example | Description |
|---|---|---|---|
| `publicBaseUrl` | string | `"https://yourserver.example.com"` | Public base URL for serving the generated PDF |
| `headless` | string | `"new"` | Puppeteer headless mode (`"new"` or `true`) |
| `chromeArgs` | array | `["--no-sandbox"]` | Extra arguments passed to Chromium |
| `waitUntil` | string | `"networkidle0"` | Puppeteer page load event to wait for |
| `timeoutMs` | number | `120000` | Page load + PDF generation timeout |
| `format` | string | `"A4"` | Paper format |
| `printBackground` | boolean | `true` | Include background colours and images |

#### getText

Plain-text file generator.

| Key | Type | Example | Description |
|---|---|---|---|
| `publicBaseUrl` | string | `"https://yourserver.example.com"` | Public base URL for serving the generated file |

#### getToken

Animated token (GIF) generator from images or video.

| Key | Type | Example | Description |
|---|---|---|---|
| `publicBaseUrl` | string | `"https://yourserver.example.com"` | Public base URL for serving the GIF |
| `magickPath` | string | `"convert"` | Path to ImageMagick `convert` binary |
| `size` | number | `512` | Output GIF canvas size (pixels) |
| `borderPx` | number | `10` | Border width in pixels |
| `ffmpegPath` | string | `"ffmpeg"` | Path to the `ffmpeg` binary |
| `maxMb` | number | `10` | Maximum output file size in megabytes |
| `fpsList` | array | `[12,10,8]` | Frame-rate candidates tried in order (highest first) |
| `scaleList` | array | `[512,384,320]` | Output scale candidates tried in order |
| `maxColorsList` | array | `[128,96,64,48,32]` | GIF colour-depth candidates tried in order |
| `ditherList` | array | `["bayer:bayer_scale=3:...","none"]` | Dithering algorithms tried in order |
| `useGifsicleLossy` | boolean | `true` | Compress the GIF further with Gifsicle |
| `gifsiclePath` | string | `"gifsicle"` | Path to the `gifsicle` binary |
| `gifsicleLossyLevels` | array | `[80,100,120]` | Lossy compression levels tried in order |

#### getLocation

Google Maps and Street View.

| Key | Type | Example | Description |
|---|---|---|---|
| `googleApiKey` | string | `"AIza..."` | Google API key |
| `publicBaseUrl` | string | `"https://yourserver.example.com"` | Public base URL for serving map images |
| `streetSize` | string | `"800x600"` | Street View image dimensions |
| `streetFov` | number | `90` | Street View field of view (degrees) |
| `timeoutMs` | number | `20000` | API request timeout |

#### getTime

Returns the current UTC time as an ISO 8601 string. No admin configuration required.

| Key | Type | Description |
|---|---|---|
| *(no keys)* | — | This tool requires no toolsconfig entry |

#### getTimeline

Returns stored timeline periods for the current channel.

| Key | Type | Example | Description |
|---|---|---|---|
| *(no keys)* | — | Timeline periods are read from MySQL; no toolsconfig entry required | |

#### getBan

Sends a ban request DM to the configured admin user.

| Key | Type | Example | Description |
|---|---|---|---|
| `adminUserId` | string | `"406901027665870848"` | Discord user ID to send ban DMs to. Falls back to `workingObject.modAdmin` if omitted. |

---

## config

The `config` section wires flows and modules together, and provides per-module settings. Each key is the exact module or flow name.

---

### discord

```jsonc
"discord": {
  "flowName": "discord",
  "token": "<discord-bot-token>",
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

| Key | Description |
|---|---|
| `flowName` | Internal name of this flow (`"discord"`) |
| `token` | Discord bot token |
| `intents` | Array of Discord.js Gateway Intents to request |

---

### api

```jsonc
"api": { "flowName": "api" }
```

The API flow is configured via command-line or defaults (host `0.0.0.0`, port `3400`). Additional keys (`host`, `port`, `path`, `toolcallPath`) can be added here as needed.

---

### webpage-config-editor

Visual config editor SPA served as a **webpage-flow module** (`modules/00047`) on a dedicated port. Renders `core.json` as a tree of collapsible sections — objects appear as cards, flat arrays as tag chips, secrets as password fields, long strings as textareas. Changes are tracked in-memory and saved atomically with Ctrl+S or the **Save** button.

The port must also appear in `config.webpage.ports`. The AI chat has moved to [`webpage-chat`](#webpage-chat).

```jsonc
"webpage-config-editor": {
  "flow":         ["webpage"],
  "port":         3111,
  "basePath":     "/config",
  "file":         "/absolute/path/to/core.json",
  "allowedRoles": ["admin"]
}
```

| Key | Description |
|---|---|
| `flow` | Must include `"webpage"` |
| `port` | HTTP port (default `3111`) — also add to `config.webpage.ports` |
| `basePath` | URL prefix served by this module (default `"/config"`) |
| `file` | Absolute path to the JSON file to edit. Falls back to `core.json` in the project root if omitted. Alias: `configPath` |
| `allowedRoles` | Array of roles allowed to view and save. Empty array `[]` = public. Example: `["admin"]` |

#### _title — Readable Section Names

Any object in `core.json` can have a `_title` key. The Config Editor uses this string as the section header instead of the raw property key.

```jsonc
"bard-join": {
  "_title": "Bard Start/Stop Commands",
  "flow": ["discord-admin"]
}
```

`_title` is skipped when the editor renders fields — it never appears as an editable input, and is ignored entirely at runtime.

> All module config sections in `core.json` already have `_title` values pre-populated. Update them freely without side effects.

---

### webpage-chat

AI chat SPA served as a **webpage-flow module** (`modules/00048`) on port 3112, routed via `GET /chat`. The API secret per channel is injected server-side — never exposed to the browser.

```jsonc
"webpage-chat": {
  "flow":         ["webpage"],
  "port":         3112,
  "basePath":     "/chat",
  "allowedRoles": ["member", "admin"],
  "apiUrl":       "http://localhost:3400/api",
  "chats": [
    { "label": "General",           "channelID": "YOUR_CHANNEL_ID",   "apiSecret": "" },
    { "label": "Browser Extension", "channelID": "browser-extension", "apiSecret": "" }
  ]
}
```

**Chat features:** markdown rendering, media embeds (YouTube/Vimeo, `<video>`, inline images), toolcall name polled per-channel every 800 ms from `/api/toolcall?channelID=<id>`, server-side API secret injection.

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
| `chats[].apiUrl` | Per-chat API URL override; falls back to `apiUrl` if omitted |

---

### webpage-bard

Bard music library manager SPA served as a **webpage-flow module** (`modules/00046`) on port 3114. Provides MP3 upload, tag editing, track deletion, and Bulk Auto-Tag upload.

```jsonc
"webpage-bard": {
  "flow":         ["webpage"],
  "port":         3114,
  "basePath":     "/bard",
  "allowedRoles": ["admin"],
  "autoTag": {
    "enabled":          false,
    "tavilyApiKey":     "tvly-…",
    "tavilyMaxResults": 5,
    "tavilyTimeoutMs":  15000,
    "endpoint":         "https://api.openai.com/v1/chat/completions",
    "apiKey":           "sk-…",
    "model":            "gpt-4o-mini",
    "temperature":      0.2,
    "maxTokens":        200,
    "llmTimeoutMs":     30000,
    "systemPrompt":     "You are a music tagging assistant …",
    "userPrompt":       "Track title: \"{title}\" …"
  }
}
```

| Key | Description |
|---|---|
| `flow` | Must include `"webpage"` |
| `port` | HTTP port (default `3114`) — must also be in `config.webpage.ports` |
| `basePath` | URL base path (default `"/bard"`) |
| `allowedRoles` | Roles allowed to access the UI (e.g. `["admin"]`). Set to `[]` for public access |
| `autoTag.enabled` | Set to `true` to enable the Bulk Auto-Tag Upload endpoint |
| `autoTag.tavilyApiKey` | Tavily API key — used to look up song genre/mood context |
| `autoTag.tavilyMaxResults` | Number of Tavily results to use for context (default `5`) |
| `autoTag.tavilyTimeoutMs` | Tavily request timeout in ms (default `15000`) |
| `autoTag.endpoint` | LLM API endpoint (OpenAI-compatible); defaults to OpenAI chat completions |
| `autoTag.apiKey` | LLM API key |
| `autoTag.model` | LLM model for tag generation (default `"gpt-4o-mini"`) |
| `autoTag.temperature` | LLM temperature (default `0.2`; lower = more consistent) |
| `autoTag.maxTokens` | Max tokens for the LLM tag response (default `200`) |
| `autoTag.llmTimeoutMs` | LLM request timeout in ms (default `30000`) |
| `autoTag.systemPrompt` | LLM system prompt for tag generation. Overrides the built-in instruction when set to a non-empty string. The built-in prompt automatically injects the known locations, situations and moods from `library.xml` per position, so the LLM reuses existing tags rather than inventing new ones. Custom prompts must instruct the LLM to output a JSON array of exactly 6 strings: `[location, situation, mood1, mood2, mood3, mood4]`. Omit or leave empty to use the built-in default. |
| `autoTag.userPrompt` | LLM user prompt template. Placeholders: `{title}` (track name), `{tavilySnippet}` (web search results). Falls back to the built-in template when empty. |

---

### webpage-wiki

AI-driven Fandom-style wiki served as a **webpage-flow module** (`modules/00052`) on port 3117. Each Discord channel gets its own wiki at `/wiki/{channelId}`. Articles are stored in MySQL (table `wiki_articles`, auto-created; `model` column added automatically via migration on first start). Search uses MySQL FULLTEXT; on no match a creator-role user triggers article generation via the **core-ai pipeline**. The LLM model used for generation is stored per article and shown as a small *"Generated by \<model\>"* note at the bottom of the article page.

AI settings are configured via the `overrides` block in `config["webpage-wiki"]`. A **global `overrides`** block sets defaults for all channels; each channel entry may add its own `overrides` block that wins over the global defaults. The module reads exclusively from its own config section — no `core-channel-config` entry is needed or supported for wiki AI settings.

```jsonc
"webpage-wiki": {
  "flow":     ["webpage"],
  "port":     3117,
  "basePath": "/wiki",
  "overrides": {                              // global defaults — apply to all channels
    "useAiModule":      "completions",        // completions | responses | pseudotoolcalls
    "model":            "gpt-4o-mini",        // LLM model for article generation
    "temperature":      0.7,
    "maxTokens":        4000,
    "maxLoops":         5,
    "requestTimeoutMs": 120000,               // AI request timeout in ms
    "includeHistory":   false,                // true = load channel chat history; see note in ADMIN_MANUAL
    "contextSize":      150,                  // messages to load when includeHistory=true
    "tools":            ["getImage", "getTimeline", "getInformation"],
    "systemPrompt":     "",                   // empty = use built-in prompt
    "persona":          "",
    "instructions":     ""
  },
  "channels": [
    {
      "_title":       "My Channel Wiki",
      "channelId":    "YOUR_DISCORD_CHANNEL_ID", // source channel for getInformation/getTimeline
      "allowedRoles": [],                         // [] = public; ["member"] = role-gated
      "adminRoles":   ["admin"],                  // full access; implicitly includes editor + creator; [] = no admin
      "editorRoles":  ["editor"],                 // may edit and delete articles
      "creatorRoles": ["creator"],                // may generate new articles via search
      "maxAgeDays":   7,                          // article TTL in days; 0 = never expire
      "overrides": {                              // optional — channel-specific overrides; win over global
        "maxTokens":    6000,
        "contextSize":  200,
        "instructions": "Always use getInformation to retrieve facts."
      }
    }
  ]
}
```

**Role hierarchy:**

| Role | Key | Allowed actions |
|---|---|---|
| `admin` | `adminRoles` | Everything — implicitly includes editor + creator |
| `editor` | `editorRoles` | Edit and delete articles |
| `creator` | `creatorRoles` | Generate new articles via search |
| *(reader)* | `allowedRoles` | Read articles only |

| Key (`webpage-wiki`) | Type | Default | Description |
|---|---|---|---|
| `flow` | array | — | Must include `"webpage"` |
| `port` | number | `3117` | HTTP port — must also be in `config.webpage.ports` and `config.webpage-auth.ports` |
| `basePath` | string | `"/wiki"` | URL base path |
| `overrides.useAiModule` | string | `"completions"` | AI module: `completions`, `responses`, or `pseudotoolcalls` |
| `overrides.model` | string | `"gpt-4o-mini"` | LLM model for article generation |
| `overrides.temperature` | number | `0.7` | Generation temperature |
| `overrides.maxTokens` | number | `4000` | Max tokens per article |
| `overrides.maxLoops` | number | `5` | Max tool-call loops |
| `overrides.requestTimeoutMs` | number | `120000` | AI request timeout in ms |
| `overrides.includeHistory` | boolean | `false` | Load channel chat history as AI context. Default `false` — see `includeHistory` note in ADMIN_MANUAL |
| `overrides.contextSize` | number | `150` | Number of recent messages loaded when `includeHistory: true` |
| `overrides.tools` | array | `["getImage","getTimeline","getInformation"]` | Tools available to the AI |
| `overrides.systemPrompt` | string | *(built-in)* | Empty = use built-in prompt |
| `overrides.persona` | string | `""` | Persona injected into the AI call |
| `overrides.instructions` | string | `""` | Instructions injected into the AI call |
| `channels[].channelId` | string | — | Discord channel ID; forms `/wiki/{channelId}` and used as context source for tool calls |
| `channels[].allowedRoles` | array | `[]` | Roles allowed to read this wiki. `[]` = public |
| `channels[].adminRoles` | array | `[]` | Full admin access (implicitly includes editor + creator). `[]` = no admin |
| `channels[].editorRoles` | array | `[]` | Roles that may edit and delete articles. `[]` = only admins |
| `channels[].creatorRoles` | array | `[]` | Roles that may generate new articles via search. `[]` = only admins |
| `channels[].maxAgeDays` | number | `7` | Article TTL in days (applies only to unedited articles). Manually edited articles never expire. `0` = never expire |
| `channels[].overrides` | object | `{}` | Per-channel override block — same keys as global `overrides`; channel values take precedence |

- Channel not in `channels[]` → HTTP 404
- AI uses **only tool results** as facts — `getInformation` and `getTimeline` are both mandatory; events always in **chronological order**
- Search always shows the results overview — even a single match never auto-redirects to the article
- The "Generate new article" button passes `force: true` to `/api/generate`, bypassing the existing-article check and always creating a new article
- Non-creator users see search results but no generate button/spinner
- **Image generation** is a required step in the AI prompt — every new article triggers a `getImage` call. AI-generated images are stored in `pub/documents/`; uploaded images in `pub/wiki/{channelId}/images/`. Requires `toolsconfig.getImage.publicBaseUrl` to be set, otherwise the image URL in the DB is `null`.
- Only articles that have **never been manually edited** (`updated_at IS NULL`) are subject to the TTL; edited articles are permanently retained
- Expired articles are pruned passively on each request; direct access returns 404
- All users always see a colour-coded expiry badge on unedited articles (green > 5 days, yellow ≤ 5 days, orange ≤ 2 days / expired); no badge on edited articles
- Add `3117` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`
- Add `reverse_proxy /wiki* localhost:3117` to your Caddyfile

---

### webpage-context

Context DB editor SPA served as a **webpage-flow module** (`modules/00053`) on port 3118. Provides a browser-based interface to browse, search, and bulk-manage conversation context rows stored in MySQL.

```jsonc
"webpage-context": {
  "flow":         ["webpage"],
  "port":         3118,
  "basePath":     "/context",
  "allowedRoles": ["admin"]
}
```

| Key | Description |
|---|---|
| `flow` | Must include `"webpage"` |
| `port` | HTTP port (default `3118`) — must also be in `config.webpage.ports` and `config.webpage-auth.ports` |
| `basePath` | URL base path (default `"/context"`) |
| `allowedRoles` | Roles allowed to access the editor. `[]` = no restriction. Default: `["admin"]` |

**HTTP routes:**

| Method | Path | Description |
|---|---|---|
| `GET` | `/context` | Renders the SPA |
| `GET` | `/context/style.css` | CSS (no auth) |
| `GET` | `/context/api/channels` | All distinct channel IDs with row counts |
| `GET` | `/context/api/columns` | Column names + types from `INFORMATION_SCHEMA` |
| `GET` | `/context/api/records` | Paginated records; params: `channel`, `page`, `limit`, `fields` |
| `GET` | `/context/api/search` | Search; params: `q`, `channel`, `fields`, `searchFields` |
| `DELETE` | `/context/api/delete` | Bulk delete; body: `{ids: [...]}` |
| `POST` | `/context/api/replace/find` | Find matches for preview; body: `{search, channel?, fields}` |
| `POST` | `/context/api/replace/apply` | Replace in single record; body: `{ctx_id, field, search, replace, mode?}` (`mode`: `"partial"` or `"full"`) |
| `POST` | `/context/api/replace/all` | Replace all matches; body: `{search, replace, channel?, fields, mode?}` (`mode`: `"partial"` or `"full"`) |

- Add `3118` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`
- Add `reverse_proxy /context* localhost:3118` to your Caddyfile

---

### webpage-auth

Discord OAuth2 SSO module. Runs passively on every webpage request — sets `wo.webAuth` when a valid session cookie is present. Handles login/logout on `loginPort`.

```jsonc
"webpage-auth": {
  "flow":           ["webpage"],
  "clientId":       "<DISCORD_CLIENT_ID>",
  "clientSecret":   "<DISCORD_CLIENT_SECRET>",
  "redirectUri":    "",
  "loginPort":      3111,
  "ports":          [3111, 3112, 3113, 3114, 3115, 3116, 3117, 3118],
  "sessionTtlMs":   86400000,
  "users": [
    { "discordId": "<YOUR_DISCORD_USER_ID>", "role": "admin" }
  ]
}
```

| Key | Description |
|---|---|
| `flow` | Must include `"webpage"` |
| `clientId` | Discord application client ID (from the Discord Developer Portal) |
| `clientSecret` | Discord application client secret |
| `redirectUri` | OAuth2 callback URL. Set to `""` to auto-derive from the HTTP `Host` header (recommended for multi-domain setups). Otherwise set to the exact callback URL, e.g. `"https://yourserver.example.com/auth/callback"`. Must be registered in the Discord Developer Portal under OAuth2 → Redirects. |
| `loginPort` | Port that handles `/auth/login`, `/auth/callback`, and `/auth/logout` routes. Typically the same port as `webpage-config-editor` (3111). |
| `ports` | All ports where the module runs passively to set `wo.webAuth`. Must include every port where login state matters. |
| `sessionTtlMs` | Session cookie lifetime in milliseconds (default: 86 400 000 = 24 h) |
| `users[].discordId` | Discord user ID |
| `users[].role` | Role assigned to this user (`"admin"`, `"editor"`, `"creator"`, etc.) |

> **Multi-domain:** Set `redirectUri: ""` and register all domains in Discord Developer Portal. The module derives the callback URL automatically from the `Host` header.

- Add all ports used by web modules to `ports`
- Add `reverse_proxy /auth* localhost:3111` to your Caddyfile (before the catch-all)

---

### webpage-menu

Global navigation menu for all web modules. Items are filtered by user role before rendering.

```jsonc
"webpage-menu": {
  "flow": ["webpage"],
  "items": [
    { "text": "💬 Chat",       "link": "/chat"       },
    { "text": "🖼 Inpainting", "link": "/inpainting" },
    { "text": "📖 Wiki",       "link": "/wiki"       },
    { "text": "📚 Docs",       "link": "/docs"       },
    { "text": "🎵 Bard",       "link": "/bard",       "roles": ["admin"] },
    { "text": "📊 Dashboard",  "link": "/dashboard",  "roles": ["admin"] },
    { "text": "⚙️ Config",     "link": "/config",     "roles": ["admin"] },
    { "text": "🗄 Context",    "link": "/context",    "roles": ["admin"] }
  ]
}
```

| Key | Description |
|---|---|
| `flow` | Must include `"webpage"` |
| `items[].text` | Label shown in the navigation bar (supports emoji) |
| `items[].link` | URL the item links to |
| `items[].roles` | If set, item is only visible to users with a matching role. Omit or leave as `[]` for public items |

---

### webpage-dashboard

Live bot telemetry dashboard. Displays flow status, memory usage, and per-module timing. Data is read from the `dashboard:state` registry key, written by `main.js` every 2 seconds.

```jsonc
"webpage-dashboard": {
  "flow":           ["webpage"],
  "port":           3115,
  "basePath":       "/dashboard",
  "allowedRoles":   ["admin"],
  "refreshSeconds": 5
}
```

| Key | Description |
|---|---|
| `flow` | Must include `"webpage"` |
| `port` | HTTP port (default `3115`) — must also be in `config.webpage.ports` |
| `basePath` | URL base path (default `"/dashboard"`) |
| `allowedRoles` | Roles allowed to view the dashboard. Typically `["admin"]` |
| `refreshSeconds` | Auto-refresh interval for the browser page in seconds (default `5`) |

- Add `3115` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`
- Add `reverse_proxy /dashboard* localhost:3115` to your Caddyfile

---

### webpage-documentation

Markdown documentation browser. Reads `.md` files from `documentation/` and renders them as formatted HTML pages with a sidebar navigation.

```jsonc
"webpage-documentation": {
  "flow":         ["webpage"],
  "port":         3116,
  "basePath":     "/docs",
  "allowedRoles": []
}
```

| Key | Description |
|---|---|
| `flow` | Must include `"webpage"` |
| `port` | HTTP port (default `3116`) — must also be in `config.webpage.ports` |
| `basePath` | URL base path (default `"/docs"`) |
| `allowedRoles` | Roles allowed to view the docs. `[]` = public |

- Add `3116` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`
- Add `reverse_proxy /docs* localhost:3116` to your Caddyfile

---

### webpage-inpainting

AI inpainting SPA. Users load an image, paint a mask, enter a prompt, and the backend calls a Stable Diffusion API to fill the masked region.

```jsonc
"webpage-inpainting": {
  "flow":         ["webpage"],
  "port":         3113,
  "basePath":     "/inpainting",
  "allowedRoles": [],
  "auth": {
    "enabled":         false,
    "tokenTtlMinutes": 720,
    "users":           []
  },
  "imageWhitelist": {
    "hosts": ["yourserver.example.com"],
    "paths": ["/documents/"]
  }
}
```

| Key | Description |
|---|---|
| `flow` | Must include `"webpage"` |
| `port` | HTTP port (default `3113`) — must also be in `config.webpage.ports` |
| `basePath` | URL base path (default `"/inpainting"`) |
| `allowedRoles` | Roles allowed to access the editor. `[]` = public |
| `auth.enabled` | Set to `false` to disable auth (proxy and upload accept all requests). `true` = enforce session auth. |
| `auth.tokenTtlMinutes` | Deep-link token TTL in minutes (default `720` = 12 h) |
| `auth.users` | Local user list for inpainting auth (separate from `webpage-auth`) |
| `imageWhitelist.hosts` | Hosts allowed as image sources for the proxy |
| `imageWhitelist.paths` | URL path prefixes that are whitelisted per host |

- Add `3113` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`
- Add both routes to Caddyfile: `reverse_proxy /inpainting* localhost:3113` and `reverse_proxy /documents* localhost:3113`
- Module `00045-webpage-inpaint.js` must also be subscribed to `flow: ["webpage"]`

---

### bard

Headless music scheduler flow. Polls the registry every `pollIntervalMs` milliseconds, selects tracks from `library.xml` based on AI mood labels, and writes `bard:stream:{guildId}` for the browser player.

```jsonc
"bard": {
  "flowName":       "bard",
  "pollIntervalMs": 5000,
  "musicDir":       "assets/bard"
}
```

| Key | Description |
|---|---|
| `flowName` | Internal name (`"bard"`) |
| `pollIntervalMs` | How often `flows/bard.js` polls for session state (milliseconds, min 5000) |
| `musicDir` | Path to the directory containing MP3 files and `library.xml`. Relative to the project root. Default `"assets/bard"` |

> **Note:** `assets/bard/` is in `.gitignore`. Use the Bard UI at `/bard` to manage the music library.

---

### bard-join

Handles `/bardstart` and `/bardstop` slash commands in the `discord-admin` flow.

```jsonc
"bard-join": {
  "_title": "Bard Start/Stop Commands",
  "flow":   ["discord-admin"]
}
```

| Key | Description |
|---|---|
| `flow` | Must include `"discord-admin"` |

---

### bard-cron

Prepares the `bard-label-gen` cron flow by building the AI prompt and payload for `core-ai-completions`. Reads recent chat context and asks the LLM to output **6 structured labels**: `location, situation, mood1, mood2, mood3, mood4`.

```jsonc
"bard-cron": {
  "_title": "Bard Mood Label Generator",
  "flow":   ["bard-label-gen"],
  "prompt": ""
}
```

| Key | Description |
|---|---|
| `flow` | Must include `"bard-label-gen"` |
| `prompt` | Custom system prompt template (overrides the built-in default). Supports `{{LOCATION_TAGS}}`, `{{SITUATION_TAGS}}`, `{{MOOD_TAGS}}` (categorised tag lists from `library.xml`), `{{CURRENT_LABELS}}` (current active labels), and `{{EXAMPLE_LINES}}` (four dynamically generated example lines using real library tags) placeholders. The built-in default uses all five placeholders; custom templates that omit `{{EXAMPLE_LINES}}` will not show dynamic examples. Leave empty to use the built-in prompt |

**Built-in prompt behaviour:**
- Always classifies from the transcript — does not preserve previous labels
- Outputs **exactly 6 comma-separated values**: `location,situation,mood1,mood2,mood3,mood4`
- Empty value for location or situation = "unknown / unchanged" (wildcard in track selection)
- Mood tags ordered by importance; the first mood tag carries the highest scoring weight

To trigger bard label generation, add a cron job pointing to `"bard-label-gen"` as the flow:
```jsonc
{
  "id":        "bard-label-gen",
  "cron":      "*/3 * * * *",
  "enabled":   true,
  "channelID": "YOUR_TEXT_CHANNEL_ID"
}
```

The `channelID` must match the text channel where your D&D session takes place (so the LLM reads the right conversation).

---

### cron

```jsonc
"cron": {
  "flowName": "cron",
  "timezone": "Europe/Berlin",
  "tickMs":   15000,
  "jobs": [
    {
      "id":        "discord-status",
      "cron":      "*/1 * * * *",
      "enabled":   true,
      "channelID": "123456"
    }
  ]
}
```

| Key | Description |
|---|---|
| `flowName` | Internal name of this flow (`"cron"`) |
| `timezone` | Timezone used for cron expression evaluation |
| `tickMs` | How often the cron runner polls for due jobs (ms) |
| `jobs[].id` | Unique job identifier |
| `jobs[].cron` | Cron expression (e.g. `"*/5 * * * *"` for every 5 min) |
| `jobs[].enabled` | Whether this job is active |
| `jobs[].channelID` | Channel context injected into `workingObject.channelID` for this job |

---

### context

```jsonc
"context": {
  "endpoint":   "https://api.openai.com/v1/chat/completions",
  "model":      "gpt-4o-mini",
  "apiKey":     "<key>",
  "periodSize": 600
}
```

| Key | Description |
|---|---|
| `endpoint` | LLM endpoint used by the context summariser |
| `model` | Model used for rolling timeline summarisation |
| `apiKey` | API key for the summariser |
| `periodSize` | Rolling window in seconds; messages older than this are summarised |

---

### webpage

```jsonc
"webpage": {
  "flowName": "webpage",
  "ports": [3000, 3111]
}
```

Declares the webpage flow and the ports it listens on.

| Key | Description |
|---|---|
| `flowName` | Internal name of this flow (`"webpage"`) |
| `ports` | Array of TCP ports to listen on. One HTTP server is started per port. Each request exposes `wo.http.port` so modules can route by port. Falls back to `port` (single number) or `3000` if omitted |
| `port` | *(legacy)* Single port — use `ports` array instead for multi-port operation |

---

### discord-admin

```jsonc
"discord-admin": { "flowName": "discord-admin" }
```

Declares the admin slash command flow.

---

### discord-voice

```jsonc
"discord-voice": { "flowName": "discord-voice" }
```

Declares the voice flow.

---

### toolcall

```jsonc
"toolcall": {
  "flowName":       "toolcall",
  "pollMs":         400,
  "initialDelayMs": 500,
  "registryKey":    "status:tool"
}
```

| Key | Description |
|---|---|
| `flowName` | Internal name of this flow |
| `pollMs` | How frequently the toolcall flow polls the registry (ms) |
| `initialDelayMs` | Delay before the first poll |
| `registryKey` | Registry key where tool-call status updates are stored |

---

### Module Flow Subscriptions

Every module has an entry under `config` that declares which flows it participates in. The key is the exact module name (filename prefix stripped).

```jsonc
"core-ai-responses": {
  "flow": ["discord", "discord-voice", "api"]
}
```

| Pattern | Meaning |
|---|---|
| `"flow": ["discord"]` | Module runs only in the `discord` flow |
| `"flow": ["all"]` | Module runs in every flow |
| `"flowName": "discord"` | This entry *is* the flow definition (not a subscription) |

**Key module subscriptions in the default config:**

| Module key | Flows |
|---|---|
| `core-ai-completions` | `discord`, `discord-voice`, `api`, `discord-status` |
| `core-ai-responses` | `discord`, `discord-voice`, `api`, `discord-status` |
| `core-ai-pseudotoolcalls` | `discord`, `discord-voice`, `api`, `discord-status` |
| `discord-voice-tts` | `discord-voice` |
| `discord-voice-transcribe` | `discord-voice` |
| `discord-add-context` | `discord`, `discord-voice` |
| `discord-text-output` | `all` |
| `core-output` | `all` |
| `moderation-output` | `discord` |
| `discord-gdpr-gate` | `discord`, `discord-voice`, `discord-admin` |
| `discord-channel-gate` | `discord`, `discord-voice`, `discord-admin`, `api` |
| `discord-trigger-gate` | `discord`, `discord-voice` |
| `discord-admin-commands` | `discord-admin`, `discord` |
| `discord-status-prepare` | `discord-status` |
| `discord-status-apply` | `discord-status`, `toolcall` |
| `core-channel-config` | `discord`, `discord-voice`, `discord-admin`, `discord-status`, `api` |
| `core-add-id` | `discord`, `discord-voice`, `api` |
| `bard-join` | `discord-admin` |
| `bard-cron` | `bard-label-gen` |
| `bard-label-output` | `bard-label-gen` |
| `webpage-auth` | `webpage` |
| `webpage-menu` | `webpage` |
| `webpage-dashboard` | `webpage` |
| `webpage-documentation` | `webpage` |
| `webpage-inpainting` | `webpage` |
| `webpage-wiki` | `webpage` |
| `webpage-context` | `webpage` |
| `api-add-context` | `api` |

---

### core-channel-config — Channel Overrides

The most powerful configuration section. Defines a hierarchy of overrides applied before the AI module runs:

```
Channel match
  └── Flow match (within that channel)
        └── User match (within that flow)
```

```jsonc
"core-channel-config": {
  "flow": ["discord", "discord-voice", "discord-admin", "discord-status", "api"],
  "channels": [
    {
      "channelMatch": ["1449472270178320516"],
      "overrides": {
        "botName":      "Jenny",
        "persona":      "You are Jenny, a D&D 5e expert.",
        "systemPrompt": "Answer only in English.",
        "instructions": "Always verify with getGoogle before answering.",
        "trigger":      "",
        "tools":        ["getGoogle", "getWebpage", "getHistory"],
        "contextSize":  70,
        "toolsconfig": {
          "getJira": { "projectKey": "VER" }
        }
      },
      "flows": [
        {
          "flowMatch": ["discord-voice"],
          "overrides": {
            "instructions": "Keep answers under 3 sentences.",
            "trigger":      "Jenny"
          }
        },
        {
          "flowMatch": ["discord-status"],
          "overrides": {
            "useAiModule":           "completions",
            "model":                 "llama2:7b",
            "endpoint":              "http://127.0.0.1:11434/v1/chat/completions",
            "tools":                 [],
            "channelIds":            [],
            "includeRuntimeContext": false,
            "includeHistory":        true,
            "includeHistoryTools":   false,
            "showReactions":         false,
            "maxTokens":             20,
            "temperature":           0.4
          }
        }
      ]
    }
  ]
}
```

**channelMatch values:**

| Value | Meaning |
|---|---|
| Discord channel ID string | Exact channel match |
| `"browser"` | Matches the legacy webpage flow |
| `"browser-extension"` | Matches requests from the Jenny Edge/Chrome browser extension |
| `"all"` | Matches every channel |

**Browser extension channel example:**

```jsonc
{
  "channelMatch": ["browser-extension"],
  "overrides": {
    "apiEnabled":   1,
    "apiSecret":    "",
    "botName":      "Jenny",
    "persona":      "You are Jenny, a browser extension assistant. You help users summarize web pages and YouTube videos.",
    "systemPrompt": "Answer in full sentences. Answer only in English.",
    "instructions": "When given a URL, use getWebpage or getYoutube to fetch and summarize the content.",
    "contextSize":  70,
    "channelIds":   []
  }
}
```

**Merge rules:**

- **Objects** are deep-merged (keys are combined; inner keys of `overrides` win over defaults).
- **Arrays** are replaced wholesale — a `tools` array in an override completely replaces the default.
- Rules are evaluated top-to-bottom; **later rules win**.
- Channel matching is case-insensitive; flow matching is case-insensitive; user matching is case-sensitive.

---

## Complete Annotated Template

Below is a minimal but functional `core.json` template with every section included. Replace placeholder values before use.

```jsonc
{
  "workingObject": {

    // ── Bot identity ──────────────────────────────────────────────────────────
    "botName":      "Jenny",
    "persona":      "A helpful AI assistant.",
    "systemPrompt": "You are a helpful assistant.",
    "instructions": "Answer concisely.",

    // ── Primary LLM ───────────────────────────────────────────────────────────
    "model":             "gpt-4o",
    "endpoint":          "https://api.openai.com/v1/chat/completions",
    "endpointResponses": "https://api.openai.com/v1/responses",
    "apiKey":            "<YOUR_OPENAI_API_KEY>",
    "useAiModule":       "responses",
    "temperature":       0.2,
    "maxTokens":         2000,
    "maxLoops":          15,
    "maxToolCalls":      7,
    "toolChoice":        "auto",
    "reasoning":         false,
    "requestTimeoutMs":  1000000,

    // ── Context ────────────────────────────────────────────────────────────────
    "includeHistory":        true,
    "includeHistoryTools":   false,
    "includeRuntimeContext": true,
    "detailedContext":       true,
    "contextTokenBudget":    60000,
    "contextSize":           20,

    // ── Discord behaviour ──────────────────────────────────────────────────────
    "trigger":                 "jenny",
    "triggerWordWindow":       3,
    "showReactions":           true,
    "modAdmin":                "<ADMIN_DISCORD_USER_ID>",
    "modSilence":              "[silence]",
    "doNotWriteToContext":     false,
    "fileUrls":                [],

    // ── Server / files ─────────────────────────────────────────────────────────
    "timezone": "Europe/Berlin",
    "baseUrl":  "https://yourserver.example.com",

    // ── Tools ─────────────────────────────────────────────────────────────────
    "tools": [
      "getGoogle", "getWebpage", "getImage", "getImageDescription",
      "getAnimatedPicture", "getVideoFromText", "getYoutube",
      "getHistory", "getInformation", "getText", "getPDF",
      "getTime", "getTimeline", "getToken", "getLocation"
    ],

    // ── Voice (TTS / Whisper) ─────────────────────────────────────────────────
    "ttsModel":        "gpt-4o-mini-tts",
    "ttsVoice":        "nova",
    "ttsEndpoint":     "https://api.openai.com/v1/audio/speech",
    "ttsApiKey":       "<YOUR_OPENAI_API_KEY>",
    "whisperApiKey":   "<YOUR_OPENAI_API_KEY>",
    "whisperModel":    "whisper-1",
    "whisperLanguage": "",
    "whisperEndpoint": "https://api.openai.com",
    "useVoiceChannel": 0,

    // ── Avatar generation ─────────────────────────────────────────────────────
    "avatarApiKey":   "<YOUR_OPENAI_API_KEY>",
    "avatarEndpoint": "https://api.openai.com/v1/images/generations",
    "avatarModel":    "dall-e-3",
    "avatarSize":     "1024x1024",
    "avatarPrompt":   "",

    // ── GDPR disclaimer (full legal text) ─────────────────────────────────────
    "gdprDisclaimer": "GDPR Notice & Consent ...",

    // ── Discord slash command definitions ─────────────────────────────────────
    "discord-admin": {
      "slash": {
        "silent":      true,
        "ephemeral":   false,
        "definitions": [ ]
      }
    },

    // ── Database ──────────────────────────────────────────────────────────────
    "db": {
      "host":     "localhost",
      "user":     "discord_bot",
      "password": "<DB_PASSWORD>",
      "database": "discord_ai"
    },

    // ── Tool configuration ────────────────────────────────────────────────────
    "toolsconfig": {
      "getImage": {
        "apiKey":           "<YOUR_OPENAI_API_KEY>",
        "endpoint":         "https://api.openai.com/v1/images/generations",
        "model":            "dall-e-3",
        "size":             "1024x1024",
        "n":                1,
        "publicBaseUrl":    "https://yourserver.example.com/",
        "targetLongEdge":   1152,
        "enhancerEndpoint": "https://api.openai.com/v1/chat/completions",
        "enhancerApiKey":   "<YOUR_OPENAI_API_KEY>",
        "enhancerModel":    "gpt-4o-mini"
      },
      "getGoogle": {
        "apiKey":    "<GOOGLE_API_KEY>",
        "cseId":     "<CSE_ID>",
        "num":       10,
        "timeoutMs": 20000
      },
      "getTavily": {
        "apiKey":      "<TAVILY_API_KEY>",
        "searchDepth": "basic",
        "maxResults":  5,
        "topic":       "general",
        "timeoutMs":   20000
      },
      "getWebpage": {
        "timeoutMs":     30000,
        "maxInputChars": 240000,
        "model":         "gpt-4.1",
        "endpoint":      "https://api.openai.com/v1/chat/completions",
        "apiKey":        "<YOUR_OPENAI_API_KEY>"
      },
      "getHistory": {
        "model":    "gpt-4.1",
        "endpoint": "https://api.openai.com/v1/chat/completions",
        "apiKey":   "<YOUR_OPENAI_API_KEY>",
        "pagesize": 1000,
        "maxRows": 4000
      },
      "getPDF": {
        "publicBaseUrl":   "https://yourserver.example.com",
        "headless":        "new",
        "chromeArgs":      ["--no-sandbox"],
        "waitUntil":       "networkidle0",
        "timeoutMs":       120000,
        "format":          "A4",
        "printBackground": true
      },
      "getText":     { "publicBaseUrl": "https://yourserver.example.com" },
      "getToken":    { "publicBaseUrl": "https://yourserver.example.com", "magickPath": "convert", "ffmpegPath": "ffmpeg", "gifsiclePath": "gifsicle", "size": 512 },
      "getLocation": { "googleApiKey": "<GOOGLE_API_KEY>", "publicBaseUrl": "https://yourserver.example.com" },
      "getYoutube":  { "googleApiKey": "<GOOGLE_API_KEY>", "apiKey": "<YOUR_OPENAI_API_KEY>", "endpoint": "https://api.openai.com/v1/chat/completions", "model": "gpt-4.1" },
      "getAnimatedPicture": {
        "videoApiToken":      "<REPLICATE_TOKEN>",
        "videoBaseUrl":       "https://api.replicate.com/v1",
        "videoModel":         "wan-video/wan-2.5-i2v",
        "videoPublicBaseUrl": "https://yourserver.example.com"
      },
      "getVideoFromText": {
        "videoApiToken":      "<REPLICATE_TOKEN>",
        "videoBaseUrl":       "https://api.replicate.com/v1",
        "videoModel":         "google/veo-3",
        "videoPublicBaseUrl": "https://yourserver.example.com"
      }
    }
  },

  "config": {

    // ── Flows ─────────────────────────────────────────────────────────────────
    "discord": {
      "flowName": "discord",
      "token":    "<DISCORD_BOT_TOKEN>",
      "intents":  ["Guilds","GuildMessages","MessageContent","GuildVoiceStates","GuildMembers","DirectMessages"]
    },
    "api":           { "flowName": "api" },
    "discord-admin": { "flowName": "discord-admin" },
    "discord-voice": { "flowName": "discord-voice" },
    "webpage":       { "flowName": "webpage", "ports": [3000, 3111, 3112, 3113, 3114, 3115, 3116, 3117] },
    "cron": {
      "flowName": "cron",
      "timezone": "Europe/Berlin",
      "tickMs":   15000,
      "jobs": [
        { "id": "discord-status", "cron": "*/1 * * * *", "enabled": true, "channelID": "<CHANNEL_ID>" }
      ]
    },
    "toolcall": {
      "flowName":       "toolcall",
      "pollMs":         400,
      "initialDelayMs": 500,
      "registryKey":    "status:tool"
    },

    // ── Context summariser ────────────────────────────────────────────────────
    "context": {
      "endpoint":   "https://api.openai.com/v1/chat/completions",
      "model":      "gpt-4o-mini",
      "apiKey":     "<YOUR_OPENAI_API_KEY>",
      "periodSize": 600
    },

    // ── Module flow subscriptions ─────────────────────────────────────────────
    "core-ai-responses":       { "flow": ["discord","discord-voice","api","discord-status"] },
    "core-ai-completions":     { "flow": ["discord","discord-voice","api","discord-status"] },
    "core-ai-pseudotoolcalls": { "flow": ["discord","discord-voice","api","discord-status"] },
    "discord-add-context":     { "flow": ["discord","discord-voice"] },
    "discord-text-output":     { "flow": ["all"] },
    "discord-voice-tts":       { "flow": ["discord-voice"] },
    "core-output":             { "flow": ["all"] },
    "moderation-output":       { "flow": ["discord"] },
    "discord-gdpr-gate":       { "flow": ["discord","discord-voice","discord-admin"], "table": "gdpr" },
    "discord-channel-gate":    { "flow": ["discord","discord-voice","discord-admin","api"] },
    "discord-trigger-gate":    { "flow": ["discord","discord-voice"] },
    "discord-admin-commands":  { "flow": ["discord-admin","discord"] },
    "core-admin-commands":     { "flow": ["api"] },
    "discord-status-prepare":  { "flow": ["discord-status"], "allowedChannels": ["<STATUS_CHANNEL_ID>"] },
    "discord-status-apply":    { "flow": ["discord-status","toolcall"], "status": "online" },
    "discord-reaction-start":  { "flow": ["discord"] },
    "discord-reaction-finish": { "flow": ["discord"] },
    "discord-admin-join":      { "flow": ["discord-admin"] },
    "discord-admin-gdpr":      { "flow": ["discord-admin"], "table": "gdpr" },
    "discord-admin-avatar":    { "flow": ["discord-admin"] },
    "discord-admin-macro":     { "flow": ["discord-admin"] },
    "discord-add-files":       { "flow": ["discord"] },
    "core-add-id":             { "flow": ["discord","discord-voice","api"], "servers": ["yourserver.example.com"] },
    "discord-voice-transcribe":{ "flow": ["discord-voice"], "pollMs": 1000, "silenceMs": 1500, "maxCaptureMs": 25000, "minVoicedMs": 1000, "minWavBytes": 24000, "snrDbThreshold": 3.8, "frameMs": 20, "startDebounceMs": 600, "keepWav": false, "maxSegmentsPerRun": 32 },
    "webpage-output":          { "flow": ["webpage"] },
    "webpage-auth": {
      "flow":         ["webpage"],
      "clientId":     "<DISCORD_CLIENT_ID>",
      "clientSecret": "<DISCORD_CLIENT_SECRET>",
      "redirectUri":  "",
      "loginPort":    3111,
      "ports":        [3111, 3112, 3113, 3114, 3115, 3116, 3117, 3118],
      "sessionTtlMs": 86400000,
      "users": [
        { "discordId": "<YOUR_DISCORD_USER_ID>", "role": "admin" }
      ]
    },
    "webpage-menu": {
      "flow": ["webpage"],
      "items": [
        { "text": "💬 Chat",      "link": "/chat"      },
        { "text": "📖 Wiki",      "link": "/wiki"      },
        { "text": "📚 Docs",      "link": "/docs"      },
        { "text": "🎵 Bard",      "link": "/bard",      "roles": ["admin"] },
        { "text": "⚙️ Config",    "link": "/config",    "roles": ["admin"] },
        { "text": "📊 Dashboard", "link": "/dashboard", "roles": ["admin"] },
        { "text": "🗄 Context",   "link": "/context",   "roles": ["admin"] }
      ]
    },
    "webpage-dashboard": {
      "flow": ["webpage"], "port": 3115, "basePath": "/dashboard",
      "allowedRoles": ["admin"], "refreshSeconds": 5
    },
    "webpage-documentation": {
      "flow": ["webpage"], "port": 3116, "basePath": "/docs", "allowedRoles": []
    },
    "webpage-inpainting": {
      "flow": ["webpage"], "port": 3113, "basePath": "/inpainting",
      "allowedRoles": [],
      "auth": { "enabled": false },
      "imageWhitelist": { "hosts": [], "paths": ["/documents/"] }
    },
    "bard": {
      "flowName": "bard", "pollIntervalMs": 5000, "musicDir": "assets/bard"
    },
    "bard-join": {
      "flow": ["discord-admin"]
    },
    "bard-cron": {
      "flow": ["bard-label-gen"], "prompt": ""
    },
    "webpage-wiki": {
      "flow":     ["webpage"],
      "port":     3117,
      "basePath": "/wiki",
      "overrides": {
        "useAiModule":      "completions",
        "model":            "gpt-4o-mini",
        "temperature":      0.7,
        "maxTokens":        4000,
        "maxLoops":         5,
        "requestTimeoutMs": 120000,
        "includeHistory":   false,
        "contextSize":      150,
        "tools":            ["getImage", "getTimeline", "getInformation"],
        "systemPrompt":     "",
        "persona":          "",
        "instructions":     ""
      },
      "channels": [
        {
          "_title":       "My Channel Wiki",
          "channelId":    "<DISCORD_CHANNEL_ID>",
          "allowedRoles": [],
          "adminRoles":   ["admin"],
          "editorRoles":  ["editor"],
          "creatorRoles": ["creator"],
          "maxAgeDays":   7,
          "overrides":    {}
        }
      ]
    },
    "api-add-context":         { "flow": ["api"] },

    // ── Channel overrides ─────────────────────────────────────────────────────
    "core-channel-config": {
      "flow": ["discord","discord-voice","discord-admin","discord-status","api"],
      "channels": [
        {
          "channelMatch": ["<YOUR_CHANNEL_ID>"],
          "overrides": {
            "botName":      "Jenny",
            "persona":      "A specialist assistant for this channel.",
            "systemPrompt": "Answer only in English.",
            "instructions": "Be thorough and cite sources.",
            "tools":        ["getGoogle","getWebpage","getHistory"],
            "contextSize":  50
          },
          "flows": [
            {
              "flowMatch": ["discord-voice"],
              "overrides": {
                "instructions": "Keep answers under 3 sentences.",
                "trigger":      "Jenny"
              }
            }
          ]
        }
      ]
    }
  }
}
```

---

*Documentation updated 2026-03-14.*
