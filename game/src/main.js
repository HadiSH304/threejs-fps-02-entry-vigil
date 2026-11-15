// VIGIL // FOUNDRY — bootstrap, fixed-step loop, shooting and effects.
// The simulation runs at a fixed 60 Hz (frame dt clamped to 0.05 s) and is
// kept apart from rendering: Match (game.js) decides, bots.js moves the
// AI, and this file only wires input, raycasts shots, draws tracers /
// sparks / smoke / flash, and drives the HUD. Staging mode (?shot=) sets
// up deterministic scenes for screenshots without pointer lock.

import * as THREE from 'three';
import { MAPS, WEAPONS, GAME, SHOP } from './config.js';
import { buildTextures } from './textures.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Bot, segmentHitsSphere } from './bots.js';
import { Match } from './game.js';
import { SoundBank } from './audio.js';
import { HUD } from './hud.js';
import { applyHit, computeHit } from './damage.js';
import { makeWeaponState, currentSpread, canFire, fireWeapon, startReload, updateWeapon } from './weapons.js';

const FIXED_DT = 1 / 60;
const params = new URLSearchParams(location.search);
const SHOT_MODE = params.get('shot'); // deploy | fight | buy | aar | yard

window.__VIGIL_ERRORS__ = [];
window.addEventListener('error', (e) => window.__VIGIL_ERRORS__.push(String(e.message || e.error)));

const canvasHost = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
canvasHost.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.08, 220);
scene.add(camera);

const textures = buildTextures();
const sound = new SoundBank();
const hud = new HUD(document);

let world = new World(scene, textures, MAPS[0]);
let player = new Player(world, MAPS[0].spawns.attack[0]);
player.team = 'attack';
player.utility = { smoke: 1, flash: 1, frag: 0 };
player.hasKit = false;

const match = new Match({
  world,
  player,
  spawnBot: (team, index, spawn, wave, weaponId) => new Bot(scene, world, team, index, spawn, wave, weaponId),
  onEvent: handleMatchEvent,
});
match.bots = [];

// Weapon loadout: slot 1 rifle (Kestrel-7 attack / Bastion-4 defend),
// slot 2 sidearm, slot 3 knife. Bought weapons replace slot 1.
const loadout = {
  1: makeWeaponState(WEAPONS.kestrel),
  2: makeWeaponState(WEAPONS.hinge),
  3: makeWeaponState(WEAPONS.talon),
};
let activeSlot = 1;
let sensitivity = 1.0;
let mapIndex = 0;
let pendingMapSwitch = -1;

const input = {
  f: false, b: false, l: false, r: false,
  walk: false, crouch: false, jump: false,
  fire: false, holdE: false,
};
let pointerLocked = false;
let paused = false;
let buyOpen = false;
let scoreboardOpen = false;
let spectateTarget = null;

// --- transient effects ---------------------------------------------------
const tracers = [];   // {line, life}
const sparks = [];    // {points, life, vel}
const smokes = [];    // {pos: Vector3, radius, until, mesh}
const projectiles = []; // thrown utility {kind, pos, vel, until}
const muzzleLight = new THREE.PointLight(0xffc46b, 0, 9, 2);
scene.add(muzzleLight);
const viewmodel = buildViewmodel();
camera.add(viewmodel);

function buildViewmodel() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.5, metalness: 0.6 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xd86a2a, roughness: 0.5, metalness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.62), dark);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.34), dark);
  barrel.position.set(0, 0.02, -0.42);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.1), accent);
  grip.position.set(0, -0.14, 0.16); grip.rotation.x = 0.3;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), accent);
  sight.position.set(0, 0.09, -0.1);
  g.add(body, barrel, grip, sight);
  g.position.set(0.28, -0.24, -0.55);
  return g;
}

function setViewmodel(weaponId) {
  const colors = { kestrel: 0xd86a2a, bastion: 0x3a7bd5, raptor: 0xc9a227, hinge: 0x888888, anvil: 0x8a6a3e, talon: 0xcccccc };
  viewmodel.children.forEach((c) => {
    if (c.material && c.material.color && c.position.y < 0) c.material.color.setHex(colors[weaponId] ?? 0xd86a2a);
  });
  viewmodel.visible = true;
}

