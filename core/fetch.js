/**********************************************************************************/
/* filename: fetch.js                                                              *
/* Version 1.0                                                                     *
/* Purpose: Centralized HTTP fetch wrapper with AbortController-based timeout.    *
/*          Replaces per-file AbortController+setTimeout patterns across tools    *
/*          and modules. Returns the native Response object or throws on          *
/*          timeout (AbortError) or network failure.                               *
/*                                                                                 *
/* Usage:                                                                          *
/*   import { fetchWithTimeout } from "../core/fetch.js";                         *
/*   const res = await fetchWithTimeout(url, { method: "POST", ... }, 30000);     *
/*                                                                                 *
/* Note: getImageSD.js uses undici Agent for TCP-level control and keeps its      *
/*       own fetch setup. All other tools and modules should use this wrapper.    *
/**********************************************************************************/


export async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
