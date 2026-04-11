# Jenny Bot — Browser Extension

> **Version:** 1.0 · **Date:** 2026-03-21

A Manifest V3 browser extension for Edge and Chrome that lets you chat with the Jenny Bot, summarize web pages and YouTube videos, and manage your image gallery — directly from your browser toolbar.

---

## Features

| Feature | Description |
|---|---|
| **Chat UI** | Full chat interface with markdown rendering, link/video embeds, and toolcall display |
| **Summarize** | Sends the active tab's URL to the bot with a summarization task; auto-detects YouTube vs. web page |
| **Toolcall display** | Active tool name shown next to the thinking indicator; polled from `/toolcall` every 800 ms |
| **File attachments** | Attach files to messages; images are uploaded to the Gallery when logged in, otherwise via the regular `/upload` endpoint |
| **Gallery upload** | Drag-and-drop or click to upload images to your personal gallery. Requires `webBaseUrl` and an active session. |
| **Auth status bar** | Shows the logged-in username at the top of the popup. Provides **Login** and **Logout** links. The user ID from the session is sent with every API message for GDPR attribution. |

---

## Installation

1. Open `chrome://extensions/` (or `edge://extensions/`).
2. Enable **Developer mode**.
3. Click **Load unpacked** → select the `extensions/jenny-extension/` folder.
4. Click the Jenny Bot icon in the toolbar to open the side panel.
5. Accept the permission prompt — required so the extension can reach the bot's API (`host_permissions: ["<all_urls>"]`).

---

## Configuration

Open the **Settings** page (⚙ button in the popup or right-click → Options).

| Field | Description |
|---|---|
| `API URL` | Full URL of the bot's API endpoint, e.g. `https://jenny.example.com/api` |
| `Channel ID` | Channel identifier sent with every message. Must match a channel with `apiEnabled: 1` in `core.json`. Default: `browser-extension` |
| `API Secret` | Bearer token for the API. Leave blank if `apiSecret` is not configured on the channel. |
| `Web Base URL` | Base URL of the Jenny web interface (e.g. `https://jenny.example.com`). Enables the auth status bar and gallery uploads. |

> **User ID:** The extension automatically retrieves your user ID from the Jenny web session (`/auth/me`). No manual configuration is needed. Log in via the **Login** link in the auth bar.

---

## Bot-side configuration

Add a channel entry in `core.json` under the relevant channel overrides:

```jsonc
{
  "channelMatch": ["browser-extension"],
  "overrides": {
    "apiEnabled":   1,
    "apiSecret":    "",
    "persona":      "You are Jenny, a browser extension assistant.",
    "instructions": "When given a URL, use getWebpage or getYoutube to fetch and summarize the content.",
    "contextSize":  70
  }
}
```

To monitor the extension's chat history in the web admin panel, add `{ "label": "Browser Extension", "channelId": "browser-extension", "roles": [] }` to `webpage-chat.chats[]`.

---

## Generating icons

The extension icons are PNG files derived from `icons/icon.svg`. To regenerate them:

```bash
npm install sharp
node -e "
const sharp = require('sharp');
[16,48,128].forEach(s => sharp('icons/icon.svg').resize(s,s).png().toFile('icons/icon'+s+'.png', e => e && console.error(e)));
"
```

Alternatively export directly from a vector editor at 16×16, 48×48, and 128×128 px.