// --- match events ----------------------------------------------------------
function handleMatchEvent(ev) {
  switch (ev.type) {
    case 'roundStart':
      hud.setScore(match.score.attack, match.score.defend, match.round, MAPS[mapIndex].name, match.wave);
      hud.centerMsg(`ROUND ${match.round} — ${match.playerTeam === 'attack' ? 'PLANT THE CHARGE' : 'DEFEND THE SITES'}`);
      sound.beep();
      break;
    case 'phaseLive':
      hud.centerMsg('GO GO GO');
      break;
    case 'roundEnd': {
      hud.setScore(match.score.attack, match.score.defend, match.round, MAPS[mapIndex].name, match.wave);
      const msg = ev.playerWon ? `ROUND WON — ${ev.reason}` : `ROUND LOST — ${ev.reason}`;
      hud.centerMsg(msg, 4000);
      hud.feed(msg, ev.playerWon ? 'good' : 'bad');
      if (ev.playerWon) sound.roundWin(); else sound.roundLose();
      break;
    }
    case 'halftime':
      hud.centerMsg(`HALFTIME — SIDES SWAPPED. YOU ARE NOW ${ev.newSide === 'attack' ? 'EMBER JACKALS (ATTACK)' : 'HARBOR WARDENS (DEFEND)'}`, 4500);
      break;
    case 'planted':
      hud.feed(`Charge planted at site ${ev.site.id}`, 'good');
      hud.centerMsg(`CHARGE PLANTED — SITE ${ev.site.id} — 40s`, 3500);
      sound.plant();
      break;
    case 'matchEnd': {
      document.exitPointerLock?.();
      hud.showAAR(true, ev.stats);
      hud.feed(`MATCH ${ev.winner === match.playerTeam ? 'WON' : 'LOST'} — RANK ${ev.stats.rank}`, 'good');
      break;
    }
    case 'killFeed':
      hud.feed(`${ev.killer} ${ev.headshot ? '☠' : '✕'} ${ev.victim}${ev.weapon ? ` [${ev.weapon}]` : ''}`, ev.killer === 'YOU' ? 'good' : '');
      break;
    case 'playerDied':
      hud.centerMsg(`ELIMINATED BY ${ev.killer} — SPECTATING`, 3000);
      spectateTarget = match.bots.find((b) => b.alive && b.team === player.team) ?? null;
      break;
    case 'respawned':
      spectateTarget = null;
      player.utility = { smoke: 1, flash: 1, frag: 0 };
      player.hasKit = false;
      loadout[1] = makeWeaponState(player.team === 'attack' ? WEAPONS.kestrel : WEAPONS.bastion);
      loadout[2] = makeWeaponState(WEAPONS.hinge);
      loadout[3] = makeWeaponState(WEAPONS.talon);
      activeSlot = 1;
      setViewmodel(loadout[1].def.id);
      break;
    case 'boughtWeapon': {
      loadout[1] = makeWeaponState(ev.weapon);
      activeSlot = 1;
      setViewmodel(ev.weapon.id);
      sound.buy();
      break;
    }
    case 'bought': sound.buy(); break;
    case 'removeBot': ev.bot.dispose(scene); break;
  }
}

// --- shooting ---------------------------------------------------------------
const raycaster = new THREE.Raycaster();
raycaster.far = 120;

function botHitMeshes() {
  const list = [];
  for (const b of match.bots) if (b.alive) list.push(...b.hitMeshes);
  return list;
}

