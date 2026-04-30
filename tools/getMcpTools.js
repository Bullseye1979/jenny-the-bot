/**************************************************************/
/* filename: "getMcpTools.js"                                */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool — lists available tools on    */
/*          configured MCP servers.                          */
/**************************************************************/

import { getPrefixedLogger } from "../core/logging.js";
import { getMcpServerConfig, getMcpServers, withMcpClient } from "../shared/mcp/mcp-client.js";

const MODULE_NAME = "getMcpTools";


function slimTool(tool) {
  return {
    name: tool.name,
    description: tool.description || "",
    inputSchema: tool.inputSchema || { type: "object", properties: {} }
  };
}


function getFilteredTools(tools, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return tools;
  const words = q.split(/\s+/).filter(w => w.length > 1);
  return tools
    .map(tool => {
      const name = String(tool.name || "").toLowerCase();
      const description = String(tool.description || "").toLowerCase();
      let score = 0;
      if (name === q) score = 100;
      else if (name.includes(q)) score = 80;
      else if (words.some(w => name.includes(w))) score = 60;
      else if (description.includes(q)) score = 40;
      else if (words.some(w => description.includes(w))) score = 20;
      return { tool, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.tool.name || "").localeCompare(String(b.tool.name || "")))
    .slice(0, 8)
    .map(item => item.tool);
}


function getServerNamespace(server) {
  return String(server?.namespace || server?.name || "").trim().replace(/[^A-Za-z0-9_-]+/g, "-");
}


function getNamespacedTool(server, tool) {
  const namespace = getServerNamespace(server);
  const remoteName = String(tool.name || "").trim();
  return {
    ...tool,
    name: `mcp.${namespace}.${remoteName}`,
    remoteName,
    source: "mcp",
    server: String(server.name || ""),
    namespace
  };
}


async function listOne(wo, server, query) {
  const serverName = String(server.name || "");
  const namespace = getServerNamespace(server);
  const result = await withMcpClient(wo, server, async (client, timeoutMs) => {
    const listed = await client.listTools({}, { timeout: timeoutMs });
    const tools = Array.isArray(listed?.tools) ? listed.tools.map(slimTool) : [];
    return getFilteredTools(tools, query).map(tool => getNamespacedTool(server, tool));
  });
  return {
    name: serverName,
    namespace,
    ok: true,
    executeWith: {
      tool: "getMcp",
      server: serverName,
      argumentShape: {
        tool: `mcp.${namespace}.<tool>`,
        arguments: {}
      },
      instruction: "Execute a discovered remote MCP tool by calling getMcp. Pass the full mcp.<namespace>.<tool> name as the tool argument. Do not call the remote mcp.* name directly as a local tool."
    },
    tools: result
  };
}


async function getInvoke(args, coreData) {
  const wo = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);
  const serverName = String(args?.server || "").trim();
  const query = String(args?.query || "").trim();
  const servers = serverName ? [getMcpServerConfig(wo, MODULE_NAME, serverName)].filter(Boolean) : getMcpServers(wo, MODULE_NAME);

  if (!servers.length) {
    return { ok: false, error: serverName ? `MCP server "${serverName}" is not configured` : "No MCP servers configured in toolsconfig.getMcpTools.servers" };
  }

  const results = [];
  for (const server of servers) {
    try {
      log(`[${MODULE_NAME}] listing ${server.name}`, "info");
      results.push(await listOne(wo, server, query));
    } catch (e) {
      results.push({ name: String(server?.name || ""), ok: false, error: String(e?.message || e), tools: [] });
    }
  }

  const anyOk = results.some(r => r.ok);
  const totalTools = results.reduce((n, r) => n + (Array.isArray(r.tools) ? r.tools.length : 0), 0);
  const data = JSON.stringify({ ok: anyOk, servers: results });
  if (anyOk && totalTools > 0) {
    return `REQUIRED NEXT ACTION: You MUST call getMcp now using a tool name from the list below. Do not answer the user before calling getMcp.\n\n${data}`;
  }
  return `No remote MCP tools are available.\n\n${data}`;
}


export default { name: MODULE_NAME, invoke: getInvoke };
