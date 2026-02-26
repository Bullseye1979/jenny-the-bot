/**************************************************************
/* filename: "discord-admin-macro.js"                        *
/* Version 1.0                                               *
/* Purpose: Slash admin command /macro with subcommands:     *
/*          /macro create <name> <text> (overwrites)         *
/*          /macro run <name>                                *
/*          /macro delete <name>                             *
/*          /macro list                                      *
/*                                                            *
/* Macros are stored per user in a MySQL table using         *
/* workingObject.db configuration.                           *
/**************************************************************/
/**************************************************************
/*                                                          *
/**************************************************************/

import mysql from "mysql2/promise";
import { getItem } from "../core/registry.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "discord-admin-macro";
const MACRO_TAG = "#Macro#";
let __pool = null;
let __tableEnsured = false;

/**************************************************************
/* functionSignature: getResolveClient (wo)                  *
/* Resolves and returns the Discord client from workingObject*/
/**************************************************************/
async function getResolveClient(wo) {
  const ref = wo?.clientRef || wo?.refs?.client || "discord:client";
  try {
    const client = await getItem(ref);
    return client || null;
  } catch {
    return null;
  }
}

/**************************************************************
/* functionSignature: getDbPool (wo, log)                    *
/* Creates or returns a cached MySQL connection pool         *
/**************************************************************/
async function getDbPool(wo, log) {
  if (__pool) return __pool;
  const db = wo?.db;
  if (!db) {
    log("macro: missing workingObject.db configuration", "error", { moduleName: MODULE_NAME });
    return null;
  }
  try {
    __pool = mysql.createPool({
      host: db.host,
      user: db.user,
      password: db.password,
      database: db.database,
      waitForConnections: true,
      connectionLimit: 4
    });
    return __pool;
  } catch (e) {
    log("macro: failed to create DB pool", "error", { moduleName: MODULE_NAME, reason: e?.message || String(e) });
    return null;
  }
}

