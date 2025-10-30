/***************************************************************
/* filename: "main.js"                                        *
/* Version 1.0                                                *
/* Purpose: Core with hot-reload and live dashboard (1/s);     *
/*          single-screen UI; telemetry and jump ≥9000         *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_NAME = "main";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const CORE_PATH  = path.join(__dirname, "core.json");

const supportsColor = process.stdout.isTTY && process.env.NO_COLOR !== "1";
const supportsClear = process.stdout.isTTY;
const C = supportsColor
  ? {
      reset: "\x1b[0m",
      dim: "\x1b[2m",
      bold: "\x1b[1m",
      red: "\x1b[31m",
      green: "\x1b[32m",
      yellow: "\x1b[33m",
      blue: "\x1b[34m",
      magenta: "\x1b[35m",
      cyan: "\x1b[36m",
      gray: "\x1b[90m",
    }
  : Object.fromEntries(["reset","dim","bold","red","green","yellow","blue","magenta","cyan","gray"].map(k => [k,""]));

const SYM = {
  ok:    supportsColor ? "✔" : "OK",
  fail:  supportsColor ? "✖" : "X",
  skip:  supportsColor ? "•" : "-",
  jump:  supportsColor ? "↳" : "->",
  dot:   supportsColor ? "·" : ".",
  play:  supportsColor ? "▶" : ">",
  stop:  supportsColor ? "■" : "#",
};

const CLEAR_MIN_INTERVAL_MS = 1000;
let __lastRenderAt = 0;

/***************************************************************
/* functionSignature: getPad (s, n)                           *
/* Returns string padded to length n                          *
/***************************************************************/
function getPad(s, n) {
  return String(s).padEnd(n, " ");
}

/***************************************************************
/* functionSignature: getTrunc (s, n)                         *
/* Returns string truncated to length n with ellipsis         *
/***************************************************************/
function getTrunc(s, n) {
  const str = String(s);
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

/***************************************************************
/* functionSignature: getFmtMs (n)                            *
/* Formats milliseconds                                       *
/***************************************************************/
function getFmtMs(n) {
  return `${n.toFixed(0)}ms`;
}

/***************************************************************
/* functionSignature: getFmtSec (n)                           *
/* Formats seconds                                            *
/***************************************************************/
function getFmtSec(n) {
  return `${n.toFixed(2)}s`;
}

/***************************************************************
/* functionSignature: getNowISO ()                            *
/* Returns current ISO timestamp                              *
/***************************************************************/
function getNowISO() {
  return new Date().toISOString();
}

/***************************************************************
/* functionSignature: getFmtMem (bytes)                       *
/* Formats bytes into human-readable memory size              *
/***************************************************************/
function getFmtMem(bytes) {
  const KB = 1024, MB = KB * 1024, GB = MB * 1024;
  if (bytes >= GB) return (bytes / GB).toFixed(2) + " GB";
  if (bytes >= MB) return (bytes / MB).toFixed(2) + " MB";
  if (bytes >= KB) return (bytes / KB).toFixed(2) + " KB";
  return bytes + " B";
}

/***************************************************************
/* functionSignature: getClearScreenHard ()                   *
/* Clears the terminal screen                                 *
/***************************************************************/
function getClearScreenHard() {
  if (!supportsClear) return;
  process.stdout.write("\x1b[2J\x1b[H");
}

/***************************************************************
/* functionSignature: setRenderWrite (s)                      *
/* Writes string to stdout                                    *
/***************************************************************/
function setRenderWrite(s) {
  process.stdout.write(s);
}

/***************************************************************
/* functionSignature: setRenderThrottled (s, force)           *
/* Renders with throttling at most once per second            *
/***************************************************************/
function setRenderThrottled(s, force = false) {
  const now = Date.now();
  if (!force && now - __lastRenderAt < CLEAR_MIN_INTERVAL_MS) return;
  __lastRenderAt = now;
  getClearScreenHard();
  setRenderWrite(s);
}

/***************************************************************
/* functionSignature: getDebounce (fn, ms)                    *
/* Returns a debounced wrapper                                *
/***************************************************************/
function getDebounce(fn, ms = 200) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/***************************************************************
/* functionSignature: getLoadJsonSafe (filePath)              *
/* Loads and validates a JSON file                            *
/***************************************************************/
function getLoadJsonSafe(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || !parsed) throw new Error("core.json is not an object");
  return parsed;
}

/***************************************************************
/* functionSignature: getInitCurrentBase ()                   *
/* Initializes the core base object                           *
/***************************************************************/
function getInitCurrentBase() {
  const base = getLoadJsonSafe(CORE_PATH);
  if (typeof base.workingObject !== "object" || !base.workingObject) base.workingObject = {};
  if (typeof base.config !== "object" || !base.config) base.config = {};
  return base;
}

