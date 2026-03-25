/**********************************************************************************/
/* filename: shared/webpage/utils.js                                              */
/* Version 1.0                                                                    */
/* Purpose: Shared HTTP-response helpers used by all webpage modules.             */
/*          Centralises setSendNow, setJsonResp, getUserRoleLabels,               */
/*          getIsAllowedRoles so each module no longer defines its own copy.      */
/**********************************************************************************/

/**
 * Send wo.http.response to the client immediately via wo.http.res.
 * Safe to call multiple times — guards writableEnded and headersSent.
 */
export async function setSendNow(wo) {
  const res = wo?.http?.res;
  if (!res || res.writableEnded || res.headersSent) return;

  const r      = wo.http?.response || {};
  const status  = Number(r.status  ?? 200);
  const headers = r.headers ?? { "Content-Type": "text/plain; charset=utf-8" };
  const body    = r.body    ?? "";

  try {
    res.writeHead(status, headers);
    res.end(typeof body === "string" ? body : Buffer.isBuffer(body) ? body : JSON.stringify(body));
  } catch {}
}


/**
 * Set a JSON response on wo.http.response.
 */
export function setJsonResp(wo, status, data) {
  wo.http.response = {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(data),
  };
}


/**
 * Extract all role labels from wo.webAuth (primary role + roles array),
 * lower-cased and de-duplicated.
 */
export function getUserRoleLabels(wo) {
  const out  = [];
  const seen = new Set();

  const primary = String(wo?.webAuth?.role || "").trim().toLowerCase();
  if (primary && !seen.has(primary)) { seen.add(primary); out.push(primary); }

  const roles = wo?.webAuth?.roles;
  if (Array.isArray(roles)) {
    for (const r of roles) {
      const v = String(r || "").trim().toLowerCase();
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}


/**
 * Return true if the user holds at least one of the required roles.
 * Empty allowedRoles array → everyone is allowed.
 */
export function getIsAllowedRoles(wo, allowedRoles) {
  const req = Array.isArray(allowedRoles) ? allowedRoles : [];
  if (!req.length) return true;

  const have = new Set(getUserRoleLabels(wo));
  for (const r of req) {
    const need = String(r || "").trim().toLowerCase();
    if (need && have.has(need)) return true;
  }
  return false;
}
