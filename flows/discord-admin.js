/**************************************************************
/* filename: "discord-admin.js"                              *
/* Version 1.0                                               *
/* Purpose: Flow trigger for Discord slash commands with     *
/*          admin gate, snapshots, and silent forwarding to  *
/*          the configured flowName from config.             *
/**************************************************************/

/**************************************************************
/*                                                          *
/**************************************************************/

import { getItem, putItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";
import { MessageFlags } from "discord.js";

const MODULE_NAME = "discord-admin";
const CROCK = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let __ulid_lastTime = 0;
let __ulid_lastRand = new Uint8Array(10).fill(0);

/**************************************************************
/* functionSignature: getUlidEncodeTime (ms)                 *
/* Encodes a millisecond timestamp to Crockford base32       *
/* (10 chars)                                                *
/**************************************************************/
function getUlidEncodeTime(ms) {
  let x = BigInt(ms);
  const out = Array(10);
  for (let i = 9; i >= 0; i--) { out[i] = CROCK[Number(x % 32n)]; x = x / 32n; }
  return out.join("");
}

/**************************************************************
/* functionSignature: getUlidEncodeRandom80ToBase32 (rand)   *
/* Encodes 80 random bits to 16 base32 chars                 *
/**************************************************************/
function getUlidEncodeRandom80ToBase32(rand) {
  const out = [];
  let acc = 0, bits = 0, i = 0;
  while (i < rand.length || bits > 0) {
    if (bits < 5 && i < rand.length) { acc = (acc << 8) | rand[i++]; bits += 8; }
    else { const v = (acc >> (bits - 5)) & 31; bits -= 5; out.push(CROCK[v]); }
  }
  return out.slice(0, 16).join("");
}

/**************************************************************
/* functionSignature: getUlidRandom80 ()                     *
/* Generates 80 random bits as Uint8Array(10)                *
/**************************************************************/
function getUlidRandom80() {
  const arr = new Uint8Array(10);
  for (let i = 0; i < 10; i++) arr[i] = Math.floor(Math.random() * 256);
  return arr;
}

/**************************************************************
/* functionSignature: getNewUlid ()                          *
/* Produces a 26-character monotonic ULID                    *
/**************************************************************/
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

/**************************************************************
/* functionSignature: getSafeArray (v)                       *
/* Returns v if array, otherwise an empty array              *
/**************************************************************/
function getSafeArray(v) {
  return Array.isArray(v) ? v : [];
}

/**************************************************************
/* functionSignature: getWOAdminRoot (baseWO)                *
/* Returns the admin root from workingObject                 *
/**************************************************************/
function getWOAdminRoot(baseWO) {
  return baseWO?.["discord-admin"] || baseWO?.discordAdmin || {};
}

/**************************************************************
/* functionSignature: getEphemeralFlag (root)                *
/* Reads the ephemeral flag from admin root                  *
/**************************************************************/
function getEphemeralFlag(root) {
  return Boolean(root?.slash?.ephemeral ?? true);
}

/**************************************************************
/* functionSignature: getSilentFlag (root)                   *
/* Reads the silent flag from admin root                     *
/**************************************************************/
function getSilentFlag(root) {
  return Boolean(root?.slash?.silent ?? true);
}

/**************************************************************
/* functionSignature: getDefaultAvatarCommand ()             *
/* Returns default /avatar command definition                *
/**************************************************************/
function getDefaultAvatarCommand() {
  return {
    name: "avatar",
    description: "Set or generate the bot's channel avatar",
    dm_permission: false,
    options: [
      {
        type: 1,
        name: "url",
        description: "Download image from a URL and set as avatar",
        options: [{ type: 3, name: "url", description: "Direct image URL", required: true }]
      },
      {
        type: 1,
        name: "prompt",
        description: "Append text to the avatar prompt and regenerate",
        options: [{ type: 3, name: "text", description: "Prompt text to append", required: true }]
      },
      {
        type: 1,
        name: "regen",
        description: "Regenerate avatar using current prompt"
      }
    ]
  };
}

/**************************************************************
/* functionSignature: getCommandDefinitions (root, log)      *
/* Returns command definitions from admin root or fallback   *
/**************************************************************/
function getCommandDefinitions(root, log) {
  const defsFromWO = getSafeArray(root?.slash?.definitions);
  if (defsFromWO.length > 0) return defsFromWO;
  log?.("no workingObject.discord-admin.slash.definitions → registering fallback /avatar", "info", { moduleName: MODULE_NAME });
  return [getDefaultAvatarCommand()];
}

/**************************************************************
/* functionSignature: getDetectedGuildIds (client)           *
/* Returns a list of guild IDs from the client cache         *
/**************************************************************/
function getDetectedGuildIds(client) {
  try {
    return Array.from(client.guilds?.cache?.keys?.() || []);
  } catch {
    return [];
  }
}

/**************************************************************
/* functionSignature: getFindDefByName (defs, name)          *
/* Finds a command definition by name                        *
/**************************************************************/
function getFindDefByName(defs, name) {
  const low = String(name || "").toLowerCase();
  return getSafeArray(defs).find(d => String(d?.name || "").toLowerCase() === low) || null;
}

/**************************************************************
/* functionSignature: getFindSubByName (cmdDef, subName)     *
/* Finds a subcommand definition by name                     *
/**************************************************************/
function getFindSubByName(cmdDef, subName) {
  if (!cmdDef) return null;
  const subs = getSafeArray(cmdDef.options).filter(o => o?.type === 1);
  const low = String(subName || "").toLowerCase();
  return subs.find(o => String(o?.name || "").toLowerCase() === low) || null;
}

/**************************************************************
/* functionSignature: getHasAdminProp (obj)                  *
/* True if object has an admin property                      *
/**************************************************************/
function getHasAdminProp(obj) {
  return obj && Object.prototype.hasOwnProperty.call(obj, "admin");
}

/**************************************************************
/* functionSignature: getCheckAllowByAdminArray (defLike,    *
/*                     userId)                               *
/* Evaluates admin array allow-list                          *
/**************************************************************/
function getCheckAllowByAdminArray(defLike, userId) {
  const list = getSafeArray(defLike?.admin).map(String);
  if (list.length === 0) return false;
  return list.includes(String(userId));
}

/**************************************************************
/* functionSignature: getIsUserAllowedForCmdAndSub          *
/*   (defs, cmdName, subName, userId)                        *
/* Checks admin gate: sub.admin > cmd.admin > allow if none  *
/**************************************************************/
function getIsUserAllowedForCmdAndSub(defs, cmdName, subName, userId) {
  const cmd = getFindDefByName(defs, cmdName);
  if (!cmd) return true;
  const sub = subName ? getFindSubByName(cmd, subName) : null;
  if (sub && getHasAdminProp(sub)) return getCheckAllowByAdminArray(sub, userId);
  if (getHasAdminProp(cmd)) return getCheckAllowByAdminArray(cmd, userId);
  return true;
}

/**************************************************************
/* functionSignature: getDeepStripAdmin (def)                *
/* Removes admin fields from a definition tree               *
/**************************************************************/
function getDeepStripAdmin(def) {
  if (!def || typeof def !== "object") return def;
  const { admin, options, ...rest } = def;
  if (Array.isArray(options)) rest.options = options.map(getDeepStripAdmin);
  return rest;
}

/**************************************************************
/* functionSignature: getSanitizeDefsForDiscord (defs)       *
/* Returns definitions without admin fields                  *
/**************************************************************/
function getSanitizeDefsForDiscord(defs) {
  return getSafeArray(defs).map(getDeepStripAdmin);
}

/**************************************************************
/* functionSignature: getSpecString (defs, scope)            *
/* Serializes a spec for change detection                    *
/**************************************************************/
function getSpecString(defs, scope) {
  return JSON.stringify({ scope, defs: defs || [] });
}

/**************************************************************
/* functionSignature: setRegisterSlashCommands (client,      *
/*                     defs)                                 *
/* Registers commands globally or per-guild                  *
/**************************************************************/
async function setRegisterSlashCommands(client, defs) {
  await client.application?.fetch();
  const guildIds = getDetectedGuildIds(client);
  const scope = guildIds.length > 0 ? `guild:${guildIds.slice().sort().join(",")}` : "global";
  const cleanDefs = getSanitizeDefsForDiscord(defs);
  const SPEC_KEY = "discord-admin:spec";
  const prev = await getItem(SPEC_KEY);
  const spec = getSpecString(cleanDefs, scope);
  const needRegister = spec !== (prev?.spec || null);
  if (!needRegister && guildIds.length > 0) return false;
  if (guildIds.length > 0) {
    for (const gid of guildIds) {
      try { await client.application.commands.set(cleanDefs, gid); } catch {}
    }
  } else {
    try { await client.application.commands.set(cleanDefs); } catch {}
  }
  await putItem({ spec, at: Date.now() }, SPEC_KEY);
  return true;
}

/**************************************************************
/* functionSignature: setEnsureGuildRegistration (client,    *
/*                     defs, log)                            *
/* Repairs missing guild command registrations if needed     *
/**************************************************************/
async function setEnsureGuildRegistration(client, defs, log) {
  const cleanDefs = getSanitizeDefsForDiscord(defs);
  const gids = getDetectedGuildIds(client);
  for (const gid of gids) {
    try {
      const existing = await client.application.commands.fetch({ guildId: gid });
      const names = new Set(existing.map(c => String(c.name || "").toLowerCase()));
      const missing = cleanDefs.filter(d => !names.has(String(d.name || "").toLowerCase()));
      if (missing.length > 0) {
        try {
          await client.application.commands.set(cleanDefs, gid);
          log(`Repaired slash registrations for guild ${gid}`, "info", { moduleName: MODULE_NAME, repaired: missing.map(m => m.name) });
        } catch {}
      }
    } catch {}
  }
}

/**************************************************************
/* functionSignature: getOptionObject (interaction)          *
/* Flattens interaction options into a plain object          *
/**************************************************************/
function getOptionObject(interaction) {
  const out = {};
  try {
    const group = interaction.options.getSubcommandGroup(false) || null;
    const sub = interaction.options.getSubcommand(false) || null;
    out.subcommandGroup = group || null;
    out.subcommand = sub || null;
    const root = interaction.options?.data || [];
    const levels = [];
    if (Array.isArray(root)) levels.push(...root);
    for (const lv of levels) {
      if (Array.isArray(lv?.options)) {
        for (const o of lv.options) {
          if (o?.name && Object.prototype.hasOwnProperty.call(o, "value")) out[o.name] = o.value;
          if (Array.isArray(o?.options)) {
            for (const p of o.options) {
              if (p?.name && Object.prototype.hasOwnProperty.call(p, "value")) out[p.name] = p.value;
            }
          }
        }
      } else if (lv?.name && Object.prototype.hasOwnProperty.call(lv, "value")) {
        out[lv.name] = lv.value;
      }
    }
  } catch {}
  return out;
}

/**************************************************************
/* functionSignature: getInteractionSnapshot (i)             *
/* Builds a safe snapshot of an interaction                  *
/**************************************************************/
function getInteractionSnapshot(i) {
  try {
    return {
      id: i?.id || "",
      applicationId: i?.applicationId || "",
      type: i?.type || 0,
      commandName: i?.commandName || "",
      guildId: i?.guildId || "",
      channelId: i?.channelId || "",
      userId: i?.user?.id || "",
      memberId: i?.member?.user?.id || "",
      options: getOptionObject(i),
      subcommand: (() => { try { return i.options.getSubcommand(false) || null; } catch { return null; } })(),
      subcommandGroup: (() => { try { return i.options.getSubcommandGroup(false) || null; } catch { return null; } })(),
      createdTimestamp: i?.createdTimestamp ?? null
    };
  } catch {
    return null;
  }
}

/**************************************************************
/* functionSignature: getBuildRunCore (createRunCore,        *
/*                     interaction, baseWO)                  *
/* Seeds a run core with safe interaction data               *
/**************************************************************/
function getBuildRunCore(createRunCore, interaction, baseWO) {
  const rc = createRunCore();
  const wo = rc.workingObject;
  if (baseWO && typeof baseWO === "object") {
    for (const [k, v] of Object.entries(baseWO)) {
      if (k === "clientRef" || k === "botName" || k === "persona" || k === "instructions") wo[k] = v;
      if (k.startsWith("Avatar")) wo[k] = v;
    }
  }
  if (!wo.clientRef) wo.clientRef = "discord:client";
  if (!wo.refs || typeof wo.refs !== "object") wo.refs = {};
  if (!wo.refs.client) wo.refs.client = "discord:client";
  wo.turn_id = getNewUlid();
  const snap = getInteractionSnapshot(interaction);
  wo.id = interaction.channelId || "";
  wo.guildId = interaction.guildId || "";
  wo.payload = { discord: { interaction: snap } };
  wo.admin = {
    command: interaction.commandName,
    options: snap?.options || {},
    subcommand: snap?.subcommand || null,
    subcommandGroup: snap?.subcommandGroup || null,
    userId: snap?.userId || "",
    channelId: interaction.channelId || "",
    guildId: interaction.guildId || ""
  };
  const createdTs = interaction?.createdTimestamp;
  wo.timestamp = new Date(createdTs || Date.now()).toISOString();
  return rc;
}

/**************************************************************
/* functionSignature: setBindInteractionHandler (client, fn) *
/* Binds a single interactionCreate handler once             *
/**************************************************************/
function setBindInteractionHandler(client, fn) {
  if (client.__discordAdminBound) return;
  client.__discordAdminBound = true;
  client.on("interactionCreate", fn);
}

/**************************************************************
/* functionSignature: getConfigFlowName (baseCore)           *
/* Reads flowName from config["discord-admin"] or fallback   *
/**************************************************************/
function getConfigFlowName(baseCore) {
  const cfg = baseCore?.config?.["discord-admin"] || baseCore?.config?.discordAdmin || {};
  const name = typeof cfg.flowName === "string" ? cfg.flowName.trim() : "";
  return name || MODULE_NAME;
}

/**************************************************************
/* functionSignature: setStartWhenClientAvailable (baseCore, *
/*                     runFlow, createRunCore)               *
/* Registers commands and routes interactions to the flow    *
/**************************************************************/
async function setStartWhenClientAvailable(baseCore, runFlow, createRunCore) {
  const INIT_KEY = "discord-admin:initialized";
  if (await getItem(INIT_KEY)) return;
  const baseWO = baseCore?.workingObject || {};
  const root = getWOAdminRoot(baseWO);
  const log = getPrefixedLogger(baseWO, import.meta.url);
  const flowName = getConfigFlowName(baseCore);
  let ticking = true;
  async function setTryStart() {
    try {
      const clientRef = baseWO.clientRef || "discord:client";
      const client = await getItem(clientRef);
      if (!client) return;
      const defs = getCommandDefinitions(root, log);
      const ephemeral = getEphemeralFlag(root);
      const silent = getSilentFlag(root);
      try {
        if (!client.isReady?.()) {
          await new Promise((resolve) => client.once(("clientReady" in client) ? "clientReady" : "ready", resolve));
        }
      } catch {}
      const changed = await setRegisterSlashCommands(client, defs);
      if (changed) {
        log("slash commands registered/updated", "info", { moduleName: MODULE_NAME, count: defs.length });
      }
      await setEnsureGuildRegistration(client, defs, log);
      setBindInteractionHandler(client, async (interaction) => {
        try {
          if (!interaction.isChatInputCommand?.()) return;
          const cmdName = String(interaction.commandName || "").toLowerCase();
          const subName = (() => { try { return interaction.options.getSubcommand(false) || null; } catch { return null; } })();
          const userId = interaction.user?.id || interaction.member?.user?.id || "";
          const allowed = getIsUserAllowedForCmdAndSub(defs, cmdName, subName, userId);
          if (!allowed) return;
          let replied = false;
          try {
            if (silent) {
              await interaction.deferReply({ flags: MessageFlags.Ephemeral });
              replied = true;
            } else {
              if (ephemeral) {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
              } else {
                await interaction.deferReply();
              }
              replied = true;
            }
          } catch {}
          const rc = getBuildRunCore(createRunCore, interaction, baseWO);
          rc.workingObject.flow = flowName;
          try {
            await runFlow(flowName, rc);
          } finally {
            if (replied) {
              try { await interaction.deleteReply(); } catch {}
            }
          }
        } catch {}
      });
      await putItem({ at: Date.now() }, INIT_KEY);
      ticking = false;
      log("discord-admin ready", "info", { moduleName: MODULE_NAME, flowName });
    } catch {}
  }
  await setTryStart();
  if (!ticking) return;
  const INTERVAL_KEY = "discord-admin:poller";
  if (await getItem(INTERVAL_KEY)) return;
  const id = setInterval(async () => {
    if (await getItem(INIT_KEY)) {
      clearInterval(id);
      return;
    }
    await setTryStart();
    if (!ticking) clearInterval(id);
  }, 1000);
  await putItem({ at: Date.now() }, INTERVAL_KEY);
}

/**************************************************************
/* functionSignature: getDiscordAdminFlow (baseCore,         *
/*                     runFlow, createRunCore)               *
/* Entry point: starts when Discord client is available      *
/**************************************************************/
export default async function getDiscordAdminFlow(baseCore, runFlow, createRunCore) {
  await setStartWhenClientAvailable(baseCore, runFlow, createRunCore);
}
