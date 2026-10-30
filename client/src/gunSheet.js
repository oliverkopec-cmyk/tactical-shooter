// Debug helper (?debug): render guns to a full-screen sheet of images, to look at the models.
// In the console: breachline.guns.sheet(['rifle', 'smg'], skinId, angle); breachline.guns.sheet() closes it.

import * as THREE from 'three';
import { makeGunModel, animateGun } from './gunModels.js';

export function sheet(ids = [], skin = null, angle = 0.35, anim = null, make = makeGunModel, cols = 1, zoom = 0.95) {
  document.getElementById('gun-sheet')?.remove();
  if (!ids.length) return;
  const W = Math.round(780 / cols), H = cols > 1 ? Math.round(W * 0.8) : 290;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x3a4350);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.8));
  const d = new THREE.DirectionalLight(0xffffff, 2.2);
  d.position.set(1, 2, 1.5);
  scene.add(d);
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.01, 10);
  const wrap = document.createElement('div');
  wrap.id = 'gun-sheet';
  wrap.style.cssText = 'position:fixed;inset:0;background:#222;z-index:99999;display:grid;grid-template-columns:repeat(' + cols + ',1fr);gap:2px;overflow:auto;align-content:start';
  for (const id of ids) {
    const g = make(id, skin);
    if (anim) animateGun(g, anim);
    scene.add(g);
    const box = new THREE.Box3().setFromObject(g);
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3()).length();
    cam.position.set(c.x + Math.cos(angle) * sz * zoom, c.y + sz * 0.22, c.z - Math.sin(angle) * sz * zoom);
    cam.lookAt(c);
    renderer.render(scene, cam);
    const img = new Image();
    img.src = renderer.domElement.toDataURL();
    img.style.cssText = 'width:100%;flex:0 0 auto';
    wrap.appendChild(img);
    scene.remove(g);
  }
  document.body.appendChild(wrap);
}
