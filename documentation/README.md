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
flows/          Entry points (discord, webpage, api, cron, voice)
modules/        Pipeline stages (00005 → 10000)
tools/          LLM-callable tools (getImage, getGoogle, getGraph, ...)
core/           Runtime utilities (registry, context, secrets, logging)
shared/         Feature-specific utilities (oauth, voice, webpage)
manifests/      Tool parameter schemas (JSON)
types/          JSDoc type definitions
```

---

*Version 1.0*
