/**************************************************************
/* filename: "getToken.js"                                    *
/* Version 1.0                                                *
/* Purpose: Accept image or video URL, convert videos to GIF, *
/*  then apply round crop with a single-color ring and return *
/*  public URLs for all artifacts                             *
/**************************************************************/

/**************************************************************
/* Version 1.0:  Standardized format, removed redundancies    *
/**************************************************************/

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/**************************************************************
/* functionSignature: setEnsureDir (absPath)                  *
/* Ensures a directory exists                                 *
/**************************************************************/
function setEnsureDir(absPath) {
  if (!fs.existsSync(absPath)) fs.mkdirSync(absPath, { recursive: true });
}

/**************************************************************
/* functionSignature: getRandSuffix ()                        *
/* Returns a short random lowercase base36 suffix              *
/**************************************************************/
function getRandSuffix() {
  const n = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, "0");
  return n.slice(-6);
}

/**************************************************************
/* functionSignature: getPublicUrl (base, filename)           *
/* Builds a public URL for a given filename                    *
/**************************************************************/
function getPublicUrl(base, filename) {
  if (!base) return `/documents/${filename}`;
  const trimmed = String(base).replace(/\/+$/, "");
  return `${trimmed}/documents/${filename}`;
}

/**************************************************************
/* functionSignature: getDownloadedBuffer (url)               *
/* Downloads a URL and returns buffer and content-type         *
/**************************************************************/
async function getDownloadedBuffer(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const ctype = res.headers.get("content-type") || "";
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, ctype };
}

