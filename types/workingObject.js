/**
 * @file types/workingObject.js
 * JSDoc type definitions for the Jenny Bot module pipeline.
 * No runtime code — import this file only in JSDoc @typedef references.
 *
 * Central reference for every field a module may read or write on `wo`
 * (coreData.workingObject). All modules receive and return `coreData`;
 * `wo` is always `coreData.workingObject`.
 */

/**
 * HTTP response descriptor set by webpage modules.
 * Consumed by 09300-webpage-output to send the actual response.
 *
 * @typedef {Object} WebHttpResponse
 * @property {number}               status   - HTTP status code (default 404)
 * @property {Object}               headers  - Response headers
 * @property {string|Buffer|Object|null} body - Response body; Object is JSON-serialised automatically
 * @property {string}               [filePath] - Serve a file from disk instead of body (absolute or pub-relative path)
 */

/**
 * HTTP context populated by flows/webpage.js for every incoming request.
 *
 * @typedef {Object} WebHttpContext
 * @property {import("node:http").IncomingMessage} req  - Raw Node.js request object
 * @property {import("node:http").ServerResponse}  res  - Raw Node.js response object
 * @property {string}            method       - HTTP method ("GET", "POST", …)
 * @property {string}            url          - Full request URL (path + query)
 * @property {string}            path         - URL path without query string
 * @property {Object<string,string>} headers  - Request headers (lower-cased keys)
 * @property {string|null}       remoteAddress - Client IP address
 * @property {string|null}       host         - Host header value
 * @property {string}            receivedAt   - ISO8601 timestamp when request arrived
 * @property {number}            port         - Server port this request arrived on
 * @property {"api"|"document"|"other"} kind  - Request category
 * @property {string}            pubRoot      - Absolute path to pub/ directory
 * @property {string}            documentsRoot - Absolute path to pub/documents/
 * @property {Object<string,string>} query    - Parsed URL query parameters
 * @property {Buffer}            [rawBodyBytes] - Raw request body as Buffer (POST/PUT/PATCH/DELETE)
 * @property {string}            [rawBody]    - Raw request body as UTF-8 string
 * @property {Object}            [json]       - Parsed JSON body (if valid JSON)
 * @property {WebHttpResponse}   response     - Response descriptor for 09300-webpage-output
 */

/**
 * Rendered webpage state accumulated during a webpage pipeline run.
 *
 * @typedef {Object} WebContext
 * @property {number}   port       - Same as wo.http.port (convenience copy)
 * @property {Array}    menu       - Nav menu items added by each module
 * @property {string|null} html    - Page body HTML set by the first matching module
 * @property {boolean}  useLayout  - false = module builds the full HTML document itself
 */

/**
 * Authenticated user info set by 00040-webpage-auth.
 *
 * @typedef {Object} WebAuth
 * @property {string} userId   - Discord user ID
 * @property {string} id       - Alias for userId
 * @property {string} role     - Role name (e.g. "admin", "editor", "member", "dnd")
 * @property {string} guildId  - Discord guild ID the session was authenticated against
 */

/**
 * A single TTS audio segment produced by 08100-core-voice-tts.
 *
 * @typedef {Object} TtsSegment
 * @property {Buffer} buffer - MP3 audio data
 * @property {string} text   - Source text for this segment
 */

