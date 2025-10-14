/***************************************************************
/* filename: "discord.js"                                      *
/* Version 1.0                                                 *
/* Purpose: Start Discord client, map messages into            *
/*          workingObject, and trigger the configured flow     *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

import { Client, GatewayIntentBits } from "discord.js";
import { putItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "discord";

/***************************************************************
/* functionSignature: getIntentsList (intents)                 *
/* Normalizes configured intents to GatewayIntentBits values   *
/***************************************************************/
function getIntentsList(intents) {
  const list = Array.isArray(intents)
    ? intents
    : ["Guilds", "GuildMessages", "MessageContent", "GuildVoiceStates"];
  return list.map((i) => GatewayIntentBits[i]).filter(Boolean);
}

/***************************************************************
/* functionSignature: getAttachmentUrls (message)              *
/* Extracts attachment URLs from a Discord message             *
/***************************************************************/
function getAttachmentUrls(message) {
  try {
    const values = message?.attachments?.values ? message.attachments.values() : [];
    return Array.from(values).map((a) => String(a?.url || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/***************************************************************
/* functionSignature: getDiscordFlow (baseCore, runFlow, make) *
/* Boots Discord client and forwards messages into the flow    *
/***************************************************************/
export default async function getDiscordFlow(baseCore, runFlow, createRunCore) {
  const discordConfig = baseCore?.config?.discord || {};
  const flowName = discordConfig.flowName || MODULE_NAME;

  if (!discordConfig.token) {
    const earlyCore = createRunCore();
    const earlyLog = getPrefixedLogger(earlyCore.workingObject, import.meta.url);
    earlyLog("Discord token missing in config.discord.token – flow not started.", "error", { moduleName: MODULE_NAME });
    return;
  }

  const client = new Client({ intents: getIntentsList(discordConfig.intents) });

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

    wo.payload = content.trim();
    wo.flow = flowName;
    wo.id = message.channelId;
    wo.message = message;
    wo.clientRef = clientRegistryId;

    wo.channelID = message.channelId;
    wo.userid = message.author?.id || "";
    wo.authorDisplayname =
      (message.member && (message.member.displayName || message.member.nickname)) ||
      message.author?.username ||
      "";

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
