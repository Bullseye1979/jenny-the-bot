# Jenny — Documentation

> **Version:** 1.0

Jenny is a self-hosted, modular AI assistant for Discord. It runs a configurable pipeline of modules across multiple flows (Discord, voice, web, API, cron) and exposes LLM-callable tools for search, image generation, file handling, and external integrations.

---

## Documentation Index

| Document | Audience | Description |
|----------|----------|-------------|
| [User Guide](USER_GUIDE.md) | End users | How to chat, use voice, generate images, manage files, and use the web interface |
| [Admin Manual](ADMIN_MANUAL.md) | Administrators | Installation, configuration, module pipeline, database, Caddy, slash commands |
| [Core JSON Reference](CORE_JSON.md) | Administrators | Complete annotated reference for every key in `core.json` |

---

## Quick Start

1. Copy `core.json.example` to `core.json` and fill in your bot token, database credentials, and API keys.
2. Run `node main.js` to start the bot.
3. Invite the bot to your Discord server and configure allowed channels in `core.json`.

See the [Admin Manual](ADMIN_MANUAL.md) for full setup instructions.

---

## Architecture Overview

Jenny uses a numbered module pipeline. Every incoming event (Discord message, HTTP request, cron tick, voice audio) passes through all modules in order. Each module checks whether it should act on the current event and either transforms the shared `workingObject` or passes it through unchanged.

```
flows/          Entry points (discord, webpage, api, cron, voice, mcp)
modules/        Pipeline stages (00005 → 10000)
tools/          LLM-callable tools (getImage, getGoogle, getGraph, ...)
core/           Runtime utilities (registry, context, secrets, logging, utils)
shared/         Feature-specific utilities (oauth, voice, webpage, mcp)
manifests/      Tool parameter schemas (JSON)
types/          JSDoc type definitions
```

---

## MCP

Jenny includes a built-in MCP (Model Context Protocol) server. It exposes only the tools resolved for the request channel through `core-channel-config`, so a channel with a small `tools` array receives a small MCP tool list. Compatible with Claude Desktop, Cursor, VS Code, and any MCP client.

**Transports supported:**
- **stdio** — for local clients (Claude Desktop, Cursor). Enable with `config.mcp.stdio: true`.
- **HTTP/SSE** — for network clients. Enable with `config.mcp.http.enabled: true`.

Jenny can also act as an MCP client through the LLM-callable tools `getMcpTools` and `getMcp`. Configure remote MCP servers in `workingObject.toolsconfig.getMcpTools.servers` and `workingObject.toolsconfig.getMcp.servers`.

See [Admin Manual](ADMIN_MANUAL.md#mcp-server) and [Core JSON Reference](CORE_JSON.md#mcp-client-tools-getmcptools-getmcp) for setup instructions.

## Runtime Changes

- Logs are stored under configurable `config.logging.logsDir` and rotate by `config.logging.maxFileBytes` / `config.logging.keepFiles`, including `toolcalls`.
- Chat subchannels can expire via `config.webpage-chat.subchannelTtlHours`; the `chat-subchannel-gc` cron flow removes expired subchannel rows and their scoped context rows daily.
- Microsoft Graph calendar operations are available through `getGraph`: list calendars, list events by timeframe, create events, update events, and delete events.
- The web root redirects to `config.webpage-menu.homePath` or the first menu item the authenticated user can access.

---

*Version 1.0*
