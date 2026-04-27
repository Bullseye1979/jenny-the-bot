/************************************************************************************/
/* filename: "mcp.js"                                                               */
/* Version 1.0                                                                      */
/* Purpose: MCP (Model Context Protocol) server flow. Starts a stdio transport      */
/*          and/or an HTTP+SSE transport depending on config, exposing all tool      */
/*          manifests as MCP tools. Auto-loaded by main.js via getStartFlows().     */
/************************************************************************************/

import http from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { getMcpToolsFromManifests, getMcpInvokeTool } from "../shared/mcp/mcp-utils.js";
import { getPrefixedLogger } from "../core/logging.js";
import { getStr, getNum } from "../core/utils.js";
import { getSecret } from "../core/secrets.js";

const MODULE_NAME = "mcp";
const CHANNEL_ID_HEADER = "x-channel-id";
const DEFAULT_CHANNEL_ID = "mcp";
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;


/*
 * Builds and returns a configured MCP Server instance. Each tool call runs a
 * full runFlow pass so core-channel-config applies per-channel overrides.
 */
function getMcpServer(sessionRunCore, log, runFlow, createRunCore) {
  const server = new Server(
    { name: getStr(sessionRunCore?.workingObject?.botName, "jenny"), version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  const tools = getMcpToolsFromManifests();
  log(`MCP tools registered: ${tools.map(t => t.name).join(", ")}`, "info");

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    log(`Tool call: ${name}`, "info");
    const callRunCore = createRunCore();
    callRunCore.workingObject.flow = MODULE_NAME;
    callRunCore.workingObject.channelId = getStr(sessionRunCore.workingObject.channelId, DEFAULT_CHANNEL_ID);
    await runFlow(MODULE_NAME, callRunCore);
    const result = await getMcpInvokeTool(name, args || {}, callRunCore);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: result?.ok === false
    };
  });

  return server;
}


/*
 * Starts the stdio MCP transport. Blocks until the process closes.
 */
async function startStdioTransport(baseCore, log, runFlow, createRunCore) {
  log("Starting MCP stdio transport", "info");
  const runCore = createRunCore();
  runCore.workingObject.flow = MODULE_NAME;
  runCore.workingObject.channelId = DEFAULT_CHANNEL_ID;
  await runFlow(MODULE_NAME, runCore);
  const server = getMcpServer(runCore, log, runFlow, createRunCore);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP stdio transport connected", "info");
}


/*
 * Returns the resolved secret value for the given apiSecret key, or empty string.
 */
async function resolveApiSecret(workingObject) {
  const apiSecret = getStr(workingObject?.apiSecret);
  if (!apiSecret) return "";
  return await getSecret(workingObject, apiSecret);
}


/*
 * Returns true when the bearer token matches the resolved apiSecret,
 * or when no apiSecret is configured for the channel.
 */
async function isRequestAuthorized(req, workingObject) {
  const resolved = await resolveApiSecret(workingObject);
  if (!resolved) return true;
  const auth = getStr(req.headers?.authorization);
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return token === resolved;
}


/*
 * Reads and parses a JSON request body for Streamable HTTP POST requests.
 * Passing parsedBody to the SDK keeps request handling aligned with the MCP
 * SDK examples and avoids ambiguous transport-level parsing failures.
 */
async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request_body_too_large"));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw.trim()) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}


function sendJsonRpcError(res, status, code, message) {
  res.writeHead(status, { "Content-Type": "application/json" })
    .end(JSON.stringify({
      jsonrpc: "2.0",
      error: { code, message },
      id: null
    }));
}


/*
 * Starts the HTTP MCP transport. Manages sessions so that the MCP
 * initialization handshake (initialize -> initialized -> requests) runs on
 * the same transport instance, as required by the MCP spec.
 */
