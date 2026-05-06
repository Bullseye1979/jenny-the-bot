/**************************************************************/
/* filename: "mcp-client.js"                                 */
/* Version 1.0                                               */
/* Purpose: Shared MCP client — connect to MCP servers via  */
/*          stdio, SSE, or streamable-HTTP transports.       */
/**************************************************************/

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { getSecret } from "../../core/secrets.js";

const MCP_CLIENT_VERSION = "1.0";
const DEFAULT_TIMEOUT_MS = 30000;


function getToolConfig(wo, toolName) {
  const all = wo?.toolsconfig || {};
  return all?.[toolName] || {};
}


function getWorkingObjectValue(wo, path) {
  const parts = String(path || "").trim().split(".").filter(Boolean);
  let current = wo;
  for (const part of parts) {
    if (!current || typeof current !== "object") return "";
    current = current[part];
  }
  return current == null ? "" : String(current);
}


export function getMcpServers(wo, toolName) {
  const ownCfg = getToolConfig(wo, toolName);
  return Array.isArray(ownCfg.servers) ? ownCfg.servers : [];
}


export function getMcpServerConfig(wo, toolName, serverName) {
  const name = String(serverName || "").trim();
  if (!name) return null;
  return getMcpServers(wo, toolName).find(s => String(s?.name || "") === name) || null;
}


async function getHeaders(wo, cfg) {
  const headers = {};
  if (Array.isArray(cfg.headers)) {
    for (const item of cfg.headers) {
      const header = String(item?.header || "").trim();
      if (!header) continue;
      const valueFromWorkingObject = String(item?.valueFromWorkingObject || "").trim();
      if (valueFromWorkingObject) {
        headers[header] = getWorkingObjectValue(wo, valueFromWorkingObject);
        continue;
      }
      if (item?.value !== undefined && item?.value !== null) {
        headers[header] = String(item.value);
        continue;
      }
      if (header.toLowerCase() === "x-channel-id") {
        headers[header] = String(wo?.channelId || "");
      }
    }
  }
  const bearerToken = cfg.bearerTokenSecret ? await getSecret(wo, String(cfg.bearerTokenSecret)) : cfg.bearerToken;
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  return headers;
}


async function getTransport(wo, cfg) {
  const type = String(cfg.type || "streamableHttp");

  if (type === "stdio") {
    if (!cfg.command) throw new Error("MCP stdio server requires command");
    return new StdioClientTransport({
      command: String(cfg.command),
      args: Array.isArray(cfg.args) ? cfg.args.map(String) : [],
      cwd: cfg.cwd ? String(cfg.cwd) : undefined,
      env: cfg.env && typeof cfg.env === "object" && !Array.isArray(cfg.env) ? Object.fromEntries(Object.entries(cfg.env).map(([k, v]) => [k, String(v)])) : undefined,
      stderr: "pipe"
    });
  }

  if (!cfg.url) throw new Error(`MCP ${type} server requires url`);
  const headers = await getHeaders(wo, cfg);
  const requestInit = Object.keys(headers).length ? { headers } : undefined;

  if (type === "sse") {
    return new SSEClientTransport(new URL(String(cfg.url)), { requestInit, eventSourceInit: requestInit });
  }

  if (type === "streamableHttp" || type === "http") {
    return new StreamableHTTPClientTransport(new URL(String(cfg.url)), { requestInit });
  }

  throw new Error(`Unsupported MCP transport type "${type}". Supported: streamableHttp, sse, stdio`);
}


export async function withMcpClient(wo, cfg, fn) {
  const client = new Client(
    { name: String(wo?.botName || "jenny"), version: String(MCP_CLIENT_VERSION) },
    { capabilities: {} }
  );
  const transport = await getTransport(wo, cfg);
  const timeoutMs = Number(cfg.timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    await client.connect(transport, { timeout: timeoutMs });
    return await fn(client, timeoutMs);
  } finally {
    try { await client.close(); } catch {}
    try { await transport.close(); } catch {}
  }
}
