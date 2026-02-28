/**
 * generate-icons.js
 * Converts icon.svg into the required PNG sizes (16, 48, 128 px).
 *
 * Usage:
 *   node generate-icons.js
 *
 * Requires: sharp   →   npm install sharp
 *
 * If you don't have Node / sharp, open icon.svg in any vector editor
 * (Inkscape, Figma, Illustrator) and export the three PNG sizes manually:
 *   icon16.png   (16×16)
 *   icon48.png   (48×48)
 *   icon128.png  (128×128)
 */
import { createRequire } from "module";
import { fileURLToPath }  from "url";
import path               from "path";
import fs                 from "fs";

const require   = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svgPath   = path.join(__dirname, "icon.svg");

let sharp;
try { sharp = require("sharp"); }
catch (e) {
  console.error("sharp not installed. Run:  npm install sharp");
  process.exit(1);
}

const sizes = [16, 48, 128];
const svg   = fs.readFileSync(svgPath);

(async () => {
  for (const size of sizes) {
    const out = path.join(__dirname, "icon" + size + ".png");
    await sharp(svg).resize(size, size).png().toFile(out);
    console.log("Written:", out);
  }
  console.log("Done.");
})();
