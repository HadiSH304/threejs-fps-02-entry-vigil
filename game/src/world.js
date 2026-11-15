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
};

export class World {
  constructor(scene, textures, mapDef) {
    this.scene = scene;
    this.textures = textures;
    this.def = mapDef;
    this.group = new THREE.Group();
    this.group.name = `world-${mapDef.id}`;
    this.colliders = []; // {minX,maxX,minY,maxY,minZ,maxZ}
    this.ramps = [];     // {x,z,w,len,dir,y0,y1}
    this.platforms = []; // walkable tops {minX,maxX,minZ,maxZ,top}
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

    // Ground.
    const gGeo = new THREE.PlaneGeometry(def.ground.w, def.ground.d);
    this.ownedGeometries.push(gGeo);
    const ground = new THREE.Mesh(gGeo, this.mat(def.ground.mat, { rough: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    // Hemisphere ambience + sun (shadows only on the outdoor map, where
    // the long shadows are part of the look; indoor light is fluorescent).
    const hemi = new THREE.HemisphereLight(def.ambient, 0x1a1d22, 0.85);
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

    // Solids + ramps from the layout array.
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

    // Killhouse ceiling + fluorescent panels.
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
        const pl = new THREE.PointLight(0xfff2cf, 6, 13, 1.6);
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
      // Floating letter sprite.
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

    this.buildWaypoints();
  }

  buildWaypoints() {
    // Graph: nodes are the layout waypoints; edges join nodes within 13 m
    // whose straight line is not blocked by a wall (2D slab test at y=1.2).
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

  // BFS path of waypoint indices from (x,z) to the waypoint nearest (tx,tz).
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

  // Slab test: does segment a->b hit any solid collider (3D)?
  segmentBlocked(a, b, yPad = 0) {
    for (const c of this.colliders) {
      if (segmentHitsBox(a, b, c, yPad)) return true;
    }
    return false;
  }

  // Ground height at (x,z): ramps interpolate, platforms cap, else 0.
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

  // AABB slide: try to move a box (half extents hx,hz, height) from (x,y,z)
  // by (dx,dz); returns the allowed position. y is the feet position.
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
  // Slab method on the segment; yPad shrinks the box vertically so a
  // low wall (barrier) does not block a standing eye-line.
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
