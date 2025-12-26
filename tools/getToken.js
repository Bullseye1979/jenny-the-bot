/**************************************************************/
/* filename: "getToken.js"                                    */
/* Version: 1.0                                               */
/* Purpose: Accept an image or video URL, convert videos to    */
/*  GIF, apply a circular mask plus a single-color ring, and   */
/*  return public URLs for all artifacts. Supports ping-pong   */
/*  playback for animated outputs and enforces final GIF size. */
/**************************************************************/

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/**************************************************************/
/* functionSignature: setEnsureDir (absPath)                  */
/* Ensures a directory exists                                 */
/**************************************************************/
function setEnsureDir(absPath) {
  if (!fs.existsSync(absPath)) fs.mkdirSync(absPath, { recursive: true });
}

/**************************************************************/
/* functionSignature: getRandSuffix ()                        */
/* Returns a short random lowercase base36 suffix              */
/**************************************************************/
function getRandSuffix() {
  const n = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, "0");
  return n.slice(-6);
}

/**************************************************************/
/* functionSignature: getPublicUrl (base, filename)           */
/* Builds a public URL for a given filename                    */
/**************************************************************/
function getPublicUrl(base, filename) {
  if (!base) return `/documents/${filename}`;
  const trimmed = String(base).replace(/\/+$/, "");
  return `${trimmed}/documents/${filename}`;
}

/**************************************************************/
/* functionSignature: getCleanString (v)                      */
/* Returns trimmed string or empty string for null/undefined   */
/**************************************************************/
function getCleanString(v) {
  if (typeof v !== "string") return "";
  const s = v.trim();
  if (!s) return "";
  if (s.toLowerCase() === "undefined") return "";
  if (s.toLowerCase() === "null") return "";
  return s;
}

/**************************************************************/
/* functionSignature: getBool (v)                             */
/* Parses boolean-ish values safely                            */
/**************************************************************/
function getBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes" || s === "y" || s === "on") return true;
    if (s === "false" || s === "0" || s === "no" || s === "n" || s === "off") return false;
  }
  return false;
}

/**************************************************************/
/* functionSignature: getIsHttpUrl (s)                        */
/* Validates basic http/https URL                              */
/**************************************************************/
function getIsHttpUrl(s) {
  if (typeof s !== "string") return false;
  if (!/^https?:\/\//i.test(s)) return false;
  return true;
}

/**************************************************************/
/* functionSignature: getDownloadedBuffer (url)               */
/* Downloads a URL and returns buffer and content-type         */
/**************************************************************/
async function getDownloadedBuffer(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const ctype = res.headers.get("content-type") || "";
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, ctype };
}

/**************************************************************/
/* functionSignature: getMediaKind (ctype, url)               */
/* Guesses whether the media is an image or a video            */
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

/**************************************************************/
/* functionSignature: getImageExt (ctype, url)                */
/* Determines an appropriate image file extension              */
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

/**************************************************************/
/* functionSignature: getRun (cmd, args, cwd)                 */
/* Runs a child process and resolves on success                */
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

/**************************************************************/
/* functionSignature: getStrictCfg (wo)                       */
/* Builds a strict, validated configuration object             */
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

/**************************************************************/
/* functionSignature: getGeometry (size, ringPx)              */
/* Calculates geometry for circular masking and ring drawing   */
/**************************************************************/
function getGeometry(size, ringPx) {
  const CX = Math.floor(size / 2);
  const CY = CX;
  const R_MASK = CX - 1;
  const R_OUT = Math.max(1, R_MASK - 2);
  const R_DRAW = R_OUT;
  return { CX, CY, R_MASK, R_OUT, R_DRAW };
}

/**************************************************************/
/* functionSignature: getEffectiveMaxBytes (cfg, pingpong)    */
/* Returns effective byte budget (scaled when pingpong=true)   */
/**************************************************************/
function getEffectiveMaxBytes(cfg, pingpong) {
  const base = cfg.maxMb * 1024 * 1024;
  return pingpong ? (base * 2) : base;
}

