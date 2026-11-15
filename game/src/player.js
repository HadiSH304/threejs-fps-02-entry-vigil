// VIGIL // FOUNDRY — player controller.
// Fixed-step movement with acceleration and fast friction (Valorant-style
// deadzone: release the keys and you stop in ~160 ms, so stopping to aim
// feels responsive). Shift = silent walk (x0.52), C = crouch (x0.34),
// Space = jump. Collision is AABB sliding against the world builder's
// colliders; ramps and platforms set the ground height. Camera pitch/yaw
// carry the weapon's recoil kick with spring recovery.

import * as THREE from 'three';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.05;

export class Player {
  constructor(world, spawn) {
    this.world = world;
    this.pos = new THREE.Vector3(spawn[0], 0, spawn[1]);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.recoilPitch = 0; // accumulated camera kick, springs back to 0
    this.recoilYaw = 0;
    this.crouched = false;
    this.onGround = true;
    this.hp = 100;
    this.armor = 0;
    this.helmet = false;
    this.money = 800;
    this.alive = true;
    this.tagSlowUntil = 0; // being hit slows you (tagging)
    this.height = 1.7;
    this.eye = EYE_STAND;
    this.speedFrac = 0; // current speed / max speed, for spread + HUD
  }

  get eyePos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eye, this.pos.z);
  }

  get maxSpeed() {
    return 6.35; // knife speed; weapon multipliers apply in game.js
  }

  // input: {f, b, l, r, walk, crouch, jump} booleans; dt fixed step.
  // moveSpeed is the current weapon's top speed in m/s.
  step(input, dt, moveSpeed, now) {
    if (!this.alive) return;
    const crouchTarget = input.crouch;
    this.crouched = crouchTarget;
    const targetHeight = crouchTarget ? 1.15 : 1.7;
    this.height += (targetHeight - this.height) * Math.min(1, dt * 12);
    const targetEye = crouchTarget ? EYE_CROUCH : EYE_STAND;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 12);

    let speed = moveSpeed;
    if (input.walk) speed *= 0.52;
    if (crouchTarget) speed *= 0.34;
    if (now < this.tagSlowUntil) speed *= 0.55; // tagged: slow

    // Wish direction in world space from yaw.
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = 0, wz = 0;
    if (input.f) { wx -= sin; wz -= cos; }
    if (input.b) { wx += sin; wz += cos; }
    if (input.l) { wx -= cos; wz += sin; }
    if (input.r) { wx += cos; wz -= sin; }
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx /= len; wz /= len; }

    // Acceleration toward wish velocity; fast friction when no input.
    const accel = this.onGround ? 42 : 10;
    const friction = this.onGround ? 11 : 0.4;
    this.vel.x += wx * accel * dt;
    this.vel.z += wz * accel * dt;
    const hv = Math.hypot(this.vel.x, this.vel.z);
    if (len === 0 && this.onGround) {
      const drop = Math.max(0, hv - friction * speed * dt);
      if (hv > 0) { this.vel.x *= drop / hv; this.vel.z *= drop / hv; }
    }
    if (hv > speed) { this.vel.x *= speed / hv; this.vel.z *= speed / hv; }

    // Gravity + jump.
    const groundY = this.world.groundHeight(this.pos.x, this.pos.z);
    if (input.jump && this.onGround) {
      this.vel.y = 5.6;
      this.onGround = false;
    }
    this.vel.y -= 16 * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= groundY) {
      this.pos.y = groundY;
      this.vel.y = 0;
      this.onGround = true;
    }

    // AABB slide against the world.
    const moved = this.world.moveBox(
      this.pos.x, this.pos.y, this.pos.z,
      this.vel.x * dt, this.vel.z * dt,
      0.36, 0.36, this.height,
    );
    this.pos.x = moved.x; this.pos.z = moved.z;

    this.speedFrac = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / speed);

    // Recoil spring: kick decays back toward zero.
    const k = Math.min(1, dt * 9);
    this.recoilPitch *= (1 - k);
    this.recoilYaw *= (1 - k);
  }

  applyCamera(camera) {
    camera.position.copy(this.eyePos);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = this.yaw + this.recoilYaw;
    camera.rotation.x = this.pitch + this.recoilPitch;
    camera.rotation.z = 0;
  }

  addRecoil(pitch, yaw) {
    this.recoilPitch += pitch;
    this.recoilYaw += yaw;
    // Clamp the accumulated kick so a full spray stays on screen.
    this.recoilPitch = Math.min(this.recoilPitch, 0.55);
    this.recoilYaw = Math.max(-0.3, Math.min(0.3, this.recoilYaw));
  }
}
