/**********************************************************************************/
/* filename: 00041-webpage-auth.js                                                */
/* Version 1.0                                                                    */
/* Purpose: Discord OAuth2 SSO for webpage ports. Scope controlled via cfg.ports. */
/*          Login routes handled only on cfg.loginPort. Writes wo.webAuth (role). */
/*          Non-/auth/* requests pass through unchanged (passive module).          */
/*          Gate redirects use the public baseUrl (without :loginPort).            */
/**********************************************************************************/

"use strict";

import crypto from "node:crypto";
import { getItem, putItem, deleteItem } from "../core/registry.js";

const MODULE_NAME = "webpage-auth";
const COOKIE_STATE = "jenny_oauth_state";
const COOKIE_SESS = "jenny_session";


async function setSendNow(wo) {
  const key = wo?.http?.requestKey;
  if (!key) return;
  const entry = await Promise.resolve(getItem(key)).catch(() => null);
  if (!entry?.res) return;

  const res = entry.res;
  const r = wo.http?.response || {};
  res.writeHead(Number(r.status ?? 200), r.headers ?? { "Content-Type": "text/plain; charset=utf-8" });
  res.end(typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? ""));
}


function setJsonResp(wo, status, obj) {
  wo.http.response = {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(obj)
  };
}


function setRedirect(wo, url, cookies = []) {
  const headers = { Location: url, "Cache-Control": "no-store" };
  if (cookies.length) headers["Set-Cookie"] = cookies;
  wo.http.response = { status: 302, headers, body: "" };
}


function getBaseUrl(wo) {
  const h = wo?.http?.headers || {};
  const host = String(h["x-forwarded-host"] || h["host"] || "").trim();
  const proto = String(h["x-forwarded-proto"] || "http").trim();
  if (!host) return "";
  return `${proto}://${host}`;
}


function getIsHttps(wo) {
  const h = wo?.http?.headers || {};
  return String(h["x-forwarded-proto"] || "").toLowerCase() === "https";
}


