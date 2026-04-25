/**************************************************************/
/* filename: "getText.js"                                           */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/







import { saveFile } from "../core/file.js";

const MODULE_NAME = "getText";


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


function getParsedArgs(args){
  if (args && typeof args === "object" && !Array.isArray(args)) {
    return {
      text: String(args.text || "").trim(),
      filename: String(args.filename || "").trim()
    };
  }
  return {
    text: String(args || "").trim(),
    filename: ""
  };
}


async function setWrittenTextFile(text, baseName, ext, wo){
  const saved = await saveFile(wo, Buffer.from(text, "utf8"), { name: baseName, ext: "." + ext });
  return { filePath: saved.absPath, fileName: saved.filename, publicUrl: saved.url };
}


async function getInvoke(args, coreData){
  try {
    const wo = coreData?.workingObject || {};

    const { text, filename } = getParsedArgs(args);
    if (!text) {
      return { ok: false, error: "GET_TEXT_INPUT — Missing 'text'." };
    }

    const baseName = getNormalizedFilename(
      filename && !/\.[a-z0-9]+$/i.test(filename) ? filename : filename?.split(".")[0],
      "text"
    );

    const ext = getDetectedExt(text, filename);

    const { filePath, fileName, publicUrl } = await setWrittenTextFile(text, baseName, ext, wo);

    return {
      ok: true,
      file: publicUrl || filePath,
      filename: fileName,
      ext,
      bytes: Buffer.byteLength(text, "utf8")
    };
  } catch (err) {
    return { ok: false, error: "GET_TEXT_UNEXPECTED — Could not save text." };
  }
}




export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
