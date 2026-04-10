







"use strict";
/* Version 1.0 */
const MODULE_NAME = "webpage-menu";
const ICONS = {
  wiki: "\u{1F5FA}\uFE0F",
  chat: "\u{1F4AC}",
  voice: "\u{1F399}\uFE0F",
  inpainting: "\u{1F3A8}",
  gallery: "\u{1F5BC}\uFE0F",
  bard: "\u{1F3B5}",
  config: "\u2699\uFE0F",
  manifests: "\u{1F4C4}",
  subagents: "\u{1F9E9}",
  context: "\u{1F5C3}\uFE0F",
  timeline: "\u23F3",
  keyManager: "\u{1F511}",
  dashboard: "\u{1F4CA}",
  logs: "\u{1F4CB}",
  live: "\u{1F4E1}",
  docs: "\u{1F4D6}",
  gdpr: "\u{1F512}",
  microsoft: "\u{1F517}",
  spotify: "\u{1F3B5}"
};
function getNormFlow(wo) {
  return String(wo?.flow || "").trim().toLowerCase();
}
function getNormRoleOrEmpty(wo) {
  return String(wo?.webAuth?.role || "").trim().toLowerCase();
}
function getIsAllowed(role, rolesArr) {
  const roles = Array.isArray(rolesArr)
    ? rolesArr.map(r => String(r || "").trim().toLowerCase()).filter(Boolean)
    : [];
  if (!roles.length) return true;
  if (!role) return false;
  if (role === "admin") return true;
  return roles.includes(role);
}
function getPathParts(value) {
  return String(value || "")
    .split("\\")
    .map(part => String(part || "").trim())
    .filter(Boolean);
}
function getIconValue(item) {
  const icon = String(item?.icon || "").trim();
  if (icon && !icon.includes("?")) return icon;
  const key = String(item?.iconKey || "").trim();
  return ICONS[key] || "";
}
export default async function getWebpageMenu(coreData) {
  const wo = coreData?.workingObject || {};
  const flow = getNormFlow(wo);
  if (!flow || !flow.startsWith("webpage")) return coreData;
  const cfg = coreData?.config?.[MODULE_NAME] || {};
  const items = Array.isArray(cfg.items) ? cfg.items : [];
  const role = getNormRoleOrEmpty(wo);
  if (!wo.web) wo.web = {};
  wo.web.menu = items
    .map(it => ({
      text: String(it?.text || it?.label || it?.name || "").trim(),
      link: String(it?.link || it?.href || it?.url || "").trim(),
      icon: getIconValue(it),
      roles: Array.isArray(it?.roles) ? it.roles : []
    }))
    .filter(it => it.text && it.link)
    .filter(it => getIsAllowed(role, it.roles));
  wo.web.menu = wo.web.menu.map(it => ({
    ...it,
    path: getPathParts(it.text),
    label: getPathParts(it.text).slice(-1)[0] || it.text
  }));
  return coreData;
}