/**************************************************************
/* functionSignature: setEnsureTable (pool, log)             *
/* Ensures the macros table exists                           *
/**************************************************************/
async function setEnsureTable(pool, log) {
  if (__tableEnsured) return;
  const sql = `
    CREATE TABLE IF NOT EXISTS discord_macros (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id    VARCHAR(64) NOT NULL,
      guild_id   VARCHAR(64) NULL,
      channel_id VARCHAR(64) NULL,
      name       VARCHAR(100) NOT NULL,
      text       TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_user_name (user_id, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await pool.query(sql);
  __tableEnsured = true;
}

/**************************************************************
/* functionSignature: setCreateOrOverwriteMacro (args)       *
/* Creates or overwrites a macro for a user                  *
/**************************************************************/
async function setCreateOrOverwriteMacro({ pool, log, userId, guildId, channelId, name, text }) {
  await setEnsureTable(pool, log);
  const sql = `
    INSERT INTO discord_macros (user_id, guild_id, channel_id, name, text)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      text = VALUES(text),
      updated_at = CURRENT_TIMESTAMP
  `;
  await pool.query(sql, [userId, guildId || null, channelId || null, name, text]);
  log("macro create/overwrite", "info", { moduleName: MODULE_NAME, userId, name });
}

/**************************************************************
/* functionSignature: setDeleteMacro (args)                  *
/* Deletes a macro by name for a user                        *
/**************************************************************/
async function setDeleteMacro({ pool, log, userId, name }) {
  await setEnsureTable(pool, log);
  const sql = `DELETE FROM discord_macros WHERE user_id = ? AND name = ? LIMIT 1`;
  const [res] = await pool.query(sql, [userId, name]);
  const affected = res?.affectedRows ?? 0;
  log("macro delete", "info", { moduleName: MODULE_NAME, userId, name, deleted: affected });
  return affected;
}

/**************************************************************
/* functionSignature: setRunMacro (args)                     *
/* Sends the stored macro text to the target channel         *
/**************************************************************/
async function setRunMacro({ pool, log, wo, userId, guildId, channelId, name }) {
  await setEnsureTable(pool, log);
  const sql = `SELECT text FROM discord_macros WHERE user_id = ? AND name = ? LIMIT 1`;
  const [rows] = await pool.query(sql, [userId, name]);
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!row) {
    log("macro run: not found", "warn", { moduleName: MODULE_NAME, userId, name });
    return { found: false };
  }
  const client = await getResolveClient(wo);
  if (!client) {
    log("macro run: missing discord client", "error", { moduleName: MODULE_NAME });
    return { found: true, sent: false, reason: "no_client" };
  }
  const targetChannelId = String(channelId || wo?.admin?.channelId || wo?.channelID || wo?.id || "");
  if (!targetChannelId) {
    log("macro run: missing channelId", "error", { moduleName: MODULE_NAME });
    return { found: true, sent: false, reason: "no_channel" };
  }
  let channel = null;
  try {
    channel = await client.channels.fetch(targetChannelId);
  } catch (e) {
    log("macro run: failed to fetch channel", "error", { moduleName: MODULE_NAME, channelId: targetChannelId, reason: e?.message || String(e) });
    return { found: true, sent: false, reason: "fetch_failed" };
  }
  if (!channel || typeof channel.send !== "function") {
    log("macro run: channel has no send()", "error", { moduleName: MODULE_NAME, channelId: targetChannelId });
    return { found: true, sent: false, reason: "no_send" };
  }
  const marker = `${MACRO_TAG} `;
  await channel.send(marker + row.text);
  log("macro run: message sent", "info", { moduleName: MODULE_NAME, userId, guildId, channelId: targetChannelId, name });
  return { found: true, sent: true };
}

/**************************************************************
/* functionSignature: getListMacros (args)                   *
/* Returns a list of user macros with previews               *
/**************************************************************/
async function getListMacros({ pool, log, userId }) {
  await setEnsureTable(pool, log);
  const sql = `
    SELECT name, text, updated_at
    FROM discord_macros
    WHERE user_id = ?
    ORDER BY updated_at DESC, name ASC
  `;
  const [rows] = await pool.query(sql, [userId]);
  log("macro list: fetched entries", "info", { moduleName: MODULE_NAME, userId, count: Array.isArray(rows) ? rows.length : 0 });
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows.map((r) => ({
    name: r.name,
    preview: r.text && r.text.length > 200 ? r.text.slice(0, 200) + "…" : (r.text || ""),
    updated_at: r.updated_at
  }));
}

/**************************************************************
/* functionSignature: getDiscordAdminMacro (coreData)        *
/* Handles /macro admin commands within the admin flow       *
/**************************************************************/
export default async function getDiscordAdminMacro(coreData) {
  const wo = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);
  try {
    if (wo?.flow !== "discord-admin") return coreData;
    const cmd = String(wo?.admin?.command || "").toLowerCase();
    if (cmd !== "macro") return coreData;
    const sub = String(wo?.admin?.subcommand || wo?.admin?.subCommand || "").toLowerCase();
    const userId = String(wo?.admin?.userId || wo.userid || wo.userId || "");
    const guildId = String(wo?.admin?.guildId || wo.guildId || "");
    const channelId = String(wo?.admin?.channelId || wo.channelID || wo.id || "");
    log("macro: incoming admin command", "debug", { moduleName: MODULE_NAME, flow: wo?.flow, command: cmd, subcommand: sub, userId, guildId, channelId });
    if (!userId) {
      wo.response = "⚠️ Macro: missing user context.";
      return coreData;
    }
    const pool = await getDbPool(wo, log);
    if (!pool) {
      wo.response = "⚠️ Macro: database connection not available.";
      return coreData;
    }
    if (sub === "create") {
      const name = String(wo?.admin?.options?.name || "").trim();
      const text = String(wo?.admin?.options?.text || "").trim();
      if (!name || !text) {
        wo.response = "⚠️ Please provide both a macro name and a text body.";
      } else {
        await setCreateOrOverwriteMacro({ pool, log, userId, guildId, channelId, name, text });
        wo.response = `✅ Macro **${name}** has been saved (overwritten if it already existed).`;
      }
    } else if (sub === "delete") {
      const name = String(wo?.admin?.options?.name || "").trim();
      if (!name) {
        wo.response = "⚠️ Please provide the name of the macro you want to delete.";
      } else {
        const deleted = await setDeleteMacro({ pool, log, userId, name });
        if (deleted) {
          wo.response = `🗑️ Macro **${name}** has been deleted.`;
        } else {
          wo.response = `ℹ️ Macro **${name}** was not found.`;
        }
      }
    } else if (sub === "run") {
      const name = String(wo?.admin?.options?.name || "").trim();
      if (!name) {
        wo.response = "⚠️ Please provide the name of the macro you want to run.";
      } else {
        const result = await setRunMacro({ pool, log, wo, userId, guildId, channelId, name });
        if (!result?.found) {
          wo.response = `ℹ️ Macro **${name}** does not exist.`;
        } else if (!result?.sent) {
          wo.response = `⚠️ Macro **${name}** was found, but I could not send the message (reason: ${result.reason || "unknown"}).`;
        } else {
          wo.response = "";
        }
      }
    } else if (sub === "list") {
      const entries = await getListMacros({ pool, log, userId });
      if (!entries.length) {
        wo.response = "📭 You don't have any macros yet.";
      } else {
        const lines = entries.map((r) => {
          const previewSafe = (r.preview || "").replace(/\r?\n/g, " ");
          return `**${r.name}**\n\`${previewSafe}\`\n`;
        });
        wo.response = "📚 **Your macros:**\n\n" + lines.join("\n");
      }
    } else {
      wo.response = "⚠️ Unknown macro subcommand (allowed: create, run, delete, list).";
    }
    return coreData;
  } catch (e) {
    log("macro handler failed", "error", { moduleName: MODULE_NAME, reason: e?.message || String(e), stack: e?.stack });
    const woRef = coreData?.workingObject || {};
    woRef.response = "❌ Internal error in macro handler.";
    return coreData;
  }
}
