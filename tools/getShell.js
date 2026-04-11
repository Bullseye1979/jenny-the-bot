/**************************************************************/
/* filename: "getShell.js"                                   */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/

import { spawn }             from "node:child_process";
import { getPrefixedLogger } from "../core/logging.js";

const MODULE_NAME        = "getShell";
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_BYTES  = 8192;


async function getInvoke(args, coreData) {
  const { command, args: cmdArgs, cwd, timeoutMs } = args || {};
  const wo  = coreData?.workingObject || {};
  const cfg = wo.toolsconfig?.[MODULE_NAME] || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  const allowlist  = Array.isArray(cfg.allowlist) ? cfg.allowlist : null;
  const maxBytes   = Number(cfg.maxOutputBytes   || DEFAULT_MAX_BYTES);
  const timeoutVal = Number(timeoutMs || cfg.defaultTimeoutMs || DEFAULT_TIMEOUT_MS);
  const cmdStr     = String(command || "").trim();
  const argsArr    = Array.isArray(cmdArgs) ? cmdArgs.map(String) : [];
  const cwdStr     = cwd ? String(cwd) : undefined;

  if (!cmdStr) return { ok: false, error: "command is required" };

  if (allowlist && !allowlist.includes(cmdStr)) {
    return { ok: false, error: `Command "${cmdStr}" is not in the allowlist` };
  }

  log(`[${MODULE_NAME}] exec: ${cmdStr} ${argsArr.join(" ")}`, "info");

  return new Promise((resolve) => {
    let stdout   = "";
    let stderr   = "";
    let timedOut = false;

    const proc = spawn(cmdStr, argsArr, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      cwd:   cwdStr,
      env:   { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: process.env.HOME || "" }
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, timeoutVal);

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (stdout.length > maxBytes) stdout = stdout.slice(0, maxBytes) + "\n[output truncated]";
      if (stderr.length > maxBytes) stderr = stderr.slice(0, maxBytes) + "\n[output truncated]";

      const parts  = [stdout, stderr ? `[stderr]\n${stderr}` : ""].filter(Boolean);
      const output = parts.join("\n") || "(no output)";

      if (timedOut) {
        resolve({ ok: false, error: "timeout", exitCode: null, output, stdout: stdout || null, stderr: stderr || null });
        return;
      }
      resolve({ ok: code === 0, exitCode: code, output, stdout: stdout || null, stderr: stderr || null });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message, exitCode: null, stdout: null, stderr: null });
    });
  });
}


export default { name: MODULE_NAME, invoke: getInvoke };
