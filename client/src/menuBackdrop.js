// The world behind the main menu: a rooftop at dusk. Your operator stands on a pad on a wet
// concrete roof (air-conditioning units, a stair hut with a lamp, a water tower, a mast with a
// blinking light); across the gap the target building rises with its windows lit, a city spreads
// to the horizon under a dusk sky, a searchlight sweeps the clouds, fog drifts past, light rain
// falls and now and then an aircraft light crosses the sky. Everything is built in code.
// `low` (the Low graphics setting) uses fewer buildings, raindrops and fog banks and no extra lights.

import * as THREE from 'three';

const clock = { value: 0 };   // shared by the window flicker
const rnd = (() => { let a = 1234567; return () => { a = (a * 1103515245 + 12345) >>> 0; return a / 4294967296; }; })();

/** A canvas texture drawn by fn(ctx, w, h). */
function canvasTexture(w, h, fn, repeat = null) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  fn(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

/**
 * A building material whose windows are worked out from the world position: a window every 2.2 m
 * across and 3.4 m up on every wall, some lit warm, a few cool, most dark, a few flickering. So
 * windows are the same size on every tower whatever its shape (and it works on instanced towers).
 */
function windowMaterial(color, lit, brightness) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.2 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uLit = { value: lit };
    shader.uniforms.uBright = { value: brightness };
    shader.uniforms.uTime = clock;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vON;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vWP = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
          vON = normalize(mat3(instanceMatrix) * normal);
        #else
          vWP = (modelMatrix * vec4(position, 1.0)).xyz;
          vON = normalize(mat3(modelMatrix) * normal);
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uLit, uBright, uTime;
        varying vec3 vWP;
        varying vec3 vON;
        float hh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 an = abs(vON);
          if (an.y < 0.5) {
            vec2 uv = (an.x > an.z ? vWP.zy : vWP.xy) / vec2(2.2, 3.4);
            vec2 cell = floor(uv), f = fract(uv);
            float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.8);
            float r = hh(cell + floor(vWP.x * 0.01 + vWP.z * 0.013) * 7.31);
            float on = step(r, uLit);
            float flick = r < 0.01 ? step(0.5, fract(uTime * 0.7 + r * 50.0)) : 1.0;
            vec3 warm = mix(vec3(1.0, 0.72, 0.42), vec3(1.0, 0.86, 0.6), hh(cell + 3.0));
            vec3 wc = hh(cell + 9.0) < 0.15 ? vec3(0.55, 0.75, 1.0) : warm;
            totalEmissiveRadiance += wc * win * on * flick * uBright * (0.6 + 0.4 * hh(cell + 5.0));
          }
        }`);
  };
  m.customProgramCacheKey = () => 'menu-windows';
  return m;
}

/** Soft cloudy blotch for fog banks. */
function fogTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    for (let i = 0; i < 26; i++) {
      const x = 20 + rnd() * 88, y = 30 + rnd() * 68, r = 14 + rnd() * 30;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.22)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }
  });
}

/** Rough wet concrete for the roof. */
function concreteTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#3a3c42';
    g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rnd() - 0.5) * 26;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n + 2;
    }
    g.putImageData(img, 0, 0);
    // expansion joints and darker damp patches
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 2;
    for (const p of [64, 192]) { g.beginPath(); g.moveTo(p, 0); g.lineTo(p, h); g.moveTo(0, p); g.lineTo(w, p); g.stroke(); }
    for (let i = 0; i < 10; i++) {
      const x = rnd() * w, y = rnd() * h, r = 10 + rnd() * 40;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(10,12,18,0.35)');
      grad.addColorStop(1, 'rgba(10,12,18,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }
  }, [6, 4]);
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vDir;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 top = vec3(0.025, 0.035, 0.09), mid = vec3(0.15, 0.10, 0.23), hor = vec3(0.78, 0.36, 0.2), below = vec3(0.07, 0.05, 0.09);
  vec3 col = h > 0.0 ? mix(mix(hor, mid, smoothstep(0.0, 0.16, h)), top, smoothstep(0.16, 0.6, h)) : mix(hor * 0.55, below, smoothstep(0.0, -0.08, h));
  // the last of the sun, low on the left
  vec3 sun = normalize(vec3(-0.75, 0.03, -0.66));
  float s = max(dot(d, sun), 0.0);
  col += vec3(1.0, 0.45, 0.18) * (pow(s, 10.0) * 0.55 + pow(s, 60.0) * 0.6);
  // stars come out higher up, twinkling
  vec3 cell = floor(d * 260.0);
  float st = step(0.9965, hash(cell)) * smoothstep(0.22, 0.6, h);
  col += vec3(0.9, 0.95, 1.0) * st * (0.55 + 0.45 * sin(uTime * 2.0 + hash(cell + 3.0) * 30.0));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const BEAM_VERT = /* glsl */ `
