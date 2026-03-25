/************************************************************************************/
/* filename: secrets.js                                                              *
/* Version 1.0                                                                       *
/* Purpose: Centralized secret resolution. Maps symbolic placeholder names           *
/*          (e.g. "OPENAI") to real values stored in the bot_secrets DB table.       *
/*          Results are TTL-cached for 60 seconds per table/placeholder combo.       *
/************************************************************************************/

import { getEnsurePool } from "./context.js";

const DEFAULT_TABLE = "bot_secrets";
const TTL_MS = 60_000;

// Cache: key = `${table}` → { map: Map<name, value>, fetchedAt: number }
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


/**
 * Resolve a placeholder to its real secret value.
 * If the placeholder is not found in the DB, returns the placeholder as-is (safe fallback).
 * @param {object} wo - workingObject (needs wo.db for DB connection)
 * @param {string} placeholder - symbolic name, e.g. "OPENAI"
 * @returns {Promise<string>}
 */
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


/**
 * Force-expire the cache for a given table (or all tables).
 * @param {string} [table] - table name; if omitted, clears all caches
 */
export function clearSecretsCache(table) {
  if (table) {
    _cache.delete(table);
  } else {
    _cache.clear();
  }
}


/**
 * List all entries in the bot_secrets table.
 * Returns array of { name, value, description }.
 */
export async function listSecrets(wo) {
  const pool = await getEnsurePool(wo);
  const table = String(wo?.secretsTable || DEFAULT_TABLE);
  const [rows] = await pool.query(
    `SELECT name, value, description FROM \`${table}\` ORDER BY name ASC`
  );
  return rows;
}


/**
 * Set (insert or update) a secret.
 */
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


/**
 * Delete a secret by name.
 */
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


/**
 * Ensure the bot_secrets table exists (called at startup or on first use).
 */
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
