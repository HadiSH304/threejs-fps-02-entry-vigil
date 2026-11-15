// VIGIL // FOUNDRY — match state: phases, economy, plant/defuse, telemetry.
// One Match owns the scoreboard, the money, the charge and the After-Action
// Report. Rendering, input and bot meshes live in main.js / bots.js; this
// module only decides what happens and when, so the soak test can drive it
// headlessly through the same code path the browser uses.
// Economy (CS2, per player): start $800; win $3,250 elimination / $3,500
// objective; loss ladder $1,400 then +$500 per loss to $3,400; planter
// +$800, team +$300 on plant; planted-but-lost +$600 each attacker;
// defuser +$300; kill rewards by weapon (rifle/pistol $300, SMG $600,
// knife $1,500). Team plans (plans.js) are picked per round in startRound.

import { GAME, ECONOMY, RANK, SHOP, WEAPONS } from './config.js';
import { nearestSite } from './bots.js';
import { pickAttackPlan, pickDefendSetup, attackRoutes, defendRoutes, assignPlan } from './plans.js';

export const PHASES = ['deploy', 'buy', 'live', 'roundEnd', 'matchEnd'];

export class Match {
  constructor(opts) {
    this.world = opts.world;
    this.player = opts.player;
    this.spawnBot = opts.spawnBot;
    this.onEvent = opts.onEvent;
    this.phase = 'deploy';
    this.mapIndex = 0;
    this.wave = 1;
    this.round = 0;
    this.score = { attack: 0, defend: 0 };
    this.playerTeam = 'attack';
    this.lossStreak = { attack: 0, defend: 0 };
    this.bots = [];
    this.charge = { planted: false, site: null, timer: 0, planter: null };
    this.phaseT = 0;
    this.roundT = 0;
    this.matchStart = 0;
    this.now = 0;
    this.defuseProgress = 0;
    this.plantProgress = 0;
    this.botDefuseProgress = 0;
    this.stats = this.freshStats();
    this.seenEnemies = new Set();
    this.roundWinner = null;
    this.roundReason = '';
    this.matchWinner = null;
    this.over = false;
    this.attackPlan = null;
    this.defendPlan = null;
    this.plan = null;
  }

  freshStats() {
    return {
      shots: 0, hits: 0, headshotKills: 0, kills: 0, deaths: 0,
      damageDealt: 0, damageTaken: 0, utilityDeployed: 0,
      enemiesBlinded: 0, smokeDenials: 0, plants: 0, defuses: 0,
      roundsWon: 0, radioCalls: 0,
    };
  }

  emit(type, data = {}) { this.onEvent({ type, ...data }); }

  startMatch(mapIndex, now) {
    this.mapIndex = mapIndex;
    this.round = 0;
    this.score = { attack: 0, defend: 0 };
    this.playerTeam = 'attack';
    this.lossStreak = { attack: 0, defend: 0 };
    this.wave = 1;
    this.stats = this.freshStats();
    this.matchStart = now;
    this.over = false;
    this.matchWinner = null;
    this.player.money = GAME.startMoney;
    this.player.armor = 0; this.player.helmet = false;
    this.startRound(now);
  }

  startRound(now) {
    this.round++;
    this.phase = 'buy';
    this.phaseT = GAME.buySeconds;
    this.roundT = GAME.roundSeconds;
    this.charge = { planted: false, site: null, timer: 0, planter: null };
    this.defuseProgress = 0;
    this.plantProgress = 0;
    this.botDefuseProgress = 0;
    this.seenEnemies.clear();
    // Both teams pick a plan for this round (rotates by round number);
    // the player's team plan is the one the HUD names.
    this.attackPlan = pickAttackPlan(this.round);
    this.defendPlan = pickDefendSetup(this.round);
    this.plan = this.playerTeam === 'attack' ? this.attackPlan : this.defendPlan;
    this.respawnAll();
    this.emit('roundStart', { round: this.round, plan: this.plan });
  }

