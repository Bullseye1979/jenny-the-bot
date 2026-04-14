/**************************************************************/
/* filename: "setup.js"                                      */
/* Version 1.0                                               */
/* Purpose: Core setup wizard that bootstraps core.json      */
/*          from the documented example template.            */
/**************************************************************/

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_EXAMPLE_PATH = path.resolve(__dirname, "../core.json.example");

function getSetupHtml(error) {
  const errHtml = error
    ? `<div class="error">&#9888; ${String(error).replace(/</g, "&lt;")}</div>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jenny Bot - First-Run Setup</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0f1117;color:#e2e2e2;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
  .card{background:#1a1a24;border:1px solid #2d2d40;border-radius:12px;padding:36px 40px;width:100%;max-width:520px}
  h1{font-size:1.4rem;font-weight:700;margin-bottom:4px;color:#fff}
  .sub{font-size:.85rem;color:#888;margin-bottom:28px}
  label{display:block;font-size:.8rem;color:#aaa;margin-bottom:6px;font-weight:600;letter-spacing:.04em}
  input{width:100%;background:#0f0f18;border:1px solid #303046;border-radius:7px;padding:10px 14px;color:#e2e2e2;font-size:.9rem;outline:none;margin-bottom:18px}
  input:focus{border-color:#5b5bd6}
  .row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  button{width:100%;background:#5b5bd6;color:#fff;border:none;border-radius:7px;padding:12px;font-size:1rem;font-weight:700;cursor:pointer;margin-top:6px}
  button:hover{background:#4a4ac0}
  .error{background:#3a1212;border:1px solid #7a2020;border-radius:7px;padding:10px 14px;margin-bottom:18px;font-size:.85rem;color:#e07070}
  .section{font-size:.72rem;color:#5b5bd6;text-transform:uppercase;letter-spacing:.1em;margin:22px 0 14px;border-bottom:1px solid #2d2d40;padding-bottom:6px}
  .hint{font-size:.75rem;color:#666;margin-top:-14px;margin-bottom:16px}
</style>
</head>
<body>
<div class="card">
  <h1>&#127775; Jenny Bot Setup</h1>
  <p class="sub">No <code>core.json</code> found. Enter the minimum required values to start the bot.</p>
  ${errHtml}
  <form method="POST" action="/setup">
    <div class="section">OpenAI</div>
    <label>API Key Alias *</label>
    <input name="apiKeyAlias" placeholder="OPENAI" value="OPENAI" required autocomplete="off">
    <p class="hint">Store the real provider key in the secret database and keep only the alias in <code>core.json</code>.</p>

    <div class="section">Database (MySQL)</div>
    <div class="row2">
      <div><label>Host *</label><input name="dbHost" placeholder="localhost" value="localhost" required></div>
      <div><label>Port</label><input name="dbPort" placeholder="3306" value="3306" type="number"></div>
    </div>
    <label>User *</label>
    <input name="dbUser" placeholder="discord_bot" required>
    <label>Password *</label>
    <input name="dbPass" type="password" placeholder="" required autocomplete="off">
    <label>Database *</label>
    <input name="dbName" placeholder="discord_ai" required>

    <div class="section">Bot Identity</div>
    <label>Bot Name</label>
    <input name="botName" placeholder="Jenny" value="Jenny">
    <label>Trigger Word</label>
    <input name="trigger" placeholder="jenny" value="jenny">
    <p class="hint">The word users must say or type to address the bot in multi-user channels.</p>

    <button type="submit">Create core.json and start bot &#8594;</button>
  </form>
</div>
</body>
</html>`;
}

function parseFormBody(body) {
  const out = {};
  for (const pair of body.split("&")) {
    const [k, v] = pair.split("=");
    if (k) out[decodeURIComponent(k.replace(/\+/g, " "))] = decodeURIComponent((v || "").replace(/\+/g, " "));
  }
  return out;
}

function buildCoreJson(fields) {
  const apiKey = (fields.apiKeyAlias || "OPENAI").trim() || "OPENAI";
  const botName = (fields.botName || "Jenny").trim() || "Jenny";
  const trigger = (fields.trigger || "jenny").trim().toLowerCase();
  const dbHost = (fields.dbHost || "localhost").trim();
  const dbPort = Number(fields.dbPort) || 3306;
  const dbUser = (fields.dbUser || "").trim();
  const dbPass = (fields.dbPass || "").trim();
  const dbName = (fields.dbName || "").trim();

  const template = JSON.parse(fs.readFileSync(CORE_EXAMPLE_PATH, "utf8"));
  const coreJson = JSON.parse(JSON.stringify(template));
  const workingObject = coreJson.workingObject || {};

  workingObject.botName = botName;
  workingObject.trigger = trigger;
  workingObject.apiKey = apiKey;
  workingObject.ttsApiKey = apiKey;
  workingObject.transcribeApiKey = apiKey;
  workingObject.avatarApiKey = apiKey;
  workingObject.baseUrl = "http://localhost:3000";
  workingObject.modAdmin = "";
  workingObject.db = workingObject.db || {};
  workingObject.db.host = dbHost;
  workingObject.db.port = dbPort;
  workingObject.db.user = dbUser;
  workingObject.db.password = dbPass;
  workingObject.db.database = dbName;

  coreJson.workingObject = workingObject;
  return coreJson;
}

export function startSetupWizard(corePath, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === "GET" && (req.url === "/" || req.url === "/setup")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(getSetupHtml(null));
        return;
      }

      if (req.method === "POST" && req.url === "/setup") {
        const chunks = [];
        req.on("data", c => chunks.push(c));
        req.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          const fields = parseFormBody(body);

          const missing = ["apiKeyAlias", "dbHost", "dbUser", "dbPass", "dbName"].filter(k => !fields[k]?.trim());
          if (missing.length) {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(getSetupHtml("Missing required fields: " + missing.join(", ")));
            return;
          }

          try {
            const coreJson = buildCoreJson(fields);
            fs.writeFileSync(corePath, JSON.stringify(coreJson, null, 2), "utf-8");

            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Setup Complete</title>
<style>body{font-family:system-ui;background:#0f1117;color:#e2e2e2;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#1a1a24;border:1px solid #2d2d40;border-radius:12px;padding:36px 40px;max-width:440px;text-align:center}
h1{color:#44cc88;margin-bottom:12px}p{color:#aaa;margin-bottom:8px}</style></head>
<body><div class="card"><h1>&#10003; Setup complete</h1>
<p>core.json has been created.</p>
<p><strong>Please restart the bot</strong> to apply the configuration.</p></div></body></html>`);

            server.close(() => resolve());
          } catch (e) {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(getSetupHtml("Failed to write core.json: " + e.message));
          }
        });
        req.on("error", err => {
          res.writeHead(500);
          res.end();
          reject(err);
        });
        return;
      }

      res.writeHead(302, { Location: "/setup" });
      res.end();
    });

    server.on("error", reject);
    server.listen(port, () => {
      process.stdout.write(`\n\x1b[33m[setup] core.json not found.\x1b[0m\n`);
      process.stdout.write(`\x1b[33m[setup] Open http://localhost:${port}/setup to configure the bot.\x1b[0m\n\n`);
    });
  });
}
