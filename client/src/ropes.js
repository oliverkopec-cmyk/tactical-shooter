// Rope anchors on the roofs and the ropes players hang from. The anchors are small steel fittings at the
// roof edge (and beside each roof hatch); a rope is drawn from its anchor down to every player who is
// rappelling, so you can see others on ropes (and they can be shot).

import * as THREE from 'three';
import { RAPPEL } from '../../shared/constants.js';
import { ropePosition } from '../../shared/movement.js';

const steel = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.45, metalness: 0.7 });
const ropeMat = new THREE.MeshStandardMaterial({ color: 0xd8c27a, roughness: 0.9 });
const ropeGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 6);

export class RopeView {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;
    this.group = new THREE.Group();
    // Anchor fittings: a plate with a ring, where each rope is tied on
    for (const r of map.ropes || []) {
      const fit = new THREE.Group();
      fit.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.2), steel));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.016, 6, 12), steel);
      ring.position.y = 0.07;
      fit.add(ring);
      const p = r.kind === 'hatch' ? { x: r.x, z: r.z + 0.7 } : { x: r.x - r.nx * 0.35, z: r.z - r.nz * 0.35 };
      fit.position.set(p.x, r.top + 0.03, p.z);
      if (r.kind === 'wall' && r.nx) fit.rotation.y = Math.PI / 2;
      this.group.add(fit);
    }
    scene.add(this.group);
    this.pool = [];     // rope meshes in use this frame
    this.free = [];
  }

  /** Draw one rope from its anchor to a hanging player at (x, y, z) (y is their feet). */
  draw(ropeNumber, x, y, z) {
    const r = this.map.ropes?.[ropeNumber - 1];
    if (!r) return;
    const mesh = this.free.pop() || new THREE.Mesh(ropeGeo, ropeMat);
    const top = r.kind === 'hatch' ? { x: r.x, z: r.z + 0.7 } : { x: r.x - r.nx * 0.2, z: r.z - r.nz * 0.2 };
    const a = new THREE.Vector3(top.x, r.top + 0.07, top.z), b = new THREE.Vector3(x, y + RAPPEL.hang, z);
    const len = a.distanceTo(b);
    mesh.position.copy(a).lerp(b, 0.5);
    mesh.scale.set(1, Math.max(0.01, len), 1);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    mesh.castShadow = false;
    if (!mesh.parent) this.group.add(mesh);
    this.pool.push(mesh);
  }

  /** Call once per frame before drawing: last frame's ropes go back to the pool. */
  begin() {
    for (const m of this.pool) { m.visible = false; this.free.push(m); }
    this.pool.length = 0;
  }

  /** Make this frame's ropes visible. */
  end() {
    for (const m of this.pool) m.visible = true;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o.isMesh && o.geometry !== ropeGeo) o.geometry.dispose(); });
  }
}

export { ropePosition };
