/**************************************************************
/* filename: 02000-moderation-output.js                           *
/* Version 1.0                                                *
/* Purpose: Trigger-based moderation on AI output (silence only)*
/**************************************************************/
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "moderation-output";


function getStr(v, d = "") { return (typeof v === "string" && v.length) ? v : d; }


function getBool(v, d = false) { return (typeof v === "boolean") ? v : d; }


function getNowIso() { return new Date().toISOString(); }


function getPreview(s, max = 280) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) + " …[truncated]" : t;
}


function getEscapedRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }


function getCfg(wo) {
  return {
    enabled: getBool(wo?.ModerationEnabled ?? true, true),
    clientRef: getStr(wo?.clientRef, ""),
    adminId: getStr(wo?.modAdmin, ""),
    trigSilence: getStr(wo?.modSilence, "")
  };
}


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

    const original = String(wo.response ?? "");
    const silenceHit = !!(cfg.trigSilence && new RegExp(getEscapedRegex(cfg.trigSilence), "i").test(original));

    if (silenceHit) {
      wo.response   = "STOP";
      wo.stop       = true;
      wo.stopReason = "moderation_silence";
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
