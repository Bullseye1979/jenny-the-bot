/***************************************************************
/* filename: "discord-admin-avatar.js"                         *
/* Version 1.0                                                 *
/* Purpose: Slash-command avatar handler for the               *
/*          "discord-admin" flow: regen, prompt, and URL.      *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fetch from "node-fetch";
import { EmbedBuilder } from "discord.js";
import { getItem } from "../core/registry.js";

/***************************************************************
/* functionSignature: getChannelId (wo)                        *
/* Resolves a channel id from admin snapshot or workingObject  *
/***************************************************************/
function getChannelId(wo) {
  const fromAdmin = wo?.admin?.channelId;
  const fromWO = wo?.id || wo?.channelId || wo?.channel_id;
  return String(fromAdmin || fromWO || "");
}

/***************************************************************
/* functionSignature: getAvatarDir ()                          *
/* Returns the absolute directory path for stored avatars      *
/***************************************************************/
function getAvatarDir() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.join(__dirname, "..", "pub", "documents", "avatars");
}

/***************************************************************
/* functionSignature: setEnsureDir (absPath)                   *
/* Ensures a directory exists                                  *
/***************************************************************/
function setEnsureDir(absPath) {
  if (!fs.existsSync(absPath)) fs.mkdirSync(absPath, { recursive: true });
}

/***************************************************************
/* functionSignature: getAvatarFilePath (channelId)            *
/* Returns the avatar file path for a given channel            *
/***************************************************************/
function getAvatarFilePath(channelId) {
  return path.join(getAvatarDir(), `${channelId}.png`);
}

/***************************************************************
/* functionSignature: setWriteAvatar (channelId, buf)          *
/* Atomically writes an avatar buffer to disk                  *
/***************************************************************/
function setWriteAvatar(channelId, buf) {
  const dir = getAvatarDir();
  setEnsureDir(dir);
  const p = getAvatarFilePath(channelId);
  try { fs.rmSync(p, { force: true }); } catch {}
  const tmp = `${p}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, buf, { flag: "w" });
  fs.renameSync(tmp, p);
  return p;
}

/***************************************************************
/* functionSignature: setLog (wo, message, level, extra)       *
/* Appends a structured log entry to workingObject.logging     *
/***************************************************************/
function setLog(wo, message, level = "info", extra = null) {
  (wo.logging ||= []).push({
    timestamp: new Date().toISOString(),
    severity: level,
    module: "discord-admin-avatar",
    exitStatus: "success",
    message,
    ...(extra ? { context: extra } : {})
  });
}

/***************************************************************
/* functionSignature: getComposePrompt (wo)                    *
/* Builds the final avatar prompt text from workingObject      *
/***************************************************************/
function getComposePrompt(wo) {
  const persona = String(wo?.persona || wo?.Persona || "").trim();
  const instructions = String(wo?.instructions || wo?.Instructions || "").trim();
  const botname = String(wo?.Botname || wo?.botname || "").trim();
  const avatarPrompt = String(wo?.avatarprompt ?? wo?.avatarPrompt ?? "").trim();
  const parts = [];
  if (persona) parts.push(persona);
  if (instructions) parts.push(instructions);
  if (botname) parts.push(`Bot name: ${botname}`);
  if (avatarPrompt) parts.push(avatarPrompt);
  let text = parts.join("\n").trim();
  if (!text) {
    text = "Friendly, modern Discord bot avatar, clean vector mascot, rounded shapes, soft lighting, high contrast, simple background";
  }
  return text.slice(0, 4000);
}

/***************************************************************
/* functionSignature: setAppendPrompt (wo, extra)              *
/* Appends additional text to the avatar prompt field          *
/***************************************************************/
function setAppendPrompt(wo, extra) {
  const base = String(wo?.avatarprompt ?? wo?.avatarPrompt ?? "").trim();
  const add = String(extra || "").trim();
  const combined = base ? `${base}\n${add}` : add;
  wo.avatarprompt = combined;
}

/***************************************************************
/* functionSignature: getDownloadUrlBuffer (urlStr)            *
/* Downloads a URL and returns its contents as a Buffer        *
/***************************************************************/
async function getDownloadUrlBuffer(urlStr) {
  const res = await fetch(String(urlStr));
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/***************************************************************
/* functionSignature: getGenerateAvatarBuffer (wo)             *
/* Calls the image API and returns the generated image buffer  *
/***************************************************************/
async function getGenerateAvatarBuffer(wo) {
  const endpoint = String(wo?.AvatarEndpoint || "");
  const model = String(wo?.AvatarModel || "");
  const apiKey = String(wo?.AvatarApiKey || "");
  if (!endpoint) throw new Error("Missing AvatarEndpoint");
  if (!model) throw new Error("Missing AvatarModel");
  if (!apiKey) throw new Error("Missing AvatarApiKey");
  const prompt = getComposePrompt(wo);
  const size = String(wo?.AvatarSize ?? "1024x1024");
  const body = { model, prompt, size, n: 1, response_format: "b64_json" };
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 800)}`);
  }
  const json = await resp.json().catch(() => ({}));
  const b64 = json?.data?.[0]?.b64_json || null;
  const url = json?.data?.[0]?.url || null;
  if (b64) return Buffer.from(b64, "base64");
  if (url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Fetch image URL failed: ${r.status}`);
    const ab = await r.arrayBuffer();
    return Buffer.from(ab);
  }
  throw new Error("No image returned by endpoint");
}

/***************************************************************
/* functionSignature: getResolveChannel (wo, channelId)        *
/* Resolves a Discord channel via the client registry          *
/***************************************************************/
async function getResolveChannel(wo, channelId) {
  const clientKey = wo?.clientRef || wo?.refs?.client || "discord:client";
  const client = await getItem(clientKey);
  if (!client?.channels?.fetch) return null;
  try { return await client.channels.fetch(channelId); } catch { return null; }
}

/***************************************************************
/* functionSignature: setSendAvatarEmbed (wo, channel, path)   *
/* Sends a preview embed with the new avatar image             *
/***************************************************************/
async function setSendAvatarEmbed(wo, channel, path) {
  try {
    const filename = path.split(path.includes("/") ? "/" : "\\").pop();
    const attachName = filename || "avatar.png";
    const embed = new EmbedBuilder()
      .setColor(0x2F3136)
      .setDescription("New avatar has been set.")
      .setImage(`attachment://${attachName}`)
      .setTimestamp(new Date());
    await channel.send({ embeds: [embed], files: [{ attachment: path, name: attachName }] });
    setLog(wo, "Avatar preview embed sent", "info");
  } catch (e) {
    setLog(wo, `Failed to send avatar embed: ${e?.message || String(e)}`, "warn");
  }
}

