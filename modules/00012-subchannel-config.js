/************************************************************************************/
/* filename: 00012-subchannel-config.js                                              *
/* Version 1.0                                                                       *
/* Purpose: When wo.subchannel is set, loads system_prompt / persona / instructions  *
/*          from chat_subchannels and overrides the corresponding workingObject       *
/*          fields. Runs after core-channel-config (00010) so subchannel settings    *
/*          take precedence. Only overrides if the field is non-empty.               *
/************************************************************************************/

import mysql from "mysql2/promise";

const MODULE_NAME = "subchannel-config";

let _pool = null;
let _poolDsn = "";


async function getPool(db) {
  const dsn = `${db.host}|${db.port ?? 3306}|${db.user}|${db.database}`;
  if (_pool && _poolDsn === dsn) return _pool;
  _pool = mysql.createPool({
    host: db.host,
    port: db.port ?? 3306,
    user: db.user,
    password: db.password,
    database: db.database,
    charset: db.charset ?? "utf8mb4",
    connectionLimit: 2,
    decimalNumbers: true
  });
  _poolDsn = dsn;
  return _pool;
}


export default async function getSubchannelConfig(coreData) {
  const wo = coreData?.workingObject || {};

  const subchannel = typeof wo.subchannel === "string" ? wo.subchannel.trim() : "";
  if (!subchannel) return coreData;

  const db = wo.db;
  if (!db?.host || !db?.user || !db?.database) return coreData;

  try {
    const pool = await getPool(db);
    const [rows] = await pool.query(
      "SELECT system_prompt, persona, instructions FROM chat_subchannels WHERE subchannel_id = ? LIMIT 1",
      [subchannel]
    );
    if (!rows || !rows.length) return coreData;

    const sc = rows[0];
    const sp = typeof sc.system_prompt === "string" ? sc.system_prompt.trim() : "";
    const pe = typeof sc.persona       === "string" ? sc.persona.trim()       : "";
    const ins = typeof sc.instructions  === "string" ? sc.instructions.trim()  : "";

    if (sp)  wo.systemPrompt  = sp;
    if (pe)  wo.persona       = pe;
    if (ins) wo.instructions  = ins;
  } catch {
    /* table may not exist yet — silently skip */
  }

  return coreData;
}