async function startHttpTransport(baseCore, cfg, log, runFlow, createRunCore) {
  const port = getNum(cfg.http?.port, 3100);
  const mcpPath = getStr(cfg.http?.path, "/mcp");

  /* sessionId -> { transport, lastUsed } */
  const sessions = new Map();

  function cleanSessions() {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, s] of sessions) {
      if (s.lastUsed < cutoff) sessions.delete(id);
    }
  }
  setInterval(cleanSessions, 5 * 60 * 1000).unref();

  const httpServer = http.createServer(async (req, res) => {
    try {
      if (!req.url?.startsWith(mcpPath)) {
        sendJsonRpcError(res, 404, -32000, "Not found");
        return;
      }

      const sessionId = getStr(req.headers?.["mcp-session-id"]);
      log(`${req.method} ${req.url} session=${sessionId || "none"} sessions_stored=${sessions.size}`, "info");

      const existing = sessionId ? sessions.get(sessionId) : null;
      const parsedBody = req.method === "POST" ? await readJsonBody(req) : undefined;

      if (existing) {
        existing.lastUsed = Date.now();
        log(`Routing to existing session ${sessionId}`, "info");
        await existing.transport.handleRequest(req, res, parsedBody);
        if (req.method === "DELETE") sessions.delete(sessionId);
        return;
      }

      if (req.method !== "POST") {
        sendJsonRpcError(res, 405, -32000, "Method not allowed");
        return;
      }

      if (!isInitializeRequest(parsedBody)) {
        sendJsonRpcError(res, 400, -32000, "Bad Request: No valid session ID provided");
        return;
      }

      /* New session - authenticate first */
      const channelId = getStr(req.headers?.[CHANNEL_ID_HEADER]) || DEFAULT_CHANNEL_ID;
      const authHeader = getStr(req.headers?.authorization);

      const runCore = createRunCore();
      runCore.workingObject.flow = MODULE_NAME;
      runCore.workingObject.channelId = channelId;
      runCore.workingObject.httpAuthorization = authHeader;
      await runFlow(MODULE_NAME, runCore);

      if (!runCore.workingObject.channelAllowed) {
        sendJsonRpcError(res, 403, -32001, "channel_not_allowed");
        return;
      }

      if (!await isRequestAuthorized(req, runCore.workingObject)) {
        sendJsonRpcError(res, 401, -32001, "unauthorized");
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (newId) => {
          sessions.set(newId, { transport, lastUsed: Date.now() });
          log(`MCP session created: ${newId}`, "info");
        }
      });

      const server = getMcpServer(runCore, log, runFlow, createRunCore);
      await server.connect(transport);
      await transport.handleRequest(req, res, parsedBody);

    } catch (err) {
      log(`MCP HTTP handler error: ${err?.message}`, "error");
      if (!res.headersSent) {
        const badJson = err?.message === "invalid_json";
        const tooLarge = err?.message === "request_body_too_large";
        const status = badJson ? 400 : tooLarge ? 413 : 500;
        const code = badJson ? -32700 : -32603;
        const message = badJson ? "Invalid JSON" : tooLarge ? "Request body too large" : "Internal server error";
        sendJsonRpcError(res, status, code, message);
      }
    }
  });

  httpServer.listen(port, () => {
    log(`MCP HTTP transport listening on port ${port} at ${mcpPath}`, "info");
  });
}


export default async function getMcpFlow(baseCore, runFlow, createRunCore) {
  const log = getPrefixedLogger(baseCore?.workingObject || {}, import.meta.url);
  const cfg = baseCore?.config?.[MODULE_NAME] || {};

  const useStdio = cfg.stdio === true;
  const useHttp = cfg.http?.enabled === true;

  if (!useStdio && !useHttp) {
    log("MCP flow disabled (set config.mcp.stdio=true or config.mcp.http.enabled=true)", "info");
    return;
  }

  if (useHttp) {
    await startHttpTransport(baseCore, cfg, log, runFlow, createRunCore);
  }

  if (useStdio) {
    await startStdioTransport(baseCore, log, runFlow, createRunCore);
  }
}
