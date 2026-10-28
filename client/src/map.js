// Builds Three.js meshes for the shared map definition.

import * as THREE from 'three';
import { MAP } from '../../shared/map.js';
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
  objective: { color: 0xffd04a, emissive: 0xffa800, emissiveIntensity: 1.4, roughness: 0.3 },
};

const unitBox = new THREE.BoxGeometry(1, 1, 1);

export function buildMap(scene) {
  const materials = {};
  const material = (kind) => {
    if (!materials[kind]) materials[kind] = new THREE.MeshStandardMaterial(KIND_STYLE[kind] || { color: 0xff00ff });
    return materials[kind];
  };

  const group = new THREE.Group();
  const meshesById = new Map();

  // Destructible interior walls are drawn as panels by DestructionView.
  for (const b of getWallLayout().staticBoxes) {
    const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
    const mesh = new THREE.Mesh(unitBox, material(b.kind));
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(b.min[0] + sx / 2, b.min[1] + sy / 2, b.min[2] + sz / 2);
    mesh.castShadow = b.kind !== 'ground' && b.kind !== 'boundary';
    mesh.receiveShadow = true;
    mesh.userData.boxId = b.id;
    meshesById.set(b.id, mesh);
    group.add(mesh);
  }

  // Objective glow
  const o = MAP.objective;
  const glow = new THREE.PointLight(0xffb020, 6, 7, 1.5);
  glow.position.set(o.x, o.y + o.size + 0.3, o.z);
  group.add(glow);

  scene.add(group);
  return { group, meshesById, objectiveLight: glow };
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

  // Soft fill lights so the building interior isn't pitch black under the roof.
  for (const [x, y, z] of [[-8, 2.6, 0], [0, 2.6, -3], [0, 2.6, 4.5], [8, 2.6, 0], [-8, 5.6, 0], [0, 5.6, 0], [8, 5.6, -5]]) {
    const l = new THREE.PointLight(0xfff0d8, 4, 12, 1.6);
    l.position.set(x, y, z);
    scene.add(l);
  }
}
