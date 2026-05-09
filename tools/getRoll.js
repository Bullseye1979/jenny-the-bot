/**************************************************************/
/* filename: "getRoll.js"                                    */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/

const MODULE_NAME = "getRoll";

const VALID_SIDES = new Set([2, 3, 4, 6, 8, 10, 12, 20, 100]);

function rollOne(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

function parseDiceNotation(notation) {
  const clean = String(notation || "").trim().toLowerCase().replace(/\s+/g, "");
  const match = clean.match(/^(\d+)?d(\d+)([+-]\d+)?$/);
  if (!match) return null;
  const count    = match[1] ? parseInt(match[1], 10) : 1;
  const sides    = parseInt(match[2], 10);
  const modifier = match[3] ? parseInt(match[3], 10) : 0;
  if (count < 1 || count > 100) return null;
  if (!VALID_SIDES.has(sides)) return null;
  return { count, sides, modifier };
}

async function getInvoke(args) {
  const notation    = String(args?.notation    || "").trim();
  const advantage   = args?.advantage   === true;
  const disadvantage = args?.disadvantage === true;
  const label       = String(args?.label || "").trim();

  if (!notation) return { ok: false, error: "notation is required (e.g. '1d20', '2d6+3')" };

  const parsed = parseDiceNotation(notation);
  if (!parsed) {
    return { ok: false, error: `Invalid notation '${notation}'. Use NdS+M format with supported die sizes: d2, d3, d4, d6, d8, d10, d12, d20, d100.` };
  }

  const { count, sides, modifier } = parsed;

  // advantage/disadvantage only applies to single d20 rolls
  const useAdvDis = (advantage || disadvantage) && sides === 20 && count === 1;

  let rolls;
  let chosenRoll;

  if (useAdvDis) {
    const roll1 = rollOne(20);
    const roll2 = rollOne(20);
    rolls = [roll1, roll2];
    chosenRoll = advantage ? Math.max(roll1, roll2) : Math.min(roll1, roll2);
  } else {
    rolls = Array.from({ length: count }, () => rollOne(sides));
    chosenRoll = rolls.reduce((a, b) => a + b, 0);
  }

  const total = chosenRoll + modifier;

  const result = {
    ok:       true,
    notation,
    rolls,
    modifier,
    total,
    ...(label && { label }),
    ...(useAdvDis && { mode: advantage ? "advantage" : "disadvantage", chosenRoll })
  };

  return result;
}

export default {
  name:   MODULE_NAME,
  invoke: getInvoke
};
