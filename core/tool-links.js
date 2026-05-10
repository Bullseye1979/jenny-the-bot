/**************************************************************/
/* filename: "tool-links.js"                                 */
/* Version 1.0                                               */
/* Purpose: Resolve linked tool names from active channel    */
/*          tool configuration without hardcoded runtime     */
/*          defaults.                                        */
/**************************************************************/

import { getObj, getStr } from "./utils.js";


function getActiveTools(wo) {
  const tools = Array.isArray(wo?.tools)
    ? wo.tools.map(name => getStr(name).trim()).filter(Boolean)
    : [];
  const blocked = new Set(
    Array.isArray(wo?.toolsBlacklist)
      ? wo.toolsBlacklist.map(name => getStr(name).trim()).filter(Boolean)
      : []
  );
  return tools.filter(name => !blocked.has(name));
}


function getConfiguredToolName(wo, configSectionName, fieldName) {
  const section = getObj(wo?.toolsconfig?.[configSectionName], {});
  const name = getStr(section?.[fieldName]).trim();
  if (!name) return "";
  return getActiveTools(wo).includes(name) ? name : "";
}


function getMatchingToolsByConfigShape(wo, ownerName, matcher) {
  const activeTools = getActiveTools(wo);
  return activeTools.filter((name) => {
    if (!name || name === ownerName) return false;
    return matcher(getObj(wo?.toolsconfig?.[name], {}), name);
  });
}


export function getSpecialistDispatcherToolName(wo) {
  const configured = getConfiguredToolName(wo, "getOrchestrator", "specialistToolName");
  if (configured) return configured;
  const matches = getMatchingToolsByConfigShape(
    wo,
    "getOrchestrator",
    cfg => cfg?.types && typeof cfg.types === "object" && !Array.isArray(cfg.types)
  );
  return matches.length === 1 ? matches[0] : "";
}


export function getMcpExecutorToolName(wo) {
  const configured = getConfiguredToolName(wo, "getMcpTools", "executorToolName");
  if (configured) return configured;
  const matches = getMatchingToolsByConfigShape(
    wo,
    "getMcpTools",
    cfg => Array.isArray(cfg?.servers)
  );
  return matches.length === 1 ? matches[0] : "";
}


export function getActiveToolNames(wo) {
  return getActiveTools(wo);
}
