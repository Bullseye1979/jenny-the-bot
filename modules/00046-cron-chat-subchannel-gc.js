/**************************************************************/
/* filename: "00046-cron-chat-subchannel-gc.js"              */
/* Version 1.0                                               */
/* Purpose: Deletes expired chat subchannel records and      */
/*          their scoped context rows.                       */
/**************************************************************/

import { getDb } from "../shared/webpage/interface.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "cron-chat-subchannel-gc";


export default async function getCronChatSubchannelGc(coreData) {
  const wo = coreData?.workingObject || {};
  if (wo?.flow !== "chat-subchannel-gc" && wo?.cronId !== "chat-subchannel-gc") return coreData;

  const log = getPrefixedLogger(wo, import.meta.url);

  try {
    const pool = await getDb(coreData);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_subchannels (
        subchannel_id CHAR(36)     NOT NULL,
        channel_id    VARCHAR(128) NOT NULL,
        name          VARCHAR(255) NOT NULL DEFAULT '',
        created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at    DATETIME     NULL,
        PRIMARY KEY (subchannel_id),
        KEY idx_csc_channel (channel_id),
        KEY idx_csc_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [rows] = await pool.query(
      "SELECT subchannel_id, channel_id FROM chat_subchannels WHERE expires_at IS NOT NULL AND expires_at <= NOW() LIMIT 500"
    );

    let contextDeleted = 0;
    for (const row of rows || []) {
      const subchannelId = String(row.subchannel_id || "");
      const channelId = String(row.channel_id || "");
      if (!subchannelId || !channelId) continue;
      const [ctxRes] = await pool.execute(
        "DELETE FROM context WHERE id = ? AND COALESCE(subchannel, '') = ?",
        [channelId, subchannelId]
      );
      contextDeleted += Number(ctxRes?.affectedRows || 0);
    }

    const [subRes] = await pool.execute(
      "DELETE FROM chat_subchannels WHERE expires_at IS NOT NULL AND expires_at <= NOW()"
    );

    log("Expired chat subchannels removed", "info", {
      moduleName: MODULE_NAME,
      subchannelsDeleted: Number(subRes?.affectedRows || 0),
      contextDeleted
    });
  } catch (e) {
    log("Expired chat subchannel cleanup failed", "error", {
      moduleName: MODULE_NAME,
      reason: String(e?.message || e)
    });
  }

  return coreData;
}
