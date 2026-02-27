/**************************************************************/
/* filename: "discord-gdpr-gate.js"                           */
/* Version 1.0                                                */
/* Purpose: GDPR gate for "discord" (text) and "discord-voice"*/
/*          Sends disclaimer DM exactly once and enforces     */
/*          consent checks; skips DMs and bot users.          */
/**************************************************************/
/**************************************************************/
/*                                                            */
/**************************************************************/

import mysql from "mysql2/promise";
import { getPrefixedLogger } from "../core/logging.js";
import { getItem } from "../core/registry.js";

const MODULE_NAME = "gdpr-gate";

/**************************************************************/
/* functionSignature: getTableName (coreData)                */
/* Resolves the consent table name from configuration        */
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

/**************************************************************/
/* functionSignature: getDbConfig (wo)                       */
/* Reads DB connection configuration from workingObject      */
/**************************************************************/
function getDbConfig(wo) {
  const db = wo?.db || {};
  const { host, user, password, database } = db;
  if (!host || !user || !database) return null;
  return { host, user, password, database, charset: "utf8mb4" };
}

/**************************************************************/
/* functionSignature: getSimpleTemplate (str, vars)          */
/* Applies {{var}} substitutions to a string                 */
/**************************************************************/
function getSimpleTemplate(str, vars) {
  return String(str).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (k in vars ? String(vars[k]) : ""));
}

/**************************************************************/
/* functionSignature: getDisclaimerText (wo)                 */
/* Resolves disclaimer text from multiple possible keys      */
/**************************************************************/
function getDisclaimerText(wo) {
  const t1 = typeof wo?.gdprDisclaimer === "string" ? wo.gdprDisclaimer : "";
  if (t1 && t1.trim()) return t1.trim();
  const t2 = typeof wo?.GDPRDisclaimer === "string" ? wo.GDPRDisclaimer : "";
  if (t2 && t2.trim()) return t2.trim();
  return "";
}

/**************************************************************/
/* functionSignature: getBuildDisclaimerFromWO (wo, ctx)     */
/* Builds disclaimer body and embed from workingObject       */
/**************************************************************/
function getBuildDisclaimerFromWO(wo, { userId, channelId, flow }) {
  const txt = getDisclaimerText(wo);
  if (!txt) return null;

  const operatorName = String(wo?.GdprOperatorName ?? wo?.GDPROperatorName ?? "");
  const operatorContact = String(wo?.GdprContact ?? wo?.GDPRContact ?? "");
  const retention = String(wo?.GdprRetention ?? wo?.GDPRRetention ?? "");

  const vars = { userId, channelId, flow, operatorName, operatorContact, retention };
  const desc = getSimpleTemplate(txt, vars);
  const embed = { title: "GDPR Consent Required", description: desc, color: 0x5865f2 };

  return { body: desc, embed };
}

/**************************************************************/
/* functionSignature: setHardBlock (wo, body)                */
/* Forces the pipeline to stop and prevents downstream work  */
/**************************************************************/
function setHardBlock(wo, body) {
  wo.response = body ?? "";
  wo.stop = true;
  wo.blocked = true;
  wo.skipLLM = true;
}

/**************************************************************/
/* functionSignature: setSendDisclaimerDM (wo, ctx, log)     */
/* Sends the disclaimer as a direct message to the user      */
/**************************************************************/
async function setSendDisclaimerDM(wo, ctx, log) {
  const built = getBuildDisclaimerFromWO(wo, ctx);
  if (!built) {
    log("gdprDisclaimer missing; DM not sent", "error", { moduleName: MODULE_NAME, ...ctx });
    return false;
  }
  try {
    const clientRef = wo?.clientRef || "discord:client";
    const client = await getItem(clientRef);
    if (!client?.users?.fetch) return false;

    const user = await client.users.fetch(ctx.userId).catch(() => null);
    if (!user?.send) return false;

    await user.send({ embeds: [built.embed] });
    log("sent gdpr disclaimer DM", "info", { moduleName: MODULE_NAME, ...ctx });
    return true;
  } catch (e) {
    log("failed to send gdpr DM", "warn", { moduleName: MODULE_NAME, reason: e?.message || String(e), ...ctx });
    return false;
  }
}

