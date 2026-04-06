





import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fetch from "node-fetch";
import discordJs from "discord.js";
const { EmbedBuilder } = discordJs;
import { getItem } from "../core/registry.js";
import { getSecret } from "../core/secrets.js";

const MODULE_NAME = "discord-admin-avatar";


function getChannelId(wo) {
  const fromAdmin = wo?.admin?.channelId;
  const fromWO = wo?.channelID;
  return String(fromAdmin || fromWO || "");
}


function getAvatarDir() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.join(__dirname, "..", "pub", "documents", "avatars");
}


function setEnsureDir(absPath) {
  if (!fs.existsSync(absPath)) fs.mkdirSync(absPath, { recursive: true });
}


function getAvatarFilePath(channelId) {
  return path.join(getAvatarDir(), `${channelId}.png`);
}


function setWriteAvatar(channelId, buf) {
  const dir = getAvatarDir();
  setEnsureDir(dir);
  const p = getAvatarFilePath(channelId);
  try {
    fs.rmSync(p, { force: true });
  } catch {}
  const tmp = `${p}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, buf, { flag: "w" });
  fs.renameSync(tmp, p);
  return p;
}


function setLog(wo, message, level = "info", extra = null) {
  (wo.logging ||= []).push({
    timestamp: new Date().toISOString(),
    severity: level,
    module: "discord-admin-avatar",
    exitStatus: level === "error" ? "error" : "success",
    message,
    ...(extra ? { context: extra } : {})
  });
}


function getComposePrompt(wo) {
  const persona = String(wo?.persona || wo?.persona || "").trim();
  const instructions = String(wo?.instructions || wo?.instructions || "").trim();
  const botname = String(wo?.botName || wo?.botname || "").trim();
  const avatarPrompt = String(wo?.avatarprompt ?? wo?.avatarPrompt ?? "").trim();
  const parts = [];
  if (persona) parts.push(persona);
  if (instructions) parts.push(instructions);
  if (botname) parts.push(`Bot name: ${botname}`);
  if (avatarPrompt) parts.push(avatarPrompt);
  const suffix = "portrait, no text, no letters, no symbols, vibrant colors, cinematic, action, digital painting, no writings, ignore text";
  let base = parts.join("\n").trim();
  if (!base) {
    return suffix.slice(0, 4000);
  }
  const maxBase = 4000 - (suffix.length + 1);
  if (maxBase <= 0) {
    return suffix.slice(0, 4000);
  }
  if (base.length > maxBase) {
    base = base.slice(0, maxBase);
  }
  return `${base}\n${suffix}`;
}


function setAppendPrompt(wo, extra) {
  const base = String(wo?.avatarprompt ?? wo?.avatarPrompt ?? "").trim();
  const add = String(extra || "").trim();
  const combined = base ? `${base}\n${add}` : add;
  wo.avatarprompt = combined;
}


async function getDownloadUrlBuffer(urlStr) {
  const res = await fetch(String(urlStr));
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}


async function getGenerateAvatarBuffer(wo) {
  const endpoint = String(wo?.avatarEndpoint || "");
  const model = String(wo?.avatarModel || "");
  const apiKey = await getSecret(wo, wo?.avatarApiKey || "");
  if (!endpoint) throw new Error("Missing avatarEndpoint");
  if (!model) throw new Error("Missing avatarModel");
  if (!apiKey) throw new Error("Missing avatarApiKey");

  const prompt = getComposePrompt(wo);
  const size = String(wo?.avatarSize ?? "1024x1024");

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


async function getResolveChannel(wo, channelId) {
  const clientKey = wo?.clientRef || wo?.refs?.client || "discord:client";
  const client = await getItem(clientKey);
  if (!client?.channels?.fetch) return null;
  try {
    return await client.channels.fetch(channelId);
  } catch {
    return null;
  }
}


async function setSendAvatarEmbed(wo, channel, filePath) {
  try {
    const filename = filePath.split(filePath.includes("/") ? "/" : "\\").pop();
    const attachName = filename || "avatar.png";
    const embed = new EmbedBuilder()
      .setColor(0x2f3136)
      .setDescription("New avatar has been set.")
      .setImage(`attachment://${attachName}`)
      .setTimestamp(new Date());
    await channel.send({ embeds: [embed], files: [{ attachment: filePath, name: attachName }] });
    setLog(wo, "Avatar preview embed sent", "info");
  } catch (e) {
    setLog(wo, `Failed to send avatar embed: ${e?.message || String(e)}`, "warn");
  }
}


function getAdminCommand(wo) {
  const cmd = (wo?.admin?.command || "").toLowerCase();
  if (cmd !== "avatar") return { isAvatar: false };

  const sub = (wo?.admin?.subcommand || wo?.admin?.subCommand || wo?.admin?.options?.subcommand || "").toLowerCase() || null;

  const opts = wo?.admin?.options || {};
  if (sub === "url") {
    return { isAvatar: true, kind: "url", value: String(opts.url || opts.value || "").trim() };
  }
  if (sub === "prompt") {
    return { isAvatar: true, kind: "prompt", value: String(opts.text || opts.value || "").trim() };
  }
  return { isAvatar: true, kind: "regen" };
}


export default async function getDiscordAdminAvatar(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "discord-admin") {
    return coreData;
  }
  const adminCmd = getAdminCommand(wo);
  if (!adminCmd.isAvatar) {
    return coreData;
  }
  const channelId = getChannelId(wo);
  if (!channelId) {
    setLog(wo, "Missing channel id for avatar command", "warn");
    wo.response = "";
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
    wo.response = "";
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
  wo.response = "";
  return coreData;
}
