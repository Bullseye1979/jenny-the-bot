/**************************************************************/
/* filename: "tool-exposure.js"                              */
/* Version 1.0                                               */
/* Purpose: Shared helpers for managing which OAuth          */
/*          providers and API key names are exposed to       */
/*          the LLM via getOauthProviders / getApiBearers.   */
/**************************************************************/

const TABLE = "tool_exposure";


export async function ensureExposureTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`${TABLE}\` (
      tool_name  VARCHAR(64) NOT NULL,
      item_name  VARCHAR(64) NOT NULL,
      PRIMARY KEY (tool_name, item_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}


export async function listExposed(pool, toolName) {
  const [rows] = await pool.query(
    `SELECT item_name FROM \`${TABLE}\` WHERE tool_name = ? ORDER BY item_name ASC`,
    [String(toolName)]
  );
  return rows.map((r) => String(r.item_name));
}


export async function addExposed(pool, toolName, itemName) {
  await pool.query(
    `INSERT IGNORE INTO \`${TABLE}\` (tool_name, item_name) VALUES (?, ?)`,
    [String(toolName), String(itemName)]
  );
}


export async function removeExposed(pool, toolName, itemName) {
  await pool.query(
    `DELETE FROM \`${TABLE}\` WHERE tool_name = ? AND item_name = ?`,
    [String(toolName), String(itemName)]
  );
}


