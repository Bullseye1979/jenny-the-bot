/************************************************************************************
/* filename: 00007-webpage-router.js                                               *
/* Version 1.0                                                                     *
/* Purpose: Flow router for webpage requests.                                      *
/*          Sets wo.flow and wo.channelID before core-channel-config (00010) runs, *
/*          based on configurable endpoint-to-flow mappings in core.json.          *
/*          This allows core-channel-config to apply flow-specific overrides via   *
/*          its flows[].flowMatch entries (e.g. "webpage-voice", "webpage-wiki").  *
/*                                                                                 *
/* Config key: webpage-router                                                      *
/*   routes[]:                                                                     *
/*     port             — HTTP port to match                                       *
/*     pathPrefix       — URL path prefix (e.g. "/voice", "/wiki")                 *
/*     flow             — wo.flow value to set (e.g. "webpage-voice")              *
/*     channelIdSource  — how to derive wo.channelID:                              *
/*                        "query:<param>" — from URL query string param            *
/*                        "path:<N>"      — path segment N after prefix (0-based)  *
/*                        "<literal>"     — static string value                    *
/*                                                                                 *
/* Note: The module pipeline is already built when this runs (based on the         *
/*       initial wo.flow = "webpage"). Changing wo.flow here only affects how      *
/*       downstream modules read it — in particular core-channel-config uses       *
/*       wo.flow for its internal flowMatch logic.                                 *
/*                                                                                 *
/* MUST run before 00010-core-channel-config.                                      *
/* Flow: webpage                                                                   *
/************************************************************************************/

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
    /* core-channel-config re-applies the trigger if the channel matches */
    wo.trigger = "";

    const channelId = resolveChannelId(
      String(route.channelIdSource || ""),
      url,
      pathPrefix
    );

    if (channelId) wo.channelID = channelId;

    /* Optional: skip modules irrelevant to this route */
    const removeModules = Array.isArray(route.removeModules) ? route.removeModules : [];
    if (removeModules.length) {
      const existing = Array.isArray(wo.flowModuleRemove) ? wo.flowModuleRemove : (wo.flowModuleRemove ? [wo.flowModuleRemove] : []);
      wo.flowModuleRemove = [...new Set([...existing, ...removeModules])];
    }

    log("Route matched — flow and channelID set", "info", {
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
