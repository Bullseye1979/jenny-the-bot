/***************************************************************
/* filename: "getDiscordAvatar.js"                             *
/* Version 1.0                                                 *
/* Purpose: Download an image URL and store it as              *
/*          ./pub/documents/avatars/<channelId>.png and return *
/*          the public URL based on toolsconfig                *
/***************************************************************/
/***************************************************************
/*                                                             *
/***************************************************************/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fetch from "node-fetch";

const MODULE_NAME = "getDiscordAvatar";

/***************************************************************
/* functionSignature: setEnsureDir (absPath)                   *
/* Ensures the directory exists (recursive create)             *
/***************************************************************/
function setEnsureDir(absPath) {
  if (!fs.existsSync(absPath)) fs.mkdirSync(absPath, { recursive: true });
}

/***************************************************************
/* functionSignature: getTrimTrailingSlashes (s)               *
/* Returns the string without trailing slashes                 *
/***************************************************************/
function getTrimTrailingSlashes(s) {
  return String(s || "").replace(/\/+$/, "");
}

/***************************************************************
/* functionSignature: getInvoke (args, coreData)               *
/* Downloads, stores avatar file, and returns its public URL   *
/***************************************************************/
async function getInvoke(args, coreData) {
  try {
    const imageUrl = String(args?.image_url || "").trim();
    const channelId = String(args?.channel_id || "").trim();
    if (!imageUrl) return { ok: false, error: "Missing parameter: image_url" };
    if (!channelId) return { ok: false, error: "Missing parameter: channel_id" };

    const wo = coreData?.workingObject || {};
    const tc = wo?.toolsconfig || {};
    const publicBaseUrl =
      tc?.getDiscordAvatar?.public_base_url ||
      tc?.getImage?.public_base_url ||
      null;

    if (!publicBaseUrl) {
      return {
        ok: false,
        error:
          "Missing toolsconfig public_base_url (getDiscordAvatar.public_base_url or getImage.public_base_url)",
      };
    }

    const res = await fetch(imageUrl);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return {
        ok: false,
        error: `HTTP ${res.status} ${res.statusText}`,
        details: txt.slice(0, 300) || undefined,
      };
    }
    const buf = Buffer.from(await res.arrayBuffer());

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const avatarsDir = path.join(__dirname, "..", "pub", "documents", "avatars");
    setEnsureDir(avatarsDir);

    const filename = `${channelId}.png`;
    const absPath = path.join(avatarsDir, filename);

    try { fs.rmSync(absPath, { force: true }); } catch {}
    const tmpPath = `${absPath}.tmp-${Date.now()}`;
    fs.writeFileSync(tmpPath, buf, { flag: "w" });
    fs.renameSync(tmpPath, absPath);

    const url = `${getTrimTrailingSlashes(publicBaseUrl)}/documents/avatars/${filename}`;
    return { ok: true, url, path: absPath, filename, overwritten: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export default {
  name: MODULE_NAME,
  definition: {
    type: "function",
    function: {
      name: MODULE_NAME,
      description: "Set the picture under the provided URL as avatar for the discord channel",
      parameters: {
        type: "object",
        properties: {
          image_url: { type: "string", description: "Absolute URL of the image" },
          channel_id: {
            type: "string",
            description: "Discord channel ID used as the avatar filename (<channelId>.png)."
          }
        },
        required: ["image_url", "channel_id"],
        additionalProperties: false
      }
    }
  },
  invoke: getInvoke
};
