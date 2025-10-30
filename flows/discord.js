/********************************************************************************
/* filename: "discord.js"                                                       *
/* Version 1.0                                                                  *
/* Purpose: Start a Discord client, map messages into workingObject (incl.      *
/*          turn_id ULID), and trigger the configured flow.                     *
/********************************************************************************/
/********************************************************************************
/*                                                                              *
/********************************************************************************/

import { Client, GatewayIntentBits, Partials, ChannelType } from "discord.js";
import { putItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "discord";
const CROCK = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let __ulid_lastTime = 0;
let __ulid_lastRand = new Uint8Array(10).fill(0);

/********************************************************************************
/* functionSignature: getUlidEncodeTime (ms)                                    *
/* Encodes a millisecond timestamp to Crockford base32 (10 chars)               *
/********************************************************************************/
function getUlidEncodeTime(ms) {
  let x = BigInt(ms);
  const out = Array(10);
  for (let i = 9; i >= 0; i--) { out[i] = CROCK[Number(x % 32n)]; x = x / 32n; }
  return out.join("");
}

/********************************************************************************
/* functionSignature: getUlidEncodeRandom80ToBase32 (rand)                      *
/* Encodes 80 random bits to 16 base32 chars                                    *
/********************************************************************************/
function getUlidEncodeRandom80ToBase32(rand) {
  const out = [];
  let acc = 0, bits = 0, i = 0;
  while (i < rand.length || bits > 0) {
    if (bits < 5 && i < rand.length) { acc = (acc << 8) | rand[i++]; bits += 8; }
    else { const v = (acc >> (bits - 5)) & 31; bits -= 5; out.push(CROCK[v]); }
  }
  return out.slice(0, 16).join("");
}

/********************************************************************************
/* functionSignature: getUlidRandom80 ()                                        *
/* Generates 80 random bits as Uint8Array(10)                                   *
/********************************************************************************/
function getUlidRandom80() {
  const arr = new Uint8Array(10);
  for (let i = 0; i < 10; i++) arr[i] = Math.floor(Math.random() * 256);
  return arr;
}

/********************************************************************************
/* functionSignature: getNewUlid ()                                             *
/* Produces a 26-char monotonic ULID string                                     *
/********************************************************************************/
function getNewUlid() {
  const now = Date.now();
  let rand = getUlidRandom80();
  if (now === __ulid_lastTime) {
    for (let i = 9; i >= 0; i--) {
      if (__ulid_lastRand[i] === 255) { __ulid_lastRand[i] = 0; continue; }
      __ulid_lastRand[i]++; break;
    }
    rand = __ulid_lastRand;
  } else {
    __ulid_lastTime = now;
    __ulid_lastRand = rand;
  }
  return getUlidEncodeTime(now) + getUlidEncodeRandom80ToBase32(rand);
}

/********************************************************************************
/* functionSignature: getIntentsList (intents)                                  *
/* Returns GatewayIntentBits for configured intents                             *
/********************************************************************************/
function getIntentsList(intents) {
  const list = Array.isArray(intents)
    ? intents
    : ["Guilds", "GuildMessages", "MessageContent", "GuildVoiceStates", "DirectMessages"];
  return list.map((i) => GatewayIntentBits[i]).filter(Boolean);
}

/********************************************************************************
/* functionSignature: getAttachmentUrls (message)                               *
/* Extracts attachment URLs from a Discord message                              *
/********************************************************************************/
function getAttachmentUrls(message) {
  try {
    const values = message?.attachments?.values ? message.attachments.values() : [];
    return Array.from(values).map((a) => String(a?.url || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/********************************************************************************
/* functionSignature: getDiscordFlow (baseCore, runFlow, createRunCore)         *
/* Boots Discord client and forwards messages into the flow                     *
/********************************************************************************/
export default async function getDiscordFlow(baseCore, runFlow, createRunCore) {
  const discordConfig = baseCore?.config?.discord || {};
  const flowName = discordConfig.flowName || MODULE_NAME;
  if (!discordConfig.token) {
    const earlyCore = createRunCore();
    const earlyLog = getPrefixedLogger(earlyCore.workingObject, import.meta.url);
    earlyLog("Discord token missing in config.discord.token – flow not started.", "error", { moduleName: MODULE_NAME });
    return;
  }
  const client = new Client({
    intents: getIntentsList(discordConfig.intents),
    partials: [Partials.Channel]
  });
  {
    const startupCore = createRunCore();
    const log = getPrefixedLogger(startupCore.workingObject, import.meta.url);
    client.once("ready", () => {
      const tag = client.user?.tag || "unknown";
      log(`Discord connected as ${tag}`, "info", { moduleName: MODULE_NAME });
    });
    log("Discord client login initiated.", "info", { moduleName: MODULE_NAME });
  }
  await client.login(discordConfig.token);
  const clientRegistryId = `${MODULE_NAME}:client`;
  putItem(client, clientRegistryId);
  client.on("messageCreate", async (message) => {
    if (message.author?.bot) return;
    const runCore = createRunCore();
    const wo = (runCore.workingObject ||= {});
    const content = typeof message.content === "string" ? message.content : "";
    wo.turn_id = getNewUlid();
    wo.payload = content.trim();
    wo.flow = flowName;
    wo.id = message.channelId;
    wo.message = message;
    wo.clientRef = clientRegistryId;
    wo.timestamp = new Date().toISOString();
    wo.channelID = message.channelId;
    wo.userid = message.author?.id || "";
    wo.authorDisplayname =
      (message.member && (message.member.displayName || message.member.nickname)) ||
      message.author?.username ||
      "";
    wo.guildId = message.guildId || "";
    wo.channelType = message.channel?.type ?? null;
    wo.isDM = (wo.channelType === ChannelType.DM);
    if (wo.isDM) wo.DM = true;
    wo.fileURLs = getAttachmentUrls(message);
    const log = getPrefixedLogger(wo, import.meta.url);
    try {
      await runFlow(flowName, runCore);
    } catch (err) {
      const reason = err?.message || String(err);
      log("Discord flow execution failed", "error", { moduleName: MODULE_NAME, channelId: message.channelId, reason });
    }
  });
}