/**************************************************************/
/* functionSignature: setOptimizeGifWithinLimit (cfg, inAbs,  */
/*  outAbs, maxBytes)                                         */
/* Optimizes (and optionally lossy-compresses) a GIF to fit    */
/* under maxBytes using gifsicle                               */
/**************************************************************/
async function setOptimizeGifWithinLimit(cfg, inAbs, outAbs, maxBytes) {
  try {
    const st0 = fs.statSync(inAbs);
    if (st0.size <= maxBytes) {
      if (inAbs !== outAbs) fs.renameSync(inAbs, outAbs);
      return true;
    }
  } catch {
    return false;
  }

  const dir = path.dirname(outAbs);
  const base = path.basename(outAbs, ".gif");
  const optTmp = path.join(dir, `${base}_opt_${getRandSuffix()}.gif`);

  try {
    await getRun(cfg.gifsiclePath, ["-O3", "-o", optTmp, inAbs], dir);
    try {
      const st = fs.statSync(optTmp);
      if (st.size <= maxBytes) {
        try { fs.unlinkSync(inAbs); } catch {}
        fs.renameSync(optTmp, outAbs);
        return true;
      }
    } catch {}
  } catch {}

  try { fs.unlinkSync(optTmp); } catch {}

  if (cfg.useGifsicleLossy) {
    for (const q of cfg.gifsicleLossyLevels) {
      const lossyTmp = path.join(dir, `${base}_lossy${q}_${getRandSuffix()}.gif`);
      try {
        await getRun(cfg.gifsiclePath, ["-O3", `--lossy=${q}`, "-o", lossyTmp, inAbs], dir);
        try {
          const stL = fs.statSync(lossyTmp);
          if (stL.size <= maxBytes) {
            try { fs.unlinkSync(inAbs); } catch {}
            fs.renameSync(lossyTmp, outAbs);
            return true;
          }
        } catch {}
      } catch {}

      try { fs.unlinkSync(lossyTmp); } catch {}
    }
  }

  return false;
}

/**************************************************************/
/* functionSignature: getGifWithinLimit (cfg, inAbs, outAbs,  */
/*  maxBytes)                                                 */
/* Creates a GIF under a byte budget using ffmpeg/gifsicle     */
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
          } catch {
            try { fs.unlinkSync(tmp); } catch {}
            try { fs.unlinkSync(palette); } catch {}
            continue;
          }

          try { fs.unlinkSync(palette); } catch {}

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
            const st = fs.statSync(tmp);
            if (st.size <= maxBytes) {
              fs.renameSync(tmp, outAbs);
              return true;
            }
          } catch {}

          try { fs.unlinkSync(tmp); } catch {}
        }
      }
    }
  }
  return false;
}

/**************************************************************/
/* functionSignature: setTokenizeStatic (cfg, inAbs, outAbs,  */
/*  size, ringColor, ringPx)                                  */
/* Tokenizes a static image with a round mask and ring         */
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

/**************************************************************/
/* functionSignature: setTokenizeAnimated (cfg, inAbs, outAbs,*/
/*  size, ringColor, ringPx, pingpong)                        */
/* Tokenizes an animated GIF with a round mask and ring. If   */
/* pingpong=true, appends a reversed copy of frames for        */
/* forward+reverse playback, then loops.                       */
/**************************************************************/
async function setTokenizeAnimated(cfg, inAbs, outAbs, size, ringColor, ringPx, pingpong) {
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
    "-compose", "Over", "-layers", "Composite"
  ];

  if (pingpong) {
    args.push(
      "(",
        "-clone", "0--1",
        "-reverse",
      ")"
    );
  }

  args.push(
    "-set", "dispose", "previous",
    "-define", "gif:loop=0",
    "-layers", "Optimize",
    outAbs
  );

  await getRun(cfg.magickPath, args, path.dirname(outAbs));
}

