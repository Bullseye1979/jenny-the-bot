/**************************************************************/
/* filename: "utils.js"                                      */
/* Version 1.0                                               */
/* Purpose: Core shared utility functions used across tools, */
/*          modules, and flows.                              */
/**************************************************************/

/**
 * Returns the value if it is a non-empty string, otherwise returns the fallback.
 * @param {*} value
 * @param {string} fallback
 * @returns {string}
 */
export function getStr(value, fallback = "") {
  return (typeof value === "string" && value.length) ? value : fallback;
}


/**
 * Returns the numeric value if finite, otherwise returns the fallback.
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
export function getNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}


/**
 * Returns the value if it is a non-null object (not array), otherwise returns the fallback.
 * @param {*} value
 * @param {object} fallback
 * @returns {object}
 */
export function getObj(value, fallback = {}) {
  return (value !== null && typeof value === "object" && !Array.isArray(value)) ? value : fallback;
}


/**
 * Returns true if the string starts with http:// or https://.
 * @param {*} value
 * @returns {boolean}
 */
export function getIsHttpUrl(value) {
  if (typeof value !== "string" || !value.length) return false;
  return /^https?:\/\//i.test(value);
}


/**
 * Returns a Promise that resolves after the given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}
