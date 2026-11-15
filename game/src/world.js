// VIGIL // FOUNDRY — one data-driven world builder for both maps.
// A layout array (config.js MAPS) becomes meshes + AABB colliders + ramps
// + plant sites + a waypoint graph. Switching maps tears the world down
// cleanly: the world group is removed, its geometries and map-owned
// materials are disposed, colliders and bots are dropped, then the next
// map is built from the same code path. No per-map special cases.

import * as THREE from 'three';

const MAT_COLORS = {
  concrete: 0x8a8d90, asphalt: 0x55585c, wall: 0x9a958a,
  plywood: 0xb08a58, crate: 0x9a7848, metal: 0x6a767e,
  target: 0xe8e2d2, furnace: 0x2a2018,
  brick: 0xa8705a, cobble: 0x8a7a68, hazard: 0xc8a028,
};

function gradientTex(w, h, stops, vertical) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const grad = vertical ? g.createLinearGradient(0, 0, 0, h) : g.createLinearGradient(0, 0, w, 0);
  for (const [t, col] of stops) grad.addColorStop(t, col);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function radialTex(size, stops) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  for (const [t, col] of stops) grad.addColorStop(t, col);
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class World {
  constructor(scene, textures, mapDef) {
    this.scene = scene;
    this.textures = textures;
    this.def = mapDef;
    this.group = new THREE.Group();
    this.group.name = `world-${mapDef.id}`;
    this.colliders = [];
    this.ramps = [];
    this.platforms = [];
    this.ownedGeometries = [];
    this.ownedMaterials = [];
    this.lights = [];
    this.siteMeshes = [];
    this.build();
    scene.add(this.group);
  }

  mat(name, opts = {}) {
    const tex = this.textures[name];
    const m = new THREE.MeshStandardMaterial({
      color: MAT_COLORS[name] ?? 0x888888,
      map: tex ?? null,
      roughness: opts.rough ?? 0.9,
      metalness: opts.metal ?? 0.05,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
    });
    this.ownedMaterials.push(m);
    return m;
  }

  box(x, z, w, d, h, y0, matName, opts) {
    const geo = new THREE.BoxGeometry(w, h, d);
    this.ownedGeometries.push(geo);
    const mesh = new THREE.Mesh(geo, this.mat(matName, opts));
    mesh.position.set(x, y0 + h / 2, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh);
    this.colliders.push({
      minX: x - w / 2, maxX: x + w / 2,
      minY: y0, maxY: y0 + h,
      minZ: z - d / 2, maxZ: z + d / 2,
    });
    return mesh;
  }

  build() {
    const def = this.def;
    const T = this.textures;
    this.scene.background = new THREE.Color(def.sky);
    this.scene.fog = new THREE.FogExp2(def.fog[0], def.fog[1] / 1000 * 0.55);

    // Outdoor sunset sky: a gradient dome (amber horizon fading to dusk
    // purple) instead of a flat color, so the yard reads as dusk at a
    // glance. Fog is off for the dome; it sits far outside the fog range.
    if (def.outdoor) {
      const domeTex = gradientTex(4, 256, [[0, '#2e1a3a'], [0.45, '#7a3a4a'], [0.68, '#e8722a'], [0.8, '#ffb060'], [1, '#5a3a28']], true);
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(150, 24, 16),
        new THREE.MeshBasicMaterial({ map: domeTex, side: THREE.BackSide, fog: false }),
      );
      this.group.add(dome);
      this.ownedGeometries.push(dome.geometry);
      this.ownedMaterials.push(dome.material);
      // Sun disc kept small and soft (was a 34 m blown-out white disc):
      // a warm glow low on the horizon, not a second light source.
      const sunTex = radialTex(128, [[0, 'rgba(255,205,130,0.9)'], [0.4, 'rgba(255,160,70,0.65)'], [1, 'rgba(255,120,40,0)']]);
      const disc = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 20),
        new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, fog: false, depthWrite: false }),
      );
      disc.position.set(120, 24, -64);
      disc.lookAt(0, 6, 0);
      this.group.add(disc);
      this.ownedGeometries.push(disc.geometry);
      this.ownedMaterials.push(disc.material);
    }

    const gGeo = new THREE.PlaneGeometry(def.ground.w, def.ground.d);
    this.ownedGeometries.push(gGeo);
    const ground = new THREE.Mesh(gGeo, this.mat(def.ground.mat, { rough: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    // Hemisphere ambience + sun (shadows only on the outdoor map, where
    // the long shadows are part of the look; indoor light is fluorescent).
    // Hemi raised 1.5 -> 1.9 in v3 so surfaces read clearly in the stills.
    const hemi = new THREE.HemisphereLight(def.ambient, 0x2a2e35, 1.9);
    this.group.add(hemi); this.lights.push(hemi);
    const sun = new THREE.DirectionalLight(def.sun.color, def.sun.intensity);
    sun.position.set(...def.sun.pos);
    sun.target.position.set(0, 0, 0);
    if (def.outdoor) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
      sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
      sun.shadow.camera.far = 90;
      sun.shadow.bias = -0.0004;
    }
    this.group.add(sun); this.group.add(sun.target); this.lights.push(sun);
    if (def.outdoor) {
      const fill = new THREE.DirectionalLight(0x9a7ab0, 1.15);
      fill.position.set(-20, 25, 22);
      fill.target.position.set(0, 0, 0);
      this.group.add(fill); this.group.add(fill.target); this.lights.push(fill);
    }

    for (const s of def.solids) {
      if (s.ramp) {
        this.ramps.push(s);
        const len = s.len, h = s.y1 - s.y0;
        const geo = new THREE.BoxGeometry(s.dir.startsWith('x') ? len : s.w, 0.25, s.dir.startsWith('x') ? s.w : len);
        this.ownedGeometries.push(geo);
        const mesh = new THREE.Mesh(geo, this.mat('metal', { metal: 0.5, rough: 0.5 }));
        const cx = s.dir === 'x+' ? s.x + len / 2 : s.dir === 'x-' ? s.x - len / 2 : s.x;
        const cz = s.dir === 'z+' ? s.z + len / 2 : s.dir === 'z-' ? s.z - len / 2 : s.z;
        mesh.position.set(cx, (s.y0 + s.y1) / 2, cz);
        mesh.rotation.z = s.dir === 'x+' ? -Math.atan2(h, len) : s.dir === 'x-' ? Math.atan2(h, len) : 0;
        mesh.rotation.x = s.dir === 'z+' ? Math.atan2(h, len) : s.dir === 'z-' ? -Math.atan2(h, len) : 0;
        mesh.castShadow = true; mesh.receiveShadow = true;
        this.group.add(mesh);
        continue;
      }
      const y0 = s.y0 ?? 0;
      const mesh = this.box(s.x, s.z, s.w, s.d, s.h, y0, s.mat);
      if (s.mat === 'furnace') { // glowing furnace face
        const fg = new THREE.PlaneGeometry(s.w * 0.8, s.h * 0.6);
        this.ownedGeometries.push(fg);
        const face = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ map: T.furnace }));
        face.position.set(s.x, y0 + s.h * 0.45, s.z - s.d / 2 - 0.01);
        face.rotation.y = Math.PI;
        this.group.add(face);
        const glow = new THREE.PointLight(0xff6a1a, 12, 12, 1.8);
        glow.position.set(s.x, 2.2, s.z - s.d / 2 - 1.5);
        this.group.add(glow); this.lights.push(glow);
      }
      if (s.mat === 'target') { // paper target face on the stand
        const tg = new THREE.PlaneGeometry(1.4, 1.4);
        this.ownedGeometries.push(tg);
        const face = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ map: T.target }));
        face.position.set(s.x - 0.12, 1.5, s.z);
        face.rotation.y = -Math.PI / 2;
        this.group.add(face);
      }
      if (y0 > 0) this.platforms.push({ minX: s.x - s.w / 2, maxX: s.x + s.w / 2, minZ: s.z - s.d / 2, maxZ: s.z + s.d / 2, top: y0 + s.h });
    }

    if (def.ceiling) {
      const cg = new THREE.PlaneGeometry(def.ground.w, def.ground.d);
      this.ownedGeometries.push(cg);
      const ceil = new THREE.Mesh(cg, this.mat('concrete', { rough: 1 }));
      ceil.rotation.x = Math.PI / 2;
      ceil.position.y = def.ceiling.y;
      this.group.add(ceil);
      for (const [px, pz] of def.ceiling.panels) {
        const pg = new THREE.PlaneGeometry(2.4, 0.9);
        this.ownedGeometries.push(pg);
        const panel = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: 0xfff6dd }));
        panel.rotation.x = Math.PI / 2;
        panel.position.set(px, def.ceiling.y - 0.02, pz);
        this.group.add(panel);
        const pl = new THREE.PointLight(0xfff2cf, 18, 18, 1.4);
        pl.position.set(px, def.ceiling.y - 0.6, pz);
        this.group.add(pl); this.lights.push(pl);
      }
    }

    // Plant sites: glowing ground ring + floating letter.
    for (const site of def.sites) {
      const rg = new THREE.RingGeometry(site.r - 0.35, site.r, 40);
      this.ownedGeometries.push(rg);
      const ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({
        color: 0xffb020, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(site.x, 0.06, site.z);
      this.group.add(ring);
      this.siteMeshes.push(ring);
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = 'rgba(20,16,8,0.65)'; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffb020'; g.font = 'bold 72px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(site.id, 64, 68);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const sm = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      this.ownedMaterials.push(sm);
      const sprite = new THREE.Sprite(sm);
      sprite.scale.set(1.6, 1.6, 1);
      sprite.position.set(site.x, 2.6, site.z);
      this.group.add(sprite);
    }

    this.buildProps();
    this.buildSigns();

    this.buildWaypoints();
  }

  // Props: barrels (hazard-banded cylinders), planters (box + green
  // top), striped barriers (low cover) and lamps (pole + warm head).
  // Visual + colliders, built from the same layout data as walls.
  col(x, z, hx, hz, h) {
    this.colliders.push({ minX: x - hx, maxX: x + hx, minY: 0, maxY: h, minZ: z - hz, maxZ: z + hz });
  }

  buildProps() {
    const def = this.def;
    for (const p of def.props ?? []) {
      if (p.kind === 'barrel') {
        const geo = new THREE.CylinderGeometry(0.42, 0.42, 1.1, 12);
        this.ownedGeometries.push(geo);
        const mesh = new THREE.Mesh(geo, this.mat('metal', { rough: 0.6, metal: 0.4 }));
        mesh.position.set(p.x, 0.55, p.z);
        mesh.castShadow = true; mesh.receiveShadow = true;
        this.group.add(mesh);
        const bandGeo = new THREE.CylinderGeometry(0.43, 0.43, 0.18, 12);
        this.ownedGeometries.push(bandGeo);
        const band = new THREE.Mesh(bandGeo, this.mat('hazard', { rough: 0.7 }));
        band.position.set(p.x, 0.75, p.z);
        this.group.add(band);
        this.col(p.x, p.z, 0.42, 0.42, 1.1);
      } else if (p.kind === 'planter') {
        const geo = new THREE.BoxGeometry(1.6, 0.7, 1.6);
        this.ownedGeometries.push(geo);
        const mesh = new THREE.Mesh(geo, this.mat('concrete', { rough: 1 }));
        mesh.position.set(p.x, 0.35, p.z);
        mesh.castShadow = true; mesh.receiveShadow = true;
        this.group.add(mesh);
        const topGeo = new THREE.BoxGeometry(1.4, 0.25, 1.4);
        this.ownedGeometries.push(topGeo);
        const top = new THREE.Mesh(topGeo, new THREE.MeshStandardMaterial({ color: 0x4a6a34, roughness: 1 }));
        this.ownedMaterials.push(top.material);
        top.position.set(p.x, 0.8, p.z);
        this.group.add(top);
        this.col(p.x, p.z, 0.8, 0.8, 0.95);
      } else if (p.kind === 'barrier') {
        const geo = new THREE.BoxGeometry(2.2, 1.0, 0.25);
        this.ownedGeometries.push(geo);
        const mesh = new THREE.Mesh(geo, this.mat('hazard', { rough: 0.7 }));
        mesh.position.set(p.x, 0.5, p.z);
        mesh.rotation.y = p.rotY ?? 0;
        mesh.castShadow = true; mesh.receiveShadow = true;
        this.group.add(mesh);
        const long = Math.abs(Math.cos(mesh.rotation.y)) > 0.5;
        this.col(p.x, p.z, long ? 1.1 : 0.13, long ? 0.13 : 1.1, 1.0);
      } else if (p.kind === 'lamp') {
        const poleGeo = new THREE.CylinderGeometry(0.07, 0.09, 3.4, 8);
        this.ownedGeometries.push(poleGeo);
        const pole = new THREE.Mesh(poleGeo, this.mat('metal', { rough: 0.5, metal: 0.6 }));
        pole.position.set(p.x, 1.7, p.z);
        pole.castShadow = true;
        this.group.add(pole);
        const headGeo = new THREE.SphereGeometry(0.22, 10, 8);
        this.ownedGeometries.push(headGeo);
        const head = new THREE.Mesh(headGeo, new THREE.MeshBasicMaterial({ color: 0xffc46b }));
        head.position.set(p.x, 3.5, p.z);
        this.group.add(head);
        const glow = new THREE.PointLight(0xffb060, 6, 10, 1.8);
        glow.position.set(p.x, 3.4, p.z);
        this.group.add(glow); this.lights.push(glow);
        this.col(p.x, p.z, 0.1, 0.1, 3.4);
      }
    }
  }

  // Painted wall signage: canvas text on a dark plate, placed from the
  // layout array (site letters, map name, warnings). No external art.
  buildSigns() {
    for (const s of this.def.signs ?? []) {
      const c = document.createElement('canvas'); c.width = 512; c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = 'rgba(16,12,8,0.82)'; g.fillRect(0, 0, 512, 128);
      g.strokeStyle = '#e8722a'; g.lineWidth = 6; g.strokeRect(4, 4, 504, 120);
      g.fillStyle = '#ffb060'; g.font = 'bold 56px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(s.text, 256, 66);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const geo = new THREE.PlaneGeometry(s.w, s.w / 4);
      this.ownedGeometries.push(geo);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
      this.ownedMaterials.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(s.x, s.y, s.z);
      mesh.rotation.y = s.rotY;
      this.group.add(mesh);
    }
  }

  buildWaypoints() {
    const pts = this.def.waypoints;
    this.graph = pts.map((p) => ({ x: p[0], z: p[1], edges: [] }));
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i][0] - pts[j][0], dz = pts[i][1] - pts[j][1];
        if (Math.hypot(dx, dz) > 13) continue;
        if (this.segmentBlocked({ x: pts[i][0], y: 1.2, z: pts[i][1] }, { x: pts[j][0], y: 1.2, z: pts[j][1] })) continue;
        this.graph[i].edges.push(j);
        this.graph[j].edges.push(i);
      }
    }
  }

  nearestWaypoint(x, z) {
    let best = 0, bd = Infinity;
    this.graph.forEach((n, i) => {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  findPath(x, z, tx, tz) {
    const start = this.nearestWaypoint(x, z);
    const goal = this.nearestWaypoint(tx, tz);
    if (start === goal) return [goal];
    const prev = new Array(this.graph.length).fill(-1);
    const queue = [start]; prev[start] = start;
    while (queue.length) {
      const cur = queue.shift();
      if (cur === goal) break;
      for (const nb of this.graph[cur].edges) {
        if (prev[nb] === -1) { prev[nb] = cur; queue.push(nb); }
      }
    }
    if (prev[goal] === -1) return [goal];
    const path = [];
    for (let n = goal; n !== start; n = prev[n]) path.unshift(n);
    return path;
  }

  segmentBlocked(a, b, yPad = 0) {
    for (const c of this.colliders) {
      if (segmentHitsBox(a, b, c, yPad)) return true;
    }
    return false;
  }

  groundHeight(x, z) {
    let h = 0;
    for (const r of this.ramps) {
      const half = r.w / 2;
      if (r.dir === 'x+') {
        if (z >= r.z - half && z <= r.z + half && x >= r.x && x <= r.x + r.len) {
          h = Math.max(h, r.y0 + (r.y1 - r.y0) * ((x - r.x) / r.len));
        }
      } else if (r.dir === 'x-') {
        if (z >= r.z - half && z <= r.z + half && x >= r.x - r.len && x <= r.x) {
          h = Math.max(h, r.y0 + (r.y1 - r.y0) * ((r.x - x) / r.len));
        }
      } else if (r.dir === 'z+') {
        if (x >= r.x - half && x <= r.x + half && z >= r.z && z <= r.z + r.len) {
          h = Math.max(h, r.y0 + (r.y1 - r.y0) * ((z - r.z) / r.len));
        }
      } else if (r.dir === 'z-') {
        if (x >= r.x - half && x <= r.x + half && z >= r.z - r.len && z <= r.z) {
          h = Math.max(h, r.y0 + (r.y1 - r.y0) * ((r.z - z) / r.len));
        }
      }
    }
    for (const p of this.platforms) {
      if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) h = Math.max(h, p.top);
    }
    return h;
  }

  moveBox(x, y, z, dx, dz, hx, hz, height) {
    let nx = x + dx, nz = z + dz;
    const overlaps = (px, pz) => this.colliders.some((c) =>
      px + hx > c.minX && px - hx < c.maxX &&
      pz + hz > c.minZ && pz - hz < c.maxZ &&
      y + height > c.minY + 0.05 && y < c.maxY - 0.05);
    if (overlaps(nx, z)) nx = x;
    if (overlaps(nx, nz)) nz = z;
    return { x: nx, z: nz };
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry && this.ownedGeometries.includes(o.geometry)) o.geometry.dispose();
    });
    for (const g of this.ownedGeometries) g.dispose();
    for (const m of this.ownedMaterials) m.dispose();
    this.colliders = []; this.ramps = []; this.platforms = [];
    this.graph = [];
  }
}

export function segmentHitsBox(a, b, c, yPad = 0) {
  const minX = c.minX, maxX = c.maxX;
  const minY = c.minY + yPad, maxY = c.maxY - yPad;
  const minZ = c.minZ, maxZ = c.maxZ;
  if (maxY <= minY) return false;
  let tmin = 0, tmax = 1;
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const axes = [
    [a.x, d.x, minX, maxX], [a.y, d.y, minY, maxY], [a.z, d.z, minZ, maxZ],
  ];
  for (const [o, dd, mn, mx] of axes) {
    if (Math.abs(dd) < 1e-9) { if (o < mn || o > mx) return false; }
    else {
      let t1 = (mn - o) / dd, t2 = (mx - o) / dd;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}