/**
 * The working object passed through every module in the pipeline.
 * Modules receive `coreData` and access `wo` via `coreData.workingObject`.
 *
 * Naming convention:
 *   wo.channelID  — uppercase ID (Discord convention)
 *   wo.guildId    — mixed case (Discord.js convention)
 *   wo.userId     — camelCase
 *
 * @typedef {Object} WorkingObject
 *
 * ── Core (all flows) ──────────────────────────────────────────────────────────
 * @property {string}   turn_id          - ULID for this pipeline run (unique per request)
 * @property {string}   flow             - Active flow name ("discord", "discord-voice", "api", "webpage", "discord-status", "bard-label-gen", …)
 * @property {string}   payload          - User message / input text
 * @property {string}   timestamp        - ISO8601 creation timestamp
 * @property {string}   channelID        - Channel identifier (Discord channel ID or logical name)
 * @property {boolean}  channelallowed   - Set by 00010-core-channel-config; true = channel is configured and active
 * @property {boolean}  [stop]           - When true, pipeline halts after the current module. Jump phase (≥9000) still runs.
 * @property {string}   [stopReason]     - Human-readable reason why stop was set (e.g. "channel_not_allowed", "gdpr", "trigger_not_found")
 * @property {boolean}  [jump]           - When true, pipeline skips to the jump phase (modules ≥9000)
 * @property {string}   [response]       - AI-generated response text (set by 01000-core-ai-completions or similar)
 * @property {boolean}  [doNotWriteToContext] - When true, 01004-core-ai-context-writer skips DB write
 * @property {string|string[]} [flowModuleAdd]    - Module name(s) to dynamically inject into this run
 * @property {string|string[]} [flowModuleRemove] - Module name(s) to skip in this run
 * @property {string}   [baseUrl]        - Public-facing base URL used for media document links (e.g. "https://xbullseyegaming.de")
 *
 * ── Discord ───────────────────────────────────────────────────────────────────
 * @property {string}   [id]             - Discord channel ID (same as channelID in discord flow)
 * @property {*}        [message]        - Raw Discord.js Message object
 * @property {string}   [clientRef]      - Registry key for the Discord.js Client instance
 * @property {string}   [userId]         - Author's Discord user ID
 * @property {string}   [authorDisplayname] - Member display name or username
 * @property {string}   [guildId]        - Discord guild (server) ID
 * @property {string}   [voiceSessionRef]  - Registry key of the active voice session for this guild
 * @property {number|null} [channelType] - Discord ChannelType enum value
 * @property {boolean}  [isDM]           - true when the message is a Direct Message
 * @property {string[]} [fileUrls]       - Attachment URLs from the Discord message
 * @property {boolean}  [isMacro]        - true when the message was triggered by a macro (tag stripped)
 * @property {string[]} [botsAllow]      - Bot user IDs allowed to trigger the flow without being filtered
 * @property {string}   [updateStatus]   - When truthy, 03000-discord-status-apply updates the bot presence
 * @property {boolean}  [useVoiceChannel] - Route TTS output to the Discord voice channel instead of text
 *
 * ── API ───────────────────────────────────────────────────────────────────────
 * @property {"http"|"api"} [source]     - "http" for webpage flow, "api" for api flow
 * @property {boolean}  [blocked]        - Set by gate modules (00021, 00022, 00074) when access is denied
 * @property {boolean}  [apiGated]       - Set by 00021-api-token-gate specifically
 *
 * ── Webpage ───────────────────────────────────────────────────────────────────
 * @property {WebHttpContext} [http]     - HTTP request/response context (webpage flow only)
 * @property {WebContext}  [web]         - Rendered page state (webpage flow only)
 * @property {WebAuth}     [webAuth]     - Authenticated user (set by 00040-webpage-auth)
 * @property {boolean}     [isWebpageVoice] - true for voice API requests (handled by 09320 instead of 09300)
 * @property {string}      [subchannel]  - Active subchannel identifier
 * @property {string}      [subchannelId] - Alias for subchannel
 *
 * ── Voice ─────────────────────────────────────────────────────────────────────
 * @property {TtsSegment[]} [ttsSegments]     - TTS audio buffers produced by 08100-core-voice-tts
 * @property {string}       [transcribeSkipped] - Why transcription was skipped (e.g. "too_small", "no_audio")
 * @property {boolean}      [transcribeOnly]  - Transcribe speech but skip AI completion
 *
 * ── AI ────────────────────────────────────────────────────────────────────────
 * @property {string}  [aiType]          - AI module selector: "completions", "responses", "pseudotoolcalls", "roleplay"
 * @property {string}  [model]           - Model override (e.g. "gpt-4o", "claude-opus-4-6")
 * @property {string}  [systemPrompt]    - System prompt override for this request
 * @property {Array}   [tools]           - AI tool definitions; set to [] to disable all tools
 */

export {};