function shootPlayer(now) {
  const state = loadout[activeSlot];
  const def = state.def;
  if (!canFire(state, now)) {
    if (state.mag <= 0) sound.dryFire();
    return;
  }
  const off = fireWeapon(state, now);
  player.addRecoil(off.pitch, off.yaw);
  match.stats.shots++;
  sound.shot(def.sound, 0);
  muzzleLight.position.copy(player.eyePos).add(new THREE.Vector3(0, -0.1, 0));
  muzzleLight.intensity = 14;
  setTimeout(() => { muzzleLight.intensity = 0; }, 50);

  if (def.kind === 'knife') {
    // Melee: short ray, generous angle.
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    let best = null, bestD = def.range;
    for (const b of match.bots) {
      if (!b.alive || b.team === player.team) continue;
      const d = b.pos.distanceTo(player.pos);
      if (d > def.range) continue;
      const to = new THREE.Vector3(b.pos.x - player.pos.x, 0, b.pos.z - player.pos.z).normalize();
      if (to.dot(new THREE.Vector3(dir.x, 0, dir.z).normalize()) < 0.6) continue;
      if (d < bestD) { best = b; bestD = d; }
    }
    if (best) {
      const res = applyHit(def, 'chest', bestD, best);
      registerPlayerHit(best, res, false, bestD);
    }
    return;
  }

  // Spread: random direction inside the current spread cone.
  const spread = currentSpread(state, player.speedFrac, player.crouched, !player.onGround);
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const jitter = new THREE.Vector3(
    (Math.random() - 0.5) * 2 * spread,
    (Math.random() - 0.5) * 2 * spread,
    0,
  );
  dir.add(jitter).normalize();
  raycaster.set(player.eyePos, dir);

  // Smoke blocks the player's shots too: count the denial for telemetry.
  const smokeHit = smokes.find((s) => {
    const end = player.eyePos.clone().add(dir.clone().multiplyScalar(120));
    return segmentHitsSphere(player.eyePos, end, s.pos, s.radius);
  });
  const hits = raycaster.intersectObjects([...botHitMeshes(), ...world.group.children], false);
  const first = hits[0];
  if (!first) { addTracer(player.eyePos, player.eyePos.clone().add(dir.clone().multiplyScalar(60)), def.tracer); return; }
  const hitPoint = first.point;
  addTracer(player.eyePos, hitPoint, def.tracer);
  const dist = player.eyePos.distanceTo(hitPoint);
  if (smokeHit && first.distance > player.eyePos.distanceTo(smokeHit.pos) - smokeHit.radius) {
    match.stats.smokeDenials++;
    addSparks(hitPoint, false);
    return; // swallowed by smoke
  }
  const ud = first.object.userData;
  if (ud && ud.bot) {
    const res = applyHit(def, ud.part, dist, ud.bot);
    registerPlayerHit(ud.bot, res, ud.part === 'head', dist);
    addSparks(hitPoint, ud.part === 'head');
  } else {
    addSparks(hitPoint, false);
    sound.hit(false);
  }
}

function registerPlayerHit(bot, res, headshot, dist) {
  match.stats.hits++;
  match.stats.damageDealt += res.healthDmg;
  hud.hitmarker(headshot);
  sound.hit(headshot);
  // Tagging: a hit slows the victim briefly.
  if (bot.tagSlowUntil !== undefined) bot.tagSlowUntil = match.now + 0.25;
  if (res.killed) {
    bot.die();
    match.onKill(player, bot, loadout[activeSlot].def, headshot);
    sound.kill();
  } else {
    bot.hear(player.pos);
    if (bot.state === 'PATROL') bot.state = 'ALERT';
    bot.lastSeen = player.pos.clone();
  }
}

function addTracer(from, to, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  scene.add(line);
  tracers.push({ line, life: 0.09 });
}

function addSparks(point, gold) {
  const n = 14;
  const positions = new Float32Array(n * 3);
  const vel = [];
  for (let i = 0; i < n; i++) {
    positions[i * 3] = point.x; positions[i * 3 + 1] = point.y; positions[i * 3 + 2] = point.z;
    vel.push(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    color: gold ? 0xffd34d : 0xff8a3c, size: 0.09, transparent: true, opacity: 1,
  }));
  scene.add(pts);
  sparks.push({ points: pts, life: 0.35, vel });
}

