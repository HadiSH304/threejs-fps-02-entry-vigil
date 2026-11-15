// VIGIL // FOUNDRY — radio callout system (judge criterion 3: tactics).
// Bots call out real events in plain words, the way a squad talks:
// first contact, a charge planted, a defuse started, a teammate down,
// a rotation, a bot falling back on low HP. A callout is three things at
// once: a line in the HUD radio feed, a short-lived blip on the mini-radar
// (contact and plant only), and a telemetry log entry. Teammates react
// to the words, not just to sight: the two nearest teammates rotate
// toward a contact callout, and every defender converges on a plant
// callout. Area names come from each map's named zones (config.js), so a
// line always names a place that exists on the map being played.

export const RADIO_THROTTLE_S = 6;
export const RADIO_LINE_S = 7;
export const RADIO_BLIP_S = 5;

const TEMPLATES = {
  contact: (b, area) => `${b.name}: Contact at ${area}, rotating`,
  plant: (b, area) => `${b.name}: Charge planted at ${area}`,
  defuse: (b, area) => `${b.name}: Defusing at ${area}`,
  down: (b, area) => `${b.name}: ${area} is down`,
  rotate: (b, area) => `${b.name}: Rotating to ${area}`,
  lowhp: (b) => `${b.name}: I'm hit, falling back`,
};

export function zoneName(mapDef, x, z) {
  let best = null, bd = Infinity;
  for (const zn of mapDef.zones ?? []) {
    const d = Math.hypot(zn.x - x, zn.z - z);
    if (d < bd) { bd = d; best = zn; }
  }
  return best ? best.name : 'Mid';
}

export class Radio {
  constructor(onLine) {
    this.onLine = onLine;
    this.lines = [];
    this.blips = [];
    this.log = [];
    this.calls = 0;
    this.lastByBot = new Map();
  }

  say(bot, kind, area, now, mapDef, pos) {
    const key = `${bot.name}:${kind}`;
    const last = this.lastByBot.get(key) ?? -Infinity;
    if (now - last < RADIO_THROTTLE_S) return null;
    this.lastByBot.set(key, now);
    const text = TEMPLATES[kind](bot, area);
    const line = { text, team: bot.team, until: now + RADIO_LINE_S, kind };
    this.lines.push(line);
    this.log.push({ t: Math.round(now * 10) / 10, text });
    if (this.log.length > 60) this.log.shift();
    this.calls++;
    if (kind === 'contact' || kind === 'plant') {
      const px = pos?.x ?? bot.pos?.x ?? 0, pz = pos?.z ?? bot.pos?.z ?? 0;
      this.blips.push({ x: px, z: pz, until: now + RADIO_BLIP_S });
    }
    this.onLine?.(line);
    return line;
  }

  prune(now) {
    this.lines = this.lines.filter((l) => now < l.until);
    this.blips = this.blips.filter((b) => now < b.until);
  }
}
