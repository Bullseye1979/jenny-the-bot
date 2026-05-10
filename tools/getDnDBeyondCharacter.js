/**************************************************************/
/* filename: "getDnDBeyondCharacter.js"                      */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/

import { fetchWithTimeout } from "../core/fetch.js";

const MODULE_NAME  = "getDnDBeyondCharacter";
const TIMEOUT_MS   = 15000;
const BASE_URL     = "https://character-service.dndbeyond.com/character/v5/character";

const ABILITY_MAP  = { 1: "STR", 2: "DEX", 3: "CON", 4: "INT", 5: "WIS", 6: "CHA" };
const ABILITY_FULL = { 1: "strength", 2: "dexterity", 3: "constitution", 4: "intelligence", 5: "wisdom", 6: "charisma" };
const SKILL_ABILITY = {
  acrobatics: 2, "animal-handling": 5, arcana: 4, athletics: 1,
  deception: 6, history: 4, insight: 5, intimidation: 6,
  investigation: 4, medicine: 5, nature: 4, perception: 5,
  performance: 6, persuasion: 6, religion: 4, "sleight-of-hand": 2,
  stealth: 2, survival: 5
};

function mod(score) { return Math.floor((score - 10) / 2); }
function profBonus(totalLevel) {
  return totalLevel <= 4 ? 2 : totalLevel <= 8 ? 3 : totalLevel <= 12 ? 4 : totalLevel <= 16 ? 5 : 6;
}
function signedMod(n) { return (n >= 0 ? "+" : "") + n; }

function getAbilityScores(data) {
  const scores = {};
  for (const s of (data.stats || [])) {
    const bonus    = (data.bonusStats  || []).find(b => b.id === s.id)?.value ?? 0;
    const override = (data.overrideStats || []).find(o => o.id === s.id)?.value;
    scores[s.id]   = override ?? (s.value + bonus);
  }
  // apply bonus modifiers from all modifier sources
  const allMods = Object.values(data.modifiers || {}).flat();
  for (const m of allMods) {
    if (m.type !== "bonus") continue;
    for (const [id, full] of Object.entries(ABILITY_FULL)) {
      if (m.subType === `${full}-score`) {
        scores[Number(id)] = (scores[Number(id)] ?? 10) + (m.fixedValue ?? m.value ?? 0);
      }
    }
  }
  return scores;
}

function getAllModifiers(data) {
  return Object.values(data.modifiers || {}).flat();
}

function getProfBonus(data) {
  const totalLevel = (data.classes || []).reduce((s, c) => s + (c.level || 0), 0);
  return profBonus(totalLevel);
}

function getSavingThrows(data, scores, pb) {
  const allMods = getAllModifiers(data);
  const result  = {};
  for (const [id, abbr] of Object.entries(ABILITY_MAP)) {
    const full       = ABILITY_FULL[id];
    const base       = mod(scores[Number(id)] ?? 10);
    const isProficient = allMods.some(m => m.type === "proficiency" && m.subType === `${full}-saving-throws`);
    const bonus      = allMods.filter(m => m.type === "bonus" && m.subType === `${full}-saving-throws`)
                               .reduce((s, m) => s + (m.fixedValue ?? m.value ?? 0), 0);
    result[abbr]     = { total: base + (isProficient ? pb : 0) + bonus, proficient: isProficient };
  }
  return result;
}

function getSkills(data, scores, pb) {
  const allMods = getAllModifiers(data);
  const result  = {};
  for (const [skill, abilId] of Object.entries(SKILL_ABILITY)) {
    const base      = mod(scores[abilId] ?? 10);
    const isExpert  = allMods.some(m => m.type === "expertise"   && m.subType === skill);
    const isProf    = allMods.some(m => m.type === "proficiency" && m.subType === skill);
    const bonus     = allMods.filter(m => m.type === "bonus" && m.subType === skill)
                              .reduce((s, m) => s + (m.fixedValue ?? m.value ?? 0), 0);
    const profMult  = isExpert ? 2 : isProf ? 1 : 0;
    result[skill]   = { total: base + pb * profMult + bonus, proficient: isProf, expertise: isExpert };
  }
  return result;
}

