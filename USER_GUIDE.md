# Jenny — User Guide

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
8. [Web Search & Pages](#web-search--pages)
9. [YouTube](#youtube)
10. [Conversation History](#conversation-history)
11. [Creating Macros](#creating-macros)
12. [Slash Commands Reference](#slash-commands-reference)
13. [Tips & Tricks](#tips--tricks)
14. [Troubleshooting](#troubleshooting)

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

### Leaving the voice channel

Type `/leave` and Jenny will disconnect.

> **Note:** You need separate GDPR consent for voice processing (`/gdpr voice 1`).

---

## What Jenny Can Do — Tools

During a conversation Jenny can call tools automatically to fulfil your request. You do not need to trigger these explicitly — just ask naturally:

| What you ask for | Tool Jenny uses |
|---|---|
| Search the web | Google search + webpage reader |
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

---

*User guide generated 2026-02-26.*