/***************************************************************
/* functionSignature: getAdminCommand (wo)                     *
/* Parses the admin slash command for avatar operations        *
/***************************************************************/
function getAdminCommand(wo) {
  const cmd = (wo?.admin?.command || "").toLowerCase();
  if (cmd !== "avatar") return { isAvatar: false };
  const sub = (wo?.admin?.subcommand || wo?.admin?.options?.subcommand || "").toLowerCase() || null;
  const opts = wo?.admin?.options || {};
  if (sub === "url")    return { isAvatar: true, kind: "url",    value: String(opts.url  || "").trim() };
  if (sub === "prompt") return { isAvatar: true, kind: "prompt", value: String(opts.text || "").trim() };
  return { isAvatar: true, kind: "regen" };
}

/***************************************************************
/* functionSignature: getDiscordAdminAvatar (coreData)         *
/* Handles /avatar slash operations and writes files + embed   *
/***************************************************************/
export default async function getDiscordAdminAvatar(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "discord-admin") {
    wo.stop = true;
    wo.Response = "";
    return coreData;
  }
  const channelId = getChannelId(wo);
  if (!channelId) {
    setLog(wo, "Missing channel id", "warn");
    wo.stop = true;
    wo.Response = "";
    return coreData;
  }
  const adminCmd = getAdminCommand(wo);
  if (!adminCmd.isAvatar) {
    wo.stop = true;
    wo.Response = "";
    return coreData;
  }
  let performedChange = false;
  let filePath = null;
  try {
    if (adminCmd.kind === "url") {
      if (!adminCmd.value) throw new Error("Missing URL value for /avatar url");
      const buf = await getDownloadUrlBuffer(adminCmd.value);
      filePath = setWriteAvatar(channelId, buf);
      performedChange = true;
      setLog(wo, "Avatar set from URL", "info", { channelId, bytes: buf.length });
    } else {
      if (adminCmd.kind === "prompt" && adminCmd.value) {
        setAppendPrompt(wo, adminCmd.value);
        setLog(wo, "Avatar prompt appended", "info", { appended: adminCmd.value.slice(0, 200) });
      }
      const buf = await getGenerateAvatarBuffer(wo);
      filePath = setWriteAvatar(channelId, buf);
      performedChange = true;
      setLog(wo, "Avatar generated and saved", "info", { channelId, bytes: buf.length });
    }
  } catch (e) {
    setLog(wo, `Avatar operation failed: ${e?.message || String(e)}`, "error");
    wo.stop = true;
    wo.Response = "";
    return coreData;
  }
  if (performedChange && filePath) {
    try {
      const channel = await getResolveChannel(wo, channelId);
      if (channel) {
        await setSendAvatarEmbed(wo, channel, filePath);
      } else {
        setLog(wo, "Could not resolve channel to send preview embed", "warn");
      }
    } catch (e) {
      setLog(wo, `Embed send failed: ${e?.message || String(e)}`, "warn");
    }
  }
  wo.stop = true;
  wo.Response = "";
  return coreData;
}