// --- utility ----------------------------------------------------------------
function throwUtility(kind) {
  if (match.phase !== 'live' || !player.alive) return;
  if ((player.utility[kind] ?? 0) <= 0) { sound.denied(); hud.hint(`No ${kind} left — buy more with B`); return; }
  player.utility[kind]--;
  match.stats.utilityDeployed++;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  projectiles.push({
    kind,
    pos: player.eyePos.clone(),
    vel: dir.multiplyScalar(13).add(new THREE.Vector3(0, 3.5, 0)),
    until: match.now + 1.4,
  });
  sound.shot('pistol', 0);
}

function detonateUtility(p) {
  if (p.kind === 'smoke') {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(3.5, 20, 14),
      new THREE.MeshBasicMaterial({ map: textures.smoke, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    mesh.position.copy(p.pos);
    mesh.position.y = Math.max(1.2, p.pos.y);
    scene.add(mesh);
    smokes.push({ pos: mesh.position.clone(), radius: 3.5, until: match.now + 14, mesh });
    sound.smoke();
  } else if (p.kind === 'flash') {
    sound.flash();
    // Blind bots facing the flash within 25 m with line of sight.
    for (const b of match.bots) {
      if (!b.alive) continue;
      const d = b.pos.distanceTo(p.pos);
      if (d > 25) continue;
      if (world.segmentBlocked(p.pos, b.eyePos, 0.12)) continue;
      const toFlash = new THREE.Vector3(p.pos.x - b.pos.x, 0, p.pos.z - b.pos.z).normalize();
      const facing = new THREE.Vector3(Math.sin(b.yaw), 0, Math.cos(b.yaw));
      const facingDot = facing.dot(toFlash);
      if (facingDot > -0.2) { // facing it (or side-on)
        b.blindedUntil = match.now + Math.max(0.8, 4 - d * 0.12);
        if (b.team !== player.team) match.stats.enemiesBlinded++;
      }
    }
    // Player flash: looking toward it whites the screen.
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const toFlash = p.pos.clone().sub(player.eyePos).normalize();
    const dot = dir.dot(toFlash);
    const d = p.pos.distanceTo(player.eyePos);
    if (dot > 0.2 && d < 30) {
      hud.flash(Math.min(1, (1 - d / 30) * (0.4 + dot * 0.6)));
      sound.ring(3);
    }
  } else if (p.kind === 'frag') {
    sound.shot('heavy', 0);
    addSparks(p.pos, false);
    for (const b of match.bots) {
      if (!b.alive) continue;
      const d = b.pos.distanceTo(p.pos);
      if (d > 7) continue;
      if (world.segmentBlocked(p.pos, b.eyePos, 0.12)) continue;
      const dmg = 90 * (1 - d / 7);
      b.hp -= dmg;
      match.stats.damageDealt += dmg;
      if (b.hp <= 0) { b.die(); match.onKill(player, b, loadout[activeSlot].def, false); }
    }
    const pd = player.pos.distanceTo(p.pos);
    if (pd < 5 && player.team === 'attack') { /* friendly fire off for the player */ }
  }
}

// --- input ------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.code;
  if (k === 'KeyW') input.f = true;
  if (k === 'KeyS') input.b = true;
  if (k === 'KeyA') input.l = true;
  if (k === 'KeyD') input.r = true;
  if (k === 'ShiftLeft' || k === 'ShiftRight') input.walk = true;
  if (k === 'KeyC') input.crouch = true;
  if (k === 'Space') { input.jump = true; e.preventDefault(); }
  if (k === 'KeyE') input.holdE = true;
  if (k === 'KeyR') {
    const st = loadout[activeSlot];
    if (startReload(st, match.now)) sound.reload();
  }
  if (k === 'Digit1' || k === 'Digit2' || k === 'Digit3') {
    activeSlot = Number(k.slice(-1));
    setViewmodel(loadout[activeSlot].def.id);
  }
  if (k === 'KeyQ') throwUtility('smoke');
  if (k === 'KeyG') throwUtility('flash');
  if (k === 'KeyB' && match.phase === 'buy') {
    buyOpen = !buyOpen;
    hud.showBuy(buyOpen, player.money, new Set(boughtKeys()), WEAPONS);
    if (buyOpen) document.exitPointerLock?.();
    else if (!SHOT_MODE) renderer.domElement.requestPointerLock();
  }
  if (k === 'Tab') { scoreboardOpen = true; hud.showScoreboard(true, scoreboardRows()); e.preventDefault(); }
  if (k === 'KeyM') {
    pendingMapSwitch = (mapIndex + 1) % MAPS.length;
    hud.centerMsg(`${MAPS[pendingMapSwitch].name} will load next round — press M again to cancel`, 3000);
    if (pendingMapSwitch === mapIndex) pendingMapSwitch = -1;
  }
  // Buy menu number keys 1-9.
  if (buyOpen && /^Digit[1-9]$/.test(k)) {
    const idx = Number(k.slice(-1)) - 1;
    const entries = buyEntries();
    const entry = entries[idx];
    if (entry) {
      const res = match.buy(entry.key);
      if (!res.ok) { sound.denied(); hud.hint(res.why); }
      else { hud.showBuy(true, player.money, new Set(boughtKeys()), WEAPONS); hud.setVitals(player.hp, player.armor, player.money); }
    }
  }
});

