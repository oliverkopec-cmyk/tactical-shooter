// Builds Three.js meshes for the shared map definition.

import * as THREE from 'three';
import { getWallLayout } from '../../shared/world.js';

const KIND_STYLE = {
  ground: { color: 0x56704a, roughness: 1 },
  floor: { color: 0x8a6e52, roughness: 0.9 },
  exterior: { color: 0xc9bfa8, roughness: 0.9 },
  interior: { color: 0xe4ddd0, roughness: 0.85 },
  stairs: { color: 0x7a6450, roughness: 0.9 },
  roof: { color: 0x4a4f57, roughness: 0.8 },
  rail: { color: 0x3b3f45, roughness: 0.6, metalness: 0.3 },
  crate: { color: 0x9a7448, roughness: 0.9 },
  container: { color: 0x2f6f73, roughness: 0.6, metalness: 0.2 },
  boundary: { color: 0x6a7380, roughness: 1 },
  furniture: { color: 0x8a6a45, roughness: 0.8 },
  barrel: { color: 0x3d6a9a, roughness: 0.5, metalness: 0.4 },
  planter: { color: 0x4b3a2b, roughness: 0.9 },
  concrete: { color: 0x9a9a98, roughness: 1 },
  pallet: { color: 0xb08a58, roughness: 0.9 },
  car: { color: 0x8b2f2f, roughness: 0.35, metalness: 0.5 },
  site: { color: 0x3d434b, roughness: 0.5, metalness: 0.5 },
};

const unitBox = new THREE.BoxGeometry(1, 1, 1);

/** Draws a map (from getMap) into the scene. Everything it adds lives in the returned group. */
export function buildMap(scene, map) {
  const materials = {};
  const material = (kind, color) => {
    const key = `${kind}:${color ?? ''}`;
    if (!materials[key]) materials[key] = new THREE.MeshStandardMaterial({ ...(KIND_STYLE[kind] || { color: 0xff00ff }), ...(color !== undefined ? { color } : {}) });
    return materials[key];
  };

  const group = new THREE.Group();
  // Static boxes are drawn in batches: one instanced mesh per look (kind and colour),
  // so a map with hundreds of boxes costs a few dozen draw calls, not hundreds.
  // Destructible interior walls are drawn as panels by DestructionView.
  const batches = new Map();
  for (const b of getWallLayout(map).staticBoxes) {
    const key = `${b.kind}:${b.color ?? ''}`;
    if (!batches.has(key)) batches.set(key, { kind: b.kind, color: b.color, boxes: [] });
    batches.get(key).boxes.push(b);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (const { kind, color, boxes } of batches.values()) {
    const mesh = new THREE.InstancedMesh(unitBox, material(kind, color), boxes.length);
    boxes.forEach((b, i) => {
      const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
      m4.compose(new THREE.Vector3(b.min[0] + sx / 2, b.min[1] + sy / 2, b.min[2] + sz / 2), q, new THREE.Vector3(sx, sy, sz));
      mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = kind !== 'ground' && kind !== 'boundary';
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  // Visual-only details: rugs, pictures, monitors, plants, car windows
  for (const d of map.details) {
    const mat = new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.8, ...(d.emissive ? { emissive: d.color, emissiveIntensity: 0.6 } : {}) });
    const mesh = new THREE.Mesh(unitBox, mat);
    mesh.scale.set(d.max[0] - d.min[0], d.max[1] - d.min[1], d.max[2] - d.min[2]);
    mesh.position.set((d.min[0] + d.max[0]) / 2, (d.min[1] + d.max[1]) / 2, (d.min[2] + d.max[2]) / 2);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // One zone marking (ring, disc, glow) per possible site. They stay hidden until the
  // site is known to you: defenders after the vote, attackers once they find it.
  const sites = map.sites.map((site) => {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffc43a, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(site.zoneRadius - 0.1, site.zoneRadius, 64), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, site.y + 0.03, site.z);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(site.zoneRadius - 0.1, 64),
      new THREE.MeshBasicMaterial({ color: 0xffc43a, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(site.x, site.y + 0.025, site.z);
    const light = new THREE.PointLight(0xffb020, 6, 7, 1.5);
    light.position.set(site.x, site.y + site.size + 0.3, site.z);
    const holder = new THREE.Group();
    holder.add(ring, disc, light);
    holder.visible = false;
    group.add(holder);
    return { holder, mat };
  });

  // Soft fill lights so the building interior isn't pitch black under the roof
  for (const [x, y, z] of map.lights || []) {
    const l = new THREE.PointLight(0xfff0d8, 4, 12, 1.6);
    l.position.set(x, y, z);
    group.add(l);
  }

  scene.add(group);
  return { group, sites };
}

export function setupLighting(scene) {
  scene.background = new THREE.Color(0x9cc4e4);
  scene.fog = new THREE.Fog(0x9cc4e4, 60, 140);

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a5a3a, 1.1));
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));

  const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
  sun.position.set(25, 40, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const c = sun.shadow.camera;
  c.left = -40; c.right = 40; c.top = 40; c.bottom = -40; c.near = 1; c.far = 120;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  return sun;
}
