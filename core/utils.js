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


const _CROCK = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let _ulidLastTime = 0;
let _ulidLastRand = new Uint8Array(10).fill(0);

/**
 * Generates a monotonically increasing ULID string.
 * @returns {string}
 */
export function getNewUlid() {
  const now = Date.now();
  let rand;
  if (now === _ulidLastTime) {
    for (let i = 9; i >= 0; i--) {
      if (_ulidLastRand[i] < 255) { _ulidLastRand[i]++; break; }
      _ulidLastRand[i] = 0;
    }
    rand = _ulidLastRand;
  } else {
    _ulidLastTime = now;
    rand = new Uint8Array(10);
    for (let i = 0; i < 10; i++) rand[i] = Math.floor(Math.random() * 256);
    _ulidLastRand = rand;
  }
  let t = BigInt(now);
  let ts = "";
  for (let i = 0; i < 10; i++) { ts = _CROCK[Number(t % 32n)] + ts; t /= 32n; }
  let acc = 0, bits = 0, i = 0;
  const rs = [];
  while (i < rand.length || bits > 0) {
    if (bits < 5 && i < rand.length) { acc = (acc << 8) | rand[i++]; bits += 8; }
    else { rs.push(_CROCK[(acc >> (bits - 5)) & 31]); bits -= 5; }
  }
  return ts + rs.slice(0, 16).join("");
}
