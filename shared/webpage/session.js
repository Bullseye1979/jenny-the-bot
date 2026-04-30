/**************************************************************/
/* filename: "session.js"                                    */
/* Version 1.0                                               */
/* Purpose: Shared session token verification helpers used   */
/*          by both the webpage-auth module and the API      */
/*          server for jenny_session cookie validation.      */
/**************************************************************/

import crypto from "node:crypto";

const COOKIE_SESSION = "jenny_session";


export function getB64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}


function getB64UrlDecode(s) {
  const t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = t.length % 4 ? "=".repeat(4 - (t.length % 4)) : "";
  return Buffer.from(t + pad, "base64");
}


function getHmac(secret, data) {
  return crypto.createHmac("sha256", String(secret)).update(String(data)).digest();
}


export function getSignToken(secret, payloadObj) {
  const p = getB64UrlEncode(JSON.stringify(payloadObj));
  const sig = getB64UrlEncode(getHmac(secret, p));
  return `${p}.${sig}`;
}


export function getVerifyToken(secret, token) {
  const s = String(token || "");
  const parts = s.split(".");
  if (parts.length !== 2) return null;
  const [p, sig] = parts;
  const want = getB64UrlEncode(getHmac(secret, p));
  const a = Buffer.from(want);
  const b = Buffer.from(sig);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(getB64UrlDecode(p).toString("utf8"));
  } catch {
    return null;
  }
}


export function getParseCookies(cookieHeader) {
  const out = {};
  const s = String(cookieHeader || "");
  if (!s) return out;
  for (const p of s.split(";")) {
    const idx = p.indexOf("=");
    if (idx <= 0) continue;
    out[p.slice(0, idx).trim()] = decodeURIComponent(p.slice(idx + 1).trim());
  }
  return out;
}


export function getSessionCookieName() {
  return COOKIE_SESSION;
}
