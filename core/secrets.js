







import { getEnsurePool } from "./context.js";

const DEFAULT_TABLE = "bot_secrets";
const TTL_MS = 60_000;

const _cache = new Map();


async function getLoadSecrets(pool, table) {
  const [rows] = await pool.query(`SELECT name, value FROM \`${table}\``);
  const map = new Map();
  for (const row of rows) {
    if (typeof row.name === "string" && row.name) {
      map.set(row.name, String(row.value ?? ""));
    }
  }
  return map;
}


async function getSecretsMap(wo) {
  const pool = await getEnsurePool(wo);
  const table = String(wo?.secretsTable || DEFAULT_TABLE);
  const now = Date.now();
  const cached = _cache.get(table);
  if (cached && now - cached.fetchedAt < TTL_MS) {
    return cached.map;
  }
  const map = await getLoadSecrets(pool, table);
  _cache.set(table, { map, fetchedAt: now });
  return map;
}









export async function getSecret(wo, placeholder) {
  if (!placeholder || typeof placeholder !== "string") return placeholder ?? "";
  try {
    const map = await getSecretsMap(wo);
    if (map.has(placeholder)) return map.get(placeholder);
    return placeholder;
  } catch {
    return placeholder;
  }
}






export function clearSecretsCache(table) {
  if (table) {
    _cache.delete(table);
  } else {
    _cache.clear();
  }
}






export async function listSecrets(wo) {
  const pool = await getEnsurePool(wo);
  const table = String(wo?.secretsTable || DEFAULT_TABLE);
  const [rows] = await pool.query(
    `SELECT name, value, description FROM \`${table}\` ORDER BY name ASC`
  );
  return rows;
}





export async function setSecret(wo, name, value, description = null) {
  const pool = await getEnsurePool(wo);
  const table = String(wo?.secretsTable || DEFAULT_TABLE);
  await pool.execute(
    `INSERT INTO \`${table}\` (name, value, description) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value), description = COALESCE(VALUES(description), description)`,
    [name, value, description]
  );
  clearSecretsCache(table);
}





export async function deleteSecret(wo, name) {
  const pool = await getEnsurePool(wo);
  const table = String(wo?.secretsTable || DEFAULT_TABLE);
  const [res] = await pool.execute(
    `DELETE FROM \`${table}\` WHERE name = ?`,
    [name]
  );
  clearSecretsCache(table);
  return Number(res?.affectedRows || 0);
}





export async function setEnsureSecretsTable(wo) {
  const pool = await getEnsurePool(wo);
  const table = String(wo?.secretsTable || DEFAULT_TABLE);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`${table}\` (
      name        VARCHAR(64)  NOT NULL,
      value       TEXT         NOT NULL,
      description VARCHAR(255) NULL,
      PRIMARY KEY (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}
