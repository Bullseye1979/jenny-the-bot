# Jenny Bot — Browser Extension

A Manifest V3 browser extension for Edge (and Chrome) that lets you **chat with the Jenny bot** and **summarize the current web page or YouTube video** with a single button click.

## Features

- **Persistent side panel** — the chat stays open while you browse; it is not closed when you click elsewhere or navigate to another page
- **Chat UI** — full chat interface with markdown rendering, clickable links, and embedded videos/images
- **Summarize button** — sends the active tab's URL to the bot with a summarization request
- **Toolcall display** — shows the name of the active tool (e.g. an image-generation tool) before the typing indicator
- **Options page** — configure API URL, Channel ID, and optional API secret via `chrome.storage`

## Installation (developer mode)

1. Open Edge: `edge://extensions/`
   (or Chrome: `chrome://extensions/`)
2. Enable **Developer mode** (toggle top-right)
3. Click **Load unpacked**
4. Select the `extensions/jenny-extension/` directory

After loading, click the **Jenny Bot** icon in the toolbar to open the side panel.

> **Note:** The extension requests the `tabs` permission to read the active tab's URL for the Summarize feature. This is required because the side panel runs in its own window (Chrome 117+) and cannot access tab URLs without it.

## Configuration

Open the extension options page (gear icon in the panel, or right-click the extension icon → *Options*):

| Field | Description |
|---|---|
| **API URL** | Full URL of the bot's API endpoint, e.g. `http://localhost:3400/api` |
| **Channel ID** | Channel this extension talks to — must match a channel with `apiEnabled: 1` in `core.json` |
| **API Secret** | Bearer token (leave empty if `apiSecret` is not set on the channel) |

## Bot-side configuration

Add a block to `core.json` under the channel that the extension will use:

```json
"browser-extension": {
  "apiEnabled": 1,
  "apiSecret":  "your-secret-here"
}
```

See the project's `CORE_JSON.md` and `ADMIN_MANUAL.md` for full details.

## Generating icons

The `icons/` directory already contains pre-generated PNGs (16×16, 48×48, 128×128).
To regenerate them from the SVG source (`icons/icon.svg`):

```bash
# from the extensions/jenny-extension/ directory
npm install sharp
node icons/generate-icons.js
```

Or export the SVG manually from any vector editor at the three required sizes.