  respawnAll() {
    const map = this.world.def;
    for (const b of this.bots) this.emit('removeBot', { bot: b });
    this.bots = [];
    const atkSpawns = this.playerTeam === 'attack' ? map.spawns.attack : map.spawns.defend;
    const defSpawns = this.playerTeam === 'attack' ? map.spawns.defend : map.spawns.attack;
    this.player.team = this.playerTeam;
    this.player.hp = 100;
    this.player.alive = true;
    this.player.pos.set(atkSpawns[0][0], 0, atkSpawns[0][1]);
    this.player.yaw = this.playerTeam === 'attack' ? Math.PI / 2 : -Math.PI / 2;
    this.player.pitch = 0;
    this.player.vel.set(0, 0, 0);
    const teamWeapons = ['kestrel', 'bastion', 'raptor', 'kestrel'];
    for (let i = 0; i < 4; i++) {
      const bot = this.spawnBot(this.playerTeam, i, atkSpawns[i + 1], this.wave, teamWeapons[i]);
      bot.armor = 100; bot.helmet = true;
      this.bots.push(bot);
    }
    const enemyWeapons = ['kestrel', 'bastion', 'raptor', 'bastion', 'kestrel'];
    for (let i = 0; i < 5; i++) {
      const bot = this.spawnBot(this.playerTeam === 'attack' ? 'defend' : 'attack', i, defSpawns[i], this.wave, enemyWeapons[i]);
      bot.armor = 100; bot.helmet = true;
      this.bots.push(bot);
    }
    // Team plans: every bot gets a role and a route for this round. The
    // attacking team's first bot carries the charge when the player is
    // defending (the player carries it on attack).
    const atkBots = this.bots.filter((b) => b.team === 'attack');
    const defBots = this.bots.filter((b) => b.team === 'defend');
    assignPlan(atkBots, attackRoutes(map, this.attackPlan, this.round), this.playerTeam === 'defend' ? 0 : -1);
    assignPlan(defBots, defendRoutes(map, this.defendPlan), -1);
    this.emit('respawned');
  }

  buy(key) {
    if (this.phase !== 'buy') return { ok: false, why: 'Buy phase is over' };
    const p = this.player;
    const item = SHOP[key];
    if (item) {
      if (p.money < item.price) return { ok: false, why: 'Not enough money' };
      if (key === 'armor' && p.armor >= 100) return { ok: false, why: 'Armor already full' };
      if (key === 'helmet' && p.helmet) return { ok: false, why: 'Already have a helmet' };
      if (key === 'kit' && p.hasKit) return { ok: false, why: 'Already have a kit' };
      p.money -= item.price;
      if (key === 'armor' || key === 'helmet') { p.armor = 100; if (key === 'helmet') p.helmet = true; }
      else if (key === 'kit') p.hasKit = true;
      else p.utility[key] = (p.utility[key] ?? 0) + 1;
      this.emit('bought', { key });
      return { ok: true };
    }
    const w = WEAPONS[key];
    if (!w || w.price <= 0) return { ok: false, why: 'Not for sale' };
    if (p.money < w.price) return { ok: false, why: 'Not enough money' };
    p.money -= w.price;
    this.emit('boughtWeapon', { key, weapon: w });
    return { ok: true };
  }

