/**************************************************************/
/* filename: "00007-webpage-router.js"                              */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/




























import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME = "webpage-router";


function resolveChannelId(source, url, pathPrefix) {
  if (!source) return "";

  const qIdx   = url.indexOf("?");
  const urlPath = qIdx >= 0 ? url.slice(0, qIdx) : url;
  const params  = new URLSearchParams(qIdx >= 0 ? url.slice(qIdx + 1) : "");

  if (source.startsWith("query:")) {
    return (params.get(source.slice(6)) || "").trim();
  }

  if (source.startsWith("path:")) {
    const n       = parseInt(source.slice(5), 10);
    const suffix  = urlPath.slice(pathPrefix.length).replace(/^\//, "");
    const segment = suffix.split("/")[isNaN(n) ? 0 : n] || "";
    return segment.trim();
  }

  return source.trim();
}


export default async function getWebpageRouter(coreData) {
  const wo  = coreData?.workingObject || (coreData.workingObject = {});
  const log = getPrefixedLogger(wo, import.meta.url);

  const cfg    = coreData?.config?.["webpage-router"] || {};
  const routes = Array.isArray(cfg.routes) ? cfg.routes : [];

  if (!routes.length) return coreData;

  const port = Number(wo.http?.port);
  const url  = wo.http?.url || "";

  const qIdx    = url.indexOf("?");
  const urlPath = qIdx >= 0 ? url.slice(0, qIdx) : url;

  for (const route of routes) {
    const routePort  = Number(route.port);
    const pathPrefix = String(route.pathPrefix || "");
    const flow       = String(route.flow || "").trim();

    if (!routePort || !pathPrefix || !flow) continue;
    if (port !== routePort)                 continue;
    if (!urlPath.startsWith(pathPrefix))    continue;

    wo.flow    = flow;
    wo.trigger = "";

    const channelId = resolveChannelId(
      String(route.channelIdSource || ""),
      url,
      pathPrefix
    );

    if (channelId) wo.channelId = channelId;

    const removeModules = Array.isArray(route.removeModules) ? route.removeModules : [];
    if (removeModules.length) {
      const existing = Array.isArray(wo.flowModuleRemove) ? wo.flowModuleRemove : (wo.flowModuleRemove ? [wo.flowModuleRemove] : []);
      wo.flowModuleRemove = [...new Set([...existing, ...removeModules])];
    }

    log("Route matched — flow and channelId set", "info", {
      moduleName: MODULE_NAME,
      port,
      pathPrefix,
      flow,
      channelId:     channelId || "(none)",
      removedModules: removeModules.length ? removeModules : undefined
    });

    break;
  }

  return coreData;
}
