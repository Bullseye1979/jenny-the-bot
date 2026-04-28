# MCP Integration

Version 1.0

## Overview

The bot supports the Model Context Protocol (MCP) in two directions:

- **MCP Server** — exposes all local tool manifests as MCP tools to external clients via HTTP or stdio transport (`flows/mcp.js`)
- **MCP Client** — allows the AI to discover and call tools on remote MCP servers via the `getMcpTools` and `getMcp` local tools

---

## MCP Client: Two-Step Tool Execution

Remote MCP tools are never called directly. The AI always uses a two-step sequence:

### Step 1 — Discovery: `getMcpTools`

Connects to configured remote MCP servers and returns all available tools. Tool names are returned in namespaced form:

```
mcp.<namespace>.<toolName>
```

Example: `mcp.jenny-mcp.getTime`

The `query` parameter filters results by keyword (use a short single word, e.g. `"confluence"`, not a full phrase).

### Step 2 — Execution: `getMcp`

Calls one specific tool on a remote MCP server. Accepts either:

- A namespaced name: `tool: "mcp.jenny-mcp.getTime"` — server is resolved automatically from the namespace
- A raw tool name plus explicit server: `server: "local-jenny"`, `tool: "getTime"`

The `arguments` field contains the input object matching the schema returned by `getMcpTools`.

### Important Rules

- Tool names starting with `mcp.` are **never** valid local tool calls — they can only be executed via `getMcp`
- `getMcpTools` is always a discovery step only; it must always be followed by `getMcp`
- Skipping `getMcp` after `getMcpTools` is not permitted

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
  { "header": "x-channel-id", "value": "mcp" }
]
```

---

## Configuration

Both tools read their server list from `workingObject.toolsconfig.<toolName>.servers`. Channel-specific overrides in `core.json` can override the server list per channel.

```json
"toolsconfig": {
  "getMcpTools": {
    "servers": [
      {
        "name": "local-jenny",
        "namespace": "jenny-mcp",
        "type": "streamableHttp",
        "url": "https://jenny.ralfreschke.de/mcp",
        "headers": [{ "header": "x-channel-id", "value": "mcp" }],
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
        "headers": [{ "header": "x-channel-id", "value": "mcp" }],
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

The bot exposes itself as an MCP server via `flows/mcp.js`. It reads all manifests from `manifests/` and registers them as MCP tools. Each tool call runs a full pipeline pass, so channel-specific config overrides apply per channel.

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

Each HTTP client connection starts with an MCP initialization handshake. Sessions are keyed by `mcp-session-id` header and expire after 30 minutes of inactivity.

### Channel Routing

The `x-channel-id` request header maps the MCP connection to a specific bot channel, applying the matching channel config overrides. If omitted, the default channel `"mcp"` is used.

### Authentication

The server checks `workingObject.apiSecret` against the `Authorization: Bearer <token>` header when a secret is configured.

---

## Files

| File | Role |
|---|---|
| `tools/getMcpTools.js` | Local tool: discovers remote MCP tools |
| `tools/getMcp.js` | Local tool: executes a remote MCP tool |
| `manifests/getMcpTools.json` | Tool manifest + policy hints for the AI |
| `manifests/getMcp.json` | Tool manifest + policy hints for the AI |
| `shared/mcp/mcp-client.js` | MCP client transport factory and config reader |
| `shared/mcp/mcp-utils.js` | MCP server utilities: manifest loader and tool invoker |
| `flows/mcp.js` | MCP server flow: HTTP and stdio transport startup |
