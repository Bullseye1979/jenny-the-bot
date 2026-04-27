/**************************************************************/
/* filename: "fetch.js"                                             */
/* Version 1.0                                               */
/* Purpose: Core shared runtime helper.                     */
/**************************************************************/


export async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
