// The ghost of what you're placing (Stage 27): a see-through copy where it will go, white if the
// spot is valid and red if it isn't. Worked out each frame with the same check the server makes
// when placing starts (placementTarget in shared/placing.js).

import * as THREE from 'three';
import { PLACE, placementTarget } from '../../shared/placing.js';
import { armorBox } from '../../shared/barricade.js';

const OK = new THREE.Color(0xffffff), BAD = new THREE.Color(0xff3b3b);

export class PlaceGhost {
  constructor(scene) {
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false });
    this.edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.mat);
    this.edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), this.edgeMat);
    this.group = new THREE.Group();
    this.group.add(this.mesh, this.edges);
    this.group.visible = false;
    this.group.renderOrder = 5;
    scene.add(this.group);
    this.t = 0;
  }

  /** kind: what is being placed (or null to hide); s: a state with yaw/pitch where the player aims. Returns the check's result. */
  update(kind, world, map, s, dt = 0) {
    if (!kind || !PLACE[kind]) { this.group.visible = false; return null; }
    const P = PLACE[kind];
    const aim = placementTarget(kind, world, map, s);
    this.t += dt;
    const g = this.group;
    g.visible = true;
    g.rotation.set(0, 0, 0);
    g.quaternion.identity();
    if (aim.opening) {
      // A doorway or window: the panel that will fill it
      const b = armorBox(aim.opening);
      const size = b.max.map((v, i) => v - b.min[i]);
      g.position.set(...b.min.map((v, i) => (v + b.max[i]) / 2));
      g.scale.set(size[0], size[1], size[2]);
    } else if (aim.section) {
      // A wall section to reinforce: its whole outline
      const sec = aim.section;
      const size = sec.max.map((v, i) => v - sec.min[i]);
      g.position.set(...sec.min.map((v, i) => (v + sec.max[i]) / 2));
      g.scale.set(size[0] + 0.04, size[1] + 0.04, size[2] + 0.04);
    } else if (aim.point) {
      const [w, h, d] = P.ghost || [0.3, 0.3, 0.1];
      const n = new THREE.Vector3(...(aim.normal || [0, 1, 0]));
      if (P.surface === 'front') {
        // A deployable shield stands on the floor in front of you
        g.position.set(aim.point[0], aim.point[1] + h / 2, aim.point[2]);
        g.lookAt(aim.point[0] - n.x, aim.point[1] + h / 2, aim.point[2] - n.z);
        g.scale.set(w, h, d);
      } else if (n.y > 0.5) {
        // On the floor: flat, sitting on it
        g.position.set(aim.point[0], aim.point[1] + h / 2 + 0.01, aim.point[2]);
        g.rotation.y = Math.atan2(-Math.sin(s.yaw), -Math.cos(s.yaw));
        g.scale.set(w, h, d);
      } else {
        // On a wall (or ceiling): its back against the surface, facing out
        g.position.set(aim.point[0] + n.x * d / 2, aim.point[1] + n.y * d / 2, aim.point[2] + n.z * d / 2);
        g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
        g.scale.set(w, h, d);
      }
    } else { g.visible = false; return aim; }
    const color = aim.ok ? OK : BAD;
    this.mat.color.copy(color);
    this.edgeMat.color.copy(color);
    this.mat.opacity = 0.22 + 0.1 * Math.sin(this.t * 6);
    return aim;
  }

  dispose() {
    this.group.parent?.remove(this.group);
  }
}
