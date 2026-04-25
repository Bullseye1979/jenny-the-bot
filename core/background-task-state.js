export function captureBackgroundTaskSignal(wo, toolName, resultLike) {
  const parsed = resultLike && typeof resultLike === "object" ? resultLike : {};
  const inner = parsed?.data && typeof parsed.data === "object" ? parsed.data : parsed;
  const status = String(inner?.status || parsed?.status || "").trim().toLowerCase();
  const meta = (inner?._meta && typeof inner._meta === "object") ? inner._meta : ((parsed?._meta && typeof parsed._meta === "object") ? parsed._meta : {});
  const event = String(meta?.event || "").trim().toLowerCase();
  const visibility = String(meta?.visibility || "").trim().toLowerCase();
  const backgroundStarted =
    event.endsWith("_started") ||
    event.endsWith("_spawned") ||
    (status === "started" && visibility === "internal");

  if (!backgroundStarted) return false;

  wo._backgroundTaskActive = true;
  wo._backgroundTaskTool = String(toolName || "").trim();
  wo._backgroundTaskStatus = status || "started";

  const msg = String(inner?.message || parsed?.message || "").trim();
  if (msg) wo._backgroundTaskStatusMessage = msg;
  return true;
}

export function hasActiveBackgroundTask(wo) {
  return wo?._backgroundTaskActive === true;
}

export function setBackgroundTaskRunningResponse(wo) {
  const msg = String(wo?._backgroundTaskStatusMessage || "").trim();
  wo.response = msg || "Die Hintergrundaufgabe wurde gestartet und laeuft weiter. Das Endergebnis wird nachgeliefert, sobald es fertig ist.";
}
