/***************************************************************
/* filename: "getTimeline.js"                                  *
/* Version 1.0                                                 *
/* Purpose: Return stored timeline periods for current channel *
/*          with indices, timestamps, and summaries.           *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

import mysql from "mysql2/promise";

const MODULE_NAME = "getTimeline";
const POOLS = new Map();

/***************************************************************
/* functionSignature: getPool (wo)                             *
/* Returns or creates a MySQL pool for the given wo.db config. *
/***************************************************************/
async function getPool(wo) {
  const key = JSON.stringify({ h: wo?.db?.host, u: wo?.db?.user, d: wo?.db?.database });
  if (POOLS.has(key)) return POOLS.get(key);
  const pool = mysql.createPool({
    host: wo?.db?.host,
    user: wo?.db?.user,
    password: wo?.db?.password,
    database: wo?.db?.database,
    waitForConnections: true,
    connectionLimit: 5,
    charset: "utf8mb4",
    dateStrings: true
  });
  POOLS.set(key, pool);
  return pool;
}

/***************************************************************
/* functionSignature: getEffectiveLimit (args, wo)             *
/* Resolves the effective period limit from args and configs.  *
/***************************************************************/
function getEffectiveLimit(args, wo) {
  if (Number.isFinite(args?.limit)) {
    return Math.max(1, Number(args.limit));
  }
  const tlCfg = wo?.toolsconfig?.getTimeline;
  if (Number.isFinite(tlCfg?.max_timeline_periods)) {
    return Math.max(1, Number(tlCfg.max_timeline_periods));
  }
  const ctxCfg = wo?.config?.context;
  if (Number.isFinite(ctxCfg?.maxTimelinePeriods)) {
    return Math.max(1, Number(ctxCfg.maxTimelinePeriods));
  }
  return null;
}

/***************************************************************
/* functionSignature: getTimelineInvoke (args, coreData)       *
/* Fetches timeline periods for wo.channelID with metadata.    *
/***************************************************************/
async function getTimelineInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const channelId = String(wo?.channelID || "");
  if (!channelId) {
    return { error: "ERROR: channel_id missing (wo.channelID)" };
  }

  const order = (args?.order === "desc") ? "DESC" : "ASC";
  const limit = getEffectiveLimit(args, wo);
  const db = await getPool(wo);

  try {
    const [[cntRow]] = await db.query(
      "SELECT COUNT(*) AS c FROM timeline_periods WHERE channel_id = ?",
      [channelId]
    );
    const total = Number(cntRow?.c || 0);

    let rows;
    if (limit) {
      const [tmp] = await db.execute(
        `
          SELECT start_idx, end_idx, start_ts, end_ts, summary, model, channel_id
            FROM timeline_periods
           WHERE channel_id = ?
           ORDER BY start_idx ${order}
           LIMIT ?
        `,
        [channelId, limit]
      );
      rows = tmp;
      if (order === "DESC") {
        rows = rows.slice().reverse();
      }
    } else {
      const [tmp] = await db.execute(
        `
          SELECT start_idx, end_idx, start_ts, end_ts, summary, model, channel_id
            FROM timeline_periods
           WHERE channel_id = ?
           ORDER BY start_idx ${order}
        `,
        [channelId]
      );
      rows = (order === "DESC") ? tmp.slice().reverse() : tmp;
    }

    const periods = (rows || []).map(r => ({
      channel_id: r.channel_id,
      start_idx: Number(r.start_idx),
      end_idx: Number(r.end_idx),
      start_ts: r.start_ts || null,
      end_ts: r.end_ts || null,
      summary: r.summary || "",
      model: r.model || null
    }));

    return {
      periods,
      meta: {
        channel_id: channelId,
        total_periods: total,
        returned_periods: periods.length,
        order: "asc",
        timestamps: true,
        note: "Each period contains start/end row indices AND start/end timestamps, so another tool can resolve the detailed rows for that range."
      }
    };
  } catch (e) {
    return { error: e?.message || String(e) };
  }
}

/***************************************************************
/* functionSignature: getDefaultExport ()                      *
/* Exposes tool definition and invoke handler for the module.  *
/***************************************************************/
function getDefaultExport() {
  return {
    name: MODULE_NAME,
    definition: {
      type: "function",
      function: {
        name: MODULE_NAME,
        description:
          "Return the stored timeline periods for the current channel (workingObject.channelID). " +
          "Each period contains: channel_id, start_idx, end_idx, start_ts, end_ts, and a short summary. " +
          "Timestamps are included so subsequent tools can resolve the detailed rows for that range.",
        parameters: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Optional maximum number of periods to return (most recent first, then re-ordered ascending)."
            },
            order: {
              type: "string",
              enum: ["asc", "desc"],
              description: "Order by start_idx ascending (default) or descending."
            }
          },
          additionalProperties: false
        }
      }
    },
    invoke: getTimelineInvoke
  };
}

export default getDefaultExport();
