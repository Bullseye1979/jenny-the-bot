/**************************************************************/
/* filename: "workingObject.js"                              */
/* Version 1.0                                               */
/* Purpose: JSDoc type definitions for the shared           */
/*          workingObject contract.                          */
/**************************************************************/

/**
 * @file types/workingObject.js
 * JSDoc type definitions for the Jenny Bot module pipeline.
 * No runtime code - import this file only in JSDoc typedef references.
 */

/**
 * HTTP response descriptor set by webpage modules.
 *
 * @typedef {Object} WebHttpResponse
 * @property {number} status
 * @property {Object} headers
 * @property {string|Buffer|Object|null} body
 * @property {string} [filePath]
 */

/**
 * HTTP context populated by flows/webpage.js.
 *
 * @typedef {Object} WebHttpContext
 * @property {import("node:http").IncomingMessage} req
 * @property {import("node:http").ServerResponse} res
 * @property {string} method
 * @property {string} url
 * @property {string} path
 * @property {Object<string,string>} headers
 * @property {string|null} remoteAddress
 * @property {string|null} host
 * @property {string} receivedAt
 * @property {number} port
 * @property {"api"|"document"|"other"} kind
 * @property {string} pubRoot
 * @property {string} documentsRoot
 * @property {Object<string,string>} query
 * @property {Buffer} [rawBodyBytes]
 * @property {string} [rawBody]
 * @property {Object} [json]
 * @property {WebHttpResponse} response
 */

/**
 * Rendered webpage state.
 *
 * @typedef {Object} WebContext
 * @property {number} port
 * @property {Array} menu
 * @property {string|null} html
 * @property {boolean} useLayout
 */

/**
 * Authenticated webpage user.
 *
 * @typedef {Object} WebAuth
 * @property {string} userId
 * @property {string} id
 * @property {string} username
 * @property {string} role
 * @property {string[]} [roles]
 * @property {string} guildId
 */

/**
 * Database connection config.
 *
 * @typedef {Object} DbConfig
 * @property {string} host
 * @property {number} [port]
 * @property {string} user
 * @property {string} password Database password.
 * @property {string} database
 */

/**
 * Discord slash command context.
 *
 * @typedef {Object} AdminContext
 * @property {string} command
 * @property {Object} options
 * @property {string|null} subcommand
 * @property {string|null} subcommandGroup
 * @property {string} userId
 * @property {string} channelId
 * @property {string} guildId
 */

/**
 * Generated TTS segment.
 *
 * @typedef {Object} TtsSegment
 * @property {Buffer} buffer
 * @property {string} text
 */

