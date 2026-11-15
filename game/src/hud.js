// VIGIL // FOUNDRY — HUD: every DOM readout in one module.
// Crosshair expands with bloom, hitmarker flashes (gold on headshot),
// kill feed, mini-radar (canvas), health/armor/ammo/money, round timer,
// scoreboard on TAB, buy menu on B (number keys 1-9 buy), deploy screen
// with map selector + sensitivity slider, and the After-Action Report.

export class HUD {
  constructor(doc) {
    this.doc = doc;
    this.el = {};
    for (const id of ['crosshair', 'hitmarker', 'ammo-mag', 'ammo-reserve', 'hp', 'armor', 'money',
      'timer', 'score-jackals', 'score-wardens', 'round-label', 'feed', 'radar', 'buy-menu',
      'scoreboard', 'deploy', 'aar', 'flash', 'damage-vignette', 'hint', 'plant-bar',
      'plant-fill', 'plant-label', 'center-msg', 'map-name', 'wave-label', 'deploy-map',
      'sens', 'sens-val', 'deploy-title', 'deploy-sub', 'radio', 'slots', 'utility',
      'plan-label', 'buy-plan']) {
      this.el[id] = doc.getElementById(id);
    }
    this.radarCtx = this.el.radar?.getContext('2d');
    this.feedItems = [];
    this.radioItems = [];
    this.blips = [];
    this.staging = new URLSearchParams(doc.location?.search ?? '').get('shot') != null;
  }

  setCrosshair(spreadPx, visible) {
    const c = this.el.crosshair;
    if (!c) return;
    c.style.opacity = visible ? '1' : '0';
    const gap = 3 + Math.min(26, spreadPx);
    c.style.setProperty('--gap', `${gap}px`);
  }

  hitmarker(headshot) {
    const h = this.el.hitmarker;
    if (!h) return;
    h.classList.remove('on', 'hs');
    void h.offsetWidth;
    h.classList.add('on');
    if (headshot) h.classList.add('hs');
    setTimeout(() => h.classList.remove('on'), 120);
  }

  setAmmo(mag, reserve, reloading) {
    if (this.el['ammo-mag']) this.el['ammo-mag'].textContent = reloading ? '--' : String(mag);
    if (this.el['ammo-reserve']) this.el['ammo-reserve'].textContent = `/ ${reserve === Infinity ? '∞' : reserve}`;
  }

  setVitals(hp, armor, money) {
    if (this.el.hp) this.el.hp.textContent = String(Math.max(0, Math.ceil(hp)));
    if (this.el.armor) this.el.armor.textContent = String(Math.max(0, Math.ceil(armor)));
    if (this.el.money) this.el.money.textContent = `$${money.toLocaleString('en-US')}`;
    if (this.el.hp) this.el.hp.parentElement.classList.toggle('low', hp <= 30);
  }

  setTimer(seconds, phase) {
    if (!this.el.timer) return;
    const s = Math.max(0, Math.ceil(seconds));
    this.el.timer.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    this.el.timer.dataset.phase = phase;
  }

  setScore(jackals, wardens, round, mapName, wave) {
    if (this.el['score-jackals']) this.el['score-jackals'].textContent = String(jackals);
    if (this.el['score-wardens']) this.el['score-wardens'].textContent = String(wardens);
    if (this.el['round-label']) this.el['round-label'].textContent = `ROUND ${round} / 16`;
    if (this.el['map-name']) this.el['map-name'].textContent = mapName;
    if (this.el['wave-label']) this.el['wave-label'].textContent = `WAVE ${wave}`;
  }

  feed(text, cls = '') {
    if (!this.el.feed) return;
    const div = this.doc.createElement('div');
    div.className = `feed-item ${cls}`;
    div.textContent = text;
    this.el.feed.prepend(div);
    this.feedItems.push(div);
    while (this.feedItems.length > 5) this.feedItems.shift().remove();
    if (!this.staging) {
      setTimeout(() => div.classList.add('fade'), 4200);
      setTimeout(() => div.remove(), 5200);
    }
  }