/**************************************************************/
/* functionSignature: getInvoke (args, coreData)              */
/* Main entry: downloads media, converts if needed, tokenizes  */
/**************************************************************/
async function getInvoke(args, coreData) {
  const MODULE_NAME = "getToken";
  const wo = coreData?.workingObject || {};
  const cfg = getStrictCfg(wo);

  const url = getCleanString(args?.url);
  const ringColor = getCleanString(args?.color1) || "#00b3ff";
  const pingpong = getBool(args?.pingpong);

  if (!url) return { ok: false, error: "Missing 'url'." };
  if (!getIsHttpUrl(url)) return { ok: false, error: "URL must start with http:// or https://." };

  const effectiveMaxBytes = getEffectiveMaxBytes(cfg, pingpong);

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

    const tokenName = `token_${Date.now()}_${getRandSuffix()}.gif`;
    const tokenAbs = path.join(documentsDir, tokenName);

    const tryBudgets = [
      effectiveMaxBytes,
      Math.floor(effectiveMaxBytes * 0.90),
      Math.floor(effectiveMaxBytes * 0.80),
      Math.floor(effectiveMaxBytes * 0.70)
    ];

    let chosenGifName = null;
    let chosenGifAbs = null;
    let okFinal = false;

    for (const budget of tryBudgets) {
      const gifName = `gif_${Date.now()}_${getRandSuffix()}.gif`;
      const gifAbs = path.join(documentsDir, gifName);

      const okGif = await getGifWithinLimit(cfg, inAbs, gifAbs, budget);
      if (!okGif) {
        try { fs.unlinkSync(gifAbs); } catch {}
        continue;
      }

      const tokenTmpName = `token_tmp_${Date.now()}_${getRandSuffix()}.gif`;
      const tokenTmpAbs = path.join(documentsDir, tokenTmpName);

      try {
        await setTokenizeAnimated(cfg, gifAbs, tokenTmpAbs, cfg.size, ringColor, cfg.border_px, pingpong);
      } catch {
        try { fs.unlinkSync(gifAbs); } catch {}
        try { fs.unlinkSync(tokenTmpAbs); } catch {}
        continue;
      }

      try {
        const st = fs.statSync(tokenTmpAbs);
        if (st.size <= effectiveMaxBytes) {
          fs.renameSync(tokenTmpAbs, tokenAbs);
          chosenGifName = gifName;
          chosenGifAbs = gifAbs;
          okFinal = true;
          break;
        }
      } catch {}

      const okOpt = await setOptimizeGifWithinLimit(cfg, tokenTmpAbs, tokenAbs, effectiveMaxBytes);
      if (okOpt) {
        chosenGifName = gifName;
        chosenGifAbs = gifAbs;
        okFinal = true;
        break;
      }

      try { fs.unlinkSync(gifAbs); } catch {}
      try { fs.unlinkSync(tokenTmpAbs); } catch {}
    }

    if (!okFinal) {
      return { ok: false, error: "Could not create final token GIF under the size limit." };
    }

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
        filename: chosenGifName,
        path: chosenGifAbs,
        url: getPublicUrl(cfg.public_base_url, chosenGifName),
        mime: "image/gif"
      },
      output: {
        filename: tokenName,
        path: tokenAbs,
        url: getPublicUrl(cfg.public_base_url, tokenName),
        mime: "image/gif",
        ring_color: ringColor,
        pingpong,
        max_bytes_effective: effectiveMaxBytes
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

      await setTokenizeAnimated(cfg, inAbs, tokenAbs, cfg.size, ringColor, cfg.border_px, pingpong);

      try {
        const st = fs.statSync(tokenAbs);
        if (st.size > effectiveMaxBytes) {
          const tokenTmpName = `token_tmp_${Date.now()}_${getRandSuffix()}.gif`;
          const tokenTmpAbs = path.join(documentsDir, tokenTmpName);
          fs.renameSync(tokenAbs, tokenTmpAbs);

          const okOpt = await setOptimizeGifWithinLimit(cfg, tokenTmpAbs, tokenAbs, effectiveMaxBytes);
          if (!okOpt) {
            try { fs.unlinkSync(tokenTmpAbs); } catch {}
            return { ok: false, error: "Final token GIF exceeds size limit." };
          }
        }
      } catch {}

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
          ring_color: ringColor,
          pingpong,
          max_bytes_effective: effectiveMaxBytes
        }
      };
    }

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
        ring_color: ringColor,
        pingpong: false,
        max_bytes_effective: null
      }
    };
  }

  return { ok: false, error: "Unsupported media type." };
}

const MODULE_NAME = "getToken";

/**************************************************************/
/* functionSignature: getExport ()                            */
/* Provides the tool export definition                         */
/**************************************************************/
function getExport() {
  return {
    name: MODULE_NAME,
    definition: {
      type: "function",
      function: {
        name: MODULE_NAME,
        description:
          "Accept an image or video URL (http/https). Videos are converted to an animated GIF under toolsconfig.maxMb, then tokenized with a round mask plus a single-color ring (color1). If pingpong=true, frames are duplicated forward+reverse before looping, and the internal byte budget is scaled (x2). The final GIF output is kept under the effective byte budget using optimization where possible. Returns hosted URLs under /documents.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "Public image or video URL (http/https)." },
            color1: { type: "string", description: "Ring color (CSS/hex). Optional. Default #00b3ff." },
            pingpong: { type: "boolean", description: "If true: a loopable animation is generated. It generates a gif that plays forward and then backward, so that it can be looped." }
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
