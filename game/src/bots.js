// VIGIL // FOUNDRY — bot AI. State machine: PATROL -> ALERT (gunshot
// heard / glimpse) -> ENGAGE (burst fire + tactical strafe) -> TAKE_COVER
// (HP < 40%). Vision is a raycast cone blocked by walls and smoke;
// hearing is an event the game feeds in. One attack bot carries the
// charge and plants it. Difficulty scales by wave: faster reactions,
// tighter aim, longer bursts. Bot fire resolves through the same hitscan
// path the player uses (ctx.hitscan, main.js): line-of-sight raycast vs
// world and body hitboxes, spread from the bot's state, hitgroup from
// the real hit position, damage through the shared damage module. No
// probability roll decides a bot hit. Bots also talk: first contact,
// low HP and plant events go out as radio callouts (radio.js), and the
// squad reacts to them. Each bot follows the round's team plan (plans.js):
// a role and a route, held until a callout rotates it.

import * as THREE from 'three';
import { applyHit } from './damage.js';
import { WEAPONS } from './config.js';
import { zoneName } from './radio.js';

const TEAM_COLOR = { attack: 0xd86a2a, defend: 0x3a7bd5 };
const NAMES = {
  attack: ['Ember', 'Cinder', 'Flare', 'Ash', 'Spark'],
  defend: ['Harbor', 'Anchor', 'Breaker', 'Tide', 'Reef'],
};

function nameSprite(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,12,14,0.7)'; g.fillRect(0, 8, 256, 48);
  g.fillStyle = color; g.font = 'bold 30px monospace'; g.textAlign = 'center';
  g.fillText(text, 128, 42);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(2.2, 0.55, 1);
  return sp;
}

export class Bot {
  constructor(scene, world, team, index, spawn, wave, weaponId) {
    this.world = world;
    this.team = team;
    this.index = index;
    this.name = NAMES[team][index % 5];
    this.pos = new THREE.Vector3(spawn[0], 0, spawn[1]);
    this.yaw = team === 'attack' ? Math.PI / 2 : -Math.PI / 2;
    this.hp = 100;
    this.armor = 0;
    this.helmet = false;
    this.alive = true;
    this.weapon = WEAPONS[weaponId];
    this.mag = this.weapon.mag;
    this.state = 'PATROL';
    this.path = [];
    this.pathIdx = 0;
    this.target = null;
    this.lastSeen = null;
    this.reactionUntil = 0;
    this.burstLeft = 0;
    this.nextShotAt = 0;
    this.burstPauseUntil = 0;
    this.strafeDir = 1;
    this.strafeUntil = 0;
    this.blindedUntil = 0;
    this.plantProgress = 0;
    this.carrier = false;
    this.crouching = false;
    this.speed = 3.4;
    this.wave = wave;
    this.role = 'entry';
    this.planRoute = null;
    this.planIdx = 0;
    this.planDone = false;
    this.group = this.buildMesh(scene);
    this.group.position.copy(this.pos);
  }

