/**************************************************************
/* filename: "discord-admin-gdpr.js"                         *
/* Version 1.0                                               *
/* Purpose: /gdpr (text|voice) (0|1); ensure table; update;  *
/*          if both chat & voice == 0 then set disclaimer=0. *
/**************************************************************/
/**************************************************************
/*                                                          *
/**************************************************************/

import mysql from "mysql2/promise";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "discord-admin-gdpr";

/**************************************************************
/* functionSignature: getTableName (coreData)                *
/* Resolves the consent table name from configuration        *
/**************************************************************/
function getTableName(coreData) {
  const t1 = coreData?.config?.["discord-gdpr-gate"]?.table;
  if (typeof t1 === "string" && t1.trim()) return t1.trim();
  const t2 = coreData?.config?.["discord-admin-gdpr"]?.table;
  if (typeof t2 === "string" && t2.trim()) return t2.trim();
  const t3 = coreData?.config?.["gdpr-gate"]?.table;
  if (typeof t3 === "string" && t3.trim()) return t3.trim();
  return "gdpr_consent";
}

/**************************************************************
/* functionSignature: getDbConfig (wo)                       *
/* Reads DB connection configuration from workingObject      *
/**************************************************************/
function getDbConfig(wo) {
  const db = wo?.db || {};
  const { host, user, password, database } = db;
  if (!host || !user || !database) return null;
  return { host, user, password, database, charset: "utf8mb4" };
}

/**************************************************************
/* functionSignature: getParseValue (x)                      *
/* Parses a numeric-like value into 0 or 1                   *
/**************************************************************/
function getParseValue(x) {
  const n = Number(x);
  return n === 1 ? 1 : 0;
}

const CREATED = new Set();

/**************************************************************
/* functionSignature: setEnsureTable (conn, table)           *
/* Ensures the consent table exists                          *
/**************************************************************/
async function setEnsureTable(conn, table) {
  if (CREATED.has(table)) return;
  const ddl = `
    CREATE TABLE IF NOT EXISTS \`${table}\` (
      \`user_id\`    VARCHAR(64)  NOT NULL,
      \`channel_id\` VARCHAR(64)  NOT NULL,
      \`chat\`       TINYINT(1)   NOT NULL DEFAULT 0,
      \`voice\`      TINYINT(1)   NOT NULL DEFAULT 0,
      \`disclaimer\` TINYINT(1)   NOT NULL DEFAULT 0,
      \`updated_at\` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`user_id\`, \`channel_id\`),
      KEY \`idx_channel\` (\`channel_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
  await conn.execute(ddl);
  CREATED.add(table);
}

/**************************************************************
/* functionSignature: getDiscordAdminGdpr (coreData)         *
/* Updates GDPR flags via /gdpr and resets disclaimer if req */
/**************************************************************/
export default async function getDiscordAdminGdpr(coreData) {
  const wo  = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  if (wo?.flow !== "discord-admin") return coreData;

  const cmd = String(wo?.admin?.command || "").toLowerCase();
  if (cmd !== "gdpr") return coreData;

  const userIdFromSlash = String(wo?.admin?.userId || "");
  const channelId       = String(wo?.admin?.channelId || wo?.id || "");
  const sub             = String(wo?.admin?.subcommand || "").toLowerCase();
  const rawVal          = wo?.admin?.options?.value ?? wo?.admin?.options?.val ?? wo?.admin?.options?.state ?? null;
  const value           = getParseValue(rawVal);

  const dbCfg = getDbConfig(wo);
  const table = getTableName(coreData);
  const targetUserId = userIdFromSlash;

  if (!dbCfg || !targetUserId || !channelId || !sub || (sub !== "text" && sub !== "voice")) {
    log("gdpr admin missing/invalid data", "error", { moduleName: MODULE_NAME, hasDb: !!dbCfg, targetUserId, channelId, sub });
    wo.Response = "";
    return coreData;
  }

  let conn = null;
  try {
    conn = await mysql.createConnection(dbCfg);
    await setEnsureTable(conn, table);

    if (sub === "text") {
      await conn.execute(
        `INSERT INTO \`${table}\` (user_id, channel_id, chat, voice, disclaimer)
         VALUES (?, ?, ?, 0, 1)
         ON DUPLICATE KEY UPDATE chat=VALUES(chat), disclaimer=1`,
        [targetUserId, channelId, value]
      );
    } else {
      await conn.execute(
        `INSERT INTO \`${table}\` (user_id, channel_id, chat, voice, disclaimer)
         VALUES (?, ?, 0, ?, 1)
         ON DUPLICATE KEY UPDATE voice=VALUES(voice), disclaimer=1`,
        [targetUserId, channelId, value]
      );
    }

    const [rows] = await conn.execute(
      `SELECT chat, voice FROM \`${table}\` WHERE user_id=? AND channel_id=? LIMIT 1`,
      [targetUserId, channelId]
    );
    const chat  = Number(rows?.[0]?.chat || 0) ? 1 : 0;
    const voice = Number(rows?.[0]?.voice || 0) ? 1 : 0;

    if (chat === 0 && voice === 0) {
      await conn.execute(
        `UPDATE \`${table}\` SET disclaimer=0 WHERE user_id=? AND channel_id=?`,
        [targetUserId, channelId]
      );
      log("both consents 0 → disclaimer reset to 0 (admin)", "info", { moduleName: MODULE_NAME, targetUserId, channelId });
    }

    log("gdpr updated", "info", { moduleName: MODULE_NAME, targetUserId, channelId, set: sub, value });

    wo.Response = "";
    await conn.end().catch(() => {});
    return coreData;

  } catch (e) {
    if (conn) try { await conn.end(); } catch {}
    log("gdpr update failed", "error", { moduleName: MODULE_NAME, reason: e?.message });
    wo.Response = "";
    return coreData;
  }
}