/**************************************************************
/* functionSignature: getMediaKind (ctype, url)               *
/* Guesses whether the media is an image or a video            *
/**************************************************************/
function getMediaKind(ctype, url) {
  const c = String(ctype || "").toLowerCase();
  const u = String(url || "").toLowerCase();
  const isImage = c.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|tiff?)(\?|#|$)/.test(u);
  const isVideo = c.startsWith("video/") || /\.(mp4|webm|mov|m4v|mkv|mpg|mpeg)(\?|#|$)/.test(u);
  if (isVideo) return "video";
  if (isImage) return "image";
  return "unknown";
}

/**************************************************************
/* functionSignature: getImageExt (ctype, url)                *
/* Determines an appropriate image file extension              *
/**************************************************************/
function getImageExt(ctype, url) {
  const c = String(ctype || "").toLowerCase();
  const u = String(url || "").toLowerCase();
  if (c.includes("gif") || /\.gif(\?|#|$)/.test(u)) return ".gif";
  if (c.includes("png") || /\.png(\?|#|$)/.test(u)) return ".png";
  if (c.includes("webp") || /\.webp(\?|#|$)/.test(u)) return ".webp";
  if (c.includes("jpeg") || c.includes("jpg") || /\.(jpe?g)(\?|#|$)/.test(u)) return ".jpg";
  return ".png";
}

/**************************************************************
/* functionSignature: getRun (cmd, args, cwd)                 *
/* Runs a child process and resolves on success                *
/**************************************************************/
function getRun(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd });
    let stderr = "";
    p.stderr.on("data", d => { stderr += d.toString(); });
    p.on("error", e => reject(e));
    p.on("close", code => code === 0 ? resolve(true) : reject(new Error(stderr.trim() || `exit ${code}`)));
  });
}

/**************************************************************
/* functionSignature: getStrictCfg (wo)                       *
/* Builds a strict, validated configuration object             *
/**************************************************************/
function getStrictCfg(wo) {
  const MODULE_NAME = "getToken";
  const cfg = wo?.toolsconfig?.[MODULE_NAME] || {};
  const public_base_url = typeof cfg.public_base_url === "string" ? cfg.public_base_url : null;
  const magickPath = String(cfg.magickPath || "convert");
  const size = Number.isFinite(cfg.size) ? Math.max(64, Math.floor(cfg.size)) : 512;
  const border_px = Number.isFinite(cfg.border_px) ? Math.max(1, Math.floor(cfg.border_px)) : 10;
  const ffmpegPath = String(cfg.ffmpegPath || "ffmpeg");
  const maxMb = Number.isFinite(cfg.maxMb) ? Math.max(1, Math.floor(cfg.maxMb)) : 4;
  const fpsList = Array.isArray(cfg.fpsList) && cfg.fpsList.length ? cfg.fpsList.map(n => Math.max(4, Math.floor(n))) : [12, 10, 8];
  const scaleList = Array.isArray(cfg.scaleList) && cfg.scaleList.length ? cfg.scaleList.map(n => Math.max(128, Math.floor(n))) : [512, 384, 320];
  const maxColorsList = Array.isArray(cfg.maxColorsList) && cfg.maxColorsList.length ? cfg.maxColorsList.map(n => Math.max(2, Math.floor(n))) : [128, 96, 64, 48, 32];
  const ditherList = Array.isArray(cfg.ditherList) && cfg.ditherList.length ? cfg.ditherList.map(String) : [
    "bayer:bayer_scale=3:diff_mode=rectangle",
    "bayer:bayer_scale=5:diff_mode=rectangle",
    "none"
  ];
  const useGifsicleLossy = !!cfg.useGifsicleLossy;
  const gifsiclePath = String(cfg.gifsiclePath || "gifsicle");
  const gifsicleLossyLevels = Array.isArray(cfg.gifsicleLossyLevels) && cfg.gifsicleLossyLevels.length
    ? cfg.gifsicleLossyLevels.map(n => Math.max(20, Math.floor(n)))
    : [80, 100, 120];

  return {
    public_base_url, magickPath, size, border_px,
    ffmpegPath, maxMb, fpsList, scaleList,
    maxColorsList, ditherList, useGifsicleLossy, gifsiclePath, gifsicleLossyLevels
  };
}

/**************************************************************
/* functionSignature: getGeometry (size, ringPx)              *
/* Calculates geometry for circular masking and ring drawing   *
/**************************************************************/
function getGeometry(size, ringPx) {
  const CX = Math.floor(size / 2);
  const CY = CX;
  const R_MASK = CX - 1;
  const R_OUT = Math.max(1, R_MASK - 2);
  const R_DRAW = R_OUT;
  return { CX, CY, R_MASK, R_OUT, R_DRAW };
}

/**************************************************************
/* functionSignature: getGifWithinLimit (cfg, inAbs, outAbs,  *
/*  maxBytes)                                                 *
/* Creates a GIF under a byte budget using ffmpeg/gifsicle     *
/**************************************************************/
async function getGifWithinLimit(cfg, inAbs, outAbs, maxBytes) {
  for (const sc of cfg.scaleList) {
    for (const fps of cfg.fpsList) {
      for (const colors of cfg.maxColorsList) {
        for (const dither of cfg.ditherList) {
          const tmp = outAbs.replace(/\.gif$/i, `_${sc}w_${fps}fps_${colors}c.gif`);
          const palette = outAbs.replace(/\.gif$/i, `_${sc}w_${fps}fps_${colors}c_palette.png`);
          try {
            await getRun(cfg.ffmpegPath, [
              "-y", "-i", inAbs,
              "-vf", `fps=${fps},scale=${sc}:-1:flags=lanczos,palettegen=max_colors=${colors}`,
              palette
            ], path.dirname(inAbs));

            const useFilter = dither === "none"
              ? `fps=${fps},scale=${sc}:-1:flags=lanczos,paletteuse=diff_mode=rectangle`
              : `fps=${fps},scale=${sc}:-1:flags=lanczos,paletteuse=dither=${dither}`;

            await getRun(cfg.ffmpegPath, [
              "-y", "-i", inAbs, "-i", palette,
              "-lavfi", useFilter,
              "-loop", "0",
              tmp
            ], path.dirname(inAbs));
          } catch (_) {
            try { fs.unlinkSync(tmp); } catch {}
            try { fs.unlinkSync(palette); } catch {}
            continue;
          }
          try { fs.unlinkSync(palette); } catch {}

          let candidate = tmp;
          if (cfg.useGifsicleLossy) {
            for (const q of cfg.gifsicleLossyLevels) {
              const lossyTmp = tmp.replace(/\.gif$/i, `_lossy${q}.gif`);
              try {
                await getRun(cfg.gifsiclePath, ["-O3", `--lossy=${q}`, "-o", lossyTmp, tmp], path.dirname(inAbs));
                try {
                  const stLossy = fs.statSync(lossyTmp);
                  if (stLossy.size <= maxBytes) {
                    fs.renameSync(lossyTmp, outAbs);
                    try { fs.unlinkSync(tmp); } catch {}
                    return true;
                  }
                } catch {}
                try { fs.unlinkSync(lossyTmp); } catch {}
              } catch {}
            }
          }

          try {
            const st = fs.statSync(candidate);
            if (st.size <= maxBytes) {
              fs.renameSync(candidate, outAbs);
              return true;
            }
          } catch {}

          try { fs.unlinkSync(candidate); } catch {}
        }
      }
    }
  }
  return false;
}

/**************************************************************
/* functionSignature: setTokenizeStatic (cfg, inAbs, outAbs,  *
/*  size, ringColor, ringPx)                                  *
/* Tokenizes a static image with round mask and ring           *
/**************************************************************/
async function setTokenizeStatic(cfg, inAbs, outAbs, size, ringColor, ringPx) {
  const { CX, CY, R_MASK, R_DRAW } = getGeometry(size, ringPx);
  const args = [
    inAbs,
    "-alpha", "on",
    "-resize", `${size}x${size}^`,
    "-gravity", "center",
    "-extent", `${size}x${size}`,
    "(",
      "-size", `${size}x${size}`,
      "xc:none",
      "-fill", "white",
      "-draw", `circle ${CX},${CY} ${CX},${CY - R_MASK}`,
    ")",
    "-compose", "CopyOpacity",
    "-composite",
    "-alpha", "on",
    "-stroke", ringColor,
    "-strokewidth", String(ringPx),
    "-fill", "none",
    "-draw", `circle ${CX},${CY} ${CX + R_DRAW},${CY}`,
    outAbs
  ];
  await getRun(cfg.magickPath, args, path.dirname(outAbs));
}

/**************************************************************
/* functionSignature: setTokenizeAnimated (cfg, inAbs, outAbs,*
/*  size, ringColor, ringPx)                                  *
/* Tokenizes an animated image (GIF) with round mask and ring  *
/**************************************************************/
async function setTokenizeAnimated(cfg, inAbs, outAbs, size, ringColor, ringPx) {
  const { CX, CY, R_MASK, R_DRAW } = getGeometry(size, ringPx);
  const args = [
    inAbs,
    "-coalesce",
    "-alpha", "on",
    "-resize", `${size}x${size}^`,
    "-gravity", "center",
    "-extent", `${size}x${size}`,
    "null:",
    "(",
      "-size", `${size}x${size}`,
      "xc:none",
      "-fill", "white",
      "-draw", `circle ${CX},${CY} ${CX},${CY - R_MASK}`,
    ")",
    "-compose", "CopyOpacity",
    "-layers", "Composite",
    "null:",
    "(",
      "-size", `${size}x${size}`, "xc:none", "-alpha", "on",
      "-stroke", ringColor, "-strokewidth", String(ringPx), "-fill", "none",
      "-draw", `circle ${CX},${CY} ${CX + R_DRAW},${CY}`,
    ")",
    "-compose", "Over", "-layers", "Composite",
    "-set", "dispose", "previous",
    "-define", "gif:loop=0",
    "-layers", "Optimize",
    outAbs
  ];
  await getRun(cfg.magickPath, args, path.dirname(outAbs));
}

/**************************************************************
/* functionSignature: getInvoke (args, coreData)              *
/* Main entry: downloads media, converts if needed, tokenizes  *
/**************************************************************/
async function getInvoke(args, coreData) {
  const MODULE_NAME = "getToken";
  const wo = coreData?.workingObject || {};
  const cfg = getStrictCfg(wo);
  const url = String(args?.url || "").trim();
  const ringColor = String(args?.color1 || "#00b3ff").trim();
  if (!url) return { ok: false, error: "Missing 'url'" };

  const { buf, ctype } = await getDownloadedBuffer(url);
  const kind = getMediaKind(ctype, url);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const documentsDir = path.join(__dirname, "..", "pub", "documents");
  setEnsureDir(documentsDir);

  if (kind === "video") {
    const inName = `vid_${Date.now()}_${getRandSuffix()}.bin`;
    const inAbs = path.join(documentsDir, inName);
    fs.writeFileSync(inAbs, buf);

    const gifName = `gif_${Date.now()}_${getRandSuffix()}.gif`;
    const gifAbs = path.join(documentsDir, gifName);
    const maxBytes = cfg.maxMb * 1024 * 1024;
    const okGif = await getGifWithinLimit(cfg, inAbs, gifAbs, maxBytes);
    if (!okGif) return { ok: false, error: "Could not compress GIF under size limit" };

    const tokenName = `token_${Date.now()}_${getRandSuffix()}.gif`;
    const tokenAbs = path.join(documentsDir, tokenName);
    await setTokenizeAnimated(cfg, gifAbs, tokenAbs, cfg.size, ringColor, cfg.border_px);

    return {
      ok: true,
      kind: "video",
      original: {
        filename: inName,
        path: inAbs,
        url: getPublicUrl(cfg.public_base_url, inName),
        mime: "application/octet-stream"
      },
      intermediate: {
        filename: gifName,
        path: gifAbs,
        url: getPublicUrl(cfg.public_base_url, gifName),
        mime: "image/gif"
      },
      output: {
        filename: tokenName,
        path: tokenAbs,
        url: getPublicUrl(cfg.public_base_url, tokenName),
        mime: "image/gif",
        ring_color: ringColor
      }
    };
  }

  if (kind === "image") {
    const ext = getImageExt(ctype, url);
    const inName = `img_${Date.now()}_${getRandSuffix()}${ext}`;
    const inAbs = path.join(documentsDir, inName);
    fs.writeFileSync(inAbs, buf);

    const isGif = /\.gif$/i.test(inName);

    if (isGif) {
      const tokenName = `token_${Date.now()}_${getRandSuffix()}.gif`;
      const tokenAbs = path.join(documentsDir, tokenName);
      await setTokenizeAnimated(cfg, inAbs, tokenAbs, cfg.size, ringColor, cfg.border_px);
      return {
        ok: true,
        kind: "image-animated",
        original: {
          filename: inName,
          path: inAbs,
          url: getPublicUrl(cfg.public_base_url, inName),
          mime: "image/gif"
        },
        output: {
          filename: tokenName,
          path: tokenAbs,
          url: getPublicUrl(cfg.public_base_url, tokenName),
          mime: "image/gif",
          ring_color: ringColor
        }
      };
    } else {
      const tokenName = `token_${Date.now()}_${getRandSuffix()}.png`;
      const tokenAbs = path.join(documentsDir, tokenName);
      await setTokenizeStatic(cfg, inAbs, tokenAbs, cfg.size, ringColor, cfg.border_px);
      const origMime = /\.png$/i.test(inName) ? "image/png" :
                       /\.jpe?g$/i.test(inName) ? "image/jpeg" :
                       /\.webp$/i.test(inName) ? "image/webp" :
                       /\.bmp$/i.test(inName) ? "image/bmp" : "application/octet-stream";
      return {
        ok: true,
        kind: "image-static",
        original: {
          filename: inName,
          path: inAbs,
          url: getPublicUrl(cfg.public_base_url, inName),
          mime: origMime
        },
        output: {
          filename: tokenName,
          path: tokenAbs,
          url: getPublicUrl(cfg.public_base_url, tokenName),
          mime: "image/png",
          ring_color: ringColor
        }
      };
    }
  }

  return { ok: false, error: "Unsupported media type" };
}

const MODULE_NAME = "getToken";

/**************************************************************
/* functionSignature: getExport ()                            *
/* Provides the tool export definition                         *
/**************************************************************/
function getExport() {
  return {
    name: MODULE_NAME,
    definition: {
      type: "function",
      function: {
        name: MODULE_NAME,
        description:
          "Accept an image or video URL. Videos are converted to an animated GIF (size limited by toolsconfig). Then the media is tokenized: round mask + single-color ring (color1). Returns hosted URLs under /documents.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "Public image or video URL." },
            color1: { type: "string", description: "Ring color (CSS/hex). Optional. Default #00b3ff." }
          },
          required: ["url"],
          additionalProperties: false
        }
      }
    },
    invoke: getInvoke
  };
}

export default getExport();
