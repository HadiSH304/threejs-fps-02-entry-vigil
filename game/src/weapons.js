// VIGIL // FOUNDRY — weapon state, spread and recoil.
// Spread model (CS2-derived): a weapon's base spread grows with movement
// (up to ~27x at full run speed), shrinks x0.75 crouched, and is wild in
// the air. Bloom builds with each shot and decays on the weapon's recovery
// timer (0.368 s standing / 0.305 s crouched for the Kestrel-7), which caps
// accurate tapping near 163/min. Recoil is a deterministic per-weapon
// pattern: bullets 1-10 climb, 11-20 swing in an S, 21-30 sweep wide —
// the same shape every spray, so it can be learned and compensated.

import { ACCURACY } from './config.js';

export function makeWeaponState(def) {
  return {
    def,
    mag: def.mag,
    reserve: def.mag * def.reserveMags,
    reloading: false,
    reloadEnd: 0,
    lastShot: -10,
    bloom: 0,          // accumulated spread from firing (radians)
    patternIndex: 0,   // shots since the last recovery reset
    lastRecovery: 0,
    cooldown: 0,
  };
}

// Current spread in radians for a shooter moving at speedFrac (0..1 of
// max speed), crouched or airborne.
export function currentSpread(state, speedFrac, crouched, airborne) {
  const def = state.def;
  let mult = 1;
  if (airborne) mult *= ACCURACY.airMult;
  else {
    // Movement penalty: linear up to ~27x at full run speed.
    mult *= 1 + speedFrac * (ACCURACY.moveMultMax - 1);
    if (crouched) mult *= ACCURACY.crouchMult;
  }
  return def.baseSpread * mult + state.bloom;
}

// A stopped first shot is near-perfect: spread below the deadzone speed
// threshold is just base spread + bloom (bloom is 0 before the first shot).
export function isAccurate(speedFrac) {
  return speedFrac < ACCURACY.deadzoneFrac;
}

// Deterministic recoil pattern offset for the n-th shot of a spray
// (n = 0-based). Returns {pitch, yaw} in radians of camera kick.
// Shape: climb for 1-10, S-swing for 11-20, wide sweeps for 21-30.
export function recoilOffset(def, n) {
  const k = def.recoil / 30; // normalize to the AK-scale kick scalar
  let pitch, yaw;
  if (n < 10) {
    pitch = (0.010 + n * 0.0022) * k;
    yaw = (Math.sin(n * 0.9) * 0.0012) * k;
  } else if (n < 20) {
    pitch = (0.030 - (n - 10) * 0.0006) * k;
    yaw = (Math.sin((n - 10) * 0.85) * 0.006) * k;
  } else {
    pitch = (0.024 - (n - 20) * 0.0004) * k;
    yaw = (Math.sin((n - 20) * 0.7 + 1.2) * 0.011) * k;
  }
  return { pitch, yaw };
}

// Per-frame update: bloom decays once the recovery timer has elapsed
// since the last shot; the pattern index resets with it.
export function updateWeapon(state, now, crouched) {
  const rec = state.def.recovery * (crouched ? 0.83 : 1); // 0.305 vs 0.368 s
  if (now - state.lastShot > rec) {
    state.bloom = 0;
    state.patternIndex = 0;
  } else {
    // Bloom decays exponentially toward 0 while the timer runs.
    state.bloom *= Math.exp(-(1 / 60) / rec * 2.2);
  }
  if (state.reloading && now >= state.reloadEnd) {
    const need = state.def.mag - state.mag;
    const take = Math.min(need, state.reserve);
    state.mag += take;
    state.reserve -= take;
    state.reloading = false;
  }
}

export function canFire(state, now) {
  if (state.reloading) return false;
  if (state.mag <= 0) return false;
  return now - state.lastShot >= 60 / state.def.rpm;
}

export function fireWeapon(state, now) {
  state.lastShot = now;
  state.mag -= 1;
  state.bloom += state.def.baseSpread * 0.9;
  const off = recoilOffset(state.def, state.patternIndex);
  state.patternIndex = Math.min(state.patternIndex + 1, 29);
  return off;
}

export function startReload(state, now) {
  if (state.reloading || state.reserve <= 0 || state.mag >= state.def.mag) return false;
  state.reloading = true;
  state.reloadEnd = now + state.def.reload;
  return true;
}