function deriveAC(data, scores) {
  const allMods      = getAllModifiers(data);
  const inventory    = data.inventory || [];
  const equippedArmor  = inventory.filter(i => i.equipped && i.definition?.filterType === "Armor" && i.definition?.type !== "Shield");
  const equippedShield = inventory.find(i  => i.equipped && i.definition?.type === "Shield");
  const dexMod       = mod(scores[2] ?? 10);

  let baseAC = 10 + dexMod; // unarmored default

  if (equippedArmor.length) {
    const armor     = equippedArmor[0].definition;
    const armorType = armor.type || "";
    const baseArmorAC = armor.armorClass || 10;
    const isLight   = armorType.toLowerCase().includes("light");
    const isMedium  = armorType.toLowerCase().includes("medium");
    const isHeavy   = armorType.toLowerCase().includes("heavy");
    if (isLight)  baseAC = baseArmorAC + dexMod;
    else if (isMedium) baseAC = baseArmorAC + Math.min(dexMod, 2);
    else if (isHeavy)  baseAC = baseArmorAC;
    else               baseAC = baseArmorAC + dexMod;
  }

  if (equippedShield) baseAC += 2;

  // AC bonuses from modifiers
  const acBonus = allMods.filter(m => m.type === "bonus" && m.subType === "armor-class")
                          .reduce((s, m) => s + (m.fixedValue ?? m.value ?? 0), 0);

  // characterValues override
  const acOverride = (data.characterValues || []).find(v => v.typeId === 1);
  if (acOverride?.value) return acOverride.value + acBonus;

  return baseAC + acBonus;
}

function getWeapons(data, scores, pb) {
  const allMods  = getAllModifiers(data);
  const strMod   = mod(scores[1] ?? 10);
  const dexMod   = mod(scores[2] ?? 10);
  const weapons  = (data.inventory || []).filter(i => i.equipped && i.definition?.filterType === "Weapon");
  return weapons.map(w => {
    const def       = w.definition;
    const isFinesse = (def.properties || []).some(p => p.name === "Finesse");
    const isRanged  = def.attackType === 2;
    const attackMod = isRanged || isFinesse
      ? Math.max(strMod, dexMod)
      : strMod;
    const magicBonus = allMods.filter(m => m.subType === "weapon-attacks" && m.type === "bonus")
                               .reduce((s, m) => s + (m.fixedValue ?? m.value ?? 0), 0);
    const toHit     = attackMod + pb + magicBonus + (def.magic ? 0 : 0);
    return {
      name:    def.name,
      toHit:   signedMod(toHit),
      damage:  def.damage?.diceString ? `${def.damage.diceString}${signedMod(attackMod + magicBonus)}` : "—",
      damageType: def.damageType || "—",
      range:   def.range ?? "5",
      properties: (def.properties || []).map(p => p.name).join(", ") || "—"
    };
  });
}

function getSpells(data) {
  const result = [];
  for (const cs of (data.classSpells || [])) {
    for (const spell of (cs.spells || [])) {
      const def = spell.definition;
      if (!def) continue;
      const activation = def.activation;
      const range      = def.range;
      const duration   = def.duration;
      result.push({
        name:          def.name,
        level:         def.level,
        school:        def.school || null,
        prepared:      spell.prepared || spell.alwaysPrepared || def.level === 0,
        castingTime:   activation ? `${activation.activationTime ?? ""} ${activation.activationType ?? ""}`.trim() : null,
        range:         range?.rangeValue != null ? `${range.rangeValue} ft` : (range?.origin || null),
        duration:      duration?.durationInterval != null ? `${duration.durationInterval} ${duration.durationUnit ?? ""}`.trim() : (duration?.durationType || null),
        concentration: def.concentration ?? false,
        ritual:        def.ritual ?? false,
        components:    [
          (def.components || []).includes(1) ? "V" : null,
          (def.components || []).includes(2) ? "S" : null,
          (def.components || []).includes(3) ? "M" : null
        ].filter(Boolean).join("")
      });
    }
  }
  return result;
}

function getInventory(data) {
  return (data.inventory || []).map(i => ({
    name:     i.definition?.name || "Unknown",
    type:     i.definition?.filterType || i.definition?.type || null,
    rarity:   i.definition?.rarity || null,
    quantity: i.quantity ?? 1,
    equipped: i.equipped ?? false,
    attuned:  i.attuned ?? false,
    weight:   i.definition?.weight ?? null
  }));
}

function getBackground(data) {
  const bg = data.background;
  if (!bg?.definition) return null;
  return {
    name:               bg.definition.name || null,
    featureName:        bg.definition.featureName || null,
    featureDescription: bg.definition.featureDescription || null
  };
}

function getPersonality(data) {
  const t = data.traits || {};
  const n = data.notes  || {};
  return {
    personalityTraits: t.personalityTraits || null,
    ideals:            t.ideals            || null,
    bonds:             t.bonds             || null,
    flaws:             t.flaws             || null,
    appearance:        t.appearance        || null,
    backstory:         n.backstory         || null,
    allies:            n.allies            || null,
    enemies:           n.enemies           || null,
    organizations:     n.organizations     || null,
    other:             n.otherNotes        || null
  };
}

