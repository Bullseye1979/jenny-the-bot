/**********************************************************************************/
/* filename: getText.js                                                            *
/* Version 1.0                                                                     *
/* Purpose: Toolcall-ready saver for arbitrary plaintext into ../pub/documents     *
/*          with a guessed extension.                                              *
/**********************************************************************************/

import { saveFile } from "../core/file.js";

const MODULE_NAME = "getText";

/**********************************************************************************/
/* functionSignature: getLogDebug (label, obj)                                     *
/* Silent debug helper                                                             *
/**********************************************************************************/
function getLogDebug(label, obj){}

/**********************************************************************************/
/* functionSignature: getNormalizedFilename (s, fallback)                          *
/* Returns fs-safe lowercased base filename without extension                      *
/**********************************************************************************/
function getNormalizedFilename(s, fallback = ""){
  const base = String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (base) return base;
  return (
    fallback ||
    "text-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  );
}

/**********************************************************************************/
/* functionSignature: getDetectedExt (text, filename)                              *
/* Guesses a file extension from content or given name                             *
/**********************************************************************************/
function getDetectedExt(text, filename){
  if (filename && /\.[a-z0-9]+$/i.test(filename)) {
    return filename.split(".").pop().toLowerCase();
  }

  const s = String(text || "").trim();

  if (s.startsWith("<!DOCTYPE html") || s.toLowerCase().startsWith("<html")) return "html";
  if (s.startsWith("<?xml") || s.startsWith("<xml")) return "xml";
  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) return "json";
  if (s.startsWith("#!")) {
    if (s.includes("python")) return "py";
    if (s.includes("node") || s.includes("nodejs")) return "js";
    return "sh";
  }
  if (/function\s+[a-zA-Z0-9_]+\s*\(/.test(s) || /const\s+[a-zA-Z0-9_]+\s*=/.test(s)) return "js";
  if (/^def\s+[A-Za-z0-9_]+\s*\(/m.test(s) || /^class\s+[A-Za-z0-9_]+\s*:/m.test(s)) return "py";
  if (/^[\t ]*\.[a-z0-9_-]+\s*\{/m.test(s) || /^body\s*\{/m.test(s)) return "css";
  if (s.includes("WScript.") || s.toLowerCase().includes("msgbox")) return "vbs";

  return "txt";
}

/**********************************************************************************/
/* functionSignature: getParsedArgs (args)                                         *
/* Accepts { text, dateiname } or raw string                                       *
/**********************************************************************************/
function getParsedArgs(args){
  if (args && typeof args === "object" && !Array.isArray(args)) {
    return {
      text: String(args.text || "").trim(),
      dateiname: String(args.dateiname || "").trim()
    };
  }
  return {
    text: String(args || "").trim(),
    dateiname: ""
  };
}

/**********************************************************************************/
/* functionSignature: setWrittenTextFile (text, baseName, ext, cfg, wo)            *
/* Writes text to pub/documents/{userId}/ and returns URLs                         *
/**********************************************************************************/
async function setWrittenTextFile(text, baseName, ext, cfg, wo){
  const saved = await saveFile(wo, Buffer.from(text, "utf8"), { name: baseName, ext: "." + ext });
  return { filePath: saved.absPath, fileName: saved.filename, publicUrl: saved.url };
}

/**********************************************************************************/
/* functionSignature: getInvoke (args, coreData)                                   *
/* Entry point for toolcall                                                        *
/**********************************************************************************/
async function getInvoke(args, coreData){
  try {
    const wo = coreData?.workingObject || {};
    const cfg = wo?.toolsconfig?.getText || {};

    const { text, dateiname } = getParsedArgs(args);
    if (!text) {
      return { ok: false, error: "GET_TEXT_INPUT — Missing 'text'." };
    }

    const baseName = getNormalizedFilename(
      dateiname && !/\.[a-z0-9]+$/i.test(dateiname) ? dateiname : dateiname?.split(".")[0],
      "text"
    );

    const ext = getDetectedExt(text, dateiname);

    const { filePath, fileName, publicUrl } = await setWrittenTextFile(text, baseName, ext, cfg, wo);

    return {
      ok: true,
      file: publicUrl || filePath,
      filename: fileName,
      ext,
      bytes: Buffer.byteLength(text, "utf8")
    };
  } catch (err) {
    getLogDebug("GET_TEXT_ERROR", err?.stack || String(err));
    return { ok: false, error: "GET_TEXT_UNEXPECTED — Could not save text." };
  }
}

/**********************************************************************************/
/* export default (tool def)                                                       *
/**********************************************************************************/
export default {
  name: MODULE_NAME,
  definition: {
    type: "function",
    function: {
      name: MODULE_NAME,
      description: "Save arbitrary plaintext (js, html, css, json, xml, txt, vbs, py, …) to ../pub/documents with a guessed extension. Returns public/relative file path.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: {
            type: "string",
            description: "Plaintext content to write. Can be code, HTML, JSON, etc."
          },
          dateiname: {
            type: "string",
            description: "Optional desired base filename. May include extension. If omitted, name is auto-generated."
          }
        },
        required: ["text"]
      }
    }
  },
  invoke: getInvoke
};
