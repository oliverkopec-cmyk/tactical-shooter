// Client view of destructible walls: all panels in one InstancedMesh, plus
// breach charge models and reinforcement visuals. The shared World is updated
// here from server events so movement prediction and raycasts see the holes.

import * as THREE from 'three';

const PANEL_COLOR = new THREE.Color(0xe4ddd0);
const REINFORCED_COLOR = new THREE.Color(0x4b535e);
const HATCH_COLOR = new THREE.Color(0x8a6a3c);   // hatch covers are wooden
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class DestructionView {
  constructor(scene, world, effects, audio) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.audio = audio;
    this.charges = new Map(); // id -> { group, led, owner }
    this.blink = 0;

    const panels = world.panels;
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }),
      panels.length,
    );
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.matrices = panels.map((p) => {
      const m = new THREE.Matrix4();
      m.compose(
        new THREE.Vector3(...p.center),
        new THREE.Quaternion(),
        new THREE.Vector3(p.max[0] - p.min[0], p.max[1] - p.min[1], p.max[2] - p.min[2]),
      );
      return m;
    });
    // Slight per-panel shade so the grid is readable without visible gaps.
    this.shade = panels.map((p) => 0.93 + (((p.col * 7 + p.row * 13) % 5) / 5) * 0.07);
    scene.add(this.mesh);
    this.syncAll();

    this.chargeGeo = new THREE.BoxGeometry(0.34, 0.22, 0.06);
    this.chargeMat = new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.6, metalness: 0.4 });
    this.stripMat = new THREE.MeshStandardMaterial({ color: 0xd9a12a, roughness: 0.6 });
  }

  /** Re-apply every panel's visibility and colour from the World (start / late join). */
  syncAll() {
    const c = new THREE.Color();
    for (const p of this.world.panels) {
      this.mesh.setMatrixAt(p.id, this.world.alive[p.id] ? this.matrices[p.id] : HIDDEN);
      c.copy(this.world.reinforced[p.sectionId] ? REINFORCED_COLOR : p.hatch ? HATCH_COLOR : PANEL_COLOR).multiplyScalar(this.shade[p.id]);
      this.mesh.setColorAt(p.id, c);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  destroyPanels(ids, { quiet = false } = {}) {
    const removed = this.world.destroyPanels(ids);
    for (const id of removed) {
      this.mesh.setMatrixAt(id, HIDDEN);
      if (!quiet) {
        const p = this.world.panels[id];
        const reinforced = this.world.reinforced[p.sectionId];
        this.effects.debris(p.center, reinforced ? 0x4b535e : 0xd8d0c0, removed.length > 6 ? 2 : 4);
      }
    }
    if (removed.length) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.effects.removeDecalsOnPanels(removed);
    }
    return removed;
  }

  reinforce(sectionId) {
    this.world.reinforce(sectionId);
    const c = new THREE.Color();
    const section = this.world.sections[sectionId];
    for (const id of section.panelIds) {
      c.copy(REINFORCED_COLOR).multiplyScalar(this.shade[id]);
      this.mesh.setColorAt(id, c);
    }
    this.mesh.instanceColor.needsUpdate = true;
    const mid = [(section.min[0] + section.max[0]) / 2, (section.min[1] + section.max[1]) / 2, (section.min[2] + section.max[2]) / 2];
    this.audio.clank(mid);
  }

  // ---------------------------------------------------------------- charges

  addCharge({ id, owner, pos, normal }) {
    if (this.charges.has(id)) return;
    const group = new THREE.Group();
    const body = new THREE.Mesh(this.chargeGeo, this.chargeMat);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.04, 0.065), this.stripMat);
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
    );
    led.position.set(0.12, 0.06, 0.035);
    group.add(body, strip, led);
    group.position.set(...pos);
    // Face out of the wall along its normal
    group.lookAt(pos[0] + normal[0], pos[1] + normal[1], pos[2] + normal[2]);
    this.scene.add(group);
    this.charges.set(id, { group, led, owner });
  }

  removeCharge(id) {
    const c = this.charges.get(id);
    if (!c) return;
    this.scene.remove(c.group);
    this.charges.delete(id);
  }

  explode({ id, pos, normal, panels }, listener) {
    this.removeCharge(id);
    this.destroyPanels(panels, { quiet: true });
    for (const pid of panels) {
      const p = this.world.panels[pid];
      this.effects.debris(p.center, 0xd8d0c0, 2, normal);
    }
    this.effects.explosion(pos);
    this.audio.explosion(pos, listener);
  }

  clearCharges() {
    for (const id of [...this.charges.keys()]) this.removeCharge(id);
  }

  update(dt) {
    this.blink += dt;
    const on = this.blink % 0.6 < 0.15;
    for (const c of this.charges.values()) c.led.visible = on;
  }
}