document.addEventListener('keyup', (e) => {
  const k = e.code;
  if (k === 'KeyW') input.f = false;
  if (k === 'KeyS') input.b = false;
  if (k === 'KeyA') input.l = false;
  if (k === 'KeyD') input.r = false;
  if (k === 'ShiftLeft' || k === 'ShiftRight') input.walk = false;
  if (k === 'KeyC') input.crouch = false;
  if (k === 'Space') input.jump = false;
  if (k === 'KeyE') input.holdE = false;
  if (k === 'Tab') { scoreboardOpen = false; hud.showScoreboard(false); }
});

document.addEventListener('mousemove', (e) => {
  if (!pointerLocked || paused) return;
  player.yaw -= e.movementX * 0.0022 * sensitivity;
  player.pitch -= e.movementY * 0.0022 * sensitivity;
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch));
});

document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (!pointerLocked && !SHOT_MODE && match.phase !== 'deploy' && !buyOpen) {
    renderer.domElement.requestPointerLock();
    return;
  }
  if (pointerLocked || SHOT_MODE) input.fire = true;
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) input.fire = false; });
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
  paused = !pointerLocked && !SHOT_MODE && match.phase !== 'deploy' && !buyOpen;
});

function boughtKeys() {
  const keys = [];
  if (player.armor >= 100) keys.push('armor');
  if (player.helmet) keys.push('helmet');
  if (player.hasKit) keys.push('kit');
  return keys;
}

function buyEntries() {
  return [
    { key: 'kestrel', label: 'Kestrel-7', price: 2700 },
    { key: 'bastion', label: 'Bastion-4', price: 2900 },
    { key: 'raptor', label: 'Raptor-9 SMG', price: 1500 },
    { key: 'anvil', label: 'Anvil .50', price: 700 },
    { key: 'armor', label: 'Kevlar Vest', price: 650 },
    { key: 'helmet', label: 'Kevlar + Helmet', price: 1000 },
    { key: 'kit', label: 'Defuse Kit', price: 400 },
    { key: 'smoke', label: 'Smoke Grenade', price: 300 },
    { key: 'flash', label: 'Flashbang', price: 200 },
  ];
}

function scoreboardRows() {
  const rows = [{
    name: 'YOU', team: player.team, kills: match.stats.kills, deaths: match.stats.deaths,
    money: player.money, you: true, dead: !player.alive,
  }];
  for (const b of match.bots) {
    rows.push({ name: b.name, team: b.team, kills: 0, deaths: b.alive ? 0 : 1, money: 0, dead: !b.alive });
  }
  return rows;
}

// --- deploy / map switching --------------------------------------------------
function switchMap(index) {
  mapIndex = index;
  world.dispose();
  for (const b of match.bots) b.dispose(scene);
  match.bots = [];
  world = new World(scene, textures, MAPS[index]);
  match.world = world;
  player.world = world;
  player.pos.set(MAPS[index].spawns.attack[0][0], 0, MAPS[index].spawns.attack[0][1]);
  hud.setScore(match.score.attack, match.score.defend, match.round, MAPS[index].name, match.wave);
}

