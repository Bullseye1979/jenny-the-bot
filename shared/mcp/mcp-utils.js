/**************************************************************/
/* filename: "mcp-utils.js"                                  */
/* Version 1.0                                               */
/* Purpose: Shared utilities for the MCP server flow.        */
/*          Reads tool manifests and invokes tool modules.   */
/**************************************************************/

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getNewUlid } from "../../core/utils.js";
import { getPrefixedLogger } from "../../core/logging.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFESTS_DIR = join(__dirname, "../../manifests");
const TOOLS_DIR = join(__dirname, "../../tools");


/*
 * Reads all JSON manifests from the manifests/ directory and returns them as
 * an array of MCP tool definition objects { name, description, inputSchema }.
 */
export function getMcpToolsFromManifests() {
  const files = readdirSync(MANIFESTS_DIR).filter(f => f.endsWith(".json"));
  const tools = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(MANIFESTS_DIR, file), "utf8");
      const manifest = JSON.parse(raw);
      if (!manifest.name) continue;
      tools.push({
        name: manifest.name,
        description: manifest.description || "",
        inputSchema: manifest.parameters || { type: "object", properties: {} }
      });
    } catch {
    }
  }
  return tools;
}


/*
 * Dynamically imports a tool module by name and invokes it with the given args
 * and a minimal coreData built from baseCore. Returns the tool result.
 */
export async function getMcpInvokeTool(name, args, runCore) {
  const workingObject = {
    ...runCore.workingObject,
    userId: args?._userId || runCore.workingObject?.userId || "mcp-client",
    turnId: getNewUlid()
  };
  const log = getPrefixedLogger(workingObject, import.meta.url);

  let toolModule;
  try {
    const mod = await import(join(TOOLS_DIR, `${name}.js`));
    toolModule = mod?.default ?? mod;
  } catch (e) {
    log(`Tool "${name}" load failed: ${e?.message}`, "error");
    return { ok: false, error: `TOOL_NOT_FOUND — ${name}` };
  }

  if (typeof toolModule?.invoke !== "function") {
    log(`Tool "${name}" has no invoke function`, "error");
    return { ok: false, error: `TOOL_NO_INVOKE — ${name}` };
  }

  try {
    const result = await toolModule.invoke(args, { workingObject, config: runCore.config });
    return result;
  } catch (e) {
    log(`Tool "${name}" invocation error: ${e?.message}`, "error");
    return { ok: false, error: `TOOL_ERROR — ${e?.message || String(e)}` };
  }
}