  // Radio feed: squad callouts (radio.js), newest on top, team-colored.
  radio(line) {
    const box = this.el.radio;
    if (!box) return;
    const div = this.doc.createElement('div');
    div.className = `radio-item ${line.team === 'attack' ? 'atk' : 'def'}`;
    div.textContent = `RADIO ${line.text}`;
    box.prepend(div);
    this.radioItems.push(div);
    while (this.radioItems.length > 3) this.radioItems.shift().remove();
    if (!this.staging) {
      setTimeout(() => div.classList.add('fade'), 5600);
      setTimeout(() => div.remove(), 6800);
    }
  }

  setBlips(blips) { this.blips = blips ?? []; }

  // Weapon-slot bar: 1 rifle / 2 sidearm / 3 knife with names; active lit.
  setSlots(loadout, activeSlot) {
    const bar = this.el.slots;
    if (!bar) return;
    const names = { 1: loadout[1]?.def.name ?? '—', 2: loadout[2]?.def.name ?? '—', 3: loadout[3]?.def.name ?? '—' };
    bar.innerHTML = [1, 2, 3].map((n) =>
      `<span class="${n === activeSlot ? 'sel' : ''}"><b>${n}</b> ${names[n]}</span>`).join('');
  }

  // Utility counts: smoke / flash / frag remaining (Q smoke, G flash).
  setUtility(utility) {
    const u = this.el.utility;
    if (!u) return;
    u.textContent = `SMOKE ${utility.smoke ?? 0} · FLASH ${utility.flash ?? 0} · FRAG ${utility.frag ?? 0}`;
  }

  // Round plan label (topbar + buy menu share the text).
  setPlan(plan) {
    const label = plan ? `PLAN: ${plan.name} — ${plan.desc}` : '';
    if (this.el['plan-label']) this.el['plan-label'].textContent = label;
    if (this.el['buy-plan']) this.el['buy-plan'].textContent = label;
  }

  centerMsg(text, ms = 2200) {
    const e = this.el['center-msg'];
    if (!e) return;
    e.textContent = text;
    e.classList.add('show');
    clearTimeout(this._msgT);
    this._msgT = setTimeout(() => e.classList.remove('show'), ms);
  }

  hint(text) { if (this.el.hint) this.el.hint.textContent = text; }

  setPlant(progress, label) {
    const bar = this.el['plant-bar'];
    if (!bar) return;
    if (progress == null) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    this.el['plant-fill'].style.width = `${Math.min(100, progress * 100)}%`;
    if (this.el['plant-label']) this.el['plant-label'].textContent = label;
  }

