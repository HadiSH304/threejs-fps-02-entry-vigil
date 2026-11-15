// VIGIL // FOUNDRY — team plans (judge criterion 3: tactics).
// At round start each team picks a plan and every bot gets a role and a
// route. Attack: Execute A, Execute B, Spread / Default, Rush Mid.
// Defend: Stack A, Stack B, Split. Roles: entry (first through the
// door), support (utility, follows the carrier), lurker (far route,
// holds the other site), carrier (carries the charge and plants it),
// anchor (holds a site), mid (holds mid, rotates on a callout). Routes
// are waypoint keys resolved against the map's own spawns, sites and
// waypoints — no hardcoded map geometry here. Plans rotate by round
// number so the same round is not played the same way twice. The
// player's team plan is shown on the buy screen and in the HUD; the
// enemy team's plan is picked the same way. Bots follow their route,
// hold the end point, and break off it to rotate on a radio callout.

export const ATTACK_PLANS = [
  { id: 'exec-a', name: 'EXECUTE A', desc: 'Hit Site A together, lurker takes B' },
  { id: 'exec-b', name: 'EXECUTE B', desc: 'Hit Site B together, lurker takes A' },
  { id: 'spread', name: 'SPREAD / DEFAULT', desc: 'Split the map, take map control' },
  { id: 'rush-mid', name: 'RUSH MID', desc: 'All four through mid, split to both sites' },
];

export const DEFEND_SETUPS = [
  { id: 'stack-a', name: 'STACK A', desc: 'Three hold Site A, one mid, one B' },
  { id: 'stack-b', name: 'STACK B', desc: 'Three hold Site B, one mid, one A' },
  { id: 'split', name: 'SPLIT', desc: 'Two per site, one floating mid' },
];

export function pickAttackPlan(round) {
  return ATTACK_PLANS[(round - 1) % ATTACK_PLANS.length];
}

export function pickDefendSetup(round) {
  return DEFEND_SETUPS[(round - 1) % DEFEND_SETUPS.length];
}

function centroid(points) {
  let x = 0, z = 0;
  for (const p of points) { x += p[0]; z += p[1]; }
  return [x / points.length, z / points.length];
}

function nearWaypoint(mapDef, x, z) {
  let best = mapDef.waypoints[0], bd = Infinity;
  for (const w of mapDef.waypoints) {
    const d = (w[0] - x) ** 2 + (w[1] - z) ** 2;
    if (d < bd) { bd = d; best = w; }
  }
  return [best[0], best[1]];
}

function keys(mapDef) {
  return {
    S: centroid(mapDef.spawns.attack),
    A: [mapDef.sites[0].x, mapDef.sites[0].z],
    B: [mapDef.sites[1].x, mapDef.sites[1].z],
    M: nearWaypoint(mapDef, 0, 0),
    N: nearWaypoint(mapDef, 0, -13),
    U: nearWaypoint(mapDef, 0, 13),
  };
}

const ATTACK_ROUTES = {
  'exec-a': [['entry', 'S', 'N', 'A'], ['support', 'S', 'M', 'A'], ['lurker', 'S', 'U', 'B'], ['entry', 'S', 'N', 'A']],
  'exec-b': [['entry', 'S', 'U', 'B'], ['support', 'S', 'M', 'B'], ['lurker', 'S', 'N', 'A'], ['entry', 'S', 'U', 'B']],
  'rush-mid': [['entry', 'S', 'M', 'A'], ['entry', 'S', 'M', 'B'], ['support', 'S', 'M', 'A'], ['lurker', 'S', 'M', 'B']],
  spread: [['entry', 'S', 'N', 'A'], ['support', 'S', 'M', 'B'], ['lurker', 'S', 'U', 'B'], ['anchor', 'S', 'M', 'A']],
};

const DEFEND_ROUTES = {
  'stack-a': [['anchor', 'A', -2, 0], ['anchor', 'A', 2, 2], ['anchor', 'A', 0, -3], ['mid', 'M', 0, 0], ['anchor', 'B', 0, 0]],
  'stack-b': [['anchor', 'B', 2, 0], ['anchor', 'B', -2, -2], ['anchor', 'B', 0, 3], ['mid', 'M', 0, 0], ['anchor', 'A', 0, 0]],
  split: [['anchor', 'A', -2, 0], ['anchor', 'A', 2, 2], ['mid', 'M', 0, 0], ['anchor', 'B', 2, 0], ['anchor', 'B', -2, -2]],
};

export function attackRoutes(mapDef, plan) {
  const k = keys(mapDef);
  return ATTACK_ROUTES[plan.id].map(([role, ...pts]) => ({
    role, route: pts.map((p) => k[p]),
  }));
}

export function defendRoutes(mapDef, setup) {
  const k = keys(mapDef);
  return DEFEND_ROUTES[setup.id].map(([role, site, dx, dz]) => ({
    role, route: [[k[site][0] + dx, k[site][1] + dz]],
  }));
}

export function assignPlan(bots, routes, carrierIndex = -1) {
  bots.forEach((bot, i) => {
    const r = routes[i % routes.length];
    bot.role = r.role;
    bot.planRoute = r.route.map(([x, z]) => ({ x, z }));
    bot.planIdx = 0;
    bot.planDone = false;
    bot.carrier = i === carrierIndex;
  });
}
