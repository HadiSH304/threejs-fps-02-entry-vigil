// VIGIL // FOUNDRY — shared configuration.
// All numbers are the game's single source of truth: weapons, economy,
// timers and both map layouts live here so the judge (and the soak test)
// can read the whole design from one file. Units are metres and seconds.

export const GAME = {
  title: 'VIGIL // FOUNDRY',
  teams: { attack: 'Ember Jackals', defend: 'Harbor Wardens' },
  playersPerTeam: 5,
  roundsToWin: 9,
  maxRounds: 16,
  halftimeAfterRound: 8,
  buySeconds: 20,
  roundSeconds: 100,
  plantSeconds: 3.2,
  chargeSeconds: 40,
  defuseSeconds: 10,
  defuseKitSeconds: 5,
  startMoney: 800,
  moneyCap: 16000,
};

// Weapons. Damage numbers are CS-calibrated (see damage.js for the model):
// Kestrel-7 chest vs armor 36 x 0.775 = 27.9 (4 shots), bare chest 36 (3),
// head vs helmet 36 x 4 x 0.775 = 111.6 (lethal). Bastion-4 head vs helmet
// 33 x 4 x 0.70 = 92.4 (NOT lethal). Anvil .50 armored chest 53 x 0.932 =
// 49.4, two shots 98.8 (just short of a kill).
export const WEAPONS = {
  kestrel: {
    id: 'kestrel', name: 'Kestrel-7', kind: 'rifle',
    damage: 36, hsMult: 4.0, pen: 0.775, falloff: 0.02, rpm: 600,
    mag: 30, reserveMags: 3, reload: 2.6, price: 2700, killReward: 300,
    moveSpeed: 5.45, baseSpread: 0.0064, recovery: 0.368,
    recoil: 30.0, tracer: 0xffc46b, sound: 'rifle',
  },
  bastion: {
    id: 'bastion', name: 'Bastion-4', kind: 'rifle',
    damage: 33, hsMult: 4.0, pen: 0.70, falloff: 0.03, rpm: 666,
    mag: 30, reserveMags: 3, reload: 2.5, price: 2900, killReward: 300,
    moveSpeed: 5.7, baseSpread: 0.0058, recovery: 0.339,
    recoil: 23.0, tracer: 0x9fd8ff, sound: 'rifle',
  },
  raptor: {
    id: 'raptor', name: 'Raptor-9', kind: 'smg',
    damage: 26, hsMult: 4.0, pen: 0.65, falloff: 0.13, rpm: 857,
    mag: 30, reserveMags: 4, reload: 2.2, price: 1500, killReward: 600,
    moveSpeed: 6.1, baseSpread: 0.0085, recovery: 0.30,
    recoil: 16.0, tracer: 0xffe08a, sound: 'smg',
  },
  hinge: {
    id: 'hinge', name: 'Hinge P9', kind: 'pistol',
    damage: 34, hsMult: 4.0, pen: 0.705, falloff: 0.09, rpm: 400,
    mag: 15, reserveMags: 4, reload: 1.9, price: 0, killReward: 300,
    moveSpeed: 6.1, baseSpread: 0.0075, recovery: 0.30,
    recoil: 14.0, tracer: 0xd8d8d8, sound: 'pistol',
  },
  anvil: {
    id: 'anvil', name: 'Anvil .50', kind: 'pistol',
    damage: 53, hsMult: 3.9, pen: 0.932, falloff: 0.15, rpm: 267,
    mag: 7, reserveMags: 4, reload: 2.3, price: 700, killReward: 300,
    moveSpeed: 5.85, baseSpread: 0.0068, recovery: 0.811,
    recoil: 26.0, tracer: 0xffb060, sound: 'heavy',
  },
  talon: {
    id: 'talon', name: 'Talon', kind: 'knife',
    damage: 60, hsMult: 1.0, pen: 0.85, falloff: 0, rpm: 150,
    mag: Infinity, reserveMags: 0, reload: 0, price: 0, killReward: 1500,
    moveSpeed: 6.35, baseSpread: 0, recovery: 0.2,
    recoil: 0, range: 2.2, tracer: 0xffffff, sound: 'knife',
  },
};