document.getElementById('play')?.addEventListener('click', () => {
  sound.ensure(); sound.resume();
  const sel = Number(document.querySelector('#deploy-map button.sel')?.dataset.map ?? 0);
  if (sel !== mapIndex) switchMap(sel);
  sensitivity = Number(document.getElementById('sens')?.value ?? 1);
  hud.showDeploy(false);
  renderer.domElement.requestPointerLock();
  match.startMatch(mapIndex, match.now);
});

document.getElementById('deploy-map')?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-map]');
  if (!btn) return;
  document.querySelectorAll('#deploy-map button').forEach((b) => b.classList.remove('sel'));
  btn.classList.add('sel');
});
document.getElementById('sens')?.addEventListener('input', (e) => {
  document.getElementById('sens-val').textContent = Number(e.target.value).toFixed(2);
});
document.getElementById('again')?.addEventListener('click', () => {
  hud.showAAR(false);
  match.wave = 1;
  match.startMatch(mapIndex, match.now);
  renderer.domElement.requestPointerLock();
});
document.getElementById('switch-map')?.addEventListener('click', () => {
  hud.showAAR(false);
  switchMap((mapIndex + 1) % MAPS.length);
  match.startMatch(mapIndex, match.now);
  renderer.domElement.requestPointerLock();
});
document.getElementById('next-wave')?.addEventListener('click', () => {
  hud.showAAR(false);
  match.wave = Math.min(5, match.wave + 1);
  hud.centerMsg(`WAVE ${match.wave} — FASTER REACTIONS, TIGHTER AIM`, 3000);
  match.startMatch(mapIndex, match.now);
  renderer.domElement.requestPointerLock();
});

// --- bot event processing -----------------------------------------------------
function processBotEvents(events) {
  for (const ev of events) {
    if (ev.type === 'botShot') {
      addTracer(ev.from, ev.end, ev.shooter.weapon.tracer);
      sound.shot(ev.shooter.weapon.sound, ev.from.distanceTo(player.eyePos));
      if (ev.hit && ev.target === player) {
        match.stats.damageTaken += ev.damage;
        player.hp -= ev.damage;
        sound.hurt();
        const ang = Math.atan2(ev.from.x - player.pos.x, ev.from.z - player.pos.z);
        hud.damageFlash(((ang - player.yaw) * 180) / Math.PI + 180);
        player.tagSlowUntil = match.now + 0.3;
        if (player.hp <= 0) { player.hp = 0; match.onKill(ev.shooter, player, ev.shooter.weapon, ev.headshot); }
      } else if (ev.hit && ev.target && ev.target.die) {
        const victim = ev.target;
        if (ev.killed) { victim.die(); match.onKill(ev.shooter, victim, ev.shooter.weapon, ev.headshot); }
      }
    } else if (ev.type === 'planted') {
      match.plantCharge(ev.site, ev.bot);
    } else if (ev.type === 'planting') {
      // Carrier progress is shown on the HUD when the player can see it.
    }
  }
  events.length = 0;
}

// --- fixed-step loop ----------------------------------------------------------
let lastTime = performance.now();
let accumulator = 0;
let framesRendered = 0;

