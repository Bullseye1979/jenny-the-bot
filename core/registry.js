/***************************************************************
/* filename: "registry.js"                                     *
/* Version 1.0                                                 *
/* Purpose: In-memory process-local registry for live objects; *
/*          provides put/get/delete APIs and ID generation.    *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

const MODULE_NAME = "registry";

const REGISTRY_MAP = new Map();

/***************************************************************
/* functionSignature: getGenId (prefix = "reg")                *
/* Generates an opaque registry ID without external deps       *
/***************************************************************/
function getGenId(prefix = "reg") {
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `${prefix}:${Date.now().toString(36)}:${randomPart}`;
}

/***************************************************************
/* functionSignature: putItem (object, id)                     *
/* Stores object under provided/generated id and returns key   *
/***************************************************************/
export function putItem(object, id) {
  const key = typeof id === "string" && id.trim() ? id.trim() : getGenId();
  REGISTRY_MAP.set(key, object);
  return key;
}

/***************************************************************
/* functionSignature: getItem (id)                             *
/* Retrieves object by id or null if it does not exist         *
/***************************************************************/
export function getItem(id) {
  if (typeof id !== "string" || !id) return null;
  return REGISTRY_MAP.has(id) ? REGISTRY_MAP.get(id) : null;
}

/***************************************************************
/* functionSignature: deleteItem (id)                          *
/* Removes an item from the registry by id                     *
/***************************************************************/
export function deleteItem(id) {
  if (typeof id !== "string" || !id) return false;
  return REGISTRY_MAP.delete(id);
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
}

export default { putItem, getItem, deleteItem, listKeys, clearAll };