  flash(strength) {
    const f = this.el.flash;
    if (!f) return;
    f.style.opacity = String(Math.min(1, strength));
    if (strength > 0) {
      const step = () => {
        const cur = parseFloat(f.style.opacity || '0');
        if (cur <= 0.01) { f.style.opacity = '0'; return; }
        f.style.opacity = String(Math.max(0, cur - 0.008));
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }

  damageFlash(fromAngle) {
    const v = this.el['damage-vignette'];
    if (!v) return;
    v.style.setProperty('--dir', `${fromAngle}deg`);
    v.classList.remove('on');
    void v.offsetWidth;
    v.classList.add('on');
    setTimeout(() => v.classList.remove('on'), 450);
  }

  // Mini-radar: top-down dots — player (center, white), teammates (green),
  // enemies (red, only when recently seen), sites (amber letters), and
  // pulsing amber rings where a radio callout just landed.
  drawRadar(player, bots, sites, mapDef, seenEnemies, now = 0) {
    const ctx = this.radarCtx;
    if (!ctx) return;
    const S = 132, pad = 8;
    const W = mapDef.ground.w, D = mapDef.ground.d;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(10,14,18,0.72)';
    ctx.fillRect(0, 0, S, S);
    const sx = (x) => pad + ((x + W / 2) / W) * (S - pad * 2);
    const sz = (z) => pad + ((z + D / 2) / D) * (S - pad * 2);
    ctx.fillStyle = 'rgba(160,170,180,0.5)';
    for (const s of mapDef.solids) {
      if (s.ramp || s.y0 > 0) continue;
      if (s.h < 2) continue;
      ctx.fillRect(sx(s.x - s.w / 2), sz(s.z - s.d / 2), (s.w / W) * (S - pad * 2), (s.d / D) * (S - pad * 2));
    }
    ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    for (const site of sites) {
      ctx.fillStyle = '#ffb020';
      ctx.fillText(site.id, sx(site.x), sz(site.z) + 4);
    }
    for (const b of this.blips) {
      const age = Math.max(0, 5 - (b.until - now));
      ctx.strokeStyle = `rgba(255,176,32,${Math.max(0.15, 0.9 - age * 0.18)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx(b.x), sz(b.z), 4 + age * 3, 0, Math.PI * 2); ctx.stroke();
    }
    const dot = (x, z, color, r = 3) => {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(sx(x), sz(z), r, 0, Math.PI * 2); ctx.fill();
    };
    for (const b of bots) {
      if (!b.alive) continue;
      if (b.team === player.team) dot(b.pos.x, b.pos.z, '#7ee787');
      else if (seenEnemies.has(b)) dot(b.pos.x, b.pos.z, '#ff5a4a', 3.5);
    }
    ctx.save();
    ctx.translate(sx(player.pos.x), sz(player.pos.z));
    ctx.rotate(Math.PI - player.yaw);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  showBuy(open, money, owned, weapons) {
    const menu = this.el['buy-menu'];
    if (!menu) return;
    menu.classList.toggle('hidden', !open);
    if (!open) return;
    const rows = menu.querySelectorAll('[data-buy]');
    rows.forEach((row) => {
      const key = row.dataset.buy;
      const item = weapons[key];
      const price = row.dataset.price ? Number(row.dataset.price) : item.price;
      const canAfford = money >= price;
      const ownedMark = owned.has(key) ? ' ✓' : '';
      row.classList.toggle('cant', !canAfford);
      const costEl = row.querySelector('.cost');
      if (costEl) costEl.textContent = `$${price.toLocaleString('en-US')}${ownedMark}`;
    });
  }

  showScoreboard(open, rows) {
    const sb = this.el.scoreboard;
    if (!sb) return;
    sb.classList.toggle('hidden', !open);
    if (!open) return;
    const body = sb.querySelector('tbody');
    body.innerHTML = rows.map((r) =>
      `<tr class="${r.you ? 'you' : ''} ${r.dead ? 'dead' : ''}"><td>${r.name}</td><td>${r.team}</td><td>${r.kills}</td><td>${r.deaths}</td><td>$${r.money}</td></tr>`).join('');
  }

  showDeploy(show, maps, selected, sensitivity) {
    const d = this.el.deploy;
    if (!d) return;
    d.classList.toggle('hidden', !show);
    if (!show) return;
    const sel = this.el['deploy-map'];
    sel.innerHTML = maps.map((m, i) =>
      `<button type="button" data-map="${i}" class="${i === selected ? 'sel' : ''}">${m.name}<span>${m.tag}</span></button>`).join('');
    this.el.sens.value = sensitivity;
    this.el['sens-val'].textContent = sensitivity.toFixed(2);
  }

  showAAR(show, stats) {
    const a = this.el.aar;
    if (!a) return;
    a.classList.toggle('hidden', !show);
    if (!show || !stats) return;
    const set = (id, v) => { const e = this.doc.getElementById(id); if (e) e.textContent = v; };
    set('aar-rank', stats.rank);
    set('aar-acc', `${(stats.accuracy * 100).toFixed(1)}%`);
    set('aar-hs', `${(stats.headshotShare * 100).toFixed(1)}%`);
    set('aar-time', stats.clearTime);
    set('aar-dmg', `${stats.damageDealt} / ${stats.damageTaken}`);
    set('aar-util', `${stats.utilityPoints} / 10`);
    set('aar-score', `${stats.total} / 100`);
    set('aar-kd', `${stats.kills}K / ${stats.deaths}D`);
    set('aar-radio', `${stats.radioCalls ?? 0} callouts`);
    set('aar-breakdown', stats.breakdown);
  }
}
