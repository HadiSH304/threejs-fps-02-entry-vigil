// VIGIL // FOUNDRY — canvas-generated textures (no external assets).
// Every surface texture is painted procedurally at load: concrete, asphalt,
// plywood, crate wood, hazard metal, wall plaster, a paper target and the
// glowing furnace face. One shared canvas helper keeps the code small.

import * as THREE from 'three';

function canvasTexture(size, painter, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  painter(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function speckle(g, size, n, colors, aMin, aMax) {
  for (let i = 0; i < n; i++) {
    const v = colors[(Math.random() * colors.length) | 0];
    g.fillStyle = v;
    g.globalAlpha = aMin + Math.random() * (aMax - aMin);
    const r = 1 + Math.random() * 2.5;
    g.fillRect(Math.random() * size, Math.random() * size, r, r);
  }
  g.globalAlpha = 1;
}

export function buildTextures() {
  const T = {};

  T.concrete = canvasTexture(256, (g, s) => {
    g.fillStyle = '#6b6f73'; g.fillRect(0, 0, s, s);
    speckle(g, s, 2600, ['#5c6064', '#7a7e82', '#54585c'], 0.15, 0.5);
    g.strokeStyle = 'rgba(40,42,45,0.5)'; g.lineWidth = 2;
    for (let i = 0; i < 5; i++) { // hairline cracks
      g.beginPath();
      let x = Math.random() * s, y = Math.random() * s;
      g.moveTo(x, y);
      for (let j = 0; j < 5; j++) { x += (Math.random() - 0.5) * 60; y += (Math.random() - 0.5) * 60; g.lineTo(x, y); }
      g.stroke();
    }
    g.strokeStyle = 'rgba(30,32,34,0.7)'; g.lineWidth = 3; // expansion joints
    g.strokeRect(1, 1, s - 2, s - 2);
    g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.stroke();
    g.beginPath(); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke();
  }, [6, 5]);

  T.asphalt = canvasTexture(256, (g, s) => {
    g.fillStyle = '#3d4045'; g.fillRect(0, 0, s, s);
    speckle(g, s, 4200, ['#2e3134', '#4a4e53', '#565a5f', '#232628'], 0.2, 0.55);
    g.strokeStyle = 'rgba(210,170,60,0.55)'; g.lineWidth = 5; // faded lane paint
    g.setLineDash([26, 22]);
    g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.stroke();
    g.setLineDash([]);
  }, [8, 6]);

  T.wall = canvasTexture(256, (g, s) => {
    g.fillStyle = '#7d7a6e'; g.fillRect(0, 0, s, s);
    speckle(g, s, 1800, ['#6e6b60', '#8b877a', '#65625a'], 0.12, 0.4);
    g.fillStyle = 'rgba(52,54,58,0.85)'; g.fillRect(0, s - 14, s, 14); // grime skirting
    g.fillStyle = 'rgba(220,120,40,0.5)'; g.fillRect(0, 0, s, 5); // hazard top edge
  }, [3, 1]);

  T.plywood = canvasTexture(256, (g, s) => {
    g.fillStyle = '#a97e4f'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 32) { // grain bands
      g.fillStyle = y % 64 === 0 ? 'rgba(120,85,45,0.35)' : 'rgba(190,150,95,0.25)';
      g.fillRect(0, y, s, 14);
    }
    g.strokeStyle = 'rgba(90,60,30,0.6)'; g.lineWidth = 1.5;
    for (let i = 0; i < 14; i++) {
      g.beginPath();
      const y = Math.random() * s;
      g.moveTo(0, y);
      g.bezierCurveTo(s * 0.3, y + 6, s * 0.7, y - 6, s, y + 3);
      g.stroke();
    }
  }, [2, 1]);

  T.crate = canvasTexture(256, (g, s) => {
    g.fillStyle = '#8a6a3e'; g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(60,40,18,0.8)'; g.lineWidth = 8;
    g.strokeRect(6, 6, s - 12, s - 12);
    g.beginPath(); g.moveTo(6, 6); g.lineTo(s - 6, s - 6); g.moveTo(s - 6, 6); g.lineTo(6, s - 6); g.stroke();
    for (let y = 0; y < s; y += 42) {
      g.fillStyle = 'rgba(70,48,22,0.3)'; g.fillRect(0, y, s, 3);
    }
    g.fillStyle = 'rgba(240,220,180,0.85)';
    g.font = 'bold 34px monospace'; g.textAlign = 'center';
    g.fillText('VIGIL', s / 2, s / 2 + 12);
  }, [1, 1]);

  T.metal = canvasTexture(256, (g, s) => {
    g.fillStyle = '#4c565e'; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 8) { // brushed metal
      g.fillStyle = `rgba(${140 + Math.random() * 40 | 0},${150 + Math.random() * 30 | 0},${160 + Math.random() * 30 | 0},0.12)`;
      g.fillRect(x, 0, 3, s);
    }
    speckle(g, s, 500, ['#39424a', '#5d6a74'], 0.2, 0.5);
    g.fillStyle = 'rgba(200,90,30,0.7)'; // hazard chevrons
    for (let i = -1; i < 5; i++) {
      g.beginPath();
      g.moveTo(i * 64, s); g.lineTo(i * 64 + 32, s); g.lineTo(i * 64 + 64, s - 40); g.lineTo(i * 64 + 32, s - 40);
      g.closePath(); g.fill();
    }
  }, [2, 1]);

  T.target = canvasTexture(128, (g, s) => {
    g.fillStyle = '#e8e2d2'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#22242a';
    [56, 40, 24, 10].forEach((r, i) => {
      g.lineWidth = i === 0 ? 4 : 3;
      g.beginPath(); g.arc(s / 2, s / 2, r, 0, Math.PI * 2); g.stroke();
    });
    g.fillStyle = '#c23b2e'; g.beginPath(); g.arc(s / 2, s / 2, 7, 0, Math.PI * 2); g.fill();
  }, [1, 1]);

  T.furnace = canvasTexture(128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 6, s / 2, s / 2, s * 0.7);
    grad.addColorStop(0, '#ffd27a'); grad.addColorStop(0.45, '#ff7a2a'); grad.addColorStop(1, '#3a1408');
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
    speckle(g, s, 300, ['#ff9a3a', '#ff5a1a', '#7a2a08'], 0.3, 0.8);
  }, [1, 1]);

  T.smoke = canvasTexture(128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(200,205,210,0.9)');
    grad.addColorStop(0.6, 'rgba(190,195,200,0.45)');
    grad.addColorStop(1, 'rgba(190,195,200,0)');
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
  }, [1, 1]);

  return T;
}
