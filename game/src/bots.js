// VIGIL // FOUNDRY — bot AI.
// State machine: PATROL -> ALERT (gunshot heard / glimpse) -> ENGAGE
// (burst fire + tactical strafe) -> TAKE_COVER (HP < 40%). Vision is a
// raycast cone blocked by walls and by smoke volumes; hearing is an event
// the game feeds in. One attack bot carries the charge and plants it.
// Difficulty scales by wave: faster reactions, tighter aim, longer bursts.
// Bot fire resolves through an aim-error cone from the bot's eye; every
// shot draws a tracer so the player can read where fire came from.

import * as THREE from 'three';
import { applyHit } from './damage.js';
import { WEAPONS } from './config.js';

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
    this.target = null;      // {kind:'player'|'bot', ref, pos}
    this.lastSeen = null;    // last known enemy position
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
    this.group = this.buildMesh(scene);
    this.group.position.copy(this.pos);
  }

  buildMesh(scene) {
    const color = TEAM_COLOR[this.team];
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.9 });
    // Legs (hitgroup leg), torso (chest), head (head).
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.75, 0.3), dark);
    legs.position.y = 0.375; legs.userData = { bot: this, part: 'leg' };
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.62, 0.32), mat);
    torso.position.y = 1.06; torso.userData = { bot: this, part: 'chest' };
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), new THREE.MeshStandardMaterial({ color: 0xc9a586, roughness: 0.7 }));
    head.position.y = 1.56; head.userData = { bot: this, part: 'head' };
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.05), dark);
    visor.position.set(0, 1.58, 0.18); group.add(visor);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.85), dark);
    gun.position.set(0.28, 1.15, 0.3); group.add(gun);
    group.add(legs); group.add(torso); group.add(head);
    this.hitMeshes = [legs, torso, head];
    this.bodyParts = { legs, torso, head };
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

  // Vision: within 38 m, inside a 100-degree cone (or already alerted),
  // line of sight not blocked by walls or smoke.
  canSee(pos, now, smokes) {
    if (this.isBlinded(now)) return false;
    const dx = pos.x - this.pos.x, dz = pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 38) return false;
    const ang = Math.atan2(dx, dz);
    let diff = Math.abs(((ang - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (diff > 1.75 && this.state === 'PATROL') return false; // ~100 deg cone
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

  // Main per-step update. ctx: {now, dt, player, bots, smokes, events,
  // onBotShot, onBotKill, plantSite, sites, wave}.
  update(ctx) {
    if (!this.alive) return;
    const now = ctx.now;
    const speed = this.crouching ? this.speed * 0.5 : this.speed;

    // Find the nearest living enemy.
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

    // Vision / alert transitions.
    if (enemy && this.canSee(enemy.pos, now, ctx.smokes)) {
      if (this.state !== 'ENGAGE') {
        this.state = 'ENGAGE';
        this.reactionUntil = now + this.reactionTime();
      }
      this.target = enemy;
      this.lastSeen = enemy.pos.clone();
    } else if (this.state === 'ENGAGE' && enemy && enemyDist < 24) {
      // Lost sight but close: stay alerted at last known position.
      this.state = 'ALERT';
    }

    if (this.hp < 40 && this.state !== 'TAKE_COVER' && this.state !== 'ENGAGE') {
      this.state = 'TAKE_COVER';
      this.coverUntil = now + 4;
      // Retreat: pick the waypoint farthest from the last seen enemy.
      let best = 0, bd = -1;
      this.world.graph.forEach((n, i) => {
        const d = this.lastSeen ? Math.hypot(n.x - this.lastSeen.x, n.z - this.lastSeen.z) : 0;
        if (d > bd) { bd = d; best = i; }
      });
      this.path = [best]; this.pathIdx = 0;
    }

    // Planting: the carrier walks to the nearest site and channels.
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
        if (this.pathIdx >= this.path.length) {
          // Wander: pick a waypoint on the objective side.
          const goal = this.team === 'attack'
            ? ctx.sites[(Math.random() * ctx.sites.length) | 0]
            : this.world.graph[(Math.random() * this.world.graph.length) | 0];
          this.setPathTo(goal.x, goal.z);
        }
        this.followPath(ctx.dt, speed * 0.8);
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
        // Tactical strafe: sideways drift, flipping every 0.7-1.4 s.
        if (now > this.strafeUntil) {
          this.strafeDir *= -1;
          this.strafeUntil = now + 0.7 + Math.random() * 0.7;
        }
        const sx = Math.cos(this.yaw) * this.strafeDir;
        const sz = -Math.sin(this.yaw) * this.strafeDir;
        const keep = dist > 14 ? 1 : dist < 6 ? -1 : 0; // hold ~6-14 m
        const mx = sx * 0.9 + Math.sin(this.yaw) * -keep * 0.5;
        const mz = sz * 0.9 + Math.cos(this.yaw) * -keep * 0.5;
        const moved = this.world.moveBox(this.pos.x, this.pos.y, this.pos.z, mx * speed * 0.55 * ctx.dt, mz * speed * 0.55 * ctx.dt, 0.36, 0.36, 1.7);
        this.pos.x = moved.x; this.pos.z = moved.z;
        this.pos.y = this.world.groundHeight(this.pos.x, this.pos.z);
        // Burst fire after the reaction delay.
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
    // Base aim error shrinks with wave; grows with distance and target speed.
    const base = Math.max(0.018, 0.055 - (this.wave - 1) * 0.004);
    return base * (1 + dist * 0.012);
  }

  shootAt(target, dist, ctx) {
    if (this.mag <= 0) { this.mag = this.weapon.mag; return; } // instant bot reload
    this.mag--;
    const err = this.aimError(dist);
    const roll = Math.random();
    // Hit chance falls with aim error and distance; headshots are rare.
    const hitP = Math.max(0.06, Math.min(0.85, 0.62 - err * 6 - dist * 0.004));
    const from = this.eyePos;
    let end;
    if (roll < hitP) {
      const part = Math.random() < 0.14 ? 'head' : (Math.random() < 0.2 ? 'stomach' : 'chest');
      const tgt = target.ref;
      const res = applyHit(this.weapon, part, dist, tgt);
      end = new THREE.Vector3(target.pos.x, target.pos.y + (part === 'head' ? 1.55 : 1.1), target.pos.z);
      ctx.events.push({
        type: 'botShot', shooter: this, target: tgt, hit: true, headshot: part === 'head',
        killed: res.killed, damage: res.healthDmg, from, end,
      });
      if (res.killed) ctx.events.push({ type: 'botKill', shooter: this, victim: tgt });
    } else {
      // Miss: tracer lands near the target, offset by the aim error.
      const off = (Math.random() - 0.5) * 2 * err * dist * 3;
      end = new THREE.Vector3(
        target.pos.x + off,
        target.pos.y + 1.1 + (Math.random() - 0.5) * err * dist * 2,
        target.pos.z + off * 0.6,
      );
      ctx.events.push({ type: 'botShot', shooter: this, target: target.ref, hit: false, from, end });
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

// Segment vs sphere (smoke volume) test for line-of-sight blocking.
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