  update(dt, now) {
    this.now = now;
    if (this.phase === 'buy') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) { this.phase = 'live'; this.emit('phaseLive'); }
    } else if (this.phase === 'live') {
      this.roundT -= dt;
      if (this.charge.planted) {
        this.charge.timer -= dt;
        if (this.charge.timer <= 0) return this.endRound('attack', 'Charge detonated');
        this.botDefuseTick(dt);
      } else if (this.roundT <= 0) {
        return this.endRound('defend', 'Time expired — site held');
      }
      const atkAlive = this.aliveCount('attack');
      const defAlive = this.aliveCount('defend');
      if (atkAlive === 0) return this.endRound('defend', 'Team eliminated');
      if (defAlive === 0) {
        if (this.charge.planted) return this.endRound('attack', 'Site cleared — charge will detonate');
        return this.endRound('attack', 'Team eliminated');
      }
    } else if (this.phase === 'roundEnd') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        if (this.over) { this.phase = 'matchEnd'; this.emit('matchEnd', { winner: this.matchWinner, stats: this.aarStats(now) }); }
        else this.startRound(now);
      }
    }
    return null;
  }

  aliveCount(team) {
    let n = 0;
    if (this.player.alive && this.player.team === team) n++;
    for (const b of this.bots) if (b.alive && b.team === team) n++;
    return n;
  }

  botDefuseTick(dt) {
    const site = this.charge.site;
    if (!site) return;
    const near = this.bots.find((b) => b.alive && b.team === 'defend' &&
      Math.hypot(b.pos.x - site.x, b.pos.z - site.z) < site.r);
    const threat = this.bots.some((b) => b.alive && b.team === 'attack' &&
      Math.hypot(b.pos.x - site.x, b.pos.z - site.z) < 9) ||
      (this.player.alive && this.player.team === 'attack' &&
        Math.hypot(this.player.pos.x - site.x, this.player.pos.z - site.z) < 9);
    if (near && !threat) {
      if (this.botDefuseProgress === 0) this.emit('defuseStart', { site, bot: near });
      this.botDefuseProgress += dt;
      if (this.botDefuseProgress >= GAME.defuseSeconds) {
        this.charge.planted = false;
        this.endRound('defend', 'Charge defused');
      }
    } else {
      this.botDefuseProgress = Math.max(0, this.botDefuseProgress - dt * 2);
    }
  }

  channel(dt, holdE, moving) {
    if (this.phase !== 'live') return null;
    const p = this.player;
    if (!p.alive) return null;
    const sites = this.world.def.sites;
    if (p.team === 'attack' && !this.charge.planted) {
      const site = nearestSite(p.pos, sites);
      const d = Math.hypot(p.pos.x - site.x, p.pos.z - site.z);
      if (d > site.r) { this.plantProgress = 0; return null; }
      if (!holdE || moving) { this.plantProgress = 0; return null; }
      this.plantProgress += dt;
      if (this.plantProgress >= GAME.plantSeconds) {
        this.plantProgress = 0;
        this.plantCharge(site, p);
        return null;
      }
      return { kind: 'plant', progress: this.plantProgress / GAME.plantSeconds, label: `PLANTING — SITE ${site.id}` };
    }
    if (p.team === 'defend' && this.charge.planted) {
      const site = this.charge.site;
      const d = Math.hypot(p.pos.x - site.x, p.pos.z - site.z);
      if (d > site.r) { this.defuseProgress = 0; return null; }
      if (!holdE || moving) { this.defuseProgress = 0; return null; }
      const need = p.hasKit ? GAME.defuseKitSeconds : GAME.defuseSeconds;
      this.defuseProgress += dt;
      if (this.defuseProgress >= need) {
        this.defuseProgress = 0;
        this.charge.planted = false;
        this.stats.defuses++;
        p.money = Math.min(16000, p.money + ECONOMY.defuseBonus);
        this.endRound('defend', 'Charge defused');
        return null;
      }
      return { kind: 'defuse', progress: this.defuseProgress / need, label: `DEFUSING — ${need}s${p.hasKit ? ' (KIT)' : ''}` };
    }
    return null;
  }

  plantCharge(site, planter) {
    this.charge = { planted: true, site, timer: GAME.chargeSeconds, planter };
    this.stats.plants++;
    if (planter === this.player) this.player.money = Math.min(16000, this.player.money + ECONOMY.plantPlanter);
    this.player.money = Math.min(16000, this.player.money + ECONOMY.plantTeam);
    this.emit('planted', { site });
  }

  onKill(killer, victim, weapon, headshot) {
    if (killer === this.player) {
      this.stats.kills++;
      if (headshot) this.stats.headshotKills++;
      this.player.money = Math.min(16000, this.player.money + (weapon?.killReward ?? 300));
      this.emit('killFeed', { killer: 'YOU', victim: victim.name ?? 'enemy', headshot, weapon: weapon?.name });
    } else if (victim === this.player) {
      this.stats.deaths++;
      this.player.alive = false;
      this.emit('playerDied', { killer: killer.name ?? 'enemy' });
    } else {
      this.emit('killFeed', { killer: killer.name ?? '?', victim: victim.name ?? '?', headshot, weapon: weapon?.name });
    }
  }

  endRound(winner, reason) {
    if (this.phase !== 'live' && this.phase !== 'buy') return;
    const objective = /detonat|defus/i.test(reason);
    this.score[winner]++;
    this.roundWinner = winner;
    this.roundReason = reason;
    const playerWon = winner === this.playerTeam;
    if (playerWon) {
      this.player.money = Math.min(16000, this.player.money + (objective ? ECONOMY.winObjective : ECONOMY.winElimination));
      this.stats.roundsWon++;
      this.lossStreak[this.playerTeam] = Math.max(0, this.lossStreak[this.playerTeam] - 1);
    } else {
      const streak = this.lossStreak[this.playerTeam];
      this.player.money = Math.min(16000, this.player.money + ECONOMY.lossBonus[Math.min(streak, 4)]);
      this.lossStreak[this.playerTeam] = Math.min(4, streak + 1);
      if (this.playerTeam === 'attack' && this.charge.planted) {
        this.player.money = Math.min(16000, this.player.money + ECONOMY.plantedButLost);
      }
    }
    this.phase = 'roundEnd';
    this.phaseT = 5;
    this.emit('roundEnd', { winner, reason, score: { ...this.score }, playerWon });
    if (this.round === GAME.halftimeAfterRound) {
      this.playerTeam = this.playerTeam === 'attack' ? 'defend' : 'attack';
      this.player.money = GAME.startMoney;
      this.lossStreak = { attack: 0, defend: 0 };
      this.emit('halftime', { newSide: this.playerTeam });
    }
    const leader = this.score.attack > this.score.defend ? 'attack' : this.score.defend > this.score.attack ? 'defend' : null;
    if (this.score.attack >= GAME.roundsToWin || this.score.defend >= GAME.roundsToWin ||
        (this.round >= GAME.maxRounds && leader)) {
      this.over = true;
      this.matchWinner = this.score.attack >= GAME.roundsToWin ? 'attack'
        : this.score.defend >= GAME.roundsToWin ? 'defend' : leader;
    }
  }

  // --- After-Action Report ----------------------------------------------
  aarStats(now) {
    const s = this.stats;
    const accuracy = s.shots > 0 ? s.hits / s.shots : 0;
    const hsShare = s.kills > 0 ? s.headshotKills / s.kills : 0;
    const exchange = (s.damageDealt + s.damageTaken) > 0 ? s.damageDealt / (s.damageDealt + s.damageTaken) : 0.5;
    const clearTime = Math.max(1, Math.round(now - this.matchStart));
    const accPts = Math.min(40, accuracy * 40 / 0.6);
    const hsPts = Math.min(25, hsShare * 25 / 0.6);
    const exPts = Math.min(15, exchange * 15 / 0.6);
    const utilPts = Math.min(10, s.enemiesBlinded * 2 + s.smokeDenials + s.utilityDeployed * 0.5 + s.plants * 2 + s.defuses * 2);
    const speedPts = Math.max(0, Math.min(10, 10 - Math.max(0, clearTime - 420) / 60));
    const total = accPts + hsPts + exPts + utilPts + speedPts;
    let rank = 'C';
    if (total >= RANK.sPlus.total && accuracy >= RANK.sPlus.acc && hsShare >= RANK.sPlus.hs) rank = 'S+';
    else if (total >= RANK.s.total && accuracy >= RANK.s.acc && hsShare >= RANK.s.hs) rank = 'S';
    else if (total >= RANK.a) rank = 'A';
    else if (total >= RANK.b) rank = 'B';
    const mm = String(Math.floor(clearTime / 60)).padStart(2, '0');
    const ss = String(clearTime % 60).padStart(2, '0');
    return {
      accuracy, headshotShare: hsShare, damageExchange: exchange,
      clearTime: `${mm}:${ss}`,
      damageDealt: Math.round(s.damageDealt), damageTaken: Math.round(s.damageTaken),
      utilityPoints: Math.round(utilPts * 10) / 10,
      total: Math.round(total * 10) / 10,
      rank, kills: s.kills, deaths: s.deaths, radioCalls: s.radioCalls,
      breakdown: `ACC ${accPts.toFixed(1)}/40 · HS ${hsPts.toFixed(1)}/25 · DMG ${exPts.toFixed(1)}/15 · UTIL ${utilPts.toFixed(1)}/10 · SPD ${speedPts.toFixed(1)}/10`,
    };
  }
}