function getParseCookies(cookieHeader) {
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


function getB64UrlEncode(input) {
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


function getSignToken(secret, payloadObj) {
  const payloadJson = JSON.stringify(payloadObj);
  const p = getB64UrlEncode(payloadJson);
  const sig = getB64UrlEncode(getHmac(secret, p));
  return `${p}.${sig}`;
}


function getVerifyToken(secret, token) {
  const s = String(token || "");
  const parts = s.split(".");
  if (parts.length !== 2) return null;
  const p = parts[0];
  const sig = parts[1];
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


function getCookieLine(name, value, opts = {}) {
  const parts = [];
  parts.push(`${name}=${encodeURIComponent(String(value || ""))}`);
  parts.push(`Path=${opts.path || "/"}`);
  if (opts.maxAge != null) parts.push(`Max-Age=${Number(opts.maxAge)}`);
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}


function getRandId() {
  return getB64UrlEncode(crypto.randomBytes(24));
}


async function getHttpPostForm(urlStr, formObj) {
  const { default: https } = await import("https");
  const { default: http } = await import("http");
  const u = new URL(urlStr);
  const body = new URLSearchParams(formObj).toString();
  const mod = u.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) }
      },
      (res) => {
        let buf = "";
        res.on("data", (d) => { buf += d; });
        res.on("end", () => {
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


async function getHttpGetJson(urlStr, headers = {}) {
  const { default: https } = await import("https");
  const { default: http } = await import("http");
  const u = new URL(urlStr);
  const mod = u.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = mod.get(
      { hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname + u.search, headers },
      (res) => {
        let buf = "";
        res.on("data", (d) => { buf += d; });
        res.on("end", () => {
          try { resolve(JSON.parse(buf)); } catch { resolve(null); }
        });
      }
    );
    req.on("error", reject);
  });
}


function getNormalizeRoleLabel(cfg, roleValue) {
  const raw = String(roleValue || "").trim();
  const map = cfg?.roleMap && typeof cfg.roleMap === "object" ? cfg.roleMap : {};
  const def = String(cfg?.defaultRole || "member").trim().toLowerCase();

  if (!raw) return def;

  const mapped = map[raw];
  if (typeof mapped === "string" && mapped.trim()) return mapped.trim().toLowerCase();

  const lower = raw.toLowerCase();
  if (lower === "admin" || lower === "member") return lower;

  return def;
}


function getRoleFromMember(cfg, member) {
  const roleIds = Array.isArray(member?.roles) ? member.roles.map(String) : [];
  const map = cfg?.roleMap && typeof cfg.roleMap === "object" ? cfg.roleMap : {};
  const prio = Array.isArray(cfg?.rolePriority) ? cfg.rolePriority.map(String) : [];
  const fallback = String(cfg?.defaultRole || "member").trim().toLowerCase();

  const labels = [];
  for (const id of roleIds) {
    const mapped = map[id];
    if (typeof mapped !== "string") continue;
    const label = mapped.trim().toLowerCase();
    if (!label) continue;
    labels.push(label);
  }

  let primary = fallback;

  for (const roleId of prio) {
    const id = String(roleId);
    if (!roleIds.includes(id)) continue;
    const mapped = map[id];
    if (typeof mapped === "string" && mapped.trim()) {
      primary = mapped.trim().toLowerCase();
      break;
    }
  }

  if (primary === fallback) {
    for (const id of roleIds) {
      const mapped = map[id];
      if (typeof mapped === "string" && mapped.trim()) {
        primary = mapped.trim().toLowerCase();
        break;
      }
    }
  }

  const uniq = [];
  const seen = new Set();
  const add = (v) => {
    const s = String(v || "").trim().toLowerCase();
    if (!s) return;
    if (seen.has(s)) return;
    seen.add(s);
    uniq.push(s);
  };

  for (const l of labels) add(l);
  add(primary);

  return { role: primary, roles: uniq, roleIds };
}


function getGuilds(cfg) {
  if (Array.isArray(cfg.guilds) && cfg.guilds.length) return cfg.guilds;
  if (String(cfg.guildId || "").trim()) return [cfg]; // backward compat
  return [];
}


function getIsAllowedByRole(cfg, roles) {
  const allow = Array.isArray(cfg?.allowRoleIds) ? cfg.allowRoleIds.map(String) : [];
  if (!allow.length) return true;
  for (const a of allow) if (roles.includes(a)) return true;
  return false;
}


function setApplyAuthToWorkingObject(wo, cfg, sess) {
  wo.webAuth = {
    username: sess?.username ? String(sess.username) : "",
    userId:   sess?.userId   ? String(sess.userId)   : "",
    guildId:  sess?.guildId  ? String(sess.guildId)  : "",
    role:     String(sess?.role || "").trim().toLowerCase() || String(cfg?.defaultRole || "member").trim().toLowerCase(),
    roles:    Array.isArray(sess?.roles)   ? sess.roles.map(String)   : [],
    roleIds:  Array.isArray(sess?.roleIds) ? sess.roleIds.map(String) : []
  };
}


function getIsAuthPath(p) {
  const path = String(p || "");
  return path === "/auth/login" || path === "/auth/callback" || path === "/auth/logout" || path === "/auth/sso" || path === "/auth/me";
}


function getNextFromUrl(wo) {
  return String(wo.http?.url || wo.http?.path || "/") || "/";
}


function getPorts(cfg) {
  const loginPort = Number(cfg?.loginPort ?? 3111);
  const raw = cfg?.ports;
  const ports = Array.isArray(raw) ? raw.map(Number).filter(n => Number.isFinite(n) && n > 0) : [loginPort];
  if (!ports.includes(loginPort)) ports.push(loginPort);
  return { loginPort, ports };
}


export default async function getWebpageAuth(coreData) {
  const wo = coreData?.workingObject || {};
  const flow = String(wo?.flow || "").trim().toLowerCase();
  if (!flow.startsWith("webpage")) return coreData;

  const cfg = coreData?.config?.[MODULE_NAME] || {};
  if (cfg?.enabled === false) return coreData;

  const { loginPort, ports } = getPorts(cfg);
  const reqPort = Number(wo?.http?.port);

  /**************************************************************/
  /* Scope ONLY via ports whitelist                              */
  /**************************************************************/
  if (!ports.includes(reqPort)) return coreData;

  const clientId = String(cfg.clientId || "").trim();
  const clientSecret = String(cfg.clientSecret || "").trim();
  const secret = String(cfg.sessionSecret || "").trim();

  if (!clientId || !clientSecret || !secret) {
    setJsonResp(wo, 500, { error: "webpage-auth misconfigured" });
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  const path = String(wo.http?.path || "/");
  const cookies = getParseCookies(wo.http?.headers?.cookie);

  const publicBase = getBaseUrl(wo); /* IMPORTANT: public origin (no internal port switching) */
  const redirectUri = cfg.redirectUri ? String(cfg.redirectUri).trim() : (publicBase ? (publicBase + "/auth/callback") : "");
  if (!redirectUri) {
    setJsonResp(wo, 500, { error: "redirectUri missing" });
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  const cookieBase = { path: "/", httpOnly: true, sameSite: String(cfg.sameSite || "Lax"), secure: getIsHttps(wo) };

  const sessTok = String(cookies[COOKIE_SESS] || "");
  const sessObj = sessTok ? getVerifyToken(secret, sessTok) : null;

  /**************************************************************/
  /* /auth/logout must work on any scoped port                   */
  /**************************************************************/
  if (path === "/auth/logout") {
    const c1 = getCookieLine(COOKIE_SESS, "", { ...cookieBase, maxAge: 0 });
    const c2 = getCookieLine(COOKIE_STATE, "", { ...cookieBase, maxAge: 0 });
    setRedirect(wo, (publicBase ? publicBase : "") + "/auth/login?next=%2F", [c1, c2]);
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /**************************************************************/
  /* /auth/me — returns current session as JSON (any scoped port) */
  /**************************************************************/
  if (path === "/auth/me") {
    if (sessObj) {
      setApplyAuthToWorkingObject(wo, cfg, sessObj);
      setJsonResp(wo, 200, {
        ok: true,
        userId:   wo.webAuth.userId,
        username: wo.webAuth.username,
        role:     wo.webAuth.role
      });
    } else {
      setJsonResp(wo, 401, { ok: false, error: "not_authenticated" });
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /**************************************************************/
  /* /auth/sso — cross-domain token handoff (any scoped port)   */
  /**************************************************************/
  if (path === "/auth/sso") {
    const tokenId = String(wo.http?.query?.token || "").trim();
    const returnTo = String(wo.http?.query?.returnTo || "/").trim();

    if (!tokenId) {
      setJsonResp(wo, 400, { error: "missing_token" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }

    const ssoKey = "sso:" + tokenId;
    const ssoData = await Promise.resolve(getItem(ssoKey)).catch(() => null);

    /* Single-use: delete immediately regardless of validity */
    await Promise.resolve(deleteItem(ssoKey)).catch(() => null);

    if (!ssoData || typeof ssoData !== "object") {
      setJsonResp(wo, 401, { error: "invalid_sso_token" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }

    if (!ssoData.expiresAt || Date.now() > ssoData.expiresAt) {
      setJsonResp(wo, 401, { error: "sso_token_expired" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }

    const sess = {
      v: ssoData.v || 1,
      userId:   String(ssoData.userId   || ""),
      username: String(ssoData.username || ""),
      guildId:  String(ssoData.guildId  || ""),
      role:     String(ssoData.role     || "member"),
      roles:    Array.isArray(ssoData.roles)   ? ssoData.roles   : [],
      roleIds:  Array.isArray(ssoData.roleIds) ? ssoData.roleIds : [],
      ts: Date.now()
    };

    const sessCookie = getCookieLine(COOKIE_SESS, getSignToken(secret, sess), {
      ...cookieBase,
      maxAge: Number(cfg.sessionMaxAgeSec ?? 60 * 60 * 12)
    });

    /* Validate returnTo: allow relative paths or URLs with allowed origins */
    const ssoPartners = Array.isArray(cfg.ssoPartners) ? cfg.ssoPartners.map(s => String(s).replace(/\/$/, "")) : [];
    let safeReturnTo = "/";
    if (returnTo.startsWith("/")) {
      safeReturnTo = publicBase + returnTo;
    } else {
      try {
        const rt = new URL(returnTo);
        const allowed = [publicBase, ...ssoPartners];
        if (allowed.some(o => o && rt.origin === new URL(o).origin)) {
          safeReturnTo = returnTo;
        }
      } catch {}
    }

    setRedirect(wo, safeReturnTo, [sessCookie]);
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  /**************************************************************/
  /* Apply session to workingObject (passive)                    */
  /**************************************************************/
  if (sessObj && typeof sessObj === "object") {
    setApplyAuthToWorkingObject(wo, cfg, sessObj);
  }

  /**************************************************************/
  /* Gate: if not logged in, redirect to login for app routes    */
  /* but DO NOT block static assets / documents                  */
  /**************************************************************/
  if (!sessObj && !getIsAuthPath(path)) {
    const isAsset =
      path === "/favicon.ico" ||
      path.endsWith(".css") || path.endsWith(".js") || path.endsWith(".map") ||
      path.endsWith(".png") || path.endsWith(".jpg") || path.endsWith(".jpeg") || path.endsWith(".gif") || path.endsWith(".webp") || path.endsWith(".svg") ||
      path.endsWith(".pdf") || path.endsWith(".txt");

    const isAppRoute =
      path === "/" ||
      path.startsWith("/chat") ||
      path.startsWith("/config") ||
      path.startsWith("/api/");

    if (isAppRoute && !isAsset) {
      setRedirect(wo, (publicBase ? publicBase : "") + "/auth/login?next=" + encodeURIComponent(getNextFromUrl(wo)));
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }
  }

  /**************************************************************/
  /* Non-/auth/* requests are not blocked                        */
  /**************************************************************/
  if (!getIsAuthPath(path)) return coreData;

  /**************************************************************/
  /* /auth/login + /auth/callback handled ONLY on loginPort      */
  /**************************************************************/
  if (reqPort !== loginPort) {
    /* Re-use the existing ?next= query param (or fall back to /) so the URL
       doesn't grow on every bounce.  Also derive the login base from the
       public redirectUri origin so direct-port access (host:3115) still
       ends up at the Caddy-proxied login page, not back on the same port. */
    const next = String(wo.http?.query?.next || "/");
    let loginBase = publicBase;
    if (cfg.redirectUri) {
      try { loginBase = new URL(String(cfg.redirectUri)).origin; } catch {}
    }
    setRedirect(wo, loginBase + "/auth/login?next=" + encodeURIComponent(next));
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (path === "/auth/login") {
    const next = String(wo.http?.query?.next || "/");
    const sid = getRandId();
    const stateTok = getSignToken(secret, { v: 1, sid, next, ts: Date.now() });
    const stateCookie = getCookieLine(COOKIE_STATE, stateTok, { ...cookieBase, maxAge: 600 });

    const scope = String(cfg.scope || "identify");
    const authUrl =
      "https://discord.com/api/oauth2/authorize" +
      "?client_id=" + encodeURIComponent(clientId) +
      "&redirect_uri=" + encodeURIComponent(redirectUri) +
      "&response_type=code" +
      "&scope=" + encodeURIComponent(scope) +
      "&state=" + encodeURIComponent(sid);

    setRedirect(wo, authUrl, [stateCookie]);
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  if (path === "/auth/callback") {
    const code = String(wo.http?.query?.code || "").trim();
    const state = String(wo.http?.query?.state || "").trim();
    if (!code || !state) {
      setJsonResp(wo, 400, { error: "missing_code_or_state" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }

    const stateTok = String(cookies[COOKIE_STATE] || "");
    const stateObj = stateTok ? getVerifyToken(secret, stateTok) : null;
    if (!stateObj || String(stateObj.sid || "") !== state) {
      setJsonResp(wo, 401, { error: "invalid_state" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }

    const tokenResp = await getHttpPostForm("https://discord.com/api/oauth2/token", {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri
    });

    if (!tokenResp?.json?.access_token) {
      setJsonResp(wo, 401, { error: "token_exchange_failed", discord: tokenResp?.json || null });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }

    const access = String(tokenResp.json.access_token);

    const user = await getHttpGetJson("https://discord.com/api/users/@me", { Authorization: "Bearer " + access });
    if (!user) {
      setJsonResp(wo, 401, { error: "discord_user_fetch_failed" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }

    let member = null;
    let matchedGuildCfg = null;
    const guilds = getGuilds(cfg);

    for (const guildCfg of guilds) {
      const gId = String(guildCfg.guildId || "").trim();
      if (!gId) continue;
      const m = await getHttpGetJson(
        "https://discord.com/api/users/@me/guilds/" + encodeURIComponent(gId) + "/member",
        { Authorization: "Bearer " + access }
      );
      if (m && Array.isArray(m.roles)) {
        const ri = getRoleFromMember(guildCfg, m);
        if (getIsAllowedByRole(guildCfg, ri.roleIds)) {
          member = m;
          matchedGuildCfg = guildCfg;
          break;
        }
        /* Member found but no matching roles in this guild — try next */
      }
    }

    if (guilds.length && !member) {
      setJsonResp(wo, 401, { error: "discord_member_fetch_failed" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }

    const username =
      (typeof user.global_name === "string" && user.global_name.trim())
        ? user.global_name.trim()
        : (typeof user.username === "string" ? user.username.trim() : "");

    const effectiveCfg = matchedGuildCfg || cfg;
    const roleInfo = member
      ? getRoleFromMember(effectiveCfg, member)
      : { role: String(cfg?.defaultRole || "member").trim().toLowerCase(), roles: [] };

    if (!getIsAllowedByRole(effectiveCfg, roleInfo.roleIds)) {
      setJsonResp(wo, 403, { error: "forbidden" });
      wo.jump = true;
      await setSendNow(wo);
      return coreData;
    }

    const sess = {
      v: 1,
      userId:  String(user.id || ""),
      username,
      guildId: String(effectiveCfg?.guildId || ""),
      role:    getNormalizeRoleLabel(effectiveCfg, roleInfo.role),
      roles:   roleInfo.roles,
      roleIds: roleInfo.roleIds,
      ts:      Date.now()
    };

    const sessCookie = getCookieLine(COOKIE_SESS, getSignToken(secret, sess), {
      ...cookieBase,
      maxAge: Number(cfg.sessionMaxAgeSec ?? 60 * 60 * 12)
    });

    const clearState = getCookieLine(COOKIE_STATE, "", { ...cookieBase, maxAge: 0 });

    const ssoPartners = Array.isArray(cfg.ssoPartners) ? cfg.ssoPartners.map(s => String(s).replace(/\/$/, "")).filter(Boolean) : [];
    if (ssoPartners.length > 0) {
      /* Issue a short-lived single-use token and chain through the first partner */
      const ssoTokenId = getRandId();
      await putItem({ ...sess, expiresAt: Date.now() + 60000 }, "sso:" + ssoTokenId);
      const next = String(stateObj.next || "/");
      const finalUrl = (publicBase || "") + (next.startsWith("/") ? next : "/" + next);
      const partnerUrl = ssoPartners[0] + "/auth/sso" +
        "?token=" + encodeURIComponent(ssoTokenId) +
        "&returnTo=" + encodeURIComponent(finalUrl);
      setRedirect(wo, partnerUrl, [sessCookie, clearState]);
    } else {
      setRedirect(wo, String(stateObj.next || "/"), [sessCookie, clearState]);
    }
    wo.jump = true;
    await setSendNow(wo);
    return coreData;
  }

  setJsonResp(wo, 404, { error: "not_found" });
  wo.jump = true;
  await setSendNow(wo);
  return coreData;
}