function stepSim(dt) {
  const now = match.now + dt;
  match.now = now;
  if (paused) return;
  if (match.phase === 'live' || match.phase === 'buy' || match.phase === 'roundEnd') {
    // Player movement + firing.
    if (player.alive && match.phase !== 'roundEnd') {
      const state = loadout[activeSlot];
      player.step(input, dt, state.def.moveSpeed, now);
      updateWeapon(state, now, player.crouched);
      if (input.fire && match.phase === 'live') shootPlayer(now);
      sound.step(player.speedFrac);
      // Plant / defuse channel (E held, standing still).
      const moving = Math.hypot(player.vel.x, player.vel.z) > 0.8;
      const ch = match.channel(dt, input.holdE, moving);
      hud.setPlant(ch ? ch.progress : null, ch ? ch.label : '');
      if (input.holdE && match.phase === 'live') {
        const site = match.world.def.sites[0];
        const d = Math.hypot(player.pos.x - site.x, player.pos.z - site.z);
        if (player.team === 'attack' && !match.charge.planted) hud.hint(d < 10 ? 'Hold E to plant the charge' : 'Get to a site (A / B) to plant');
        else if (player.team === 'defend' && match.charge.planted) hud.hint('Hold E on the site to defuse');
      }
    }
    // Bots.
    const ctx = {
      now, dt, player, bots: match.bots, smokes,
      events: [], sound, phase: match.phase,
      chargePlanted: match.charge.planted, sites: match.world.def.sites, wave: match.wave,
    };
    for (const b of match.bots) b.update(ctx);
    processBotEvents(ctx.events);
    // Utility projectiles.
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.vel.y -= 12 * dt;
      p.pos.addScaledVector(p.vel, dt);
      const gy = world.groundHeight(p.pos.x, p.pos.z);
      if (p.pos.y <= gy + 0.1 || now >= p.until) { detonateUtility(p); projectiles.splice(i, 1); }
    }
    // Smoke expiry.
    for (let i = smokes.length - 1; i >= 0; i--) {
      if (now > smokes[i].until) { scene.remove(smokes[i].mesh); smokes.splice(i, 1); }
    }
    match.update(dt, now);
    // Map switch requested with M applies at the next round.
    if (pendingMapSwitch >= 0 && match.phase === 'buy' && match.round > 1) {
      switchMap(pendingMapSwitch);
      pendingMapSwitch = -1;
      match.respawnAll();
    }
  }
}