export const ECONOMY = {
  winElimination: 3250,
  winObjective: 3500,
  lossBonus: [1400, 1900, 2400, 2900, 3400],
  plantPlanter: 800,
  plantTeam: 300,
  plantedButLost: 600,
  defuseBonus: 300,
};

export const SHOP = {
  armor: { name: 'Kevlar Vest', price: 650 },
  helmet: { name: 'Kevlar + Helmet', price: 1000 },
  kit: { name: 'Defuse Kit', price: 400 },
  smoke: { name: 'Smoke Grenade', price: 300 },
  flash: { name: 'Flashbang', price: 200 },
  frag: { name: 'Frag Grenade', price: 300 },
};

export const ACCURACY = {
  moveMultMax: 27,
  crouchMult: 0.75,
  airMult: 3.5,
};

export const RANK = {
  sPlus: { total: 88, acc: 0.40, hs: 0.45 },
  s: { total: 74, acc: 0.35, hs: 0.40 },
  a: 58, b: 40,
};


export const MAPS = [
  {
    id: 'killhouse',
    name: 'Killhouse',
    tag: 'Map 01 — Indoor CQB',
    outdoor: false,
    fog: [0x2a2118, 26, 60],
    ground: { w: 38, d: 30, mat: 'concrete' },
    sky: 0x1c1712,
    ambient: 0xc8b49a,
    sun: { color: 0xffe0b0, intensity: 1.4, pos: [10, 18, 6] },
    ceiling: { y: 4.2, panels: [[-12, -8], [0, -8], [12, -8], [-12, 0], [0, 0], [12, 0], [-12, 8], [0, 8], [12, 8]] },
    solids: [
      { x: 0, z: -15.3, w: 38.6, d: 0.6, h: 4.2, mat: 'wall' },
      { x: 0, z: 15.3, w: 38.6, d: 0.6, h: 4.2, mat: 'wall' },
      { x: -19.3, z: 0, w: 0.6, d: 30.6, h: 4.2, mat: 'wall' },
      { x: 19.3, z: 0, w: 0.6, d: 30.6, h: 4.2, mat: 'wall' },
      { x: -6, z: -6, w: 0.6, d: 12, h: 4.2, mat: 'wall' },
      { x: -6, z: 6, w: 0.6, d: 6, h: 4.2, mat: 'wall' },
      { x: 6, z: -3, w: 0.6, d: 12, h: 4.2, mat: 'wall' },
      { x: 6, z: 9, w: 0.6, d: 6, h: 4.2, mat: 'wall' },
      { x: -12, z: 0, w: 12, d: 0.6, h: 4.2, mat: 'wall' },
      { x: 12, z: 0, w: 12, d: 0.6, h: 4.2, mat: 'wall' },
      { x: 0, z: -10, w: 12, d: 0.6, h: 4.2, mat: 'wall' },
      { x: -2, z: 11, w: 8, d: 0.6, h: 4.2, mat: 'wall' },
      { x: -14, z: -10, w: 4, d: 0.6, h: 4.2, mat: 'wall' },
      { x: 14, z: 10, w: 4, d: 0.6, h: 4.2, mat: 'wall' },
      { x: -2, z: -4, w: 3.2, d: 0.4, h: 1.1, mat: 'plywood' },
      { x: 3, z: 4, w: 3.2, d: 0.4, h: 1.1, mat: 'plywood' },
      { x: -11, z: 6, w: 0.4, d: 3.2, h: 1.1, mat: 'plywood' },
      { x: 11, z: -6, w: 0.4, d: 3.2, h: 1.1, mat: 'plywood' },
      { x: 0, z: 13, w: 4, d: 0.4, h: 1.1, mat: 'plywood' },
      { x: 16, z: -10, w: 0.2, d: 1.6, h: 1.8, y0: 0.0, mat: 'target' },
      { x: 16, z: -4, w: 0.2, d: 1.6, h: 1.8, mat: 'target' },
      { x: 16, z: 2, w: 0.2, d: 1.6, h: 1.8, mat: 'target' },
      { x: -15, z: -12, w: 2.4, d: 2.4, h: 2.4, mat: 'crate' },
      { x: 15, z: 12, w: 2.4, d: 2.4, h: 2.4, mat: 'crate' },
      { x: -15, z: 12, w: 1.6, d: 1.6, h: 1.6, mat: 'crate' },
      { x: 15, z: -12, w: 1.6, d: 1.6, h: 1.6, mat: 'crate' },
    ],
    sites: [
      { id: 'A', x: -15.5, z: -12, r: 3.2 },
      { id: 'B', x: 15.5, z: 12, r: 3.2 },
    ],
    spawns: {
      attack: [[-17, 12], [-16, 14], [-17, 8], [-15, 10], [-18, 10]],
      defend: [[17, -12], [16, -14], [17, -8], [15, -10], [18, -10]],
    },
    waypoints: [
      [-16, 10], [-12, 12], [-8, 12], [-2, 12], [4, 12], [10, 12], [16, 10],
      [-16, -2], [-10, -2], [-2, -2], [4, -2], [10, -2], [16, -2],
      [-16, -12], [-10, -12], [-2, -12], [4, -12], [10, -12], [16, -12],
      [-2, 6], [2, 6], [-2, -6], [2, -6], [-12, 4], [12, -4],
    ],
    // Named zones feed the radio callouts ("Contact at East Lane").
    zones: [
      { name: 'West Hall', x: -14, z: 8, r: 7 },
      { name: 'East Lane', x: 14, z: -6, r: 7 },
      { name: 'South Room', x: 2, z: 12, r: 6 },
      { name: 'North Corridor', x: 0, z: -12, r: 7 },
      { name: 'Mid Spine', x: 0, z: 0, r: 6 },
    ],
    props: [
      { kind: 'barrel', x: -9, z: -9 }, { kind: 'barrel', x: -8.2, z: -9 },
      { kind: 'barrel', x: 9, z: 9 }, { kind: 'barrel', x: 9.8, z: 9 },
      { kind: 'barrier', x: -2, z: 2 }, { kind: 'barrier', x: 5, z: -8 },
      { kind: 'lamp', x: -16, z: -2 }, { kind: 'lamp', x: 16, z: 2 },
    ],
    signs: [
      { text: 'KILLHOUSE', x: -18.9, y: 2.6, z: 0, rotY: Math.PI / 2, w: 6 },
      { text: 'SITE A', x: -15.5, y: 2.4, z: -14.9, rotY: 0, w: 3.4 },
      { text: 'SITE B', x: 15.5, y: 2.4, z: 14.9, rotY: Math.PI, w: 3.4 },
      { text: 'LANE 02', x: 18.9, y: 2.4, z: -4, rotY: -Math.PI / 2, w: 3 },
    ],
  },
  {
    id: 'foundry',
    name: 'Foundry Yard',
    tag: 'Map 02 — Outdoor Industrial',
    outdoor: true,
    // Sunset palette: low amber sun, long shadows, warm haze. One palette
    // for the whole map so the yard reads at a glance.
    fog: [0x8a5a3a, 45, 130],
    ground: { w: 46, d: 38, mat: 'cobble' },
    sky: 0x2e1a24,
    ambient: 0xd8a878,
    sun: { color: 0xff9a4a, intensity: 3.0, pos: [38, 13, -20] },
    solids: [
      { x: 0, z: -19.3, w: 46.6, d: 0.6, h: 3.4, mat: 'brick' },
      { x: 0, z: 19.3, w: 46.6, d: 0.6, h: 3.4, mat: 'brick' },
      { x: -23.3, z: 0, w: 0.6, d: 38.6, h: 3.4, mat: 'brick' },
      { x: 23.3, z: 0, w: 0.6, d: 38.6, h: 3.4, mat: 'brick' },
      { x: -8, z: -12.5, w: 30, d: 0.6, h: 3.0, mat: 'wall' },
      { x: 12, z: -16, w: 0.6, d: 7, h: 3.0, mat: 'wall' },
      { x: -4, z: 0, w: 8, d: 0.8, h: 3.2, mat: 'wall' },
      { x: 4, z: 0, w: 8, d: 0.8, h: 3.2, mat: 'wall' },
      { x: 0, z: -6, w: 0.8, d: 12, h: 3.2, mat: 'wall' },
      { x: -14, z: 10, w: 14, d: 0.8, h: 3.6, mat: 'wall' },
      { x: -14, z: 16, w: 14, d: 0.8, h: 3.6, mat: 'wall' },
      { x: -20, z: 13, w: 0.8, d: 6, h: 3.6, mat: 'wall' },
      { x: 12, z: -6, w: 10, d: 3, h: 0.4, y0: 3.2, mat: 'metal' },
      { ramp: 1, x: 6.2, z: -6, w: 3, len: 5.5, dir: 'x+', y0: 0, y1: 3.2 },
      { ramp: 1, x: 17.8, z: -6, w: 3, len: 5.5, dir: 'x-', y0: 0, y1: 3.2 },
      { x: -18, z: -14, w: 2.4, d: 2.4, h: 2.4, mat: 'crate' },
      { x: -18, z: -14, w: 2.4, d: 2.4, h: 2.4, y0: 2.4, mat: 'crate' },
      { x: 18, z: 14, w: 2.4, d: 2.4, h: 2.4, mat: 'crate' },
      { x: 18, z: 14, w: 2.4, d: 2.4, h: 2.4, y0: 2.4, mat: 'crate' },
      { x: 8, z: 12, w: 2.4, d: 2.4, h: 2.4, mat: 'crate' },
      { x: -6, z: -4, w: 1.6, d: 1.6, h: 1.6, mat: 'crate' },
      { x: 19, z: -14, w: 4, d: 4, h: 5, mat: 'furnace' },
      { x: 0, z: 17.5, w: 30, d: 1.2, h: 1.0, mat: 'metal' },
    ],
    sites: [
      { id: 'A', x: -17, z: -15, r: 3.4 },
      { id: 'B', x: 17, z: 13, r: 3.4 },
    ],
    spawns: {
      attack: [[-21, 16], [-20, 18], [-21, 12], [-19, 14], [-22, 14]],
      defend: [[21, -16], [20, -18], [21, -12], [19, -14], [22, -14]],
    },
    waypoints: [
      [-20, 14], [-14, 14], [-8, 10], [-2, 8], [4, 8], [10, 10], [16, 12],
      [-20, -8], [-14, -8], [-8, -8], [-2, -4], [2, -2], [8, -4], [14, -4], [20, -8],
      [-18, -15], [-10, -15], [0, -15], [10, -15], [18, -15],
      [-2, 14], [2, 14], [12, -6], [6, -6], [18, -6],
    ],
    zones: [
      { name: 'Furnace', x: 18, z: -13, r: 6 },
      { name: 'Catwalk', x: 12, z: -6, r: 5 },
      { name: 'Mid Connector', x: 0, z: 0, r: 6 },
      { name: 'North Lane', x: 0, z: -15, r: 7 },
      { name: 'South Pipes', x: 0, z: 16, r: 7 },
      { name: 'Yard Crates', x: -16, z: -13, r: 6 },
    ],
    props: [
      { kind: 'barrel', x: -4, z: 6 }, { kind: 'barrel', x: -3.2, z: 6.4 }, { kind: 'barrel', x: -3.6, z: 5.2 },
      { kind: 'barrel', x: 14, z: 8 }, { kind: 'barrel', x: -12, z: -10 },
      { kind: 'barrel', x: 3, z: 9 }, { kind: 'barrel', x: 11, z: 9 },
      { kind: 'planter', x: -10, z: 14 }, { kind: 'planter', x: 6, z: -12 },
      { kind: 'barrier', x: 0, z: -3 }, { kind: 'barrier', x: -8, z: 2 },
      { kind: 'lamp', x: -20, z: 0 }, { kind: 'lamp', x: 20, z: 0 }, { kind: 'lamp', x: 0, z: -18 },
    ],
    signs: [
      { text: 'FOUNDRY', x: 0, y: 2.8, z: -18.9, rotY: 0, w: 8 },
      { text: 'SITE A', x: -17, y: 2.4, z: -18.9, rotY: 0, w: 3.4 },
      { text: 'SITE B', x: 17, y: 2.4, z: 18.9, rotY: Math.PI, w: 3.4 },
      { text: 'YARD 02', x: -22.9, y: 2.4, z: 8, rotY: Math.PI / 2, w: 3.4 },
      { text: 'DANGER — HOT METAL', x: 19, y: 3.4, z: -16.1, rotY: Math.PI, w: 4.5 },
    ],
  },
];