/**************************************************************/
/* functionSignature: setEnsureConsentTable (conn, table)    */
/* Ensures the consent table exists in the database          */
/**************************************************************/
async function setEnsureConsentTable(conn, table) {
  const sql = `
    CREATE TABLE IF NOT EXISTS \`${table}\` (
      \`user_id\`    VARCHAR(64)  NOT NULL,
      \`channel_id\` VARCHAR(64)  NOT NULL,
      \`chat\`       TINYINT(1)   NOT NULL DEFAULT 0,
      \`voice\`      TINYINT(1)   NOT NULL DEFAULT 0,
      \`disclaimer\` TINYINT(1)   NOT NULL DEFAULT 0,
      \`updated_at\` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                 ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`user_id\`, \`channel_id\`),
      KEY \`idx_channel\` (\`channel_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
  await conn.execute(sql);
}

/**************************************************************/
/* functionSignature: getGdprGate (coreData)                 */
/* Enforces GDPR gate, sends DM once, blocks if not allowed  */
/**************************************************************/
export default async function getGdprGate(coreData) {
  const wo = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  const flow = String(wo?.flow || "");
  if (flow !== "discord" && flow !== "discord-voice") return coreData;

  const isBotUser =
    wo?.message?.author?.bot === true ||
    wo?.authorIsBot === true ||
    wo?.isMacro === true;

  if (isBotUser) {
    log("bot user detected — skipping gdpr gate", "debug", { moduleName: MODULE_NAME, flow });
    return coreData;
  }

  const isDM =
    wo?.DM === true ||
    wo?.isDM === true ||
    String(wo?.channelType ?? "").toUpperCase() === "DM" ||
    wo?.channelType === 1 ||
    (!wo?.guildId && !!wo?.userId);
  if (isDM) {
    log("dm detected — skipping gdpr gate", "info", { moduleName: MODULE_NAME, flow });
    return coreData;
  }

  const dbCfg = getDbConfig(wo);
  const table = getTableName(coreData);

  const userId = String(wo?.userId ?? "");
  const channelId = String(wo?.channelID ?? "");
  if (!userId || !channelId) {
    log("gdpr gate missing ids -> blocking", "warn", { moduleName: MODULE_NAME, userId, channelId, flow });
    const built = getBuildDisclaimerFromWO(wo, { userId, channelId, flow });
    setHardBlock(wo, built?.body ?? "");
    await setSendDisclaimerDM(wo, { userId, channelId, flow }, log);
    return coreData;
  }

  if (!dbCfg) {
    log("no DB config; default-deny", "error", { moduleName: MODULE_NAME, flow, userId, channelId });
    const built = getBuildDisclaimerFromWO(wo, { userId, channelId, flow });
    setHardBlock(wo, built?.body ?? "");
    await setSendDisclaimerDM(wo, { userId, channelId, flow }, log);
    return coreData;
  }

  let conn = null;
  try {
    conn = await mysql.createConnection(dbCfg);
    await setEnsureConsentTable(conn, table);

    let chat = 0, voice = 0, disclaimer = 0;

    {
      const [rows] = await conn.execute(
        `SELECT chat, voice, disclaimer FROM \`${table}\` WHERE user_id=? AND channel_id=? LIMIT 1`,
        [userId, channelId]
      );
      if (Array.isArray(rows) && rows.length) {
        chat = Number(rows[0].chat) ? 1 : 0;
        voice = Number(rows[0].voice) ? 1 : 0;
        disclaimer = Number(rows[0].disclaimer) ? 1 : 0;
      } else {
        await conn.execute(
          `INSERT IGNORE INTO \`${table}\` (user_id, channel_id, chat, voice, disclaimer) VALUES (?, ?, 0, 0, 0)`,
          [userId, channelId]
        );
        chat = 0;
        voice = 0;
        disclaimer = 0;
      }
    }

    if (disclaimer === 0) {
      const [upd] = await conn.execute(
        `UPDATE \`${table}\` SET disclaimer=1 WHERE user_id=? AND channel_id=? AND disclaimer=0`,
        [userId, channelId]
      );
      if (upd.affectedRows === 1) {
        log("disclaimer 0→1, DM sent and block", "info", { moduleName: MODULE_NAME, userId, channelId, flow });
        const built = getBuildDisclaimerFromWO(wo, { userId, channelId, flow });
        setHardBlock(wo, built?.body ?? "");
        await setSendDisclaimerDM(wo, { userId, channelId, flow }, log);
        await conn.end().catch(() => {});
        return coreData;
      }
    }

    const allowed = flow === "discord" ? chat === 1 : voice === 1;
    if (!allowed) {
      log("blocked by gdpr gate", "info", { moduleName: MODULE_NAME, flow, userId, channelId, chat, voice });
      setHardBlock(wo, "");
      await conn.end().catch(() => {});
      return coreData;
    }

    log("gdpr pass", "info", { moduleName: MODULE_NAME, flow, userId, channelId, chat, voice });
    await conn.end().catch(() => {});
    return coreData;
  } catch (e) {
    if (conn) {
      try { await conn.end(); } catch {}
    }
    log("db error (default-deny)", "error", { moduleName: MODULE_NAME, flow, err: e?.message });
    const built = getBuildDisclaimerFromWO(wo, { userId, channelId, flow });
    setHardBlock(wo, built?.body ?? "");
    await setSendDisclaimerDM(wo, { userId, channelId, flow }, log);
    return coreData;
  }
}