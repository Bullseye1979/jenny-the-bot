/**************************************************************
/* filename: "moderation-output.js"                           *
/* Version 1.0                                                *
/* Purpose: Trigger-based moderation on AI output (silence only)*
/**************************************************************/
/**************************************************************
/*                                                            *
/**************************************************************/

import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "moderation-output";

/**************************************************************
/* functionSignature: getStr (v, d = "")                      *
/* Returns v if it is a non-empty string; otherwise d.        *
/**************************************************************/
function getStr(v, d = "") { return (typeof v === "string" && v.length) ? v : d; }

/**************************************************************
/* functionSignature: getBool (v, d = false)                  *
/* Returns v if it is boolean; otherwise d.                   *
/**************************************************************/
function getBool(v, d = false) { return (typeof v === "boolean") ? v : d; }

/**************************************************************
/* functionSignature: getNowIso ()                            *
/* Returns current time in ISO format.                        *
/**************************************************************/
function getNowIso() { return new Date().toISOString(); }

/**************************************************************
/* functionSignature: getPreview (s, max = 280)               *
/* Returns a truncated preview of s up to max chars.          *
/**************************************************************/
function getPreview(s, max = 280) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) + " …[truncated]" : t;
}

/**************************************************************
/* functionSignature: getEscapedRegex (s)                     *
/* Escapes regex metacharacters in s.                         *
/**************************************************************/
function getEscapedRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/**************************************************************
/* functionSignature: getCfg (wo)                             *
/* Extracts normalized moderation config from wo.             *
/**************************************************************/
function getCfg(wo) {
  return {
    enabled: getBool(wo?.ModerationEnabled ?? true, true),
    clientRef: getStr(wo?.clientRef, ""),
    adminId: getStr(wo?.ModAdmin, ""),
    trigSilence: getStr(wo?.ModSilence, "")
  };
}

/**************************************************************
/* functionSignature: setDecisionLog (wo, payload)            *
/* Appends a compact decision entry into wo.logging.          *
/**************************************************************/
function setDecisionLog(wo, { level = "info", message = "Moderation decision", decision, extra = {} }) {
  try {
    if (!Array.isArray(wo.logging)) wo.logging = [];
    wo.logging.push({
      ts: getNowIso(),
      level,
      message,
      moduleName: "logging",
      prefix: "[02000:moderation-output]",
      context: { moduleName: MODULE_NAME, ...decision, ...extra }
    });
  } catch {}
}

/**************************************************************
/* functionSignature: getModerationOutput (coreData)          *
/* Evaluates wo.Response for [silence] only.                  *
/**************************************************************/
export default async function getModerationOutput(coreData) {
  const wo = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);
  const cfg = getCfg(wo);

  try {
    log("Moderation (silence-only) started", "info", {
      moduleName: MODULE_NAME,
      enabled: cfg.enabled,
      hasClientRef: !!cfg.clientRef,
      hasAdmin: !!cfg.adminId,
      trigSilence: cfg.trigSilence ? "[set]" : "[unset]"
    });

    if (!cfg.enabled) return coreData;

    const original = String(wo.Response ?? "");
    const silenceHit = !!(cfg.trigSilence && new RegExp(getEscapedRegex(cfg.trigSilence), "i").test(original));

    if (silenceHit) {
      wo.Response = "STOP";
      wo.stop = true;
      const decision = { action: "drop", tag: "silence", reason: "trigger_match" };
      wo.Moderation = decision;

      log("Silence trigger matched → STOP (jump to output)", "info", {
        trigger: cfg.trigSilence, preview: getPreview(original)
      });
      setDecisionLog(wo, { level: "info", decision, extra: { stop: true, trigger: cfg.trigSilence, preview: getPreview(original) } });

      return coreData;
    }

    const decision = { action: "post", tag: null, reason: "no_trigger" };
    wo.Moderation = decision;

    log("No trigger matched → pass-through", "info", { preview: getPreview(original) });
    setDecisionLog(wo, { level: "info", decision, extra: { stop: false, preview: getPreview(original) } });

    return coreData;

  } catch (err) {
    const reason = err?.message || String(err);
    const decision = { action: "post", tag: null, reason: "error_passthrough" };
    wo.Moderation = decision;

    log("Moderation error → pass-through", "error", { moduleName: MODULE_NAME, reason });
    setDecisionLog(wo, { level: "error", message: "Moderation error", decision, extra: { stop: false, error: reason } });

    return coreData;
  }
}
