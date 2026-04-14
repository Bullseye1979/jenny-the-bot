/**
 * ESLint rule: no-foreign-config
 *
 * Modules in modules/ must only read from their own config section.
 *
 * Detects string-literal computed access to a ".config" object where
 * the key does not match the module's own config key (derived from filename).
 *
 * Examples flagged (in module 00050-discord-admin-commands.js):
 *   coreData?.config?.["core-channel-config"]   ← foreign key → error
 *   config["webpage-chat"]                       ← foreign key → error
 *
 * Allowed:
 *   coreData?.config?.["discord-admin-commands"] ← own key    → ok
 *   coreData?.config?.[MODULE_NAME]              ← variable   → ok (not a literal)
 */

import path from "node:path";

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Modules must only access their own config section in coreData.config",
      category: "Architecture",
    },
    messages: {
      foreignConfig:
        "Config isolation: this module (\"{{own}}\") must not access config[\"{{foreign}}\"] — " +
        "only config[\"{{own}}\"] is allowed.",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? "";
    const basename = path.basename(filename, ".js");

    if (!/^\d+-.+/.test(basename)) return {};

    const moduleKey = basename.replace(/^\d+-/, "");

    return {
      MemberExpression(node) {
        if (!node.computed) return;
        if (node.property.type !== "Literal") return;
        if (typeof node.property.value !== "string") return;

        const accessedKey = node.property.value;

        if (!isConfigAccess(node.object)) return;

        if (accessedKey === moduleKey) return;

        context.report({
          node,
          messageId: "foreignConfig",
          data: { own: moduleKey, foreign: accessedKey },
        });
      },
    };
  },
};


/**
 * Returns true if the node represents access to a property named "config".
 * Covers:
 *   config                    — bare Identifier
 *   something.config          — MemberExpression, non-computed
 *   something?.config         — optional MemberExpression (inside ChainExpression)
 */
function isConfigAccess(node) {
  if (node.type === "Identifier" && node.name === "config") return true;

  if (node.type === "MemberExpression" && !node.computed) {
    if (node.property.type === "Identifier" && node.property.name === "config") return true;
  }

  if (node.type === "ChainExpression") {
    return isConfigAccess(node.expression);
  }

  return false;
}