let currentBase = getInitCurrentBase();

/***************************************************************
/* functionSignature: getStartHotReload ()                    *
/* Starts hot-reload watching core.json                       *
/***************************************************************/
function getStartHotReload() {
  const doReload = () => {
    try {
      const fresh = getLoadJsonSafe(CORE_PATH);
      if (typeof fresh.workingObject !== "object" || !fresh.workingObject) fresh.workingObject = {};
      if (typeof fresh.config !== "object" || !fresh.config) fresh.config = {};
      for (const k of Object.keys(currentBase)) delete currentBase[k];
      Object.assign(currentBase, fresh);
    } catch (err) {
      console.error(`${C.red}[${MODULE_NAME}] core.json reload error:${C.reset} ${err.message}`);
    }
  };
  const reload = getDebounce(doReload, 250);
  try { fs.watch(CORE_PATH, { persistent: true }, () => reload()); } catch (err) { console.error(`${C.red}[${MODULE_NAME}] fs.watch not available:${C.reset} ${err.message}`); }
  try { fs.watchFile(CORE_PATH, { interval: 500 }, () => reload()); } catch (err) { console.error(`${C.red}[${MODULE_NAME}] fs.watchFile not available:${C.reset} ${err.message}`); }
}
getStartHotReload();

/***************************************************************
/* functionSignature: getCloneJSON (x)                        *
/* Deep clones a JSON-compatible value                        *
/***************************************************************/
function getCloneJSON(x) {
  return JSON.parse(JSON.stringify(x));
}

/***************************************************************
/* functionSignature: getCreateRunCore ()                     *
/* Creates a fresh core object for a run                      *
/***************************************************************/
function getCreateRunCore() {
  return {
    config: currentBase.config,
    workingObject: getCloneJSON(currentBase.workingObject)
  };
}

/***************************************************************
/* functionSignature: getProgressBar (pct, width)             *
/* Builds a textual progress bar                              *
/***************************************************************/
function getProgressBar(pct, width = 28) {
  const p = Math.max(0, Math.min(1, pct || 0));
  const filled = Math.round(width * p);
  const empty = width - filled;
  return `${C.green}${"█".repeat(filled)}${C.gray}${"░".repeat(empty)}${C.reset} ${Math.round(p * 100)}%`;
}

/***************************************************************
/* functionSignature: getSep (ch)                             *
/* Returns a separator line                                   *
/***************************************************************/
function getSep(ch = "─") {
  return `${C.gray}${ch.repeat(60)}${C.reset}`;
}

/***************************************************************
/* functionSignature: getRenderDashboard (state)              *
/* Renders the live dashboard string                          *
/***************************************************************/
function getRenderDashboard(state) {
  const { flowName, startedAt, ok, fail, skip, total, current, perModule, stopped, phase, jumpActive } = state;
  const tNow = performance.now?.() ?? Date.now();
  const elapsedMs = tNow - startedAt;
  const mem = process.memoryUsage?.();
  const rss = mem?.rss ? getFmtMem(mem.rss) : "n/a";
  const heap = mem?.heapUsed ? getFmtMem(mem.heapUsed) : "n/a";
  const useVoice = state.useVoice ? `${C.green}on${C.reset}` : `${C.gray}off${C.reset}`;
  const header =
    `${C.bold}${C.cyan}Flow${C.reset} ${C.bold}${flowName}${C.reset}  ${C.gray}${getNowISO()}${C.reset}\n` +
    `${C.gray}${SYM.dot} useVoiceChannel:${C.reset} ${useVoice}\n`;
  const progPct = total > 0 ? (ok + fail + skip) / total : 0;
  const prog = getProgressBar(progPct);
  const statusColor = fail ? C.red : (stopped ? C.yellow : C.green);
  const statusText = fail ? "FAIL" : (stopped ? "STOP" : (phase === "done" ? "DONE" : "RUN"));
  const phaseText = jumpActive ? "jump≥9000" : phase;
  const summary =
    `${statusColor}${C.bold}${statusText}${C.reset}  ` +
    `${C.gray}(${ok} ok, ${fail} fail, ${skip} skip / ${total})  ` +
    `${getFmtSec(elapsedMs / 1000)}  ${C.gray}rss=${rss}, heap=${heap}${C.reset}\n`;
  const currentLine =
    `${C.blue}${SYM.play}${C.reset} ${C.bold}${getTrunc(current || (phaseText === "done" ? "—" : "…"), 38)}${C.reset}  ` +
    `${C.gray}${prog}${C.reset}\n`;
  const last = perModule.slice(-8).reverse();
  const rows = last.map(m => {
    const icon = m.ok === true ? `${C.green}${SYM.ok}${C.reset}` : (m.ok === false ? `${C.red}${SYM.fail}${C.reset}` : `${C.gray}${SYM.skip}${C.reset}`);
    const name = getPad(getTrunc(m.name, 28), 28);
    const kind = m.kind === "jump" ? `${C.magenta}${SYM.jump}${C.reset}` : " ";
    const ms = getFmtMs(m.ms || 0);
    const err = m.err ? `  ${C.red}${getTrunc(m.err, 40)}${C.reset}` : "";
    return ` ${icon} ${name} ${C.gray}${ms}${C.reset} ${kind}${err}`;
  }).join("\n");
  return [
    getSep(),
    header,
    getSep(),
    currentLine,
    summary,
    getSep("·"),
    `${C.yellow}Recent modules:${C.reset}`,
    rows || `${C.gray}(none yet)${C.reset}`,
    getSep()
  ].join("\n") + "\n";
}