function frame(t) {
  requestAnimationFrame(frame);
  const frameDt = Math.min(0.05, (t - lastTime) / 1000);
  lastTime = t;
  if (!paused) {
    accumulator += frameDt;
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < 5) {
      stepSim(FIXED_DT);
      accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === 5) accumulator = 0;
  }
  // Camera: player, or spectate a teammate when dead.
  if (player.alive) player.applyCamera(camera);
  else if (spectateTarget && spectateTarget.alive) {
    camera.position.set(spectateTarget.pos.x, spectateTarget.pos.y + 1.6, spectateTarget.pos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = spectateTarget.yaw;
    camera.rotation.x = 0;
  }
  // Viewmodel sway + recoil.
  viewmodel.position.y = -0.24 + Math.sin(t * 0.002) * 0.004 * player.speedFrac;
  viewmodel.rotation.x = player.recoilPitch * 0.4;
  // Effect lifetimes.
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].life -= frameDt;
    tracers[i].line.material.opacity = Math.max(0, tracers[i].life / 0.09) * 0.9;
    if (tracers[i].life <= 0) { scene.remove(tracers[i].line); tracers[i].line.geometry.dispose(); tracers.splice(i, 1); }
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life -= frameDt;
    const pos = s.points.geometry.attributes.position;
    for (let j = 0; j < s.vel.length; j++) {
      pos.array[j * 3] += s.vel[j].x * frameDt;
      pos.array[j * 3 + 1] += s.vel[j].y * frameDt;
      pos.array[j * 3 + 2] += s.vel[j].z * frameDt;
      s.vel[j].y -= 6 * frameDt;
    }
    pos.needsUpdate = true;
    s.points.material.opacity = Math.max(0, s.life / 0.35);
    if (s.life <= 0) { scene.remove(s.points); s.points.geometry.dispose(); sparks.splice(i, 1); }
  }
  // HUD (cheap DOM writes each frame; numbers only when changed is overkill).
  const st = loadout[activeSlot];
  hud.setCrosshair(currentSpread(st, player.speedFrac, player.crouched, !player.onGround) * 9000, player.alive && match.phase !== 'deploy');
  hud.setAmmo(st.mag, st.reserve, st.reloading);
  hud.setVitals(player.hp, player.armor, player.money);
  if (match.phase === 'buy') hud.setTimer(match.phaseT, 'buy');
  else if (match.phase === 'live') hud.setTimer(match.charge.planted ? match.charge.timer : match.roundT, match.charge.planted ? 'charge' : 'live');
  else hud.setTimer(0, match.phase);
  if (match.phase !== 'deploy') {
    hud.drawRadar(player, match.bots, match.world.def.sites, match.world.def, match.seenEnemies);
  }
  renderer.render(scene, camera);
  framesRendered++;
  if (framesRendered === 30) window.__SHOT_READY__ = true;
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- staging mode for screenshots -------------------------------------------
// ?shot=fight  — mid-fight on Killhouse: round live, enemies ahead.
// ?shot=yard   — Foundry Yard overview from the attack spawn.
// ?shot=buy    — buy menu open during the buy phase.
// ?shot=aar    — After-Action Report with sample stats.
// ?shot=deploy — the deploy screen (default).
function stageShot() {
  if (!SHOT_MODE || SHOT_MODE === 'deploy') { hud.showDeploy(true, MAPS, 0, 1.0); return; }
  sound.ensure();
  hud.showDeploy(false);
  if (SHOT_MODE === 'yard') switchMap(1);
  match.startMatch(mapIndex, 0);
  match.phase = 'live';
  match.phaseT = 0;
  match.roundT = 85;
  if (SHOT_MODE === 'fight') {
    // Put the player mid-map, aiming down the east lane at two enemies.
    player.pos.set(-2, 0, 2);
    player.yaw = -Math.PI / 2 - 0.35;
    player.pitch = -0.02;
    const foes = match.bots.filter((b) => b.team !== player.team);
    foes[0].pos.set(8, 0, -4); foes[0].yaw = Math.PI / 2; foes[0].syncMesh();
    foes[1].pos.set(12, 0, 2); foes[1].yaw = Math.PI / 2; foes[1].syncMesh();
    foes[2].pos.set(4, 0, 8); foes[2].yaw = Math.PI; foes[2].syncMesh();
    addTracer(player.eyePos, foes[0].eyePos, WEAPONS.kestrel.tracer);
    addSparks(foes[0].eyePos, true);
    hud.hitmarker(true);
  }
  if (SHOT_MODE === 'yard') {
    player.pos.set(-18, 0, 10);
    player.yaw = -Math.PI / 2 - 0.5;
    player.pitch = 0.05;
    const foes = match.bots.filter((b) => b.team !== player.team);
    foes[0].pos.set(2, 0, -4); foes[0].syncMesh();
    foes[1].pos.set(12, 3.6, -6); foes[1].syncMesh(); // on the catwalk
  }
  if (SHOT_MODE === 'buy') {
    match.phase = 'buy';
    match.phaseT = 14;
    player.money = 4750;
    hud.showBuy(true, player.money, new Set(), WEAPONS);
  }
  if (SHOT_MODE === 'aar') {
    match.stats = {
      shots: 142, hits: 68, headshotKills: 9, kills: 17, deaths: 6,
      damageDealt: 2140, damageTaken: 1230, utilityDeployed: 6,
      enemiesBlinded: 3, smokeDenials: 4, plants: 1, defuses: 0, roundsWon: 9,
    };
    match.matchStart = 0;
    hud.showAAR(true, match.aarStats(512));
    hud.centerMsg('MATCH WON 9 — 4 — RANK S', 60000);
  }
  hud.setScore(match.score.attack, match.score.defend, match.round, MAPS[mapIndex].name, match.wave);
}

stageShot();
requestAnimationFrame(frame);

// Test + automation hooks (used by the soak test and screenshot scripts).
window.__VIGIL__ = {
  match, player, world: () => world, MAPS, WEAPONS, loadout,
  get bots() { return match.bots; },
  get phase() { return match.phase; },
  get smokes() { return smokes; },
  shoot: () => shootPlayer(match.now),
  throwUtility, switchMap,
  step: (n = 1) => { for (let i = 0; i < n; i++) stepSim(FIXED_DT); },
  frames: () => framesRendered,
};
