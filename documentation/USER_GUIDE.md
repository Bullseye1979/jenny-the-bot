# Jenny — User Guide

> **Version:** 1.0 · **Date:** 2026-03-14

Jenny is an AI assistant that lives in your Discord server. She can chat, answer questions, generate images and videos, look things up on the web, read YouTube transcripts, manage Confluence and Jira, and even talk back to you in voice channels.

This guide explains everything you need to know to use Jenny as a regular user.

---

## Table of Contents

1. [Talking to Jenny](#talking-to-jenny)
2. [Privacy & GDPR Consent](#privacy--gdpr-consent)
3. [Text Chat](#text-chat)
4. [Voice Chat](#voice-chat)
5. [What Jenny Can Do — Tools](#what-jenny-can-do--tools)
6. [Generating Images](#generating-images)
7. [Generating Videos](#generating-videos)
8. [Editing Images (Inpainting)](#editing-images-inpainting)
9. [Web Search & Pages](#web-search--pages)
10. [YouTube](#youtube)
11. [Conversation History](#conversation-history)
12. [Creating Macros](#creating-macros)
13. [Bard Music System](#bard-music-system)
14. [Web Interface](#web-interface)
15. [AI Wiki](#ai-wiki)
16. [Slash Commands Reference](#slash-commands-reference)
17. [Tips & Tricks](#tips--tricks)
18. [Troubleshooting](#troubleshooting)

---

## Talking to Jenny

Jenny responds when her name appears in a message. By default the trigger word is **"jenny"** (case-insensitive). She is usually set to respond when the trigger word is anywhere in the first few words of your message:

```
jenny, what's the weather like in Berlin today?
Hey jenny, explain quantum entanglement simply.
Jenny can you draw a cat astronaut?
```

In some channels Jenny may be always-on (no trigger word needed) or may require a different phrase — your server admin sets this per channel.

**Direct messages:** Jenny can also respond to DMs. Consent still applies (see below).

---

## Privacy & GDPR Consent

Jenny is operated in compliance with the GDPR (EU data protection regulation).

**Before Jenny will respond to you for the first time in a channel, she will:**

1. Send you a private DM with a full explanation of what data is processed and why.
2. Wait for you to give explicit consent using a slash command.

**You must opt in before Jenny processes your messages.** She will remain silent (or send you a reminder) until you do.

### Consent commands

| Command | Effect |
|---|---|
| `/gdpr text 1` | ✅ Allow Jenny to process your text messages in this channel |
| `/gdpr text 0` | ❌ Stop Jenny from processing your text messages |
| `/gdpr voice 1` | ✅ Allow Jenny to transcribe and respond to your voice in this channel |
| `/gdpr voice 0` | ❌ Stop Jenny from processing your voice |

> **Important:** Consent is **per-channel**. You need to consent separately in each channel where you want to use Jenny.

You can revoke consent at any time with the `0` commands. Jenny will immediately stop processing your new messages in that channel. Historical data is retained according to the privacy notice you received.

---

## Text Chat

Once you have consented, simply mention Jenny's trigger word in your message:

```
jenny, tell me a joke.
jenny summarise this text: [paste your text here]
jenny what is 15% of 340?
```

**Jenny remembers the conversation.** She loads the last 20 messages (configurable) from the channel's history so you can have a flowing dialogue. You do not need to repeat context she already knows:

```
You: jenny, who wrote Dune?
Jenny: Dune was written by Frank Herbert, first published in 1965.

You: jenny, and when did the sequel come out?
Jenny: The sequel, Dune Messiah, was published in 1969.
```

**Attachments:** You can attach images, PDFs, or other files to your message. Jenny will receive the URLs and can describe images or process the content if you ask her to.

---

## Voice Chat

Jenny can join a voice channel, listen to what you say, transcribe it using Whisper, and reply with a synthesised voice.

### Joining a voice channel

1. Join a voice channel yourself.
2. Type `/join` in any text channel (Jenny needs to be in the same server).
3. Jenny will join your current voice channel.

### Speaking to Jenny in voice

- Jenny listens continuously.
- Say her trigger word (usually "Jenny") followed by your question or request.
- She will transcribe your speech, process it through the same AI pipeline as text, and speak the response aloud.
- Voice responses are kept short by default (your admin may configure a 3-sentence limit).

### Multiple voices

Jenny supports switching between different voices within a single response using `[speaker: <voice>]` tags. The AI can place these tags automatically when telling a story or roleplaying, or you can ask her to use them explicitly.

**Syntax:**
```
[speaker: nova] Hello, I'm Nova.
[speaker: echo] And I'm Echo.
[speaker: default] Back to the default voice now.
```

Each tagged segment is rendered with its own voice and played back sequentially. Available voices depend on your admin's TTS configuration (typically OpenAI voices: `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`). `default` or an empty tag always falls back to the configured default voice.

### Leaving the voice channel

Type `/leave` and Jenny will disconnect.

> **Note:** You need separate GDPR consent for voice processing (`/gdpr voice 1`).

---

## What Jenny Can Do — Tools

During a conversation Jenny can call tools automatically to fulfil your request. You do not need to trigger these explicitly — just ask naturally:

| What you ask for | Tool Jenny uses |
|---|---|
| Search the web | Tavily web search (current news, finance, general) or Google search + webpage reader |
| Explain a website | Fetch & read the page |
| Generate an image | DALL-E image generation |
| Animate an image | WAN image-to-video |
| Create a video from a description | Veo-3 text-to-video |
| Find a YouTube video / read its transcript | YouTube tool |
| Look up past conversations | History / Information tool |
| Check the current time | Time tool |
| Create a PDF | PDF generator |
| Create a text file | Text file generator |
| Convert an image into a GIF token | Token generator |
| Look up a location / show Street View | Location / Maps tool |
| Query or create Jira tickets | Jira tool |
| Search Confluence pages | Confluence tool |

---

## Generating Images

Ask Jenny in plain language:

```
jenny, draw a sunset over the ocean in watercolour style
jenny, generate an image of a robot barista serving coffee
jenny, can you make a picture of a medieval castle at night?
```

Jenny will:
1. Optionally enhance your prompt for better results.
2. Call DALL-E 3 (or the configured model).
3. Save the image to the server and post a link in the channel.

**Size:** Images are generated at 1024×1024 by default and may be scaled before delivery.

**Stable Diffusion:** If your server has a local Stable Diffusion instance configured, you can ask Jenny to use it:
```
jenny, generate with stable diffusion: a fantasy forest
```

---

## Generating Videos

### Animate an existing image

Send an image attachment or paste an image URL, then ask:

```
jenny, animate this image
jenny, make this picture move
```

Jenny will use the WAN image-to-video model to create a short animated clip and post the link. Generation can take several minutes.

### Create a video from text

```
jenny, create a video of a dolphin leaping at sunset
jenny, generate a short clip showing a time-lapse of a city at night
```

Jenny uses Google's Veo-3 model via Replicate. Generation typically takes 5–15 minutes.

---

## Editing Images (Inpainting)

The inpainting tool is a browser-based image editor that lets you load any image, paint a mask over the area you want to change, describe what should appear there, and submit it to AI for processing. It runs in your browser at **`/inpainting`**.

### Opening the editor

**From a generated image:**
When Jenny generates an image with Stable Diffusion, the response includes an edit link. Click it to open the image directly in the inpainting editor.

**From the browser:**
Navigate to `https://yourserver.example.com/inpainting` and load an image manually.

**With a URL parameter:**
Append `?src=<image-url>` to open a specific image directly:
```
https://yourserver.example.com/inpainting?src=https://example.com/photo.png
```

---

### How to use it

1. **Load an image** — drag and drop an image file onto the canvas, use the file picker, or load via `?src=` URL parameter.
2. **Paint a mask** — use the brush tool to paint over the area you want to replace. Painted areas appear as a coloured overlay.
3. **Adjust the brush** — use the brush size slider to paint fine details or large regions.
4. **Enter a prompt** — describe what should appear in the masked area (e.g. *"a glowing blue portal"*, *"remove the person"*).
5. **Click Inpaint** — the editor sends the image and mask to the Stable Diffusion backend. Results appear on the canvas within a few seconds.
6. **Download or continue** — save the result or paint a new mask to refine further.

---

### Tips

| Tip | Detail |
|-----|--------|
| **Iterative editing** | After the first inpaint completes the result becomes the new canvas. Paint a new mask and inpaint again to refine. |
| **Larger brush for rough areas** | Use a big brush to cover backgrounds; switch to a small brush for edges. |
| **Be specific in prompts** | *"a wooden door with iron hinges, fantasy style"* works better than *"a door"*. |
| **Negative prompt** | If the result keeps including something unwanted, add it to the negative prompt field. |

---

## Web Search & Pages

Jenny can search Google and read web pages:

```
jenny, what are the latest news about the EU AI Act?
jenny, search for the best hiking trails near Munich
jenny, read the content of https://example.com and summarise it
```

She will:
1. Run a Google search.
2. Open relevant pages.
3. Summarise or answer based on the content.
4. Cite her sources.

---

## YouTube

Jenny can find YouTube videos and read their transcripts:

```
jenny, find a YouTube tutorial on sourdough bread making
jenny, summarise the transcript of https://www.youtube.com/watch?v=xxxxx
jenny, what does this YouTube video say about climate change? [URL]
```

---

## Conversation History

Jenny stores conversations in a database. You can ask her to recall things:

```
jenny, what did we talk about last week?
jenny, can you summarise our conversation from today?
jenny, what was the recipe you gave me yesterday?
```

She uses two tools for this:

- **`getHistory`** — retrieves and summarises older messages, page by page.
- **`getInformation`** — finds specific facts or events across the entire conversation log.
- **`getTimeline`** — shows a chronological overview of topics discussed.

---

## Creating Macros

Macros let you save a long piece of text (like a prompt, a template, or frequently used instructions) and trigger it with a short name.

### Create a macro

```
/macro create name:research text:Always search Google first, then read at least 2 web pages. Cite all sources. Write your conclusion last.
```

### Use a macro

Simply start your message with the macro name:

```
research jenny, find the best electric cars of 2026
```

Jenny expands the macro before processing — the bot receives the full macro text prepended to your message.

### List your macros

```
/macro list
```

### Delete a macro

```
/macro delete name:research
```

> Macros are **personal** — only you can see and use your own macros.

---

## Bard Music System

The Bard is Jenny's background music system for tabletop RPG sessions. It plays mood-appropriate music through a browser-based audio player — no second Discord bot required.

### Starting and stopping

| Command | Effect |
|---|---|
| `/bardstart` | Start the music scheduler for this server. Jenny begins analysing the chat and playing music. |
| `/bardstop` | Stop the music scheduler. Music stops immediately. |

Once started, the scheduler:
1. Reads the current chat context every few minutes.
2. Asks an AI to classify the session mood as 3 mood tags (e.g. `combat, intense, danger`).
3. Selects the best-matching track from the music library and plays it.
4. Switches tracks automatically when the mood changes.

### Browser audio player

Open **`/bard`** in your browser to hear the music. The page shows a **Now Playing** card with:
- The current track title and mood tags
- Colour-coded label indicators (green = active mood match, blue = track tag only, grey = mood label not on track)
- A stream player — click **▶ Zum Anhören klicken** to start playback

The player syncs automatically when the track changes. If a song ends, the next track starts within a few seconds.

### Music library management

Admins can manage the music library at **`/bard`**:
- Edit track title, tags, and volume
- Delete tracks
- Preview any track with the ▶ button
- Upload MP3 files with automatic AI-generated tags (if configured)

---

## Web Interface

Jenny provides several browser-based tools. Your server admin decides which are accessible and who can log in.

| URL | What it does |
|---|---|
| `/chat` | AI chat in the browser — same as Discord chat but accessible from any device |
| `/inpainting` | Image editor for AI inpainting (see [Editing Images](#editing-images-inpainting)) |
| `/bard` | Bard music player and library manager |
| `/wiki` | AI-generated wiki for your channel — articles written from conversation history |
| `/docs` | Project documentation viewer |
| `/config` | Config editor (admin only) |
| `/dashboard` | Live bot status dashboard (admin only) |
| `/context` | Conversation context editor (admin only) |

To log in, navigate to any of these pages and you will be redirected to Discord OAuth2 login if authentication is required. Once logged in, your access is determined by the role your server admin assigned to your Discord account.

---

## AI Wiki

If your admin has set up the wiki, you can browse it at **`/wiki`**. Each channel has its own wiki at `/wiki/{channelId}`.

### Reading articles

Browse directly or use the search bar on the channel wiki page. Articles are generated from the channel's conversation history using AI.

### Searching and generating

1. Type a search term (e.g. a character name, location, or event from your campaign).
2. If a matching article exists, it appears immediately.
3. If you have **creator** or **admin** rights and no article exists, Jenny generates one automatically using the channel's conversation history.

### Article expiry

Unedited articles expire after a configurable number of days (shown with a colour-coded badge). Once an article has been manually edited by an editor or admin, it is retained permanently.

---

## Slash Commands Reference

These commands are available to all users (unless marked **Admin**).

| Command | Who | Description |
|---|---|---|
| `/gdpr text 1` | Everyone | Enable text chat consent for this channel |
| `/gdpr text 0` | Everyone | Disable text chat consent for this channel |
| `/gdpr voice 1` | Everyone | Enable voice processing consent for this channel |
| `/gdpr voice 0` | Everyone | Disable voice processing consent for this channel |
| `/macro create <name> <text>` | Everyone | Create or update a personal macro |
| `/macro list` | Everyone | List all your personal macros |
| `/macro delete <name>` | Everyone | Delete one of your personal macros |
| `/macro run <name>` | Everyone | Run a macro immediately (without a message) |
| `/join` | Everyone | Jenny joins your current voice channel |
| `/leave` | Everyone | Jenny leaves the voice channel |
| `/bardstart` | Everyone | Start the Bard music scheduler for this server |
| `/bardstop` | Everyone | Stop the Bard music scheduler |
| `/avatar url <url>` | **Admin** | Set Jenny's avatar from an image URL |
| `/avatar prompt <text>` | **Admin** | Add text to the avatar prompt and regenerate |
| `/avatar regen` | **Admin** | Regenerate avatar using the current prompt |
| `/purge [count]` | **Admin** | Delete the last N messages in this channel (max 5000) |
| `/purgedb` | **Admin** | Delete Jenny's conversation database for this channel |
| `/freeze` | **Admin** | Protect the last database entry from deletion |
| `/error` | Everyone | Simulate an internal error (for testing) |

---

## Tips & Tricks

**Be specific.** Jenny's output quality improves with clear requests:
```
❌ jenny, make an image
✅ jenny, draw a photorealistic image of a tiger in a rainforest at golden hour
```

**Refer back to the conversation.** Jenny remembers context within the current session:
```
jenny, now make it in a winter setting
jenny, translate that last answer to German
```

**Ask Jenny to verify.** For factual questions, tell Jenny to check her sources:
```
jenny, search for this and verify with at least 2 sources before answering
```

**Use instructions in your request.** You can give Jenny formatting instructions:
```
jenny, explain REST APIs as a bulleted list, keep it under 200 words
jenny, write a formal email to decline a meeting invitation
```

**Chain requests.** Jenny can handle complex multi-step tasks:
```
jenny, search for the top 5 electric cars, compare their range and price,
generate a summary table, and create a PDF of the results
```

**Voice keeps it short.** In voice channels Jenny's replies are shorter by default. For longer answers, use text chat.

---

## Troubleshooting

**Jenny doesn't respond to me**

- Check that you have given consent: `/gdpr text 1`
- Make sure you include the trigger word (usually "jenny") in your message.
- Jenny may be restricted from responding in that specific channel. Ask your server admin.

**Jenny says she needs consent**

Run `/gdpr text 1` in the channel. Jenny will send you a DM with the privacy notice first if you haven't seen it yet — check your DMs.

**My voice isn't being recognised**

- Make sure you've enabled voice consent: `/gdpr voice 1`
- Speak clearly and include Jenny's trigger word.
- Check that Jenny is in the voice channel (`/join` if needed).
- Poor microphone quality or background noise can affect transcription accuracy.

**Image/video generation failed**

- Complex or unclear prompts can sometimes fail. Try rephrasing.
- Video generation takes time (5–15 minutes). Jenny will post the result when ready.
- The server may have hit an API limit. Try again in a few minutes.

**Jenny seems to have forgotten something**

- Jenny loads a fixed number of messages from history (default: 20 recent rows).
- For older conversations, ask her explicitly: `jenny, use getHistory to find what we said about X last Tuesday`

**I want to start fresh**

Ask your server admin to run `/purgedb` to clear Jenny's conversation database for the channel.

**Bard music doesn't play**

- Make sure `/bardstart` has been used in the server.
- Open `/bard` in your browser and click **▶ Zum Anhören klicken** to start the stream.
- If the Now Playing card shows no track, the music library may be empty. Ask your admin to add MP3 files.
- If labels are shown as grey, the AI hasn't classified the session yet — this happens on the first run. It will update within a few minutes.

---

*User guide updated 2026-03-14.*