/**
 * Shared workingObject passed through the pipeline.
 *
 * Secret alias policy:
 * - Secret-related fields may remain on the workingObject.
 * - Committed config should store symbolic aliases such as `OPENAI`,
 *   `API_SECRET` or `DISCORD_CLIENT_SECRET`.
 * - Real secrets are resolved only at runtime through `getSecret(...)`.
 *
 * Naming convention:
 * - Internal runtime fields use camelCase.
 * - `guildId`, `userId`, and `channelId` stay camelCase.
 * - snake_case is allowed only for external contracts such as SQL columns
 *   or third-party API payloads.
 *
 * @typedef {Object} WorkingObject
 * @property {string} [turnId]
 * @property {string} [flow]
 * @property {string} [payload]
 * @property {string} [timestamp]
 * @property {string} [channelId]
 * @property {boolean} [channelAllowed]
 * @property {boolean} [stop]
 * @property {string} [stopReason]
 * @property {boolean} [jump]
 * @property {string} [response]
 * @property {boolean} [doNotWriteToContext]
 * @property {string|string[]} [flowModuleAdd]
 * @property {string|string[]} [flowModuleRemove]
 * @property {string} [baseUrl]
 * @property {string} [botName]
 * @property {string} [trigger]
 * @property {string} [persona]
 * @property {string} [modAdmin] Discord user ID of the bot administrator.
 * @property {string} [modSilence] Magic string that suppresses bot response when set as payload.
 * @property {boolean} [tracePipeline] When true, logs each module execution step to console.
 * @property {string[]} [tracePipelineExcludeFlows] Flow name patterns excluded from pipeline tracing.
 * @property {string} [instructions]
 * @property {string} [timezone]
 * @property {string} [apiKey] Alias for the AI provider secret.
 * @property {string} [endpoint]
 * @property {string} [endpointResponses]
 * @property {string} [model]
 * @property {string} [useAiModule]
 * @property {string} [systemPrompt]
 * @property {number} [temperature]
 * @property {number} [maxTokens]
 * @property {number} [contextSize]
 * @property {number} [contextTokenBudget]
 * @property {number} [triggerWordWindow]
 * @property {string} [toolChoice]
 * @property {Array} [tools]
 * @property {Array} [responseTools]
 * @property {boolean} [includeHistory]
 * @property {boolean} [includeHistoryTools]
 * @property {boolean} [includeHistorySystemMessages]
 * @property {boolean} [includeRuntimeContext]
 * @property {boolean} [moderationEnabled]
 * @property {number} [maxLoops]
 * @property {number} [maxToolCalls]
 * @property {number} [requestTimeoutMs]
 * @property {boolean} [showReactions]
 * @property {string[]} [logging]
 * @property {Object} [toolsconfig]
 * @property {string} [ttsModel]
 * @property {string} [ttsVoice]
 * @property {string} [ttsEndpoint]
 * @property {string} [ttsApiKey] Alias for the TTS secret.
 * @property {string} [ttsFormat]
 * @property {number} [ttsFetchTimeoutMs]
 * @property {string} [transcribeModel]
 * @property {string} [transcribeLanguage]
 * @property {string} [transcribeEndpoint]
 * @property {string} [transcribeApiKey] Alias for the transcription secret.
 * @property {boolean} [transcribeAudio]
 * @property {boolean} [transcribeOnly]
 * @property {number} [transcribeChunkS]
 * @property {number} [transcribeOverlapS]
 * @property {number} [diarizeChunkMB]
 * @property {number} [opusBitrateKbps]
 * @property {number} [snrDbThreshold]
 * @property {number} [minVoicedMs]
 * @property {boolean} [keepWav]
 * @property {string} [audioFile]
 * @property {number} [apiEnabled]
 * @property {string} [apiSecret] Alias for the API bearer secret.
 * @property {string} [httpAuthorization]
 * @property {DbConfig} [db]
 * @property {string} [id]
 * @property {*} [message]
 * @property {string} [clientRef]
 * @property {string} [userId]
 * @property {string} [authorDisplayname]
 * @property {string} [guildId]
 * @property {string} [voiceSessionRef]
 * @property {number|null} [channelType]
 * @property {boolean} [isDM]
 * @property {string[]} [fileUrls]
 * @property {boolean} [isMacro]
 * @property {string[]} [botsAllow]
 * @property {string|boolean} [updateStatus]
 * @property {boolean} [useVoiceChannel]
 * @property {AdminContext} [admin]
 * @property {"http"|"api"} [source]
 * @property {boolean} [blocked]
 * @property {boolean} [apiGated]
 * @property {WebHttpContext} [http]
 * @property {WebContext} [web]
 * @property {WebAuth} [webAuth]
 * @property {boolean} [isWebpageVoice]
 * @property {string} [subchannel]
 * @property {string} [subchannelId]
 * @property {TtsSegment[]} [ttsSegments]
 * @property {string} [transcribeSkipped]
 * @property {string} [contextChannelId]
 * @property {string[]} [contextIds]
 * @property {string} [callerChannelId]
 * @property {string[]} [callerChannelIds]
 * @property {string} [callerFlow]
 * @property {string} [callerContextChannelId]
 * @property {string} [agentType]
 * @property {number} [agentDepth]
 * @property {boolean} [skipAiCompletions]
 * @property {boolean} [allowArtifactGeneration]
 * @property {boolean} [aborted]
 * @property {string} [messageId]
 * @property {string} [jumpReason]
 * @property {string} [systemPromptAddition]
 * @property {boolean} [includeCallerContext]
 * @property {string} [toolcallScope]
 * @property {string} [toolStatusScope]
 * @property {string} [statusScope]
 * @property {boolean} [bypassTriggerGate]
 * @property {boolean} [bypassGdprGate]
 * @property {string} [gdprDisclaimer]
 * @property {string} [agentRolePrompt] System prompt fragment for orchestrator/specialist agents (completions/responses modules).
 * @property {string} [agentDelegateRolePrompt] System prompt fragment for orchestrator/specialist agents (pseudotoolcalls/roleplay modules).
 * @property {string} [primaryRolePrompt] System prompt fragment for primary user-facing assistant mode.
 * @property {string[]} [toolsBlacklist] Tool names excluded from the active tool list.
 * @property {Object} [fallbackOverrides] Applied when the primary endpoint is unreachable.
 * @property {string} [callerTurnId] Turn ID of the calling agent.
 * @property {string} [primaryImageUrl] URL of the primary generated image in the response.
 * @property {Array} [toolCallLog] Log of tool calls made during this turn.
 * @property {boolean} [detailedContext] Whether to include detailed context in the prompt.
 * @property {boolean} [simplifiedContext] Whether to use simplified context format.
 * @property {string} [contextMetaFrames] Context meta frame inclusion mode.
 * @property {boolean} [_backgroundTaskActive] Internal: set to true when a tool signals a background task start.
 * @property {string} [_backgroundTaskTool] Internal: name of the tool that started the background task.
 * @property {string} [_backgroundTaskStatus] Internal: status string from the background task signal.
 * @property {string} [_backgroundTaskStatusMessage] Internal: user-facing message from the background task.
 */

export {};
