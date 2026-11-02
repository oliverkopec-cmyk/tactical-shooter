// Pictures of skins: each skin drawn on a rifle, side on, rendered once into an image
// (for the admin gift picker). Rendering happens a few skins per frame so the page never
// stalls, and the renderer is thrown away afterwards so it doesn't hold a WebGL context.

import * as THREE from 'three';
import { makeGunModel } from './weapons.js';

const W = 240, H = 110;
const cache = new Map();   // skin id -> data URL

/** Calls onThumb(id, url) for each skin as its picture is ready (cached ones straight away). */
export async function renderSkinThumbs(ids, onThumb, gun = 'rifle') {
  const todo = [];
  for (const id of ids) { if (cache.has(id)) onThumb(id, cache.get(id)); else todo.push(id); }
  if (!todo.length) return;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x161a20);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1, 2, 3);
  scene.add(key);
  const camera = new THREE.OrthographicCamera(-0.55, 0.55, 0.25, -0.25, 0.1, 10);
  camera.position.set(0, 0.02, 3);
  for (let i = 0; i < todo.length; i++) {
    const id = todo[i];
    const model = makeGunModel(gun, id);
    model.rotation.y = Math.PI / 2;           // muzzle to the right
    model.position.x = 0.04;
    scene.add(model);
    renderer.render(scene, camera);
    const url = canvas.toDataURL('image/png');
    cache.set(id, url);
    onThumb(id, url);
    scene.remove(model);
    model.traverse((o) => { if (o.isMesh || o.isPoints) { o.geometry.dispose(); } });
    if (i % 4 === 3) await new Promise((r) => requestAnimationFrame(r));
  }
  renderer.dispose();
  renderer.forceContextLoss();
}