/***************************************************************
/* functionSignature: getRunFlow (flowName, coreDataForRun)    *
/* Executes modules with a live dashboard                      *
/***************************************************************/
async function getRunFlow(flowName, coreDataForRun) {
  const coreData = coreDataForRun || getCreateRunCore();
  const modulesDir = path.join(__dirname, "modules");
  const moduleFiles = fs.readdirSync(modulesDir).filter(f => f.endsWith(".js")).sort();
  const slots = moduleFiles
    .map(f => {
      const m = f.match(/^(\d+)-.+\.js$/);
      return m ? { num: parseInt(m[1], 10), file: f } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.num - b.num);
  const normalList = slots.filter(s => s.num < 9000).filter(s => {
    const clean = s.file.replace(".js", "").replace(/^\d+-/, "");
    const flowCfg = coreData.config?.[clean];
    if (!flowCfg) return false;
    const flows = Array.isArray(flowCfg.flow) ? flowCfg.flow : [flowCfg.flow];
    return flows.includes(flowName) || flows.includes("all");
  });
  const jumpList = slots.filter(s => s.num >= 9000).filter(s => {
    const clean = s.file.replace(".js", "").replace(/^\d+-/, "");
    const flowCfg = coreData.config?.[clean];
    if (!flowCfg) return false;
    const flows = Array.isArray(flowCfg.flow) ? flowCfg.flow : [flowCfg.flow];
    return flows.includes(flowName) || flows.includes("all");
  });
  const state = {
    flowName,
    startedAt: performance.now?.() ?? Date.now(),
    ok: 0, fail: 0, skip: 0,
    total: normalList.length,
    current: "",
    perModule: [],
    stopped: false,
    phase: "run",
    jumpActive: false,
    useVoice: !!coreData?.workingObject?.useVoiceChannel,
  };
  setRenderThrottled(getRenderDashboard(state), true);

  /*************************************************************
  /* functionSignature: getRunModule (s, kind)                *
  /* Runs a single module file                                *
  /*************************************************************/
  async function getRunModule(s, kind = "normal") {
    const cleanName = s.file.replace(".js", "").replace(/^\d+-/, "");
    state.current = cleanName;
    setRenderThrottled(getRenderDashboard(state));
    const t0 = performance.now?.() ?? Date.now();
    try {
      const { default: fn } = await import(`./modules/${s.file}`);
      await fn(coreData);
      const dt = (performance.now?.() ?? Date.now()) - t0;
      state.perModule.push({ name: cleanName, kind, ok: true, ms: dt });
      if (kind === "normal") state.ok++;
    } catch (e) {
      const dt = (performance.now?.() ?? Date.now()) - t0;
      state.perModule.push({ name: cleanName, kind, ok: false, ms: dt, err: e?.message || String(e) });
      if (kind === "normal") state.fail++;
    }
    setRenderThrottled(getRenderDashboard(state));
  }

  for (const s of normalList) {
    await getRunModule(s, "normal");
    if (coreData?.workingObject?.stop === true) {
      state.stopped = true;
      break;
    }
  }

  if (jumpList.length) {
    state.phase = "jump";
    state.jumpActive = true;
    setRenderThrottled(getRenderDashboard(state));
    for (const s of jumpList) {
      await getRunModule(s, "jump");
    }
  }

  state.phase = "done";
  state.current = "";
  setRenderThrottled(getRenderDashboard(state), true);
  return coreData;
}

/***************************************************************
/* functionSignature: getStartFlows ()                        *
/* Loads and starts all flow entrypoints                      *
/***************************************************************/
async function getStartFlows() {
  const flowsDir = path.join(__dirname, "flows");
  const flowFiles = fs.readdirSync(flowsDir).filter(f => f.endsWith(".js"));
  for (const file of flowFiles) {
    const { default: fn } = await import(`./flows/${file}`);
    await fn(currentBase, runFlow, createRunCore);
  }
}

const runFlow = getRunFlow;
const createRunCore = getCreateRunCore;
export { runFlow, createRunCore };

await getStartFlows();
