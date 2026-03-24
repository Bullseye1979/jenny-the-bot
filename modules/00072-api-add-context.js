/****************************************************************************************************************
* filename: 00072-api-add-context.js                                                                               *
* Version 1.0                                                                                                  *
* Purpose: Append the current API payload to the DB context with role=user and preserved turn_id when present.  *
****************************************************************************************************************/

import { setContext } from "../core/context.js";

const MODULE_NAME = "api-add-context";

function getString(value) {
  return value == null ? "" : String(value);
}

function getEnsureLogging(workingObject) {
  if (!Array.isArray(workingObject.logging)) workingObject.logging = [];
  return workingObject.logging;
}

function setPushLog(logging, entry) {
  logging.push(entry);
}

export default async function getApiAddContext(coreData) {
  const workingObject = coreData?.workingObject || {};
  const logging = getEnsureLogging(workingObject);

  const timestamp = String(workingObject.timestamp || new Date().toISOString());
  const text = typeof workingObject.payload === "string" ? workingObject.payload.trim() : "";

  setPushLog(logging, {
    timestamp,
    severity: "info",
    module: MODULE_NAME,
    exitStatus: "started",
    message: "Begin append API message to context",
  });

  if (workingObject.doNotWriteToContext === true) {
    setPushLog(logging, {
      timestamp,
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "skipped",
      message: "doNotWriteToContext=true — skipped API context write",
    });
    return coreData;
  }

  if (!workingObject.db || !workingObject.flow || !workingObject.channelID || !text) {
    setPushLog(logging, {
      timestamp,
      severity: "error",
      module: MODULE_NAME,
      exitStatus: "failed",
      message: "Missing required fields: db, flow, id, or payload",
    });
    return coreData;
  }

  const turnId =
    typeof workingObject.turn_id === "string" && workingObject.turn_id.length > 0
      ? workingObject.turn_id
      : undefined;

  const record = {
    ts: getString(workingObject.timestamp || ""),
    role: "user",
    turn_id: turnId,
    content: getString(text),
    source: getString(workingObject.source ?? workingObject.flow ?? "api"),
  };

  try {
    await setContext(workingObject, record);
    setPushLog(logging, {
      timestamp,
      severity: "info",
      module: MODULE_NAME,
      exitStatus: "success",
      message: "API message appended to context",
    });
  } catch (err) {
    setPushLog(logging, {
      timestamp,
      severity: "error",
      module: MODULE_NAME,
      exitStatus: "failed",
      message: `Context write failed: ${err?.message || String(err)}`,
    });
  }

  return coreData;
}