function getSpellSlots(data) {
  const slots = (data.spellSlots || []).filter(s => s.available > 0);
  const pact  = (data.pactMagic  || []).filter(s => s.available > 0);
  return [
    ...slots.map(s => ({ level: s.level, available: s.available, used: s.used ?? 0, type: "spell" })),
    ...pact.map(s  => ({ level: s.level, available: s.available, used: s.used ?? 0, type: "pact"  }))
  ];
}

async function getInvoke(args) {
  const characterId = String(args?.characterId || "").trim();
  if (!characterId || !/^\d+$/.test(characterId)) {
    return { ok: false, error: "characterId must be a numeric string (the ID at the end of the DnD Beyond character URL)." };
  }

  const url = `${BASE_URL}/${characterId}`;
  let raw;
  try {
    const res = await fetchWithTimeout(url, { headers: { "Accept": "application/json" } }, TIMEOUT_MS);
    if (!res.ok) return { ok: false, error: `DnD Beyond returned HTTP ${res.status}` };
    raw = await res.json();
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }

  if (!raw?.success || !raw?.data) {
    return { ok: false, error: raw?.message || "Unexpected API response structure" };
  }

  const d   = raw.data;
  const pb  = getProfBonus(d);
  const scores = getAbilityScores(d);

  const totalLevel = (d.classes || []).reduce((s, c) => s + (c.level || 0), 0);
  const maxHP  = d.overrideHitPoints ?? ((d.baseHitPoints ?? 0) + (d.bonusHitPoints ?? 0));
  const currHP = maxHP - (d.removedHitPoints ?? 0);

  const saves  = getSavingThrows(d, scores, pb);
  const skills = getSkills(d, scores, pb);
  const ac     = deriveAC(d, scores);

  const proficientSaves  = Object.entries(saves).filter(([, v]) => v.proficient).map(([k]) => k);
  const proficientSkills = Object.entries(skills).filter(([, v]) => v.proficient && !v.expertise).map(([k]) => k);
  const expertiseSkills  = Object.entries(skills).filter(([, v]) => v.expertise).map(([k]) => k);

  const passivePerception = 10 + skills["perception"]?.total;

  return {
    ok:            true,
    characterId,
    url:           d.readonlyUrl || url,
    avatarUrl:     (() => {
      const raw = d.avatarUrl || d.decorations?.avatarUrl || null;
      if (!raw) return null;
      try { const u = new URL(raw); u.search = ""; return u.toString(); } catch { return raw; }
    })(),
    primaryImageUrl: (() => {
      const raw = d.avatarUrl || d.decorations?.avatarUrl || null;
      if (!raw) return null;
      try { const u = new URL(raw); u.search = ""; return u.toString(); } catch { return raw; }
    })(),
    name:          d.name,
    race:          d.race?.fullName || d.race?.baseName || "Unknown",
    classes:       (d.classes || []).map(c => ({
      name:       c.definition?.name,
      subclass:   c.subclassDefinition?.name ?? null,
      level:      c.level,
      hitDice:    `d${c.definition?.hitDice}`
    })),
    totalLevel,
    proficiencyBonus: signedMod(pb),
    inspiration:   d.inspiration ?? false,
    hp: {
      current:   currHP,
      max:       maxHP,
      temp:      d.temporaryHitPoints ?? 0
    },
    ac,
    speed:         d.race?.weightSpeeds?.normal?.walk ?? 30,
    abilityScores: Object.fromEntries(
      Object.entries(ABILITY_MAP).map(([id, abbr]) => [
        abbr, { score: scores[Number(id)] ?? 10, modifier: signedMod(mod(scores[Number(id)] ?? 10)) }
      ])
    ),
    savingThrows:  Object.fromEntries(Object.entries(saves).map(([k, v]) => [k, { total: signedMod(v.total), proficient: v.proficient }])),
    proficientSaves,
    skills:        Object.fromEntries(Object.entries(skills).map(([k, v]) => [k, { total: signedMod(v.total), proficient: v.proficient, expertise: v.expertise }])),
    proficientSkills,
    expertiseSkills,
    passivePerception,
    weapons:       getWeapons(d, scores, pb),
    spellSlots:    getSpellSlots(d),
    spells:        getSpells(d),
    inventory:     getInventory(d),
    background:    getBackground(d),
    personality:   getPersonality(d),
    conditions:    (d.conditions || []).map(c => c.definition?.name ?? c.id),
    deathSaves:    d.deathSaves ?? null,
    currencies:    d.currencies ?? null,
    feats:         (d.feats || []).map(f => f.definition?.name).filter(Boolean),
    xp:            d.currentXp ?? null
  };
}

export default {
  name:   MODULE_NAME,
  invoke: getInvoke
};