uniform float uLen;
varying float vAlong;
varying vec3 vN, vV;
void main() {
  vAlong = clamp(-position.y / uLen, 0.0, 1.0);   // 0 at the lamp, 1 at the far end
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying float vAlong;
varying vec3 vN, vV;
void main() {
  float core = pow(abs(dot(vN, vV)), 2.0);          // brightest through the middle of the beam
  float a = pow(1.0 - vAlong, 1.6) * core * uStrength;
  gl_FragColor = vec4(uColor * a, a);
}`;

const RAIN_VERT = /* glsl */ `
uniform float uTime;
attribute vec4 aDrop;     // x, start height, z, speed
attribute float aEnd;     // 0 the bottom of the streak, 1 the top
varying float vA;
void main() {
  float y = mod(aDrop.y - uTime * aDrop.w, 12.0) - 0.4;
  vec3 p = vec3(aDrop.x + y * 0.06, y + aEnd * 0.32, aDrop.z);
  vA = smoothstep(-0.4, 0.4, y) * (0.4 + 0.6 * aEnd);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const RAIN_FRAG = /* glsl */ `
varying float vA;
void main() { gl_FragColor = vec4(0.72, 0.78, 0.9, 0.3 * vA); }`;

export class MenuBackdrop {
  constructor(scene, { low = false } = {}) {
    this.scene = scene;
    this.low = low;
    this.group = new THREE.Group();
    this.disposables = [];
    this.time = 0;
    scene.add(this.group);
    this.buildSky();
    this.buildCity();
    this.buildRoof();
    this.buildTarget();
    this.buildSearchlight();
    this.buildFog();
    this.buildRain();
    this.buildAircraft();
  }

  add(obj, { shadow = false } = {}) {
    obj.traverse((o) => {
      if (o.isMesh) { o.castShadow = shadow && !this.low; o.receiveShadow = !this.low; }
      if (o.geometry) this.disposables.push(o.geometry);
      if (o.material) this.disposables.push(o.material);
    });
    this.group.add(obj);
    return obj;
  }

  buildSky() {
    this.skyMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(220, 32, 16), this.skyMat);
    sky.renderOrder = -10;
    this.add(sky);
  }

  /** The city below and beyond the roof: hundreds of towers with lit windows, in one draw call. */
  buildCity() {
    const n = this.low ? 120 : 300;
    const mat = windowMaterial(0x0b0d14, 0.34, 1.8);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const city = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      // a wide arc in front of the camera (which looks towards -z), further = taller on average
      // our roof is high up: most of the city lies below it, with the odd tower rising above
      const a = (rnd() - 0.5) * Math.PI * 1.3;
      const dist = 55 + rnd() ** 0.8 * 150;
      const w = 7 + rnd() * 14, d = 7 + rnd() * 14;
      const tall = rnd() < 0.12;
      const top = tall ? 8 + rnd() * 30 + dist * 0.05 : -28 + rnd() * 26 + dist * 0.04;
      p.set(Math.sin(a) * dist, (top - 70) / 2, -Math.cos(a) * dist - 6);
      s.set(w, top + 70, d);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 0.5);
      city.setMatrixAt(i, m.compose(p, q, s));
    }
    this.add(city);
  }

  /** The roof you stand on, with its parapet and clutter. */
  buildRoof() {
    const tex = concreteTexture();
    this.disposables.push(tex);
    const concrete = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.55, metalness: 0.15 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 16), concrete);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.1, 1);
    this.add(floor);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x45464c, roughness: 0.8 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x5b5d63, roughness: 0.6, metalness: 0.2 });
    const parapet = (w, x, z, ry) => {
      const g = new THREE.Group();
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 1.0, 0.35), wallMat);
      wall.position.y = 0.4;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.08, 0.45), capMat);
      cap.position.y = 0.94;
      g.add(wall, cap);
      g.position.set(x, 0, z);
      g.rotation.y = ry;
      this.add(g, { shadow: true });
    };
    parapet(40, 0, -7, 0);
    parapet(16, -20, 1, Math.PI / 2);
    parapet(16, 20, 1, Math.PI / 2);

    const metal = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.45, metalness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.7, metalness: 0.4 });
    // air-conditioning units with fans
    for (const [x, z, r] of [[-4.4, -4.6, 0.2], [4.8, -5.3, -0.15], [-10, -2, 0]]) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.1, 1.1), metal);
      body.position.y = 0.45;
      const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.06, 20), dark);
      fan.position.set(0.3, 1.02, 0);
      const grille = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 0.02), dark);
      grille.position.set(0, 0.45, 0.56);
      g.add(body, fan, grille);
      g.position.set(x, 0, z);
      g.rotation.y = r;
      this.add(g, { shadow: true });
      (this.fans ||= []).push(fan);
    }
    // stair hut with a door and a lamp over it
    const hut = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.7, 2.4), wallMat);
    walls.position.y = 1.25;
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.0, 0.05), new THREE.MeshStandardMaterial({ color: 0x2a3138, metalness: 0.6, roughness: 0.5 }));
    door.position.set(0.4, 0.9, 1.22);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.18), new THREE.MeshStandardMaterial({ color: 0xffd8a0, emissive: 0xffc880, emissiveIntensity: 3 }));
    lamp.position.set(0.4, 2.1, 1.3);
    hut.add(walls, door, lamp);
    hut.position.set(-7.6, 0, -2.6);
    hut.rotation.y = 0.35;
    this.add(hut, { shadow: true });
    if (!this.low) {
      const pool = new THREE.PointLight(0xffc880, 6, 6, 1.8);
      pool.position.set(-7.0, 2.0, -1.2);
      this.group.add(pool);
    }
    // water tower on legs
    const tower = new THREE.Group();
    for (const [lx, lz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), dark);
      leg.position.set(lx, 1.3, lz);
      tower.add(leg);
    }
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 2.0, 20), new THREE.MeshStandardMaterial({ color: 0x5a4434, roughness: 0.9 }));
    tank.position.y = 3.6;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.7, 20), new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.9 }));
    roof.position.y = 4.95;
    tower.add(tank, roof);
    tower.position.set(8.2, 0, -5.4);
    this.add(tower, { shadow: true });
    // a mast with a blinking red light
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 7, 6), metal);
    mast.position.set(6.6, 3.5, -6.4);
    this.add(mast, { shadow: true });
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
    this.beacon.position.set(6.6, 7.05, -6.4);
    this.add(this.beacon);
    // vent pipes and a stack of crates
    for (const [x, z, h] of [[-2.3, -6.3, 0.9], [-1.8, -6.3, 0.6], [6, -2.6, 0.7]]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, h, 10), metal);
      pipe.position.set(x, h / 2 - 0.1, z);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 10), dark);
      cap.position.set(x, h - 0.05, z);
      this.add(pipe, { shadow: true }); this.add(cap);
    }
    const crate = new THREE.MeshStandardMaterial({ color: 0x5a4a32, roughness: 0.9 });
    for (const [x, y, z, r] of [[5.4, 0.3, -0.8, 0.3], [6.2, 0.3, -1.3, -0.2], [5.8, 0.9, -1.0, 0.1]]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.6, 0.75), crate);
      c.position.set(x, y - 0.1, z);
      c.rotation.y = r;
      this.add(c, { shadow: true });
    }
  }

  /** The target building across the gap: taller than the roof, windows lit, a helipad marker on top. */
  buildTarget() {
    const mat = windowMaterial(0x161a24, 0.5, 1.6);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(9, 60, 9), mat);
    tower.position.set(-13, -30 + 16, -20);
    tower.rotation.y = 0.25;
    this.add(tower);
    const crown = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.6, 9.4), new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.5, metalness: 0.6 }));
    crown.position.set(-13, 16.3, -20);
    crown.rotation.y = 0.25;
    this.add(crown);
    // a red warning light at each corner of the top
    this.redLights = [];
    for (const [dx, dz] of [[-4.3, -4.3], [4.3, -4.3], [-4.3, 4.3], [4.3, 4.3]]) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
      const c = Math.cos(0.25), s = Math.sin(0.25);
      l.position.set(-13 + dx * c + dz * s, 16.8, -20 - dx * s + dz * c);
      this.add(l);
      this.redLights.push(l);
    }
  }

  /** A searchlight on a lower building to the right, its beam sweeping slowly through the haze. */
  buildSearchlight() {
    const base = new THREE.Vector3(9, -2, -48);
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 0.8, 12), new THREE.MeshStandardMaterial({ color: 0x30343a, metalness: 0.7, roughness: 0.4, emissive: 0xfff2d0, emissiveIntensity: 0.6 }));
    housing.position.copy(base);
    this.add(housing);
    const len = 90;
    const geo = new THREE.ConeGeometry(7, len, 24, 1, true).translate(0, -len / 2, 0);   // the tip at the lamp, opening outwards along -y
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uLen: { value: len }, uColor: { value: new THREE.Color(0xfff0d0) }, uStrength: { value: this.low ? 0.18 : 0.24 } },
      vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    this.beam = new THREE.Mesh(geo, this.beamMat);
    this.beam.position.copy(base);
    this.beam.frustumCulled = false;
    this.add(this.beam);
  }

  /** Banks of fog drifting slowly sideways, in front of the city and over the roof's edge. */
  buildFog() {
    const tex = fogTexture();
    this.disposables.push(tex);
    this.fogs = [];
    const n = this.low ? 4 : 11;
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, color: 0x8a7f9a, transparent: true, opacity: 0.18 + rnd() * 0.18, depthWrite: false, fog: true });
      const sp = new THREE.Sprite(mat);
      const far = i < n * 0.6;
      sp.position.set((rnd() - 0.5) * 60, far ? -2 + rnd() * 8 : 0.4 + rnd() * 2, far ? -20 - rnd() * 40 : -7 - rnd() * 6);
      sp.scale.set(far ? 26 + rnd() * 20 : 10 + rnd() * 8, far ? 10 + rnd() * 6 : 3 + rnd() * 2, 1);
      sp.userData.speed = 0.3 + rnd() * 0.5;
      this.add(sp);
      this.fogs.push(sp);
    }
  }

  /** Light rain: streaks falling in a box around the operator and the camera. */
  buildRain() {
    const n = this.low ? 350 : 1300;
    const drop = new Float32Array(n * 2 * 4), end = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = (rnd() - 0.5) * 22, y = rnd() * 12, z = -14 + rnd() * 21, speed = 7 + rnd() * 3;
      for (let k = 0; k < 2; k++) { drop.set([x, y, z, speed], (i * 2 + k) * 4); end[i * 2 + k] = k; }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    geo.setAttribute('aDrop', new THREE.BufferAttribute(drop, 4));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.rainMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false });
    const rain = new THREE.LineSegments(geo, this.rainMat);
    rain.frustumCulled = false;
    this.add(rain);
  }

  /** A blinking aircraft light crossing the sky every so often. */
  buildAircraft() {
    this.plane = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
    this.add(this.plane);
  }

  update(dt) {
    const t = (this.time += dt);
    clock.value = t;
    this.skyMat.uniforms.uTime.value = t;
    this.rainMat.uniforms.uTime.value = t;
    // the searchlight sweeps left and right, rising and dipping a little
    const a = Math.sin(t * 0.16) * 0.9, up = 0.75 + Math.sin(t * 0.23) * 0.12;
    const dir = new THREE.Vector3(Math.sin(a) - 0.25, up, -0.35).normalize();
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    for (const f of this.fogs) {
      f.position.x += f.userData.speed * dt;
      if (f.position.x > 45) f.position.x = -45;
    }
    for (const fan of this.fans || []) fan.rotation.y += dt * 9;
    const blink = (t % 1.6) < 0.2;
    this.beacon.visible = blink;
    for (const l of this.redLights) l.visible = (t % 2.2) < 1.1;
    // the aircraft: 40 s crossing, then a pause
    const k = (t % 70) / 40;
    this.plane.visible = k < 1 && (t % 1.1) < 0.15;
    this.plane.position.set(-120 + k * 240, 45 + k * 8, -150);
  }

  dispose() {
    this.scene.remove(this.group);
    for (const d of this.disposables) d.dispose?.();
  }
}