  buildMesh(scene) {
    const color = TEAM_COLOR[this.team];
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.9 });
    const box = (w, h, d, m, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      group.add(mesh);
      return mesh;
    };
    // Team color reads at a glance: colored torso, helmet stripe and
    // shoulder pads; attackers carry a backpack, defenders a bulkier
    // chest plate, so the two sides have distinct silhouettes.
    const torsoW = this.team === 'defend' ? 0.62 : 0.55;
    const legs = box(0.42, 0.75, 0.3, dark, 0, 0.375, 0);
    legs.userData = { bot: this, part: 'leg' };
    const torso = box(torsoW, 0.62, 0.32, mat, 0, 1.06, 0);
    torso.userData = { bot: this, part: 'chest' };
    const head = box(0.34, 0.34, 0.34, new THREE.MeshStandardMaterial({ color: 0xc9a586, roughness: 0.7 }), 0, 1.56, 0);
    head.userData = { bot: this, part: 'head' };
    box(0.36, 0.06, 0.36, new THREE.MeshBasicMaterial({ color }), 0, 1.75, 0);
    box(0.36, 0.1, 0.05, new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.3, emissive: color, emissiveIntensity: 0.35 }), 0, 1.58, 0.18);
    for (const sx of [-1, 1]) box(0.14, 0.12, 0.34, mat, sx * (torsoW / 2 + 0.05), 1.34, 0);
    if (this.team === 'attack') box(0.4, 0.5, 0.18, dark, 0, 1.1, -0.26);
    else box(0.5, 0.4, 0.06, new THREE.MeshStandardMaterial({ color: 0x2e4a6a, roughness: 0.6, metalness: 0.3 }), 0, 1.1, 0.19);
    box(0.09, 0.12, 1.0, dark, 0.28, 1.15, 0.35);
    box(0.1, 0.03, 0.5, new THREE.MeshBasicMaterial({ color }), 0.28, 1.22, 0.35);
    box(0.06, 0.06, 0.12, new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.7 }), 0.28, 1.15, -0.2);
    this.hitMeshes = [legs, torso, head];
    const label = nameSprite(this.name, this.team === 'attack' ? '#ffb060' : '#8fc4ff');
    label.position.y = 2.05;
    group.add(label);
    group.traverse((o) => { o.castShadow = true; });
    scene.add(group);
    return group;
  }

  get eyePos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + 1.55, this.pos.z);
  }

  isBlinded(now) { return now < this.blindedUntil; }

  canSee(pos, now, smokes) {
    if (this.isBlinded(now)) return false;
    const dx = pos.x - this.pos.x, dz = pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 38) return false;
    const ang = Math.atan2(dx, dz);
    let diff = Math.abs(((ang - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (diff > 1.75 && this.state === 'PATROL') return false;
    const eye = this.eyePos;
    const target = new THREE.Vector3(pos.x, pos.y + 1.2, pos.z);
    if (this.world.segmentBlocked(eye, target, 0.12)) return false;
    for (const s of smokes) {
      if (segmentHitsSphere(eye, target, s.pos, s.radius)) return false;
    }
    return true;
  }

  hear(pos) {
    if (this.state === 'PATROL') {
      this.state = 'ALERT';
      this.lastSeen = pos.clone();
    }
  }

  // Radio: say a line through the shared Radio (radio.js). Emits a
  // 'radio' event so main.js can show it and order reactions. pos is the
  // radar-blip position (the enemy's position for a contact callout).
  // Returns the line or null when throttled.
  callRadio(ctx, kind, area, pos) {
    if (!ctx.radio) return null;
    const line = ctx.radio.say(this, kind, area, ctx.now, this.world.def, pos ?? this.pos);
    if (line) ctx.events.push({ type: 'radio', line, kind, bot: this, area, x: (pos ?? this.pos).x, z: (pos ?? this.pos).z });
    return line;
  }

  // Rotate toward a callout: break off the plan route and walk to the
  // named point. Fighting and covering bots do not rotate.
  rotateTo(x, z) {
    if (this.state === 'ENGAGE' || this.state === 'TAKE_COVER') return false;
    this.planRoute = [{ x, z }];
    this.planIdx = 0;
    this.planDone = false;
    this.path = []; this.pathIdx = 0;
    this.state = 'PATROL';
    return true;
  }

  setPathTo(tx, tz) {
    this.path = this.world.findPath(this.pos.x, this.pos.z, tx, tz);
    this.pathIdx = 0;
  }

  followPath(dt, speed) {
    if (this.pathIdx >= this.path.length) return true;
    const node = this.world.graph[this.path[this.pathIdx]];
    const dx = node.x - this.pos.x, dz = node.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.6) { this.pathIdx++; return this.pathIdx >= this.path.length; }
    this.yaw = Math.atan2(dx, dz);
    const step = Math.min(dist, speed * dt);
    const nx = this.pos.x + (dx / dist) * step;
    const nz = this.pos.z + (dz / dist) * step;
    const moved = this.world.moveBox(this.pos.x, this.pos.y, this.pos.z, nx - this.pos.x, nz - this.pos.z, 0.36, 0.36, 1.7);
    this.pos.x = moved.x; this.pos.z = moved.z;
    this.pos.y = this.world.groundHeight(this.pos.x, this.pos.z);
    return false;
  }

  update(ctx) {
    if (!this.alive) return;
    const now = ctx.now;
    const speed = this.crouching ? this.speed * 0.5 : this.speed;

    let enemy = null, enemyDist = Infinity;
    const candidates = [];
    if (ctx.player.alive && ctx.player.team !== this.team) candidates.push({ kind: 'player', ref: ctx.player, pos: ctx.player.pos });
    for (const b of ctx.bots) {
      if (b !== this && b.alive && b.team !== this.team) candidates.push({ kind: 'bot', ref: b, pos: b.pos });
    }
    for (const c of candidates) {
      const d = Math.hypot(c.pos.x - this.pos.x, c.pos.z - this.pos.z);
      if (d < enemyDist) { enemyDist = d; enemy = c; }
    }

    if (enemy && this.canSee(enemy.pos, now, ctx.smokes)) {
      if (this.state !== 'ENGAGE') {
        this.state = 'ENGAGE';
        this.reactionUntil = now + this.reactionTime();
        this.callRadio(ctx, 'contact', zoneName(this.world.def, enemy.pos.x, enemy.pos.z), enemy.pos);
      }
      this.target = enemy;
      this.lastSeen = enemy.pos.clone();
      if (enemy.kind === 'bot' && ctx.seenEnemies) ctx.seenEnemies.add(enemy.ref);
    } else if (this.state === 'ENGAGE' && enemy && enemyDist < 24) {
      this.state = 'ALERT';
    }

    if (this.hp < 40 && this.state !== 'TAKE_COVER' && this.state !== 'ENGAGE') {
      this.state = 'TAKE_COVER';
      this.coverUntil = now + 4;
      this.callRadio(ctx, 'lowhp', zoneName(this.world.def, this.pos.x, this.pos.z));
      let best = 0, bd = -1;
      this.world.graph.forEach((n, i) => {
        const d = this.lastSeen ? Math.hypot(n.x - this.lastSeen.x, n.z - this.lastSeen.z) : 0;
        if (d > bd) { bd = d; best = i; }
      });
      this.path = [best]; this.pathIdx = 0;
    }

    if (this.carrier && this.team === 'attack' && ctx.phase === 'live' && !ctx.chargePlanted && this.state !== 'ENGAGE') {
      const site = nearestSite(this.pos, ctx.sites);
      const d = Math.hypot(site.x - this.pos.x, site.z - this.pos.z);
      if (d < site.r) {
        this.plantProgress += ctx.dt;
        ctx.events.push({ type: 'planting', bot: this, progress: this.plantProgress });
        if (this.plantProgress >= 3.2) {
          ctx.events.push({ type: 'planted', bot: this, site });
          this.plantProgress = 0;
        }
        this.syncMesh();
        return;
      }
      if (this.pathIdx >= this.path.length || this.path.length === 0) this.setPathTo(site.x, site.z);
      this.followPath(ctx.dt, speed);
      this.syncMesh();
      return;
    }

    switch (this.state) {
      case 'PATROL': {
        // Follow the round's plan route, point by point; at the last
        // point the bot holds (no wandering) until a callout rotates it.
        // A bot with no plan (fallback) wanders the objective side.
        if (this.planRoute && !this.planDone) {
          const pt = this.planRoute[this.planIdx];
          if (this.pathIdx >= this.path.length) this.setPathTo(pt.x, pt.z);
          const arrived = this.followPath(ctx.dt, speed * 0.8);
          if (arrived) {
            this.planIdx++;
            if (this.planIdx >= this.planRoute.length) { this.planDone = true; this.path = []; }
          }
        } else if (!this.planRoute) {
          if (this.pathIdx >= this.path.length) {
            const goal = this.team === 'attack'
              ? ctx.sites[(Math.random() * ctx.sites.length) | 0]
              : this.world.graph[(Math.random() * this.world.graph.length) | 0];
            this.setPathTo(goal.x, goal.z);
          }
          this.followPath(ctx.dt, speed * 0.8);
        }
        break;
      }
      case 'ALERT': {
        if (this.lastSeen) {
          if (this.pathIdx >= this.path.length) this.setPathTo(this.lastSeen.x, this.lastSeen.z);
          const arrived = this.followPath(ctx.dt, speed);
          if (arrived) { this.state = 'PATROL'; this.path = []; }
        } else this.state = 'PATROL';
        break;
      }
      case 'TAKE_COVER': {
        this.crouching = true;
        const done = this.followPath(ctx.dt, speed);
        if (done || now > (this.coverUntil ?? 0)) {
          this.crouching = false;
          this.state = this.hp < 40 ? 'TAKE_COVER' : 'PATROL';
          if (this.hp >= 40) { this.state = 'PATROL'; this.path = []; }
        }
        break;
      }
      case 'ENGAGE': {
        if (!this.target || !this.target.ref.alive) { this.state = 'PATROL'; this.target = null; break; }
        const tp = this.target.pos;
        const dx = tp.x - this.pos.x, dz = tp.z - this.pos.z;
        const dist = Math.hypot(dx, dz);
        this.yaw = Math.atan2(dx, dz);
        if (now > this.strafeUntil) {
          this.strafeDir *= -1;
          this.strafeUntil = now + 0.7 + Math.random() * 0.7;
        }
        const sx = Math.cos(this.yaw) * this.strafeDir;
        const sz = -Math.sin(this.yaw) * this.strafeDir;
        const keep = dist > 14 ? 1 : dist < 6 ? -1 : 0;
        const mx = sx * 0.9 + Math.sin(this.yaw) * -keep * 0.5;
        const mz = sz * 0.9 + Math.cos(this.yaw) * -keep * 0.5;
        const moved = this.world.moveBox(this.pos.x, this.pos.y, this.pos.z, mx * speed * 0.55 * ctx.dt, mz * speed * 0.55 * ctx.dt, 0.36, 0.36, 1.7);
        this.pos.x = moved.x; this.pos.z = moved.z;
        this.pos.y = this.world.groundHeight(this.pos.x, this.pos.z);
        if (now >= this.reactionUntil && now >= this.burstPauseUntil) {
          if (this.burstLeft <= 0) {
            this.burstLeft = this.burstSize();
            this.nextShotAt = now;
          }
          if (now >= this.nextShotAt && this.burstLeft > 0) {
            this.shootAt(this.target, dist, ctx);
            this.burstLeft--;
            this.nextShotAt = now + 60 / this.weapon.rpm;
            if (this.burstLeft === 0) this.burstPauseUntil = now + this.burstPause();
          }
        }
        break;
      }
    }
    this.syncMesh();
  }

  reactionTime() { return Math.max(0.42, 0.85 - (this.wave - 1) * 0.08); }
  burstSize() { return Math.min(6, 3 + (this.wave - 1)); }
  burstPause() { return Math.max(0.5, 0.95 - (this.wave - 1) * 0.08); }

  aimError(dist) {
    const base = Math.max(0.018, 0.055 - (this.wave - 1) * 0.004);
    return base * (1 + dist * 0.012);
  }

  shootAt(target, dist, ctx) {
    if (this.mag <= 0) { this.mag = this.weapon.mag; return; }
    this.mag--;
    // Aim point: usually the chest, sometimes the head. Aim error
    // (reaction/aim by wave, growing with distance) jitters the shot
    // direction — then the shot resolves with the SAME hitscan path the
    // player uses (ctx.hitscan, main.js). No probability roll decides a
    // hit; a wall, a teammate or smoke in the way is a real miss, and the
    // tracer ends where the ray actually stopped.
    const err = this.aimError(dist);
    const tp = target.pos;
    const aimY = tp.y + (Math.random() < 0.12 ? 1.55 : 1.1);
    const from = this.eyePos;
    const dir = new THREE.Vector3(tp.x - from.x, aimY - from.y, tp.z - from.z).normalize();
    const right = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    dir.addScaledVector(right, (Math.random() - 0.5) * 2 * err)
      .addScaledVector(up, (Math.random() - 0.5) * 2 * err).normalize();
    const res = ctx.hitscan(from, dir, { excludeBot: this, shooter: 'bot', maxDist: 60 });
    let smokeBlocked = false;
    for (const s of ctx.smokes) {
      if (segmentHitsSphere(from, res.point, s.pos, s.radius)) { smokeBlocked = true; break; }
    }
    if (smokeBlocked) {
      const d = Math.max(1, res.dist * 0.5);
      ctx.events.push({ type: 'botShot', shooter: this, target: target.ref, hit: false, from, end: from.clone().addScaledVector(dir, d) });
      ctx.sound.shot(this.weapon.sound, dist);
      return;
    }
    if (res.kind === 'bot' || res.kind === 'player') {
      const tgt = res.kind === 'player' ? ctx.player : res.bot;
      if (tgt.team === this.team) {
        ctx.events.push({ type: 'botShot', shooter: this, target: target.ref, hit: false, from, end: res.point });
        ctx.sound.shot(this.weapon.sound, dist);
        return;
      }
      const hit = applyHit(this.weapon, res.part, res.dist, tgt);
      ctx.events.push({
        type: 'botShot', shooter: this, target: tgt, hit: true, headshot: res.part === 'head',
        killed: hit.killed, damage: hit.healthDmg, from, end: res.point,
      });
    } else {
      ctx.events.push({ type: 'botShot', shooter: this, target: target.ref, hit: false, from, end: res.point });
    }
    ctx.sound.shot(this.weapon.sound, dist);
  }

  syncMesh() {
    this.group.position.set(this.pos.x, this.pos.y + (this.crouching ? -0.35 : 0), this.pos.z);
    this.group.rotation.y = this.yaw;
    this.group.scale.y = this.crouching ? 0.72 : 1;
    if (!this.alive) {
      this.group.rotation.z = Math.PI / 2;
      this.group.position.y = this.pos.y + 0.2;
    }
  }

  die() {
    this.alive = false;
    this.state = 'DEAD';
    this.syncMesh();
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}

export function nearestSite(pos, sites) {
  let best = sites[0], bd = Infinity;
  for (const s of sites) {
    const d = Math.hypot(s.x - pos.x, s.z - pos.z);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

export function segmentHitsSphere(a, b, center, radius) {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: center.x - a.x, y: center.y - a.y, z: center.z - a.z };
  const len2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  let t = len2 > 0 ? (ac.x * ab.x + ac.y * ab.y + ac.z * ab.z) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + ab.x * t, py = a.y + ab.y * t, pz = a.z + ab.z * t;
  const dx = px - center.x, dy = py - center.y, dz = pz - center.z;
  return dx * dx + dy * dy + dz * dz < radius * radius;
}
