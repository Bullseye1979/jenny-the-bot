/***************************************************************
/* filename: "main.js"                                         *
/* Version 1.0                                                  *
/* Purpose: Per-run core with hot-reload; builds run data and   *
/*          executes modules with stop→output jump.             *
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

/***************************************************************
/* functionSignature: getDebounce (fn, ms)                     *
/* Creates a debounced wrapper                                 *
/***************************************************************/
function getDebounce(fn, ms = 200) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/***************************************************************
/* functionSignature: getLoadJsonSafe (filePath)               *
/* Loads and validates a JSON file                             *
/***************************************************************/
function getLoadJsonSafe(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || !parsed) throw new Error("core.json is not an object");
  return parsed;
}

let currentBase = (() => {
  const base = getLoadJsonSafe(CORE_PATH);
  if (typeof base.workingObject !== "object" || !base.workingObject) base.workingObject = {};
  if (typeof base.config !== "object" || !base.config) base.config = {};
  return base;
})();

/***************************************************************
/* functionSignature: getStartHotReload ()                     *
/* Starts hot-reload for core.json                             *
/***************************************************************/
function getStartHotReload() {
  const doReload = () => {
    try {
      const fresh = getLoadJsonSafe(CORE_PATH);
      if (typeof fresh.workingObject !== "object" || !fresh.workingObject) fresh.workingObject = {};
      if (typeof fresh.config !== "object" || !fresh.config) fresh.config = {};
      for (const k of Object.keys(currentBase)) delete currentBase[k];
      Object.assign(currentBase, fresh);
      console.log(`[${MODULE_NAME}] 🔄 core.json reloaded. useVoiceChannel =`, currentBase?.workingObject?.useVoiceChannel);
    } catch (err) {
      console.error(`[${MODULE_NAME}] Failed to reload core.json:`, err.message);
    }
  };
  const reload = getDebounce(doReload, 250);
  try {
    fs.watch(CORE_PATH, { persistent: true }, () => reload());
  } catch (err) {
    console.error(`[${MODULE_NAME}] fs.watch not available:`, err.message);
  }
  try {
    fs.watchFile(CORE_PATH, { interval: 500 }, () => reload());
  } catch (err) {
    console.error(`[${MODULE_NAME}] fs.watchFile not available:`, err.message);
  }
}
getStartHotReload();

/***************************************************************
/* functionSignature: getCloneJSON (x)                         *
/* Performs a structured clone via JSON                        *
/***************************************************************/
function getCloneJSON(x) {
  return JSON.parse(JSON.stringify(x));
}

/***************************************************************
/* functionSignature: createRunCore ()                         *
/* Creates a fresh run core snapshot                           *
/***************************************************************/
export function createRunCore() {
  return {
    config: currentBase.config,
    workingObject: getCloneJSON(currentBase.workingObject)
  };
}

/***************************************************************
/* functionSignature: runFlow (flowName, coreDataForRun)       *
/* Runs modules for a flow; supports stop→output jump          *
/***************************************************************/
export async function runFlow(flowName, coreDataForRun) {
  const coreData = coreDataForRun || createRunCore();
  const modulesDir  = path.join(__dirname, "modules");
  const moduleFiles = fs.readdirSync(modulesDir).filter(f => f.endsWith(".js")).sort();

  /*************************************************************
  /* functionSignature: getRunModuleFile (file)                *
  /* Dynamically imports and executes a module                 *
  /*************************************************************/
  async function getRunModuleFile(file) {
    const { default: fn } = await import(`./modules/${file}`);
    await fn(coreData);
  }

  /*************************************************************
  /* functionSignature: getJumpToOutputAndEnd ()               *
  /* Executes output module when stop is set                   *
  /*************************************************************/
  async function getJumpToOutputAndEnd() {
    let outFile = moduleFiles.find(f => /^10000-.*\.js$/.test(f));
    if (!outFile) {
      outFile = moduleFiles.find(f => f.replace(/^\d+-/, "").replace(/\.js$/, "") === "output");
    }
    if (outFile) {
      try {
        await getRunModuleFile(outFile);
      } catch (e) {
        console.error(`[${MODULE_NAME}] Jumped output module failed: ${e.message}`);
      }
    } else {
      console.warn(`[${MODULE_NAME}] stop flag set, but 10000-output not found — nothing to jump to.`);
    }
  }

  for (const file of moduleFiles) {
    const cleanName = file.replace(".js", "").replace(/^\d+-/, "");
    const flowCfg   = coreData.config?.[cleanName];
    if (!flowCfg) continue;
    const flows = Array.isArray(flowCfg.flow) ? flowCfg.flow : [flowCfg.flow];
    if (!flows.includes(flowName) && !flows.includes("all")) continue;
    try {
      await getRunModuleFile(file);
    } catch (err) {
      console.error(`[${MODULE_NAME}] Module ${cleanName} failed: ${err.message}`);
    }
    if (coreData?.workingObject?.stop === true) {
      await getJumpToOutputAndEnd();
      return coreData;
    }
  }

  return coreData;
}

/***************************************************************
/* functionSignature: getStartFlows ()                         *
/* Loads and starts all flows                                  *
/***************************************************************/
async function getStartFlows() {
  const flowsDir  = path.join(__dirname, "flows");
  const flowFiles = fs.readdirSync(flowsDir).filter(f => f.endsWith(".js"));
  for (const file of flowFiles) {
    const { default: fn } = await import(`./flows/${file}`);
    await fn(currentBase, runFlow, createRunCore);
  }
}

await getStartFlows();
