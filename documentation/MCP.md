# MCP Integration

Version 1.0

## Overview

The bot supports the Model Context Protocol (MCP) in two directions:

- **MCP Server** - exposes only the local tools that are active for the resolved channel via HTTP or stdio transport (`flows/mcp.js`)
- **MCP Client** - allows the AI to discover and call tools on remote MCP servers via the `getMcpTools` and `getMcp` local tools

---

## MCP Client: Two-Step Tool Execution

Remote MCP tools are never called directly. The AI always uses a two-step sequence:

### Step 1 - Discovery: `getMcpTools`

Connects to configured remote MCP servers and returns all available tools. Tool names are returned in namespaced form:

```text
mcp.<namespace>.<toolName>
```

Example: `mcp.jenny-mcp.getTime`

The `query` parameter filters results by keyword. Use a short task term such as `time`, `email`, `file`, or `search`.

### Step 2 - Execution: `getMcp`

Calls one specific tool on a remote MCP server. Accepts either:

- A namespaced name: `tool: "mcp.jenny-mcp.getTime"` - server is resolved automatically from the namespace
- A raw tool name plus explicit server: `server: "local-jenny"`, `tool: "getTime"`

The `arguments` field contains the input object matching the schema returned by `getMcpTools`.

### Important Rules

- Tool names starting with `mcp.` are never valid local tool calls. They can only be executed via the local MCP execution tool.
- `getMcpTools` is always a discovery step only. It must always be followed by the MCP execution tool available in the current channel.
- Skipping that execution step after `getMcpTools` is not permitted.

---

## Namespacing

Each configured MCP server has a `namespace` property in `toolsconfig.getMcpTools.servers` and `toolsconfig.getMcp.servers`. The namespace is used to prefix all tool names discovered from that server:

```json
{
  "name": "local-jenny",
  "namespace": "jenny-mcp",
  "type": "streamableHttp",
  "url": "https://jenny.ralfreschke.de/mcp"
}
```

A tool named `getTime` on this server becomes `mcp.jenny-mcp.getTime` after discovery.

Namespace characters are normalized: any character outside `[A-Za-z0-9_-]` is replaced with `-`.

If no `namespace` is set, the server `name` is used as the namespace.

---

## Transport Types

Configured in both `toolsconfig.getMcpTools.servers` and `toolsconfig.getMcp.servers`:

| `type` | Description |
|---|---|
| `streamableHttp` | HTTP transport using the MCP Streamable HTTP spec (default) |
| `sse` | HTTP Server-Sent Events transport |
| `stdio` | Local subprocess via stdin/stdout |

### Authentication

Servers can provide bearer token authentication:

```json
{
  "bearerTokenSecret": "JENNY_MCP_TOKEN"
}
```

The value is a secret alias resolved at runtime. Static tokens can be set with `"bearerToken"` instead.

Additional HTTP headers are supported via the `headers` array:

```json
"headers": [
  { "header": "x-channel-id", "valueFromWorkingObject": "channelId" }
]
```

---

## Configuration

Both tools read their server list from `workingObject.toolsconfig.<toolName>.servers`. Channel-specific overrides in `core.json` can override the server list per channel.

`getMcpTools` may define `executorToolName` to point discovery hints at a specific local execution tool. If it is omitted, the runtime resolves the execution tool dynamically from the active channel tool set.

```json
"toolsconfig": {
  "getMcpTools": {
    "executorToolName": "getMcp",
    "servers": [
      {
        "name": "local-jenny",
        "namespace": "jenny-mcp",
        "type": "streamableHttp",
        "url": "https://jenny.ralfreschke.de/mcp",
        "headers": [{ "header": "x-channel-id", "valueFromWorkingObject": "channelId" }],
        "bearerTokenSecret": "JENNY_MCP_TOKEN",
        "timeoutMs": 30000
      }
    ]
  },
  "getMcp": {
    "servers": [
      {
        "name": "local-jenny",
        "namespace": "jenny-mcp",
        "type": "streamableHttp",
        "url": "https://jenny.ralfreschke.de/mcp",
        "headers": [{ "header": "x-channel-id", "valueFromWorkingObject": "channelId" }],
        "bearerTokenSecret": "JENNY_MCP_TOKEN",
        "timeoutMs": 30000
      }
    ]
  }
}
```

`getMcpTools` and `getMcp` maintain separate server lists so discovery and execution can be configured independently.

---

## MCP Server

The bot exposes itself as an MCP server via `flows/mcp.js`. It reads manifests only for the tools allowed by the resolved channel and registers only that filtered set as MCP tools. Each tool call runs a full pipeline pass, so channel-specific config overrides apply per channel.

### Transports

Configured under `config.mcp`:

```json
"mcp": {
  "stdio": false,
  "http": {
    "enabled": true,
    "port": 3100,
    "path": "/mcp"
  }
}
```

### Session Handling (HTTP)

Each HTTP client connection can start with an MCP initialization handshake. Sessions are keyed by `mcp-session-id` header and expire after 30 minutes of inactivity.

Tool requests without a known session ID are handled with a fresh stateless transport. This keeps request/response tool calls compatible with MCP clients that do not reuse the initialization session for later calls.

### Channel Routing

The `x-channel-id` request header maps the MCP connection to a specific bot channel, applying the matching channel config overrides and filtering exposed tools to that channel's active tool set. If omitted, the server falls back to `config.mcp.defaultChannelId`, which defaults to `"mcp"`.

### Authentication

The server checks `workingObject.apiSecret` against the `Authorization: Bearer <token>` header when a secret is configured.

---

## Files

| File | Role |
|---|---|
| `tools/getMcpTools.js` | Local tool: discovers remote MCP tools |
| `tools/getMcp.js` | Local tool: executes a remote MCP tool |
| `manifests/getMcpTools.json` | Tool manifest and policy hints for the AI |
| `manifests/getMcp.json` | Tool manifest and policy hints for the AI |
| `shared/mcp/mcp-client.js` | MCP client transport factory and config reader |
| `shared/mcp/mcp-utils.js` | MCP server utilities: manifest loader and tool invoker |
| `flows/mcp.js` | MCP server flow: HTTP and stdio transport startup |
