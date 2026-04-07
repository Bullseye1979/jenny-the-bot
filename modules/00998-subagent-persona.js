/************************************************************************************/
/* filename: 00998-subagent-persona.js                                              */
/* Version 1.0                                                                      */
/* Purpose: Applies subagent-specific persona and instruction inheritance before    */
/*          the core AI modules run.                                                */
/************************************************************************************/

const MODULE_NAME = "subagent-persona";


function getText(value) {
  return typeof value === "string" ? value.trim() : "";
}


function getCombinedText(first, second) {
  const a = getText(first);
  const b = getText(second);
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;
  return `${a}\n\n${b}`;
}


export default async function getSubagentPersona(coreData) {
  const wo = coreData?.workingObject;
  if (!wo || wo.__subagentPersonaApplied === true) return coreData;

  const callerPersona = getText(wo.callerPersona);
  const callerInstructions = getText(wo.callerInstructions);
  if (!callerPersona && !callerInstructions) return coreData;

  const ownPersona = getText(wo.persona);
  const personaParts = [];
  if (ownPersona) personaParts.push(`You are: ${ownPersona}`);
  if (callerPersona) personaParts.push(`Answer as: ${callerPersona}`);
  if (personaParts.length) wo.persona = personaParts.join("\n");

  if (callerInstructions) {
    wo.instructions = getCombinedText(wo.instructions, callerInstructions);
  }

  wo.__subagentPersonaApplied = true;
  return coreData;
}
