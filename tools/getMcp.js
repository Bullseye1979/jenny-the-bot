/**************************************************************/
/* filename: "getMcp.js"                                     */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool — executes a tool on a        */
/*          configured MCP server.                           */
/**************************************************************/

import { getPrefixedLogger } from "../core/logging.js";
import { getMcpServerConfig, getMcpServers, withMcpClient } from "../shared/mcp/mcp-client.js";

const MODULE_NAME = "getMcp";


function getServerNamespace(server) {
  return String(server?.namespace || server?.name || "").trim().replace(/[^A-Za-z0-9_-]+/g, "-");
}


function getNamespacedToolParts(toolName) {
  const parts = String(toolName || "").trim().split(".");
  if (parts.length < 3 || parts[0] !== "mcp") return null;
  return {
    namespace: parts[1],
    tool: parts.slice(2).join(".")
  };
}


function getServerByNamespace(wo, namespace) {
  const ns = String(namespace || "").trim();
  if (!ns) return null;
  return getMcpServers(wo, MODULE_NAME).find(server => getServerNamespace(server) === ns) || null;
}


async function getInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  let serverName = String(args?.server || "").trim();
  let toolName = String(args?.tool || "").trim();
  const toolArgs = args?.arguments && typeof args.arguments === "object" && !Array.isArray(args.arguments) ? args.arguments : {};

  if (!toolName) return { ok: false, error: "tool is required" };

  const namespaced = getNamespacedToolParts(toolName);
  let server = null;
  if (namespaced) {
    server = getServerByNamespace(wo, namespaced.namespace);
    if (!server) return { ok: false, tool: toolName, error: `MCP namespace "${namespaced.namespace}" is not configured` };
    serverName = String(server.name || "");
    toolName = namespaced.tool;
  } else {
    if (!serverName) return { ok: false, error: "server is required when tool is not namespaced as mcp.<namespace>.<tool>" };
    server = getMcpServerConfig(wo, MODULE_NAME, serverName);
  }
  if (!server) return { ok: false, error: `MCP server "${serverName}" is not configured` };

  try {
    log(`[${MODULE_NAME}] ${serverName}.${toolName}`, "info");
    const result = await withMcpClient(wo, server, async (client, timeoutMs) => {
      return await client.callTool({ name: toolName, arguments: toolArgs }, undefined, { timeout: timeoutMs });
    });
    return { ok: result?.isError !== true, server: serverName, tool: toolName, result };
  } catch (e) {
    return { ok: false, server: serverName, tool: toolName, error: String(e?.message || e) };
  }
}


export default { name: MODULE_NAME, invoke: getInvoke };
