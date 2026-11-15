// VIGIL // FOUNDRY — damage model (pure functions, no three.js).
// CS2 pipeline, in order: (1) base x range falloff: (1 - falloff%)^
// (distance / 500 u), 500 u = 12.7 m, so metres convert at 39.37 u/m.
// (2) x hitgroup multiplier: head = weapon hsMult, chest/arms = 1,
// stomach = 1.25, legs = 0.75. (3) If the hitgroup is armored: x weapon
// armor-penetration %. Kevlar covers chest/stomach/arms, helmet covers
// head; legs are NEVER protected. There is NO extra x0.5 anywhere.
// Armor pool: 100 points. The blocked fraction (1 - pen) is absorbed by
// the pool, and the pool drains at HALF the blocked amount — so 100 armor
// effectively soaks ~200 blocked damage. Protection is full until the
// pool empties, then the hitgroup takes full damage.
//
// Sanity targets (verified by tests/damage.test.mjs):
//   Kestrel-7 chest vs armor: 36 x 0.775 = 27.9  -> 4 shots to kill
//   Kestrel-7 bare chest:     36               -> 3 shots to kill
//   Kestrel-7 head vs helmet: 36 x 4 x 0.775 = 111.6 -> lethal
//   Bastion-4 head vs helmet: 33 x 4 x 0.70  = 92.4  -> NOT lethal
//   Anvil .50 armored chest:  53 x 0.932 = 49.4 -> two shots 98.8, short

export const HITGROUPS = { head: 'head', chest: 'chest', stomach: 'stomach', arm: 'arm', leg: 'leg' };

export function hitgroupMult(weapon, hitgroup) {
  switch (hitgroup) {
    case 'head': return weapon.hsMult;
    case 'stomach': return 1.25;
    case 'leg': return 0.75;
    default: return 1.0;
  }
}

export function isArmoredHitgroup(hitgroup, target) {
  if (hitgroup === 'leg') return false;
  if (hitgroup === 'head') return target.helmet > 0;
  return target.armor > 0;
}

export function falloffFactor(weapon, distanceM) {
  if (!weapon.falloff) return 1;
  const units = distanceM * 39.3701;
  return Math.pow(1 - weapon.falloff, units / 500);
}

export function computeHit(weapon, hitgroup, distanceM, target) {
  const raw = weapon.damage * falloffFactor(weapon, distanceM) * hitgroupMult(weapon, hitgroup);
  const armored = isArmoredHitgroup(hitgroup, target);
  if (!armored) return { health: raw, blocked: 0 };
  const health = raw * weapon.pen;
  return { health, blocked: raw - health };
}

export function applyHit(weapon, hitgroup, distanceM, target) {
  const { health, blocked } = computeHit(weapon, hitgroup, distanceM, target);
  let healthDmg = health;
  let armorDmg = 0;
  if (blocked > 0 && target.armor > 0) {
    const drain = Math.min(target.armor, blocked * 0.5);
    armorDmg = drain;
    target.armor -= drain;
    const unabsorbed = blocked - drain * 2;
    if (unabsorbed > 0) healthDmg += unabsorbed;
    if (target.armor <= 0 && hitgroup === 'head') target.helmet = 0;
  }
  target.hp -= healthDmg;
  return { healthDmg, armorDmg, killed: target.hp <= 0, headshot: hitgroup === 'head' };
}

export function shotsToKill(weapon, distanceM = 0, armored = true) {
  const t = { hp: 100, armor: armored ? 100 : 0, helmet: armored ? 1 : 0 };
  let n = 0;
  while (t.hp > 0 && n < 40) { applyHit(weapon, 'chest', distanceM, t); n++; }
  return n;
}
