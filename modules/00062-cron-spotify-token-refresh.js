/**************************************************************/
/* filename: "00062-cron-spotify-token-refresh.js"                  */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/


"use strict";

import { getEnsurePool }      from "../core/context.js";
import { getSecret }         from "../core/secrets.js";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "cron-spotify-token-refresh";


async function getHttpPostFormBasicAuth(urlStr, formObj, clientId, clientSecret) {
  const { default: https } = await import("node:https");
  const { default: http  } = await import("node:http");
  const u    = new URL(urlStr);
  const body = new URLSearchParams(formObj).toString();
  const mod  = u.protocol === "https:" ? https : http;
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        hostname: u.hostname,
        port:     u.port || (u.protocol === "https:" ? 443 : 80),
        path:     u.pathname + u.search,
        method:   "POST",
        headers:  {
          "Content-Type":   "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
          "Authorization":  `Basic ${auth}`,
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (d) => { buf += d; });
        res.on("end",  () => {
          let json = null;
          try { json = JSON.parse(buf); } catch {}
          resolve({ status: res.statusCode || 0, body: buf, json });
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}


export default async function cronSpotifyTokenRefresh(coreData) {
  const wo  = coreData?.workingObject || {};
  const cfg = coreData?.config?.[MODULE_NAME] || {};

  if (wo?.flow !== "cron-spotify-token-refresh") return coreData;

  const log      = getPrefixedLogger(wo, import.meta.url);
  const bufferMs = (Number(cfg.refreshBufferMinutes) || 10) * 60 * 1000;
  const cutoff   = Date.now() + bufferMs;

  let db;
  try {
    db = await getEnsurePool(wo);
  } catch (e) {
    log(`[${MODULE_NAME}] DB connect error: ${e?.message || e}`, "error");
    return coreData;
  }

  let rows;
  try {
    const [result] = await db.query(
      "SELECT * FROM spotify_tokens WHERE expires_at < ? AND refresh_token IS NOT NULL",
      [cutoff]
    );
    rows = result;
  } catch (e) {
    log(`[${MODULE_NAME}] Query error: ${e?.message || e}`, "error");
    return coreData;
  }

  if (!rows || rows.length === 0) return coreData;

  const clientId     = await getSecret(wo, cfg.auth?.clientId     || "");
  const clientSecret = await getSecret(wo, cfg.auth?.clientSecret || "");

  if (!clientId || !clientSecret) {
    log(`[${MODULE_NAME}] Missing auth config (clientId/clientSecret)`, "error");
    return coreData;
  }

  for (const row of rows) {
    const userId = String(row.user_id || "");
    if (!userId) continue;

    let resp;
    try {
      resp = await getHttpPostFormBasicAuth(
        "https://accounts.spotify.com/api/token",
        {
          grant_type:    "refresh_token",
          refresh_token: String(row.refresh_token || ""),
        },
        clientId,
        clientSecret
      );
    } catch (e) {
      log(`[${MODULE_NAME}] Token refresh request failed for user ${userId}: ${e?.message || e}`, "error");
      continue;
    }

    const tok = resp.json;
    if (!tok?.access_token) {
      log(`[${MODULE_NAME}] No access_token in refresh response for user ${userId}: ${tok?.error_description || tok?.error || resp.body}`, "error");
      continue;
    }

    const expiresAt = Date.now() + (Number(tok.expires_in || 3600) * 1000);
    const now       = Date.now();

    try {
      await db.query(
        `UPDATE spotify_tokens
         SET access_token  = ?,
             refresh_token = COALESCE(?, refresh_token),
             expires_at    = ?,
             updated_at    = ?
         WHERE user_id = ?`,
        [
          tok.access_token,
          tok.refresh_token || null,
          expiresAt,
          now,
          userId,
        ]
      );
      log(`[${MODULE_NAME}] Refreshed token for user ${userId}`, "info");
    } catch (e) {
      log(`[${MODULE_NAME}] DB update failed for user ${userId}: ${e?.message || e}`, "error");
    }
  }

  return coreData;
}
