/***************************************************************
/* filename: "registry.js"                                     *
/* Version 1.0                                                 *
/* Purpose: In-memory registry with single TTL, optional LRU,  *
/*          and automatic garbage collection                   *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

const MODULE_NAME = "registry";

const GC_INTERVAL_MS = 1000;
const GC_MAX_ENTRIES = 100000;
const GC_TOUCH_ON_GET = true;
const ENABLE_LRU_EVICT = true;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const REGISTRY_MAP = new Map();
const META_MAP = new Map();

/***************************************************************
/* functionSignature: getNow ()                                *
/* Returns the current timestamp in milliseconds               *
/***************************************************************/
function getNow() {
  return Date.now();
}

/***************************************************************
/* functionSignature: getGenId (prefix = "reg")                *
/* Generates a registry key with time and random suffix        *
/***************************************************************/
function getGenId(prefix = "reg") {
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `${prefix}:${Date.now().toString(36)}:${randomPart}`;
}

/***************************************************************
/* functionSignature: setEnsureMeta (key)                      *
/* Ensures and returns metadata record for a key               *
/***************************************************************/
function setEnsureMeta(key) {
  if (!META_MAP.has(key)) {
    META_MAP.set(key, {
      since: getNow(),
      lastAccess: getNow(),
      ttlMs: null,
      expireAt: null
    });
  }
  return META_MAP.get(key);
}

/***************************************************************
/* functionSignature: setApplyGlobalTTL (meta)                 *
/* Applies the global TTL to a meta record                     *
/***************************************************************/
function setApplyGlobalTTL(meta) {
  const ttl = Number(DEFAULT_TTL_MS);
  if (Number.isFinite(ttl) && ttl > 0) {
    meta.ttlMs = ttl;
    meta.expireAt = getNow() + ttl;
  } else {
    meta.ttlMs = null;
    meta.expireAt = null;
  }
}

/***************************************************************
/* functionSignature: getIsExpired (meta)                      *
/* Returns true if the meta record indicates expiration        *
/***************************************************************/
function getIsExpired(meta) {
  if (!meta) return false;
  return meta.expireAt != null && getNow() >= meta.expireAt;
}

/***************************************************************
/* functionSignature: setHardExpire (key)                      *
/* Removes a key and its metadata from the registry            *
/***************************************************************/
function setHardExpire(key) {
  REGISTRY_MAP.delete(key);
  META_MAP.delete(key);
}

/***************************************************************
/* functionSignature: setEnforceLRULimit ()                    *
/* Evicts least-recently-used items if size exceeds the cap    *
/***************************************************************/
function setEnforceLRULimit() {
  if (!ENABLE_LRU_EVICT) return 0;
  if (!Number.isFinite(GC_MAX_ENTRIES) || GC_MAX_ENTRIES === Infinity) return 0;
  const size = REGISTRY_MAP.size;
  if (size <= GC_MAX_ENTRIES) return 0;
  const excess = size - GC_MAX_ENTRIES;
  if (excess <= 0) return 0;
  const items = [];
  for (const k of REGISTRY_MAP.keys()) {
    const m = META_MAP.get(k) || {};
    items.push({ k, last: m.lastAccess ?? 0 });
  }
  items.sort((a, b) => a.last - b.last);
  let removed = 0;
  for (let i = 0; i < excess; i++) {
    const k = items[i]?.k;
    if (!k) break;
    setHardExpire(k);
    removed++;
  }
  return removed;
}

/***************************************************************
/* functionSignature: setSweepAll ()                           *
/* Expires TTL keys and enforces LRU size limits               *
/***************************************************************/
function setSweepAll() {
  const keys = Array.from(REGISTRY_MAP.keys());
  for (const k of keys) {
    const meta = META_MAP.get(k);
    if (getIsExpired(meta)) setHardExpire(k);
  }
  setEnforceLRULimit();
}

/***************************************************************
/* functionSignature: putItem (object, id)                     *
/* Stores object under provided/generated id and returns key   *
/***************************************************************/
export function putItem(object, id) {
  const key = (typeof id === "string" && id.trim()) ? id.trim() : getGenId();
  REGISTRY_MAP.set(key, object);
  const meta = setEnsureMeta(key);
  meta.since = getNow();
  meta.lastAccess = getNow();
  setApplyGlobalTTL(meta);
  return key;
}

/***************************************************************
/* functionSignature: getItem (id)                             *
/* Retrieves an object by id or null if missing/expired        *
/***************************************************************/
export function getItem(id) {
  if (typeof id !== "string" || !id) return null;
  if (!REGISTRY_MAP.has(id)) return null;
  const meta = setEnsureMeta(id);
  if (getIsExpired(meta)) {
    setHardExpire(id);
    return null;
  }
  if (GC_TOUCH_ON_GET) meta.lastAccess = getNow();
  return REGISTRY_MAP.get(id);
}

/***************************************************************
/* functionSignature: deleteItem (id)                          *
/* Removes an item from the registry by id                     *
/***************************************************************/
export function deleteItem(id) {
  if (typeof id !== "string" || !id) return false;
  const ok = REGISTRY_MAP.delete(id);
  META_MAP.delete(id);
  return ok;
}

/***************************************************************
/* functionSignature: listKeys (prefix = null)                 *
/* Returns all keys, optionally filtered by prefix             *
/***************************************************************/
export function listKeys(prefix = null) {
  const keys = Array.from(REGISTRY_MAP.keys());
  if (typeof prefix === "string" && prefix.length > 0) {
    return keys.filter(k => k.startsWith(prefix));
  }
  return keys;
}

/***************************************************************
/* functionSignature: clearAll ()                              *
/* Clears the entire in-memory registry                        *
/***************************************************************/
export function clearAll() {
  REGISTRY_MAP.clear();
  META_MAP.clear();
}

export default { putItem, getItem, deleteItem, listKeys, clearAll };

/***************************************************************
/* functionSignature: setStartHardcodedGC ()                   *
/* Starts the periodic GC timer                                *
/***************************************************************/
function setStartHardcodedGC() {
  try {
    const t = setInterval(() => {
      try { setSweepAll(); } catch {}
    }, GC_INTERVAL_MS);
    if (typeof t.unref === "function") t.unref();
  } catch {}
}

setStartHardcodedGC();
