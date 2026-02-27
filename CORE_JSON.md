# core.json — Complete Reference

`core.json` is the single configuration file for the entire Jenny bot. It is loaded at startup and watched at runtime — any change triggers an automatic hot-reload within seconds. No restart is required.

The file has two top-level sections:

```jsonc
{
  "workingObject": { ... },  // Runtime defaults merged into every pipeline run
  "config":        { ... }   // Module wiring, flow subscriptions, and overrides
}
```

All key names follow **camelCase** throughout.

> **Tip:** Use `__description` fields freely anywhere in the JSON. They are ignored by the bot and serve purely as inline comments.

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
2. [config](#config)
   - [discord](#discord)
   - [api](#api)
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
| `allowArtifactGeneration` | boolean | `true` | **Currently not implemented** — reserved for a future global on/off switch for image and file generation. Setting this value has no effect. |
| `requestTimeoutMs` | number | `1000000` | HTTP request timeout in milliseconds for LLM calls |
| `triggerWordWindow` | number | `3` | Words scanned at the start of a message for the trigger word |
| `trigger` | string | `"jenny"` | Trigger word that activates the bot (empty = always active) |
| `doNotWriteToContext` | boolean | `false` | Skip writing this turn to MySQL (useful for status flows) |
| `showReactions` | boolean | `true` | Add emoji reactions to Discord messages during processing |
| `timezone` | string | `"Europe/Berlin"` | Default timezone for time-aware modules and tools |
| `baseUrl` | string | `"https://yourserver.example.com"` | Public base URL for serving generated files (images, PDFs, etc.) |
| `modAdmin` | string | `"406901027665870848"` | Discord user ID with elevated bot admin rights |
| `modSilence` | string | `"[silence]"` | If this token appears in the AI response, output is suppressed |
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
| `base_url` | string | `"http://127.0.0.1:7860"` | Base URL of the Stable Diffusion Web UI API |
| `publicBaseUrl` | string | `"https://yourserver.example.com"` | Public URL for serving output images |
| `size` | string | `"256x256"` | Output image dimensions |
| `n` | number | `1` | Number of images |
| `steps` | number | `15` | Diffusion steps |
| `cfg_scale` | number | `7` | Guidance scale |
| `sampler` | string | `"Euler a"` | Sampler algorithm |
| `seed` | number | `-1` | Seed (-1 = random) |
| `model` | string | `"realisticVisionV60B1_v51HyperVAE.safetensors"` | Checkpoint model filename |
| `negative_extra` | string | `"overprocessed, muddy colors"` | Extra negative prompt text |
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
| `max_tokens` | number | `1000` | Max tokens in the description |
| `timeout_ms` | number | `60000` | Request timeout |

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

#### getWebpage

Web page fetcher and AI post-processor.

| Key | Type | Example | Description |
|---|---|---|---|
| `user_agent` | string | `"Mozilla/5.0 ..."` | HTTP User-Agent header |
| `timeoutMs` | number | `30000` | Fetch timeout in milliseconds |
| `maxInputChars` | number | `240000` | Maximum characters of page content to process |
| `model` | string | `"gpt-4.1"` | LLM model for AI post-processing |
| `temperature` | number | `0.2` | Sampling temperature |
| `max_tokens` | number | `18000` | Max tokens for AI post-processing |
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
| `max_tokens` | number | `8000` | Max tokens for summarisation |
| `dump_threshold_chars` | number | `20000` | Character threshold above which full transcript is truncated |
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
| `max_rows` | number | `4000` | Absolute maximum rows to read |
| `threshold` | number | `800` | Token count above which a page is summarised |
| `model` | string | `"gpt-4.1"` | Summarisation model |
| `temperature` | number | `0` | Temperature (0 = deterministic for summaries) |
| `max_tokens` | number | `8000` | Max tokens for each summary |
| `aiTimeoutMs` | number | `45000` | LLM call timeout |
| `endpoint` | string | OpenAI completions URL | LLM endpoint |
| `apiKey` | string | `"sk-proj-..."` | API key |
| `include_tool_rows` | boolean | `false` | Include tool-call rows in history |
| `chunk_max_tokens` | number | `600` | Maximum token size of each chunk before summarising |

#### getInformation

Information clustering and retrieval from the context log.

| Key | Type | Example | Description |
|---|---|---|---|
| `cluster_rows` | number | `200` | Number of context rows to cluster |
| `pad_rows` | number | `20` | Rows of padding added around a cluster |
| `token_window` | number | `5` | Token window for clustering |
| `max_log_chars` | number | `6000` | Maximum characters from the log to include |
| `max_output_lines` | number | `1000` | Maximum output lines |
| `min_coverage` | number | `1` | Minimum coverage threshold |
| `event_gap_minutes` | number | `45` | Minutes between events before a new cluster starts |
| `max_timeline_periods` | number | `30` | Maximum number of timeline periods |
| `strip_code` | boolean | `false` | Strip code blocks from context before clustering |

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
| `border_px` | number | `10` | Border width in pixels |
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
| `street_size` | string | `"800x600"` | Street View image dimensions |
| `street_fov` | number | `90` | Street View field of view (degrees) |
| `timeoutMs` | number | `20000` | API request timeout |

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
"webpage": { "flowName": "webpage" }
```

Declares the webpage flow.

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
| `"browser"` | Matches the webpage / browser extension flow |
| `"all"` | Matches every channel |

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
    "allowArtifactGeneration": true,
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
        "max_rows": 4000
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
    "webpage":       { "flowName": "webpage" },
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
    "discord-voice-transcribe":{ "flow": ["discord-voice"], "pollMs": 1000, "silenceMs": 1500, "maxCaptureMs": 25000 },
    "webpage-output":          { "flow": ["webpage"] },
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

*Documentation generated 2026-02-26.*
