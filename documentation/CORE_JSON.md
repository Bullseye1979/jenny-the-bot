# core.json — Complete Reference

> **Version:** 1.0 · **Date:** 2026-04-05

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
   - [Diagnostics / Pipeline Logging](#diagnostics--pipeline-logging)
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
     - [getSubAgent](#getsubagent)
     - [getAgentResume](#getagentresume)
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
   - [webpage-landing](#webpage-landing)
   - [webpage-menu](#webpage-menu)
   - [webpage-dashboard](#webpage-dashboard)
   - [webpage-documentation](#webpage-documentation)
   - [webpage-inpainting](#webpage-inpainting)
   - [webpage-inpaint](#webpage-inpaint)
   - [webpage-gallery](#webpage-gallery)
   - [webpage-gdpr](#webpage-gdpr)
   - [webpage-keymanager](#webpage-keymanager)
   - [bard](#bard)
   - [bard-join](#bard-join)
   - [bard-cron](#bard-cron)
   - [cron](#cron)
   - [context](#context)
   - [webpage](#webpage)
   - [discord-admin](#discord-admin)
   - [discord-voice](#discord-voice)
   - [webpage-voice-record](#webpage-voice-record)
   - [discord-voice-capture](#discord-voice-capture)
   - [core-voice-transcribe](#core-voice-transcribe)
   - [core-voice-tts](#core-voice-tts)
   - [discord-voice-tts-play](#discord-voice-tts-play)
   - [webpage-router](#webpage-router)
   - [webpage-voice](#webpage-voice)
   - [webpage-voice-output](#webpage-voice-output)
   - [toolcall](#toolcall)
   - [discord-subagent-poll](#discord-subagent-poll)
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
| `apiKey` | string | `"OPENAI"` | Placeholder name resolved at runtime from the `bot_secrets` DB table via `core/secrets.js`. Set to the symbolic name (e.g. `"OPENAI"`) — the real key value lives in `bot_secrets`. |
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
| `contextChannelID` | string | `""` | Override the channel ID used when reading/writing context. When set, context is stored under this ID instead of `channelID`. Useful when one channel (e.g. a subagent channel) should share history with another. |
| `skipAiCompletions` | boolean | `false` | When `true`, the `core-ai-completions` module exits immediately without running the AI. Use this in flows where the AI call is handled by a different module or must be suppressed entirely for that pipeline pass. |
| `showReactions` | boolean | `true` | Add emoji reactions to Discord messages during processing |
| `timezone` | string | `"Europe/Berlin"` | Default timezone for time-aware modules and tools |
| `baseUrl` | string | `"https://yourserver.example.com"` | Public base URL for serving generated files (images, PDFs, etc.) |
| `modAdmin` | string | `"406901027665870848"` | Discord user ID with elevated bot admin rights |
| `modSilence` | string | `"[silence]"` | If this token appears in the AI response, output is suppressed |
| `apiSecret` | string | `"API_SECRET"` | Placeholder name for the HTTP API bearer token — resolved from `bot_secrets` at runtime. Every `POST /api` request must supply `Authorization: Bearer <real-value>`. Set to `""` or omit to disable token checking. |
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
| `ttsApiKey` | string | `"OPENAI"` | Placeholder name for the TTS API key — resolved from `bot_secrets` at runtime |
| `whisperApiKey` | string | `"OPENAI"` | Placeholder name for the Whisper/transcription API key — resolved from `bot_secrets` at runtime |
| `whisperModel` | string | `"whisper-1"` | Whisper model identifier (legacy fallback). `core-voice-transcribe` defaults to `"gpt-4o-mini-transcribe"` unless overridden via `transcribeModel` in its config block |
| `whisperLanguage` | string | `""` | Force a specific transcription language (ISO 639-1, or empty for auto) |
| `whisperEndpoint` | string | `"https://api.openai.com"` | Base URL for the Whisper/transcription API |

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

Internal API-backed image analysis tool.

| Key | Type | Example | Description |
|---|---|---|---|
| `channelId` | string | `"image-description"` | Internal API channel used for the analysis request |
| `apiUrl` | string | `"http://localhost:3400"` | Internal API base URL |
| `apiSecret` | string | `"API_SECRET"` | Optional bearer placeholder resolved via `bot_secrets` |
| `systemPrompt` | string | `"You are a vision assistant..."` | Optional system instruction prepended to request payload |
| `defaultPrompt` | string | `"Describe the image accurately..."` | Default task text when tool args omit `prompt` |
| `timeoutMs` | number | `30000` | Internal API timeout |

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
| `includeAnsweredTurns` | boolean | `false` | Include user turns that already have a bot reply |
| `includeAssistantTurns` | boolean | `false` | Include `role=assistant` rows; implies `includeAnsweredTurns` |
| `includeAliasSearch` | boolean | `false` | Enable iterative alias resolution (see ADMIN_MANUAL) |
| `aliasMaxDepth` | number | `1` | Alias-extraction rounds. `2` handles 3-step chains (A→B→C) |
| `aliasMaxCount` | number | `8` | Max new aliases per round |
| `aliasSampleRows` | number | `30` | Pass 1 rows fed to the alias AI call |
| `aliasEndpoint` | string | `""` | Endpoint for alias AI call; falls back to `wo.endpoint` |
| `aliasApiKey` | string | `""` | API key for alias AI call; falls back to `wo.apiKey` |
| `aliasModel` | string | `"gpt-4o-mini"` | Model for alias extraction |
| `aliasTimeoutMs` | number | `30000` | Timeout for the alias AI call |

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

#### getSubAgent

Spawns an isolated AI subagent via the internal API flow. Each subagent type maps to a virtual channel configured with its own tool palette, model, and system prompt.

| Key | Type | Example | Description |
|---|---|---|---|
| `apiUrl` | string | `"http://localhost:3400"` | Base URL of the internal API server |
| `apiSecret` | string | `"API_SECRET"` | Placeholder name for the bearer token — resolved from `bot_secrets` at runtime |
| `asyncSpawnPath` | string | `"/api/spawn"` | Path used for spawning jobs (`POST /api/spawn`). Defaults to `"/api/spawn"`. |
| `spawnTimeoutMs` | number | `10000` | Timeout for the initial spawn HTTP request (ms). The subagent itself then runs independently. |
| `maxSpawnDepth` | number | `2` | Maximum nesting depth for subagent spawning. A subagent at depth ≥ `maxSpawnDepth` may not spawn further subagents. |
| `types` | object | `{"research":"subagent-research"}` | Map of type name → virtual channel ID. Each entry enables one subagent type. |

`getSubAgent` always posts to `/api/spawn` and returns immediately with `{ jobId, projectId, status: "started" }`. Results are delivered back to the originating Discord channel by the `discord-subagent-poll` flow when the job completes.

#### getAgentResume

Resumes an existing async subagent project by spawning a follow-up task on the mapped subagent channel.

| Key | Type | Example | Description |
|---|---|---|---|
| `apiUrl` | string | `"http://localhost:3400"` | Base URL of the internal API server |
| `apiSecret` | string | `"API_SECRET"` | Placeholder name for bearer auth; resolved from `bot_secrets` |
| `asyncSpawnPath` | string | `"/api/spawn"` | Spawn endpoint path |
| `spawnTimeoutMs` | number | `10000` | Timeout for spawn request |
| `types` | object | `{"research":"subagent-research"}` | Subagent type map used to resolve the target channel from stored project metadata |

`getAgentResume` reads only `toolsconfig.getAgentResume` and the runtime `workingObject`.

#### getBan

Sends a ban request DM to the configured admin user.

| Key | Type | Example | Description |
|---|---|---|---|
| `adminUserId` | string | `"406901027665870848"` | Discord user ID to send ban DMs to. Falls back to `workingObject.modAdmin` if omitted. |

---

### Diagnostics / Pipeline Logging

Controls the pipeline diff logger in `main.js`. When enabled, every module call that changes the `workingObject` writes a `+`/`-` diff to `logs/pipeline/`. See [ADMIN_MANUAL §7.4](ADMIN_MANUAL.md#74-final-logging-10xxx) for full details.

| Key | Type | Default | Description |
|---|---|---|---|
| `tracePipeline` | boolean | `false` | Master switch. Set to `true` to enable diff logging. No files are written and no snapshots are taken when `false`. |
| `tracePipelineExcludeFlows` | string[] | `[]` | Blacklist of flow names to **skip**. Supports `*` wildcards — e.g. `"webpage*"` excludes all `webpage-*` flows. Omit or leave empty to trace every flow. |

**Recommended production setting** (excludes high-frequency HTTP flows):
```json
"workingObject": {
  "tracePipeline": true,
  "tracePipelineExcludeFlows": ["webpage*", "bard-*"]
}
```

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
"api": {
  "flowName":   "api",
  "host":       "0.0.0.0",
  "port":       3400,
  "path":       "/api",
  "toolcallPath": "/toolcall",
  "contextPath":  "/context",
  "spawnPath":    "/api/spawn",
  "jobsPath":     "/api/jobs",
  "uploadPath":   "/upload",
  "publicBaseUrl": "https://yourserver.example.com"
}
```

| Key | Type | Default | Description |
|---|---|---|---|
| `host` | string | `"0.0.0.0"` | Bind address for the HTTP server |
| `port` | number | `3400` | Port number |
| `path` | string | `"/api"` | Path for the synchronous `POST` endpoint |
| `toolcallPath` | string | `"/toolcall"` | `GET` endpoint for polling tool-call registry status |
| `contextPath` | string | `"/context"` | `GET` endpoint for reading channel conversation history |
| `spawnPath` | string | `"/api/spawn"` | `POST` endpoint for spawning async subagent jobs |
| `jobsPath` | string | `"/api/jobs"` | `GET` endpoint for listing async jobs by `callerChannelId` |
| `uploadPath` | string | `"/upload"` | `POST` endpoint for uploading files (returns public URL) |
| `publicBaseUrl` | string | — | Public base URL used when constructing file URLs returned by `/upload` |

**Endpoints summary:**

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Returns `{ ok: true, botname }` |
| `POST` | `/api` | Bearer | Synchronous AI pipeline request; returns `{ ok, response, turn_id, ... }` |
| `GET` | `/toolcall` | Bearer | Poll current tool-call status; `?channelID=` for channel-specific key |
| `GET` | `/context` | Bearer | Read recent conversation; requires `?channelID=`; optional `?limit=` |
| `POST` | `/api/spawn` | Bearer | Spawn async subagent job; returns `{ ok, jobId, projectId }` immediately |
| `GET` | `/api/jobs` | Bearer | List async jobs for a caller channel; requires `?channelID=` |
| `POST` | `/upload` | Bearer | Upload a file and receive its public URL |

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

AI chat SPA served as a **webpage-flow module** (`modules/00048`) on port 3112, routed via `GET /chat`. `00048-webpage-chat` is a **pure HTTP handler** — it sets up `wo` fields (channelID, payload, systemPrompt, persona, instructions, contextSize) and returns. The AI pipeline modules (01000–01003) handle the AI call naturally; `09300-webpage-output` returns `{ response: wo.response }` as JSON. Subchannels allow scoped conversation threads per channel, stored in the `chat_subchannels` DB table.

```jsonc
"webpage-chat": {
  "flow":               ["webpage"],
  "port":               3112,
  "basePath":           "/chat",
  "allowedRoles":       ["member", "admin"],
  "systemPrompt":       "",
  "contextSize":        20,
  "maxTokens":          1024,
  "toolStatusPollMs":   500,
  "chats": [
    { "label": "General", "channelID": "YOUR_CHANNEL_ID", "roles": [] }
  ]
}
```

**Chat features:** markdown rendering, media embeds (YouTube/Vimeo, `<video>`, inline images), active toolcall name displayed in the thinking bubble via a persistent SSE connection to `GET <basePath>/api/toolstatus/stream?channelID=<id>` (server pushes an event only when the tool name changes — no polling overhead on the client), subchannel CRUD endpoints, file attachments (📎 button in footer).

**File upload flow:** images → `POST /gallery/api/files` (session cookie auth, same-origin); non-images or gallery failure → `POST /chat/api/upload` (server-side proxy to `apiUrl.replace(/\/api/, '/upload')` with optional Bearer token). The uploaded URL is prepended to the message payload before the AI call.

| Key | Description |
|---|---|
| `flow` | Must include `"webpage"` |
| `port` | HTTP port (default `3112`) |
| `basePath` | URL prefix (default `"/chat"`) |
| `allowedRoles` | Roles allowed to access the chat. Empty = public |
| `systemPrompt` | Optional system prompt prepended to every AI call (default `""`) |
| `contextSize` | Recent user turns to include in AI context (default `20`) |
| `maxTokens` | Max tokens in AI response (default `1024`) |
| `toolStatusPollMs` | Server-side check interval in ms for the toolstatus SSE stream (default `500`). The server polls the registry at this rate and pushes a new SSE event only when the active tool name changes. |
| `chats[].label` | Display name in the channel selector |
| `chats[].channelID` | Channel ID used as context scope |
| `chats[].apiUrl` | Internal API endpoint for this chat (default `http://localhost:3400/api`). Also used to derive the upload endpoint (`/upload`). |
| `chats[].apiSecret` | Placeholder name resolved from `bot_secrets` at runtime via `getSecret()`, or a literal token. Sent as `Authorization: Bearer` with AI requests and file upload proxy requests. Falls back to top-level `cfg.apiSecret` if omitted per entry. Leave empty if no token gate is configured. |
| `chats[].roles` | Optional role restriction for this chat entry |

> AI credentials (`apiKey`, `model`, `endpoint`) are read from the workingObject — the same global bot config used by all channels. No separate `ai.*` section is needed in `webpage-chat`.

---

### webpage-bard

Bard music library manager SPA served as a **webpage-flow module** (`modules/00043`) on port 3114. Provides MP3 upload, tag editing, track deletion, and Bulk Auto-Tag upload.

Access is **tiered**: `allowedRoles` grants basic access (Now Playing card + audio stream); `adminRoles` additionally grants full upload and library management rights. Users with no matching role in `allowedRoles` receive a full HTML 403 deny.

```jsonc
"webpage-bard": {
  "flow":         ["webpage"],
  "port":         3114,
  "basePath":     "/bard",
  "allowedRoles": ["admin", "dnd"],
  "adminRoles":   ["admin"],
  "autoTag": {
    "enabled":          false,
    "tavilyApiKey":     "tvly-…",
    "tavilyMaxResults": 5,
    "tavilyTimeoutMs":  15000,
    "apiUrl":           "http://localhost:3400",
    "channelId":        "bard-autotag",
    "apiSecret":        "API_SECRET",
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
| `allowedRoles` | Roles that may access the page at all (Now Playing + audio stream). Empty `[]` = public access. Example: `["admin","dnd"]` |
| `adminRoles` | Roles that additionally get full admin rights (upload, tag editing, delete, autotag). Empty `[]` = nobody. Example: `["admin"]` |
| `autoTag.enabled` | Set to `true` to enable the Bulk Auto-Tag Upload endpoint |
| `autoTag.tavilyApiKey` | Tavily API key — used to look up song genre/mood context |
| `autoTag.tavilyMaxResults` | Number of Tavily results to use for context (default `5`) |
| `autoTag.tavilyTimeoutMs` | Tavily request timeout in ms (default `15000`) |
| `autoTag.apiUrl` | Internal API base URL for tag generation requests |
| `autoTag.channelId` | Internal channel used for autotag inference |
| `autoTag.apiSecret` | Optional bearer placeholder resolved from `bot_secrets` |
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
    "tools":            ["getImage", "getInformation"],
    "systemPrompt":     "",                   // empty = use built-in prompt
    "persona":          "",
    "instructions":     ""
  },
  "channels": [
    {
      "_title":       "My Channel Wiki",
      "channelId":    "YOUR_DISCORD_CHANNEL_ID", // source channel for getInformation tool calls
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
| `overrides.tools` | array | `["getImage","getInformation"]` | Tools available to the AI |
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
- AI uses **only tool results** as facts — `getInformation` is the primary source for article content
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

Discord OAuth2 SSO module. Runs passively on every webpage request — sets `wo.webAuth` when a valid session cookie is present. Handles login/logout on `loginPort`. `wo.userId` is automatically populated from `wo.webAuth.userId` for all downstream modules (context writes, AI modules, etc.) — no per-module fallback chains needed.

```jsonc
"webpage-auth": {
  "flow":             ["webpage"],
  "clientId":         "<DISCORD_CLIENT_ID>",
  "clientSecret":     "<DISCORD_CLIENT_SECRET>",
  "sessionSecret":    "<LONG_RANDOM_SECRET>",
  "redirectUri":      "",
  "scope":            "identify guilds.members.read",
  "loginPort":        3111,
  "ports":            [3111, 3112, 3113, 3114, 3115, 3116, 3117, 3118, 3119, 3120],
  "sessionMaxAgeSec": 43200,
  "sameSite":         "Lax",
  "ssoPartners":      [],
  "guilds": [
    {
      "guildId":      "<PRIMARY_GUILD_ID>",
      "defaultRole":  "member",
      "allowRoleIds": [],
      "rolePriority": ["<ADMIN_ROLE_ID>"],
      "roleMap":      { "<ADMIN_ROLE_ID>": "admin", "<MEMBER_ROLE_ID>": "member" }
    }
  ]
}
```

| Key | Description |
|---|---|
| `flow` | Must include `"webpage"` |
| `clientId` | Discord application client ID (from the Discord Developer Portal) |
| `clientSecret` | Discord application client secret |
| `sessionSecret` | Secret used to sign session cookies — use a long random string |
| `redirectUri` | OAuth2 callback URL. Set to `""` to auto-derive from the HTTP `Host` header (recommended for multi-domain setups). Must be registered in the Discord Developer Portal under OAuth2 → Redirects. |
| `scope` | Discord OAuth2 scope. Use `"identify guilds.members.read"` to read guild roles. |
| `loginPort` | Port that handles `/auth/login`, `/auth/callback`, `/auth/logout`, and `/auth/me`. |
| `ports` | All ports where the module runs passively to set `wo.webAuth`. Include every port where login state matters. |
| `sessionMaxAgeSec` | Session cookie lifetime in seconds (default: 43 200 = 12 h) |
| `sameSite` | Cookie `SameSite` attribute: `"Lax"`, `"Strict"`, or `"None"` |
| `ssoPartners` | Array of partner base URLs for cross-domain SSO chaining. After login the session is forwarded to each partner via a short-lived token. Leave `[]` to disable. |
| `guilds` | List of Discord guilds to authenticate against. Guilds are tried in order — the first guild where the user is a member **and** passes `allowRoleIds` wins. If the user is found in a guild but has no permitted role there, iteration continues to the next guild. Each entry has its own `roleMap`/`rolePriority` so different servers can have different role mappings. |
| `guilds[].guildId` | Discord Guild (server) ID. **The Jenny bot must be invited to this server.** |
| `guilds[].defaultRole` | Role assigned to authenticated members not matched by `roleMap` |
| `guilds[].allowRoleIds` | If non-empty, only users with at least one of these role IDs are allowed in |
| `guilds[].rolePriority` | Role IDs checked first; highest-priority first |
| `guilds[].roleMap` | Maps Discord Role ID → role label (`"admin"`, `"member"`, etc.) |

> **Role label persistence:** The role label (e.g. `"dnd"`, `"admin"`, `"member"`) is normalized once at login time using the matched guild's `roleMap` and stored in the signed session cookie. On every subsequent request it is read directly from the session — no re-normalization occurs. This means custom labels are preserved correctly even when the root config has no `roleMap`.

> **Backward compat:** The old format with `guildId`, `roleMap`, `rolePriority`, `defaultRole`, `allowRoleIds` at the top level (instead of inside `guilds[]`) is still supported.

> **Multi-guild:** Add more entries to `guilds[]`. The bot must be invited to each server (you need admin rights on the target server — no Developer Portal access required). Useful for authenticating users from multiple Discord servers without having them join one central server.

> **Multi-domain:** Set `redirectUri: ""` and register all domains in the Discord Developer Portal. The module derives the callback URL from the `Host` header automatically.

- Add all ports used by web modules to `ports`
- Add `reverse_proxy /auth* localhost:3111` to your Caddyfile (before the catch-all)
- `GET /auth/me` — returns `{ ok, userId, username, role }` for the current session, or `401 { ok: false }` if not authenticated. Used by the browser extension to retrieve the logged-in user's identity.

---

### webpage-landing

Landing page served at `GET /` after login. Shows the authenticated user's name and role, and renders the role-filtered navigation menu (`wo.web.menu`, set by `00041-webpage-menu`). Unauthenticated requests are redirected to `/auth/login`.

```jsonc
"webpage-landing": {
  "flow": ["webpage"],
  "port": 3111
}
```

| Key | Description |
|---|---|
| `flow` | Must include `"webpage"` |
| `port` | Port on which `GET /` is handled (default: `3111`) |

---

### webpage-menu

Global navigation menu for all web modules. Items are filtered by user role before rendering.

```jsonc
"webpage-menu": {
  "flow": ["webpage"],
  "items": [
    { "text": "💬 Chat",       "link": "/chat",       "roles": ["member", "admin"] },
    { "text": "🖼 Inpainting", "link": "/inpainting" },
    { "text": "🖼 Gallery",    "link": "/gallery",    "roles": ["member", "admin"] },
    { "text": "🔒 GDPR",       "link": "/gdpr",       "roles": ["member", "admin"] },
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
- Module `00042-webpage-inpaint.js` must also be subscribed to `flow: ["webpage"]`

---

### webpage-inpaint

Redirect module (`modules/00042-webpage-inpaint.js`). Intercepts `GET /documents/*.png` requests and redirects them to the inpainting editor. This allows images generated by the bot (stored under `pub/documents/`) to be opened directly in the inpainting SPA via a single click.

```jsonc
"webpage-inpaint": {
  "flow":        ["webpage"],
  "inpaintHost": "jenny.example.com/inpainting"
}
```

| Key | Description |
|---|---|
| `flow` | Must include `"webpage"` |
| `inpaintHost` | Redirect target. **When the value contains a hostname** (does not start with `/`), it is used as-is as the redirect destination host + path, e.g. `"jenny.example.com/inpainting"`. **When the value starts with `/`**, it is treated as a path suffix appended to the request's own hostname, e.g. `"/inpainting"` → `<request-host>/inpainting`. **Recommendation:** use a fixed hostname pointing to the domain where your users log in (e.g. `"jenny.ralfreschke.de/inpainting"`). This ensures the session cookie is always valid on the inpainting SPA regardless of which domain the image link originates from. Use path-only (`"/inpainting"`) only when all image links and the inpainting SPA share the same domain. |

> Image files (PNG, JPG, JPEG, WebP, GIF, BMP) under `/documents/` are redirected. All other paths pass through unchanged. Add `?raw=1` to bypass the redirect and receive the raw file.

---

### webpage-gallery

Image gallery SPA (`modules/00056-webpage-gallery.js`). Shows the logged-in user's images stored in `pub/documents/<userId>/`. Users can open images in the inpainting editor or delete them. Supports gallery upload via a REST endpoint (`POST /gallery/api/files`).

```jsonc
"webpage-gallery": {
  "flow":         ["webpage"],
  "port":         3120,
  "basePath":     "/gallery",
  "inpaintingUrl": "https://jenny.example.com/inpainting"
}
```

| Key | Description |
|---|---|
| `flow` | Must include `"webpage"` |
| `port` | HTTP port (default `3120`) — must also be in `config.webpage.ports` and `config.webpage-auth.ports` |
| `basePath` | URL base path (default `"/gallery"`) |
| `inpaintingUrl` | Full URL of the inpainting SPA. Used by the gallery SPA's "Inpaint" button to construct the deep-link (e.g. `https://jenny.example.com/inpainting?src=<imageUrl>`). Must match the public URL where the inpainting module is served. |

**HTTP routes:**

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/gallery` | Required | Renders the gallery SPA |
| `GET` | `/gallery/style.css` | None | Serves shared CSS |
| `GET` | `/gallery/api/files` | Required | Lists all images for the logged-in user |
| `POST` | `/gallery/api/files` | Required | Uploads an image for the logged-in user. Send raw image bytes as the request body with `X-Filename: <filename>` header. Returns `{ ok, url, filename }`. |
| `DELETE` | `/gallery/api/files` | Required | Deletes an image. Body: `{ filename }`. Returns `{ ok }`. |

- Add `3120` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`
- Add `reverse_proxy /gallery* localhost:3120` to your Caddyfile
- The module requires `webpage-auth` to be active on port 3120 — unauthenticated requests are redirected to `/`

---

### webpage-gdpr

GDPR data-export SPA. Authenticated users can download an Excel file (`.xlsx`) containing all personal data held for their account:

- **Sheet 1 – Context** — all conversation history rows where `id = userId`
- **Sheet 2 – GDPR Consent** — consent records per channel for the user
- **Sheet 3 – Files** — files stored in the user's personal documents directory (`pub/documents/<userId>/`)

The file is generated on demand; no data is cached or stored by the module itself.

```jsonc
"webpage-gdpr": {
  "flow":      ["webpage"],
  "port":      3121,
  "basePath":  "/gdpr",
  "gdprTable": "gdpr"
}
```

| Key | Default | Description |
|---|---|---|
| `flow` | — | Must include `"webpage"` |
| `port` | `3121` | HTTP port this module listens on |
| `basePath` | `"/gdpr"` | URL prefix for all GDPR routes |
| `gdprTable` | `"gdpr"` | MySQL table name for GDPR consent records |

**HTTP routes:**

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/gdpr` | Required | HTML overview page with download button |
| `GET` | `/gdpr/style.css` | None | Serves shared CSS |
| `GET` | `/gdpr/export.xlsx` | Required | Generates and downloads the Excel export |

- Add `3121` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`
- Add `reverse_proxy /gdpr* localhost:3121` to your Caddyfile
- The module requires `webpage-auth` to be active on port 3121 — unauthenticated requests are redirected to `/`
- Requires the `exceljs` npm package (`npm install`)
- Database connection is read from `wo.db` (set by the `context` config block)

---

### webpage-keymanager

Admin CRUD web UI for the `bot_secrets` table. Lets admins view, add, edit, and delete secret mappings (placeholder name → real value) without touching MySQL directly. Each row shows the placeholder name with its masked value stacked below it. Icon buttons: **👁** reveal/hide, **📋** copy to clipboard, **✏️** edit, **🗑️** delete. The table fits on mobile without horizontal scroll; the description column is hidden on narrow viewports. See [ADMIN_MANUAL §9.4](#94-secretsjs--centralized-secret-store) for the full secrets system description.

```jsonc
"webpage-keymanager": {
  "flow":         ["webpage"],
  "port":         3122,
  "basePath":     "/key-manager",
  "allowedRoles": ["admin"]
}
```

| Key | Default | Description |
|---|---|---|
| `flow` | — | Must include `"webpage"` |
| `port` | `3122` | HTTP port this module listens on |
| `basePath` | `"/key-manager"` | URL prefix |
| `allowedRoles` | `["admin"]` | Roles permitted to access the page |

**HTTP routes:**

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/key-manager` | Required (admin) | Main UI page |
| `GET` | `/key-manager/api/list` | Required (admin) | JSON list of all secrets `{ok, secrets:[{name,value,description}]}` |
| `POST` | `/key-manager/api/set` | Required (admin) | Upsert a secret. Body: `{name, value, description?}` |
| `POST` | `/key-manager/api/delete` | Required (admin) | Delete a secret. Body: `{name}` |

- Add `3122` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`
- Add `reverse_proxy /key-manager* localhost:3122` to your Caddyfile
- The `bot_secrets` table is created automatically on first request (idempotent)

---

### webpage-live

Live context monitor SPA (`modules/00059-webpage-live.js`) on port 3123, `/live`. Polls the `context` table and streams new rows as a real-time chat transcript. Channel selection, field toggles (timestamp, channel ID, role), and autoscroll state persist in `localStorage`.

**Message parsing:** the `json` column of each context row is parsed to extract `authorName` (displayed as the speaker label) and `content` (the message text). Rows with `internal_meta: true` or text starting with `META|` are suppressed.

```jsonc
"webpage-live": {
  "flow":           ["webpage"],
  "port":           3123,
  "basePath":       "/live",
  "allowedRoles":   ["admin"],
  "pollIntervalMs": 2000,
  "messageLimit":   300
}
```

| Key | Default | Description |
|---|---|---|
| `flow` | — | Must include `"webpage"` |
| `port` | `3123` | HTTP port |
| `basePath` | `"/live"` | URL prefix |
| `allowedRoles` | `["admin"]` | Roles permitted to access the page |
| `pollIntervalMs` | `2000` | Default poll interval (ms); minimum 500; overridable in UI |
| `messageLimit` | `300` | Maximum rows per API response; caps the initial load limit available in the UI |

**HTTP routes:**

| Method | Path | Description |
|---|---|---|
| `GET` | `/live` | Main SPA |
| `GET` | `/live/style.css` | Shared stylesheet |
| `GET` | `/live/api/channels` | Distinct channel IDs with row counts |
| `GET` | `/live/api/messages?channels=a,b&afterId=N&limit=L` | Rows newer than cursor `N` for the given channels |

- Add `3123` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`
- Add `reverse_proxy /live* localhost:3123` to your Caddyfile

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
- Empty value for a slot = "unknown this cycle": location/situation fall back to carry-forward; mood slots are left blank
- Mood tags ordered by importance; the first mood tag carries the highest weight in mood scoring
- The output module applies a **change-preference rescue**: if the AI repeated the previous location/situation from `{{CURRENT_LABELS}}` while mentioning a different known word elsewhere, the different word is preferred (scene-change detection)

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
  "endpoint":           "https://api.openai.com/v1/chat/completions",
  "model":              "gpt-4o-mini",
  "apiKey":             "<key>",
  "periodSize":         600,
  "subchannelFallback": false
}
```

| Key | Description |
|---|---|
| `endpoint` | LLM endpoint used by the context summariser |
| `model` | Model used for rolling timeline summarisation |
| `apiKey` | API key for the summariser |
| `periodSize` | Rolling window in seconds; messages older than this are summarised |
| `subchannelFallback` | `false` (default): when `wo.subchannel` is not set, all functions (getContext, setPurgeContext, setFreezeContext, getContextLastSeconds, getContextSince) operate only on rows where `subchannel IS NULL`. `true`: no subchannel filter — all rows for the channel including subchannel rows are included. |

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

### discord-voice-capture

Controls PCM capture and VAD from the Discord voice receiver. Produces a 16kHz mono WAV and writes `wo.transcribeAudio = true` for the transcription module to pick up.

```jsonc
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

| Key | Type | Default | Description |
|---|---|---|---|
| `flow` | array | — | Must include `"discord-voice"` |
| `pollMs` | number | `1000` | Voice receiver poll interval (ms) |
| `silenceMs` | number | `1500` | Silence duration that ends a capture segment (ms) |
| `maxCaptureMs` | number | `25000` | Maximum capture duration per segment (ms) |
| `minWavBytes` | number | `24000` | Minimum WAV size (bytes); segments below this are skipped |
| `frameMs` | number | `20` | Opus frame duration (ms) |
| `startDebounceMs` | number | `600` | Debounce before starting a new capture (ms) |
| `maxSegmentsPerRun` | number | `32` | Maximum segments processed per polling cycle |
| `keepWav` | boolean | `false` | Retain WAV files on disk after processing (for debugging) |

---

### core-voice-transcribe

Source-agnostic transcription module. Runs in `discord-voice` and `webpage` flows when `wo.transcribeAudio === true`. Applies a quality gate when `wo.audioStats` is set. API credentials fall back to `workingObject.whisperApiKey` / `workingObject.apiKey` if not set here.

```jsonc
"core-voice-transcribe": {
  "flow":               ["discord-voice", "webpage"],
  "minVoicedMs":        1000,
  "snrDbThreshold":     3.8,
  "keepWav":            false,
  "transcribeModel":    "gpt-4o-mini-transcribe",
  "transcribeLanguage": "",
  "transcribeEndpoint": "",
  "transcribeApiKey":   ""
}
```

| Key | Type | Default | Description |
|---|---|---|---|
| `flow` | array | — | Must include the flows where transcription is needed |
| `minVoicedMs` | number | `1000` | Minimum voiced audio (ms) required to attempt transcription; checked against `wo.audioStats.usefulMs` when set |
| `snrDbThreshold` | number | `3.8` | SNR threshold; segments below this are discarded; checked against `wo.audioStats.snrDb` when set |
| `keepWav` | boolean | `false` | Retain WAV files on disk after transcription (for debugging) |
| `transcribeModel` | string | `"gpt-4o-mini-transcribe"` | Transcription model. Overridable per-turn via `wo.transcribeModel`. Alias: `whisperModel` |
| `transcribeLanguage` | string | `""` | Force a specific language (ISO 639-1). Empty = auto-detect. Alias: `whisperLanguage` |
| `transcribeEndpoint` | string | `""` | Base URL for the transcription API. Falls back to `workingObject.whisperEndpoint`. Alias: `whisperEndpoint` |
| `transcribeApiKey` | string | `""` | API key for transcription. Falls back to `workingObject.whisperApiKey` then `workingObject.apiKey`. Alias: `whisperApiKey` |

---

### core-voice-tts

Source-agnostic TTS renderer. Runs in `discord-voice` and `webpage` flows. Parses `[speaker: <voice>]` tags in `wo.response` to support multi-voice segments. Calls the OpenAI TTS API for each segment in parallel (concurrency 2). Output format is controlled by `wo.ttsFormat` or `cfg.ttsFormat` — default `"opus"` for Discord, `"mp3"` for webpage voice. TTS credentials fall back to `workingObject.ttsApiKey` / `workingObject.apiKey` if not set here.

```jsonc
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

| Key | Type | Default | Description |
|---|---|---|---|
| `flow` | array | — | Must include the flows where TTS is needed |
| `ttsModel` | string | `"gpt-4o-mini-tts"` | TTS model. Falls back to `workingObject.ttsModel` if not set |
| `ttsVoice` | string | `"alloy"` | Default TTS voice. Falls back to `workingObject.ttsVoice` if not set |
| `ttsEndpoint` | string | `""` | TTS API endpoint. Falls back to `workingObject.ttsEndpoint` |
| `ttsApiKey` | string | `""` | API key for TTS. Falls back to `workingObject.ttsApiKey` then `workingObject.apiKey` |
| `ttsFormat` | string | `"opus"` | Audio format. Use `"mp3"` for the webpage voice interface; `"opus"` for Discord playback |
| `TTSFetchTimeoutMs` | number | `30000` | HTTP timeout for TTS API calls (ms) |

---

### discord-voice-tts-play

Discord-specific TTS playback. Plays `wo.ttsSegments` sequentially into the active voice channel using the @discordjs/voice AudioPlayer. Manages a guild-level lock to prevent overlapping speech. Only active in `discord-voice`.

```jsonc
"discord-voice-tts-play": {
  "flow": ["discord-voice"]
}
```

| Key | Description |
|---|---|
| `flow` | Must include `"discord-voice"` |

---

### webpage-router

Maps HTTP requests (by port + path prefix) to a named flow and sets `wo.channelID`. Runs before `core-channel-config` so that flow-specific overrides apply to web requests. Active in the `webpage` flow only.

**Why use it:** Without `webpage-router`, all web requests have `wo.flow = "webpage"`. By routing `/voice` to `"webpage-voice"` and `/wiki` to `"webpage-wiki"`, `core-channel-config` `flows[].flowMatch` entries can apply different AI settings per web endpoint.

```jsonc
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

| Key | Type | Description |
|---|---|---|
| `flow` | array | Must include `"webpage"` |
| `routes[].port` | number | HTTP port to match |
| `routes[].pathPrefix` | string | URL path prefix to match |
| `routes[].flow` | string | Value written to `wo.flow` |
| `routes[].channelIdSource` | string | How `wo.channelID` is derived: `"query:<param>"` reads a URL query parameter; `"path:<N>"` reads path segment N after the prefix (0-based); any other string is used as a literal static channel ID |

> `webpage-router` only changes `wo.flow` — the module pipeline is already assembled based on the initial `"webpage"` flow. The new flow name is consumed by `core-channel-config` and logging only.

---

### webpage-voice

Browser-based voice interface with two modes: **always-on continuous listening** (Mic button) and **meeting recorder** (REC button). Serves a self-contained SPA at `GET /voice`, accepts always-on audio at `POST /voice/audio`, and accepts full meeting recordings at `POST /voice/record`.

**Always-on (`POST /voice/audio`):** Audio is converted to 16kHz mono WAV via ffmpeg, handed to `core-voice-transcribe` → AI pipeline → `core-voice-tts` → `webpage-voice-output`. Returns MP3 audio with `X-Transcript` and `X-Response` headers.

**Meeting recorder (`POST /voice/record`):** Transcribes the full recording using `recordModel` with optional speaker diarization. Optionally clears the channel context before storing the transcript. Returns `{ ok, words, speakers }`.

```jsonc
"webpage-voice": {
  "flow":                   ["webpage"],
  "port":                   3119,
  "basePath":               "/voice",
  "silenceTimeoutMs":       2500,
  "maxDurationMs":          30000,
  "recordModel":            "gpt-4o-transcribe",
  "diarize":                true,
  "clearContextChannels":   [],
  "allowedRoles":           [],
  "channels": [
    { "id": "YOUR_CHANNEL_ID", "label": "General" }
  ]
}
```

| Key | Type | Default | Description |
|---|---|---|---|
| `flow` | array | — | Must include `"webpage"` |
| `port` | number | `3119` | HTTP port — must also be in `config.webpage.ports` |
| `basePath` | string | `"/voice"` | URL prefix for this module |
| `silenceTimeoutMs` | number | `2500` | Silence duration (ms) before the always-on mic auto-sends audio |
| `maxDurationMs` | number | `30000` | Hard cap on a single always-on audio segment (ms) |
| `recordModel` | string | `"gpt-4o-transcribe"` | Transcription model for meeting recordings |
| `diarize` | boolean | `true` | Request speaker diarization for meeting recordings |
| `clearContextChannels` | array | `[]` | Channel IDs whose non-frozen context rows are purged (via `setPurgeContext`) before storing a transcript. Frozen rows are never deleted. |
| `allowedRoles` | array | `[]` | Roles that may access `/voice`. Empty = public |
| `channels` | array | `[]` | Channel list for the SPA dropdown: `[{ "id": "...", "label": "..." }]`. If empty, a free-text input is shown. |

### webpage-voice-record

Dedicated endpoint for full meeting uploads (`POST /voice/record`). Handles transcription, optional diarization, optional context purge, and writes transcript entries into context.

```jsonc
"webpage-voice-record": {
  "flow": ["webpage"],
  "port": 3119,
  "recordModel": "gpt-4o-transcribe",
  "diarize": true,
  "diarizationChannelId": "voice-diarize",
  "apiUrl": "http://localhost:3400",
  "apiSecret": "API_SECRET",
  "clearContextChannels": [],
  "allowedRoles": [],
  "diarizationSystemPrompt": ""
}
```

| Key | Type | Description |
|---|---|---|
| `flow` | array | Must include `"webpage"` |
| `port` | number | HTTP port (must match webpage flow port) |
| `recordModel` | string | Transcription model for uploaded meeting recordings |
| `diarize` | boolean | Enables/disables diarization pass |
| `diarizationChannelId` | string | Internal API channel used for diarization inference |
| `apiUrl` | string | Internal API base URL for diarization |
| `apiSecret` | string | Optional bearer placeholder resolved via `bot_secrets` |
| `clearContextChannels` | array | Channels that are purged (non-frozen rows) before transcript write |
| `allowedRoles` | array | Role allowlist for `/voice/record` |
| `diarizationSystemPrompt` | string | Optional prompt prefix added before segment payload |

- Add `3119` to `config.webpage.ports[]` and `config.webpage-auth.ports[]`
- Add `reverse_proxy /voice* localhost:3119` to your Caddyfile
- Optionally add a `webpage-router` route to assign the `"webpage-voice"` flow for `core-channel-config` flow overrides

---

### webpage-voice-output

Sends TTS audio back to the webpage voice caller. Must run in the output phase (≥9000). Triggered unconditionally when `wo.isWebpageVoice === true` — ignores `wo.stop` so a response is always sent.

- **Success:** HTTP 200, `Content-Type: audio/mpeg`, concatenated MP3 buffers from `wo.ttsSegments`. Also sets `X-Transcript` (transcribed user text) and `X-Response` (AI response text) headers.
- **Error:** HTTP 400, `Content-Type: application/json`, `{error: "<reason>"}`.

```jsonc
"webpage-voice-output": {
  "flow": ["webpage"]
}
```

| Key | Description |
|---|---|
| `flow` | Must include `"webpage"` |

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

### discord-subagent-poll

Polls the registry for completed async subagent jobs and delivers results back to the originating Discord channel. This flow is started at bot startup as a background interval — it is not wired to any flow array.

```jsonc
"discord-subagent-poll": {
  "enabled":           false,
  "pollIntervalMs":    5000,
  "callerFlowPattern": ["discord", "discord-voice"],
  "maxJobAgeMs":       86400000
}
```

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `false` | Set to `true` to activate the poller. When `false` the flow file loads but immediately returns. |
| `pollIntervalMs` | number | `5000` | How often to scan the registry for finished jobs (ms). Minimum 1000. |
| `callerFlowPattern` | array | `["discord","discord-voice"]` | Only deliver jobs whose `callerFlow` starts with one of these prefixes. Jobs from other flows (e.g. `api`) are left in the registry until they expire. |
| `maxJobAgeMs` | number | `86400000` | Jobs still `"running"` after this many ms are marked as `"error"` (timed out). Minimum 60000. |

**How async delivery works:**
1. The main AI calls `getSubAgent(type, task)`.
2. `getSubAgent` posts to `/api/spawn` and returns `{ jobId, projectId, status: "started" }` immediately.
3. The API flow runs the subagent pipeline in the background and stores the result under `"job:<jobId>"` in the registry.
4. The `discord-subagent-poll` interval fires, finds the completed job, removes it from the registry, and runs the `discord` pipeline with `wo.deliverSubagentJob = <job>` set — which causes the result to be sent to the original Discord channel.

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
| `core-ai-completions` | `discord`, `discord-voice`, `api`, `discord-status`, `webpage` |
| `core-ai-responses` | `discord`, `discord-voice`, `api`, `discord-status`, `webpage` |
| `core-ai-pseudotoolcalls` | `discord`, `discord-voice`, `api`, `discord-status`, `webpage` |
| `core-ai-roleplay` | `discord`, `discord-voice`, `api`, `discord-status`, `webpage` |
| `discord-voice-capture` | `discord-voice` |
| `core-voice-transcribe` | `discord-voice`, `webpage` |
| `core-voice-tts` | `discord-voice`, `webpage` |
| `discord-voice-tts-play` | `discord-voice` |
| `discord-add-context` | `discord`, `discord-voice` |
| `discord-text-output` | `all` |
| `core-output` | `all` |
| `moderation-output` | `discord` |
| `discord-gdpr-gate` | `discord`, `discord-voice`, `discord-admin`, `webpage` |
| `discord-channel-gate` | `discord`, `discord-voice`, `discord-admin`, `api` |
| `discord-trigger-gate` | `discord`, `discord-voice`, `webpage` |
| `discord-admin-commands` | `discord-admin`, `discord` |
| `discord-status-prepare` | `discord-status` |
| `discord-status-apply` | `discord-status`, `toolcall` |
| `core-channel-config` | `discord`, `discord-voice`, `discord-admin`, `discord-status`, `api`, `webpage` |
| `core-add-id` | `discord`, `discord-voice`, `api` |
| `bard-join` | `discord-admin` |
| `bard-cron` | `bard-label-gen` |
| `bard-label-output` | `bard-label-gen` |
| `webpage-router` | `webpage` |
| `webpage-auth` | `webpage` |
| `webpage-menu` | `webpage` |
| `webpage-dashboard` | `webpage` |
| `webpage-documentation` | `webpage` |
| `webpage-inpaint` | `webpage` |
| `webpage-inpainting` | `webpage` |
| `webpage-gallery` | `webpage` |
| `webpage-gdpr` | `webpage` |
| `webpage-wiki` | `webpage` |
| `webpage-voice` | `webpage` |
| `webpage-voice-output` | `webpage` |
| `webpage-context` | `webpage` |
| `api-add-context` | `api` |
| `webpage-add-context` | called directly by `webpage-chat` (not pipeline-subscribed) |

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
      "getTime", "getToken", "getLocation", "getSubAgent"
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
    "webpage":       { "flowName": "webpage", "ports": [3000, 3111, 3112, 3113, 3114, 3115, 3116, 3117, 3118, 3119, 3120] },
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
      "endpoint":           "https://api.openai.com/v1/chat/completions",
      "model":              "gpt-4o-mini",
      "apiKey":             "<YOUR_OPENAI_API_KEY>",
      "periodSize":         600,
      "subchannelFallback": false
    },

    // ── Module flow subscriptions ─────────────────────────────────────────────
    "core-ai-responses":       { "flow": ["discord","discord-voice","api","discord-status","webpage"] },
    "core-ai-completions":     { "flow": ["discord","discord-voice","api","discord-status","webpage"] },
    "core-ai-pseudotoolcalls": { "flow": ["discord","discord-voice","api","discord-status","webpage"] },
    "core-ai-roleplay":        { "flow": ["discord","discord-voice","api","discord-status","webpage"] },
    "discord-add-context":     { "flow": ["discord","discord-voice"] },
    "discord-text-output":     { "flow": ["all"] },
    "core-output":             { "flow": ["all"] },
    "moderation-output":       { "flow": ["discord"] },
    "discord-gdpr-gate":       { "flow": ["discord","discord-voice","discord-admin","webpage"], "table": "gdpr" },
    "discord-channel-gate":    { "flow": ["discord","discord-voice","discord-admin","api"] },
    "discord-trigger-gate":    { "flow": ["discord","discord-voice","webpage"] },
    "discord-admin-commands":  { "flow": ["discord-admin","discord"] },
    "core-admin-commands":     { "flow": ["api"] },
    "discord-status-prepare":  { "flow": ["discord-status"], "allowedChannels": ["<STATUS_CHANNEL_ID>"] },
    "discord-status-apply":    { "flow": ["discord-status","toolcall"], "allowedFlows": ["discord","discord-voice"], "status": "online" },
    "discord-reaction-start":  { "flow": ["discord"] },
    "discord-reaction-finish": { "flow": ["discord"] },
    "discord-admin-join":      { "flow": ["discord-admin"] },
    "discord-admin-gdpr":      { "flow": ["discord-admin"], "table": "gdpr" },
    "discord-admin-avatar":    { "flow": ["discord-admin"] },
    "discord-admin-macro":     { "flow": ["discord-admin"] },
    "discord-add-files":       { "flow": ["discord"] },
    "core-add-id":             { "flow": ["discord","discord-voice","api"], "servers": ["yourserver.example.com"] },
    "core-channel-config":     { "flow": ["discord","discord-voice","discord-admin","discord-status","api","webpage"] },
    "discord-voice-capture":   { "flow": ["discord-voice"], "pollMs": 1000, "silenceMs": 1500, "maxCaptureMs": 25000, "minWavBytes": 24000, "frameMs": 20, "startDebounceMs": 600, "keepWav": false, "maxSegmentsPerRun": 32 },
    "core-voice-transcribe":   { "flow": ["discord-voice","webpage"], "minVoicedMs": 1000, "snrDbThreshold": 3.8, "keepWav": false, "transcribeModel": "gpt-4o-mini-transcribe" },
    "core-voice-tts":          { "flow": ["discord-voice","webpage"], "ttsModel": "gpt-4o-mini-tts", "ttsVoice": "alloy", "ttsFormat": "opus", "TTSFetchTimeoutMs": 30000 },
    "discord-voice-tts-play":  { "flow": ["discord-voice"] },
    "webpage-output":          { "flow": ["webpage"] },
    "webpage-router": {
      "flow": ["webpage"],
      "routes": [
        { "port": 3117, "pathPrefix": "/wiki",  "flow": "webpage-wiki",  "channelIdSource": "path:0" },
        { "port": 3119, "pathPrefix": "/voice", "flow": "webpage-voice", "channelIdSource": "query:channelId" }
      ]
    },
    "webpage-voice": {
      "flow":                   ["webpage"],
      "port":                   3119,
      "basePath":               "/voice",
      "silenceTimeoutMs":       2500,
      "maxDurationMs":          30000,
      "recordModel":            "gpt-4o-transcribe",
      "diarize":                true,
      "clearContextChannels":   [],
      "allowedRoles":           [],
      "channels":               []
    },
    "webpage-voice-output":    { "flow": ["webpage"] },
    "webpage-auth": {
      "flow":         ["webpage"],
      "clientId":     "<DISCORD_CLIENT_ID>",
      "clientSecret": "<DISCORD_CLIENT_SECRET>",
      "redirectUri":  "",
      "loginPort":    3111,
      "ports":        [3111, 3112, 3113, 3114, 3115, 3116, 3117, 3118, 3119, 3120],
      "sessionTtlMs": 86400000,
      "ssoPartners":  [],
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
    "webpage-inpaint": {
      "flow": ["webpage"],
      "inpaintHost": "jenny.example.com/inpainting"
    },
    "webpage-inpainting": {
      "flow": ["webpage"], "port": 3113, "basePath": "/inpainting",
      "allowedRoles": [],
      "auth": { "enabled": false },
      "imageWhitelist": { "hosts": [], "paths": ["/documents/"] }
    },
    "webpage-gallery": {
      "flow":          ["webpage"],
      "port":          3120,
      "basePath":      "/gallery",
      "inpaintingUrl": "https://jenny.example.com/inpainting"
    },
    "webpage-gdpr": {
      "flow":      ["webpage"],
      "port":      3121,
      "basePath":  "/gdpr",
      "gdprTable": "gdpr"
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
        "tools":            ["getImage", "getInformation"],
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

*Documentation updated 2026-04-05. Version 1.0.*
