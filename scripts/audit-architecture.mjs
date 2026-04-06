import fs from "node:fs";
import path from "node:path";

const ROOTS = ["modules", "tools", "flows"];
const violations = [];

function listJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...listJsFiles(full));
    else if (full.endsWith(".js")) out.push(full);
  }
  return out;
}

function checkImports(file, source) {
  const importRe = /import\s+[^"'\n]+["']([^"']+)["']/g;
  let match;
  while ((match = importRe.exec(source))) {
    const spec = match[1];
    const isModuleFile = file.startsWith("modules/") || file.startsWith("tools/");
    if (isModuleFile) {
      if (spec.includes("/modules/") || spec.includes("/tools/") || spec.startsWith("../modules") || spec.startsWith("../tools")) {
        violations.push(`${file}: imports forbidden module/tool path (${spec})`);
      }
      if (spec.includes("shared/webpage") && !path.basename(file).includes("webpage-")) {
        violations.push(`${file}: only webpage-* files may import shared/webpage (${spec})`);
      }
    }
  }
}

function checkVersion(file, source) {
  const m = source.match(/Version\s+([0-9]+\.[0-9]+)/i);
  if (!m) return;
  if (m[1] !== "1.0") violations.push(`${file}: version is ${m[1]} (expected 1.0)`);
}

function checkManifestCamelCase(file, json) {
  function walkProperties(schema, prefix = "") {
    if (!schema || typeof schema !== "object") return;
    if (schema.properties && typeof schema.properties === "object") {
      for (const [key, value] of Object.entries(schema.properties)) {
        if (key.includes("_")) violations.push(`${file}: non-camelCase parameter key ${prefix}${key}`);
        walkProperties(value, `${prefix}${key}.`);
      }
    }
  }
  walkProperties(json.parameters || {});
}

for (const root of ROOTS) {
  for (const file of listJsFiles(root)) {
    const src = fs.readFileSync(file, "utf8");
    checkImports(file, src);
    checkVersion(file, src);
  }
}

for (const name of fs.readdirSync("manifests")) {
  if (!name.endsWith(".json")) continue;
  const file = path.join("manifests", name);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  checkManifestCamelCase(file, data);
}

if (violations.length) {
  console.error("Architecture audit failed:\n" + violations.map(v => `- ${v}`).join("\n"));
  process.exit(1);
}

console.log("Architecture audit passed.");
