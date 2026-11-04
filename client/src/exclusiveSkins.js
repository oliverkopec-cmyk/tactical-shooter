// Exclusive skins: animated effects drawn in shaders on top of the normal gun materials
// (lighting, shadows and reflections still work). The pattern is worked out from each
// point's position on the gun, so it runs continuously across parts and stays put while
// the gun moves. Every role gets its own treatment:
//   body / accent   the skin's effect (accent a darker take on it)
//   steel           dark polished metal with a sheen of light sliding along it
//   trim            sights, optic housing, vents: a glow that pulses along the gun
// Some skins also have small particles floating around the gun (embers, snow, petals...).
// The Christmas effects (21 and up) also give raised detail: they set fxH, a height that bends the surface so
// icing, ribbon and snow catch the light, and they have their own colours for the metal and the small parts.

import * as THREE from 'three';

const FX = { lava: 0, space: 1, storm: 2, crystal: 3, neon: 4, scales: 5, circuit: 6, waves: 7, aurora: 8, blossom: 9, carbon: 10, glitch: 11, holo: 12, plasma: 13, marble: 14, hexes: 15, fire: 16, toxic: 17, synth: 18, damascus: 19, pixels: 20, candy: 21, wrap: 22, ginger: 23, frost: 24, ornament: 25, pine: 26, twinkle: 27, knit: 28, holly: 29, wax: 30, leather: 31, mulled: 32, drift: 33, tinsel: 34, nightstar: 35, yule: 36, silent: 37 };
const ROLE = { body: 0, accent: 1, steel: 2, trim: 3 };

// One clock for every exclusive skin on screen (menu, game, crate), ticking on its own
const clock = { value: 0 };
let ticking = false;
function startClock() {
  if (ticking) return;
  ticking = true;
  const t0 = performance.now();
  const tick = (now) => { clock.value = (now - t0) / 1000; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}

const COMMON = /* glsl */ `
uniform float uTime, uScale, uSpeed, uGlow, uVar, uRole;
uniform vec3 uC1, uC2, uC3, uSteel, uTrim;
varying vec3 vGun;
varying vec3 vObjN;
float h1(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 h22(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float n3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h1(i), h1(i + vec3(1, 0, 0)), f.x), mix(h1(i + vec3(0, 1, 0)), h1(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h1(i + vec3(0, 0, 1)), h1(i + vec3(1, 0, 1)), f.x), mix(h1(i + vec3(0, 1, 1)), h1(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * n3(p); p *= 2.03; a *= 0.5; } return s; }
// Voronoi: x = distance to the nearest point, y = gap to the second (small on a cell edge), z = the cell's random number
vec3 vor(vec2 p) {
  vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)); vec2 r = g + h22(i + g) - f; float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = h2(i + g); } else if (d < d2) d2 = d;
  }
  return vec3(sqrt(d1), sqrt(d2) - sqrt(d1), id);
}
float gridLine(float x, float w) { return smoothstep(w, 0.0, 0.5 - abs(fract(x) - 0.5)); }
float band(float x, float w) { return smoothstep(w, 0.0, abs(fract(x) - 0.5)); }   // a soft stripe once per unit

float fxH = 0.0;   // the Christmas effects' raised detail, in the same units as uv

// The effect: base colour and glow for a point. uv = flat coordinates on the face, p = 3D position, fres = 0 facing you .. 1 edge-on
void skinFx(vec2 uv, vec3 p, float t, float fres, out vec3 col, out vec3 glow, inout float metal, inout float rough) {
  col = uC1; glow = vec3(0.0);
#if FX == 0   // lava: a dark crust broken by glowing cracks that flow
  vec2 q = uv + vec2(fbm(p * 0.6 + t * 0.15), fbm(p * 0.6 - t * 0.1)) * 0.9;
  vec3 v = vor(q);
  float crack = 1.0 - smoothstep(0.02, 0.14, v.y);
  float heat = fbm(p * 1.4 + vec3(0.0, -t * 0.6, 0.0));
  col = mix(uC1 * (0.7 + 0.6 * v.z), uC2 * 0.6, crack * 0.6);
  glow = mix(uC2, uC3, heat) * (crack * (1.1 + 0.6 * sin(t * 2.0 + v.z * 6.28)) + 0.12 * heat);
  rough = 0.85 - crack * 0.4; metal = 0.2;
#elif FX == 1  // deep space: a slow nebula with drifting, twinkling stars
  float neb = fbm(p * 0.7 + vec3(t * 0.05, 0.0, t * 0.03));
  col = mix(uC1, uC2, smoothstep(0.3, 0.8, neb)) * 1.4;
  vec2 sq = uv * 3.0 + vec2(t * 0.25, 0.0);
  vec2 cell = floor(sq), f = fract(sq) - 0.5, o = (h22(cell) - 0.5) * 0.6;
  float s = h2(cell);
  float star = step(0.6, s) * smoothstep(0.11, 0.0, length(f - o)) * (0.5 + 0.5 * sin(t * 5.0 + s * 40.0));
  glow = uC3 * star * 2.6 + uC2 * smoothstep(0.45, 0.9, neb) * 0.7;
  metal = 0.5; rough = 0.35;
#elif FX == 2  // storm: rolling clouds and forks of lightning that flash
  float c = fbm(p * 0.8 + vec3(0.0, 0.0, t * 0.3));
  col = mix(uC1, uC2, c);
  float r = abs(fbm(p * 1.5 + vec3(t * 0.9, 0.0, 0.0)) - 0.5);
  float bolt = smoothstep(0.035, 0.0, r);
  float flash = step(0.55, n3(vec3(t * 4.0, uVar * 7.0, 0.0)));
  glow = uC3 * bolt * (0.35 + 1.8 * flash) + uC2 * c * 0.25 * flash;
  metal = 0.4; rough = 0.4;
#elif FX == 3  // crystal: faceted ice with bright edges and sparkles
  vec3 v = vor(uv * 1.2);
  col = mix(uC1, uC2, v.z * 0.7) * (0.9 + 0.6 * v.x);
  float edge = 1.0 - smoothstep(0.0, 0.06, v.y);
  vec2 sg = uv * 6.0;
  float sp = h2(floor(sg) + floor(t * 3.0));
  float spark = step(0.95, sp) * smoothstep(0.45, 0.0, length(fract(sg) - 0.5));
  glow = uC3 * (edge * 0.9 + spark * 3.0) + uC1 * 0.18 + uC2 * fres * 0.5;
  metal = 0.6; rough = 0.08;
#elif FX == 4  // neon city: rows of lit windows switching on and off, and scanlines rolling past
  vec2 g = uv * vec2(1.6, 2.6);
  vec2 cell = floor(g), f = fract(g);
  float win = step(0.15, f.x) * step(f.x, 0.85) * step(0.22, f.y) * step(f.y, 0.78);
  float lit = step(0.45, h2(cell + floor(t * 0.6 + h2(cell) * 4.0)));
  vec3 wc = mix(uC2, uC3, step(0.5, h2(cell + 7.0)));
  float scan = band(uv.y * 0.18 - t * 0.35, 0.04);
  col = uC1 + wc * win * lit * 0.25;
  glow = wc * win * lit * 1.3 + uC3 * scan * 0.7;
  metal = 0.6; rough = 0.3;
#elif FX == 5  // dragon scales: overlapping scales with a colour that shifts as you turn the gun
  vec2 g = uv * 1.4; g.x += 0.5 * mod(floor(g.y), 2.0);
  vec2 c = fract(g) - vec2(0.5, 0.0);
  float d = length(c);
  float hue = fres * 1.2 + d * 0.8 + t * 0.15;
  vec3 iri = mix(uC1 * 1.4, uC2, 0.5 + 0.5 * sin(hue * 6.28));
  col = mix(iri, uC1 * 0.35, smoothstep(0.35, 0.6, d));
  glow = uC3 * smoothstep(0.42, 0.5, d) * step(d, 0.62) * (0.4 + 0.6 * sin(t * 2.0 + floor(g.y) * 0.9)) + iri * fres * 0.25;
  metal = 0.85; rough = 0.25;
#elif FX == 6  // circuitry: traces and pads with pulses of light running along them
  vec2 g = uv * 1.8; vec2 cell = floor(g), f = fract(g);
  float hr = h2(cell);
  float lh = smoothstep(0.07, 0.0, abs(f.y - 0.5)) * step(0.35, hr);
  float lv = smoothstep(0.07, 0.0, abs(f.x - 0.5)) * step(hr, 0.65);
  float pad = smoothstep(0.16, 0.1, length(f - 0.5)) * step(0.72, h2(cell + 3.1));
  float tr = max(max(lh, lv), pad);
  float pulse = smoothstep(0.85, 1.0, fract((cell.x + f.x + cell.y + f.y) * 0.22 - t * 0.6 + hr));
  col = mix(uC1, uC2, tr);
  glow = uC3 * tr * (0.12 + pulse * 2.0);
  metal = mix(0.4, 1.0, tr); rough = mix(0.5, 0.2, tr);
#elif FX == 7  // waves: layered swells rolling along, with glowing foam on the crests
  float y = uv.y + 0.35 * sin(uv.x * 1.2 + t) + 0.18 * sin(uv.x * 2.6 - t * 1.3);
  float b = fract(y * 1.1);
  col = mix(uC1, uC2, smoothstep(0.0, 1.0, b));
  float crest = smoothstep(0.9, 1.0, b);
  glow = uC3 * crest * (0.7 + 0.5 * n3(p * 3.0 + t)) + uC2 * 0.1;
  metal = 0.5; rough = 0.25;
#elif FX == 8  // aurora: curtains of light swaying across a night sky
  float x = uv.x * 0.5 + fbm(vec3(uv * 0.3, t * 0.2)) * 2.0;
  float curtain = pow(0.5 + 0.5 * sin(x * 3.0 + t * 0.7), 3.0);
  vec3 ac = mix(uC2, uC3, 0.5 + 0.5 * sin(x + t * 0.3));
  col = uC1 + ac * curtain * 0.2;
  glow = ac * curtain * (0.55 + 0.45 * fbm(vec3(uv * 0.8, t)));
  metal = 0.5; rough = 0.35;
#elif FX == 9  // blossom: petals turning slowly as they drift across
  vec2 g = uv * 1.1 + vec2(t * 0.15, -t * 0.1); vec2 cell = floor(g), f = fract(g) - 0.5;
  float hr = h2(cell), ang = hr * 6.28 + t * 0.5;
  vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * (f - (h22(cell) - 0.5) * 0.4);
  float a = atan(q.y, q.x), r = length(q);
  float petal = smoothstep(0.02, 0.0, r - 0.2 * (0.55 + 0.45 * abs(cos(a * 2.5)))) * step(0.3, hr);
  col = mix(uC1, uC2, petal);
  glow = uC3 * petal * 0.35 + uC3 * smoothstep(0.06, 0.0, r) * petal * 0.6;
  metal = 0.3; rough = 0.45;
#elif FX == 10  // carbon fibre: a woven sheen with inlaid metal lines that catch a moving light
  vec2 g = uv * 5.0;
  float weave = step(0.5, fract((floor(g.x) + floor(g.y)) * 0.5));
  float sheen = 0.5 + 0.5 * sin((weave > 0.5 ? g.x : g.y) * 6.28);
  col = vec3(0.035) + vec3(0.05) * sheen;
  float inl = uVar < 0.5 ? max(band(uv.x * 0.35 + uv.y * 0.18, 0.03), band(uv.y * 0.25, 0.02)) : band(uv.x * 0.5 - uv.y * 0.5, 0.025);
  float shim = band(uv.x * 0.12 - t * 0.25, 0.12);
  col = mix(col, uC2, inl);
  glow = uC3 * inl * (0.15 + 1.6 * shim);
  metal = mix(0.35, 1.0, inl); rough = mix(0.35, 0.15, inl);
#elif FX == 11  // glitch: blocks jumping sideways, colour bands splitting and flickering
  float tt = floor(t * 7.0);
  vec2 b = floor(uv * vec2(0.8, 3.0));
  float r = h2(b + tt);
  vec2 u2 = uv; u2.x += r > 0.78 ? (h2(b + tt + 1.0) - 0.5) * 3.0 : 0.0;
  float stripe = step(0.5, fract(u2.y * (uVar < 0.5 ? 1.5 : 4.0) + u2.x * 0.1));
  col = mix(uC1, uC2, stripe);
  float split = step(0.7, h2(vec2(floor(uv.y * 5.0), tt)));
  vec3 rgb = vec3(step(0.5, fract(u2.x * 2.0)), step(0.5, fract(u2.x * 2.0 + 0.33)), step(0.5, fract(u2.x * 2.0 + 0.66)));
  glow = (uVar < 0.5 ? rgb : uC3 * rgb.g) * split * 1.3 + uC3 * step(0.93, h2(b * 3.1 + tt)) * 1.6 + uC3 * stripe * 0.08;
  metal = 0.4; rough = 0.4;
#elif FX == 12  // holographic: rainbow foil that changes with the angle you look at it from
  float h = fres * 2.0 + (uv.x + uv.y) * 0.06 + t * 0.2;
  if (uVar > 0.5) h += vor(uv * 0.9).z * 1.5;    // prism: every facet its own colour
  vec3 rainbow = 0.5 + 0.5 * cos(6.28 * (h + vec3(0.0, 0.33, 0.67)));
  float lines = 0.5 + 0.5 * sin(uv.y * 18.0 + t * 2.0);
  col = mix(uC1, rainbow, 0.65);
  glow = rainbow * (0.2 + 0.4 * lines * fres) * mix(vec3(1.0), uC2, 0.3);
  metal = 1.0; rough = 0.12;
#elif FX == 13  // plasma: swirling bands of colour
  float v = sin(uv.x * 0.9 + t) + sin(uv.y * 1.1 - t * 1.3) + sin((uv.x + uv.y) * 0.7 + t * 0.7) + sin(length(uv) * 1.2 - t);
  vec3 pc = mix(mix(uC1, uC2, 0.5 + 0.5 * sin(v)), uC3, 0.5 + 0.5 * sin(v * 1.7));
  col = pc * 0.45; glow = pc * 0.75;
  metal = 0.4; rough = 0.3;
#elif FX == 14  // marble: polished stone with veins that glint (obsidian: veins that glow)
  float m = fbm(p * 0.8);
  float vein = smoothstep(0.16, 0.0, abs(sin(uv.x * 0.6 + fbm(p * 0.9) * 6.0)));
  col = mix(uC1, uC1 * 0.7, m);
  col = mix(col, uC2, vein);
  float glint = band(uv.x * 0.1 - t * 0.2, 0.1);
  glow = uC3 * vein * (uVar > 0.5 ? 0.6 + 0.4 * sin(t * 1.5 + m * 8.0) : 0.15 + 0.8 * glint);
  metal = mix(0.1, 1.0, vein); rough = mix(0.15, 0.25, vein);
#elif FX == 15  // energy shield: a hex grid with waves of energy passing through
  vec2 g = uv * 1.3; vec2 rr = vec2(1.0, 1.732), hh = rr * 0.5;
  vec2 a = mod(g, rr) - hh, b = mod(g - hh, rr) - hh;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  vec2 q = abs(gv);
  float d = max(dot(q, normalize(vec2(1.0, 1.732))), q.x);
  float edge = smoothstep(0.04, 0.0, abs(d - 0.45));
  float wave = band(uv.x * 0.15 - t * 0.4, 0.15);
  col = uC1 + uC2 * edge * 0.25;
  glow = uC2 * edge * (0.25 + 1.6 * wave) + uC3 * wave * (1.0 - edge) * 0.12;
  metal = 0.7; rough = 0.25;
#elif FX == 16  // fire: flames licking upwards
  float f = fbm(vec3(uv.x * 0.7, uv.y * 0.7 - t * 1.3, t * 0.3));
  float hgt = clamp(f * 1.5 - 0.25, 0.0, 1.0);
  vec3 fc = mix(uC1, mix(uC2, uC3, hgt), hgt);
  col = fc * 0.5; glow = fc * hgt * 1.4;
  metal = 0.2; rough = 0.6;
#elif FX == 17  // toxic: bubbles swelling and popping in sludge
  vec2 g = uv * 1.2 + vec2(0.0, t * 0.2); vec3 v = vor(g);
  float rad = 0.25 + 0.15 * sin(t * 2.0 + v.z * 20.0);
  float bub = smoothstep(rad, rad - 0.05, v.x), ring = smoothstep(0.04, 0.0, abs(v.x - rad));
  col = mix(uC1, uC2 * 0.6, bub);
  glow = uC3 * (ring * 1.2 + bub * 0.25 * (0.5 + 0.5 * sin(t * 3.0 + v.z * 9.0)));
  metal = 0.3; rough = 0.25;
#elif FX == 18  // synthwave: a sunset gradient with a neon grid rushing past
  col = mix(uC1, uC2 * 0.5, clamp(uv.y * 0.08 + 0.5, 0.0, 1.0));
  float grid = max(gridLine(uv.x * 1.2, 0.09), gridLine(uv.y * 1.2 + t * 0.6, 0.09));
  glow = uC3 * grid * 1.2 + uC2 * 0.08;
  metal = 0.6; rough = 0.3;
#elif FX == 19  // damascus: folded steel ripples with light sliding over them
  float w = sin((uv.x + fbm(p * 0.7) * 4.0 + sin(uv.y * 0.8) * 0.8) * 3.0);
  float layer = 0.5 + 0.5 * w;
  col = mix(uC1, uC2, layer);
  float shim = band(uv.x * 0.12 + uv.y * 0.05 - t * 0.2, 0.12);
  glow = uC3 * shim * layer * 0.6;
  metal = 1.0; rough = 0.2 + 0.2 * layer;
#elif FX == 21  // candy cane: glossy twisted stripes, red, white and fine red pinstripes, with sugar that sparkles
  float s = fract((uv.x * 0.85 + uv.y) * 0.3 - t * 0.05);
  float red = smoothstep(0.015, 0.03, s) * smoothstep(0.42, 0.405, s);
  float pin = max(smoothstep(0.022, 0.012, abs(s - 0.56)), max(smoothstep(0.022, 0.012, abs(s - 0.71)), smoothstep(0.022, 0.012, abs(s - 0.86))));
  col = mix(mix(uC1, uC2, red), uC2 * 0.95, pin);
  fxH = 0.09 * cos(s * 6.2832 * 2.0) + 0.012 * n3(vec3(uv * 11.0, 0.0));
  vec2 sg = floor(uv * 13.0);
  float sugar = step(0.975, h2(sg)) * (0.45 + 0.55 * sin(t * 4.0 + h2(sg + 3.0) * 60.0));
  glow = uC3 * (sugar * 1.8 + band(uv.x * 0.08 - t * 0.26, 0.07) * 0.5) + uC2 * red * 0.1;
  metal = 0.08; rough = 0.16;
#elif FX == 22  // wrapping paper: foil stars and snowflakes on red, tied both ways with a raised satin ribbon
  vec2 g = uv * 0.9; g.x += 0.5 * mod(floor(g.y), 2.0);
  vec2 cell = floor(g), f = fract(g) - 0.5;
  float a = atan(f.y, f.x) + h2(cell) * 6.28, r = length(f), kind = h2(cell + 5.0);
  float star = kind < 0.6 ? smoothstep(0.015, 0.0, r - 0.2 * (0.58 + 0.42 * cos(a * 5.0))) : smoothstep(0.03, 0.012, abs(cos(a * 3.0)) * r) * smoothstep(0.24, 0.2, r);
  float rx = abs(fract(uv.x * 0.11) - 0.5), ry = abs(fract(uv.y * 0.35) - 0.5);
  float ribbon = max(smoothstep(0.062, 0.056, rx), smoothstep(0.1, 0.09, ry));
  float edge = max(smoothstep(0.075, 0.068, rx), smoothstep(0.125, 0.112, ry)) - ribbon;
  float sat = 0.5 + 0.5 * sin((rx < 0.075 ? uv.y : uv.x) * 34.0);
  col = mix(uC1 * (0.92 + 0.16 * n3(vec3(uv * 4.0, 1.0))), uC2, star);
  col = mix(col, uC3 * (0.85 + 0.25 * sat), ribbon);
  col = mix(col, uC2, edge);
  fxH = max(ribbon, edge * 0.8) * 0.14 + star * 0.018;
  float tw = pow(0.5 + 0.5 * sin(t * 2.2 + h2(cell) * 40.0), 5.0);
  float sweep = band(uv.x * 0.09 - t * 0.2, 0.07);
  glow = uC2 * (star * (0.14 + 0.9 * tw) * (1.0 - ribbon) + edge * 0.35) + uC3 * ribbon * sweep * 0.8;
  metal = mix(0.1, 0.9, max(star, edge)); rough = mix(0.55, 0.22, max(max(star, edge), ribbon * 0.7));
#elif FX == 23  // gingerbread: baked and crumbly, piped icing scallops standing proud, shiny sweets pressed in
  float crumb = fbm(p * 2.4);
  col = uC1 * (0.55 + 0.95 * crumb);
  col = mix(col, uC1 * 0.45, smoothstep(0.1, 0.0, abs(fract(uv.y * 0.18) - 0.5)) * 0.5);
  float rowY = uv.y * 0.32, rowId = floor(rowY), yy = fract(rowY) - 0.5;
  float arc = abs(yy - 0.22 * abs(sin(uv.x * 1.15 + rowId * 1.3)));
  float ice = smoothstep(0.085, 0.05, arc);
  vec2 g = uv * 0.8; vec2 cell = floor(g), f = fract(g) - 0.5;
  float sw = step(0.62, h2(cell)) * smoothstep(0.17, 0.13, length(f - (h22(cell) - 0.5) * 0.35)) * (1.0 - ice);
  vec3 sc = h2(cell + 2.0) < 0.5 ? uC3 : vec3(0.1, 0.62, 0.3);
  col = mix(mix(col, uC2, ice), sc, sw);
  fxH = crumb * 0.09 + ice * 0.16 * sqrt(max(0.0, 1.0 - arc * 11.0)) + sw * 0.12;
  glow = uC2 * ice * (0.03 + 0.5 * band(uv.x * 0.09 - t * 0.22, 0.08)) + sc * sw * (0.22 + 0.22 * sin(t * 2.0 + h2(cell) * 6.28));
  metal = 0.0; rough = mix(0.92, 0.3, max(ice, sw));
#elif FX == 24  // frosted ice: deep blue ice with white feathers of frost growing over it, cracks and sparkles
  float q = fbm(p * 0.55 + vec3(0.0, 0.0, t * 0.03));
  float fern = smoothstep(0.05, 0.0, abs(fbm(p * 1.5 + q * 1.8) - 0.5)) + 0.6 * smoothstep(0.03, 0.0, abs(fbm(p * 3.3 + q) - 0.5));
  vec3 v = vor(uv * 0.55);
  float crack = smoothstep(0.035, 0.0, v.y);
  col = mix(uC1 * 0.6, uC1 * 1.3, q);
  col = mix(col, uC2, smoothstep(0.42, 0.8, q) * 0.7);
  col = mix(col, uC3, clamp(fern, 0.0, 1.0) * 0.85);
  col = mix(col, uC2, crack * 0.6);
  fxH = fern * 0.05 - crack * 0.05 + v.z * 0.1;
  vec2 sg = uv * 5.5;
  float spark = step(0.95, h2(floor(sg) + floor(t * 2.5))) * smoothstep(0.45, 0.0, length(fract(sg) - 0.5));
  glow = uC3 * (clamp(fern, 0.0, 1.0) * 0.26 + spark * 3.0 + crack * 0.35) + uC2 * fres * 0.55;
  metal = 0.3; rough = 0.08;
#elif FX == 25  // ornament: glass-glossy red with raised gold bands, a diamond lattice and jewels that glow
  float b = abs(fract(uv.x * 0.13) - 0.5);
  float gold = smoothstep(0.06, 0.052, b) + smoothstep(0.018, 0.012, abs(b - 0.1));
  vec2 dg = uv * 0.72; dg = vec2(dg.x + dg.y, dg.x - dg.y);
  vec2 df = abs(fract(dg) - 0.5);
  float lat = smoothstep(0.05, 0.03, min(df.x, df.y)) * smoothstep(0.34, 0.3, b) * step(0.1, b);
  float jd = length(fract(dg) - 0.5);
  float jewel = smoothstep(0.17, 0.13, length(vec2(df.x, df.y) - 0.5)) * smoothstep(0.34, 0.3, b) * step(0.1, b);
  float deco = clamp(gold + lat, 0.0, 1.0);
  col = mix(uC1, uC2, deco);
  col = mix(col, vec3(0.1, 0.75, 0.45), jewel);
  fxH = deco * 0.1 + jewel * 0.16;
  float glitter = step(0.86, h2(floor(uv * 15.0) + floor(t * 3.0)));
  glow = uC3 * deco * (0.08 + 1.0 * glitter) + uC1 * pow(fres, 2.0) * 1.1 + vec3(0.2, 1.0, 0.6) * jewel * (0.3 + 0.3 * sin(t * 2.0 + jd * 9.0)) + uC3 * band(uv.x * 0.07 - t * 0.2, 0.05) * 0.4;
  metal = mix(0.65, 1.0, deco); rough = mix(0.06, 0.26, deco);
#elif FX == 26  // snowy pine: tiers of needles, deep snow on everything facing up, tiny warm lights among the branches
  vec2 ng = uv * vec2(1.0, 2.4);
  float tier = floor(ng.y), slant = abs(fract(ng.x * 3.0 + tier * 0.5) - 0.5);
  float needle = smoothstep(0.5, 0.05, slant) * (1.0 - fract(ng.y));
  float n = n3(vec3(uv * 1.3, 2.0));
  col = mix(uC1 * 0.65, uC2, needle * (0.45 + n));
  float cover = vObjN.y * 0.75 + (fbm(p * 0.95) - 0.5) * 1.5 + 0.16 - needle * 0.08;
  float snow = smoothstep(0.1, 0.24, cover);
  col = mix(col, uC3 * (0.9 + 0.1 * n), snow);
  fxH = needle * 0.08 * (1.0 - snow) + snow * (0.14 + 0.1 * fbm(p * 1.6));
  vec2 lg = uv * 0.8; vec2 lc = floor(lg);
  float lamp = step(0.72, h2(lc)) * smoothstep(0.12, 0.03, length(fract(lg) - 0.5)) * (1.0 - snow);
  glow = uC3 * snow * step(0.965, h2(floor(uv * 9.0) + floor(t * 2.0))) * 1.6 + vec3(1.0, 0.68, 0.28) * lamp * (0.7 + 0.6 * sin(t * 2.0 + h2(lc) * 20.0)) + uC2 * (1.0 - snow) * 0.03;
  metal = 0.0; rough = mix(0.82, 0.48, snow);
#elif FX == 27  // festive lights: strings of glass bulbs on green wire, chasing and twinkling, with soft halos
  float row = uv.y * 0.46 + 0.1 * sin(uv.x * 0.9);
  float y = fract(row), rowId = floor(row);
  float wire = smoothstep(0.032, 0.012, abs(y - 0.3 - 0.07 * sin(uv.x * 2.4 + rowId)));
  float bx = uv.x * 0.7 + rowId * 0.5, id = floor(bx);
  vec2 d = vec2((fract(bx) - 0.5) / 0.7, (y - 0.44) / 0.46);
  float bulb = smoothstep(0.26, 0.2, length(d * vec2(1.25, 0.82)));
  float socket = smoothstep(0.07, 0.05, abs(d.x)) * smoothstep(0.04, 0.0, abs(d.y + 0.27));
  float which = mod(id + rowId * 3.0, 4.0);
  vec3 c = which < 1.0 ? vec3(1.0, 0.1, 0.08) : which < 2.0 ? vec3(0.1, 1.0, 0.28) : which < 3.0 ? vec3(1.0, 0.68, 0.12) : vec3(0.12, 0.42, 1.0);
  float chase = 0.5 + 0.5 * sin(t * 2.4 - id * 1.6 + rowId);
  float tw = 0.22 + 0.78 * chase * chase * (0.72 + 0.28 * sin(t * 13.0 + h2(vec2(id, rowId)) * 40.0));
  col = mix(uC1 + uC2 * n3(p * 1.5) * 0.8, c * 0.55, bulb);
  col = mix(col, vec3(0.03), max(socket, wire * (1.0 - bulb)));
  fxH = bulb * 0.34 * sqrt(max(0.0, 1.0 - dot(d * vec2(1.25, 0.82), d * vec2(1.25, 0.82)) * 16.0)) + wire * 0.04;
  glow = c * bulb * tw * 2.4 + c * smoothstep(0.75, 0.0, length(d)) * tw * 0.42;
  metal = 0.2; rough = mix(0.6, 0.08, bulb);
#elif FX == 28  // winter wool: a chunky knitted jumper, with zigzags and rows of snowflakes knitted in
  vec2 st = uv;
  vec2 sf = fract(st);
  float vee = abs(sf.x - 0.5) * 2.0 - sf.y;
  float stitch = smoothstep(0.0, 0.32, 1.0 - abs(vee));
  vec2 m = floor(st);
  float bandRow = mod(m.y, 13.0);
  float zig = step(abs(mod(m.x, 6.0) - 3.0), bandRow) * step(bandRow, 2.5);
  float cx = abs(mod(m.x, 9.0) - 4.0), cy = abs(bandRow - 7.0);
  float flake = step(cy, 3.0) * step(cx, 3.0) * clamp(step(cx, 0.5) + step(cy, 0.5) + step(abs(cx - cy), 0.5), 0.0, 1.0);
  float line = step(abs(bandRow - 3.5), 0.5) + step(abs(bandRow - 11.5), 0.5);
  col = mix(uC1, uC2, clamp(flake + line, 0.0, 1.0));
  col = mix(col, uC3, zig);
  col *= 0.62 + 0.5 * stitch;
  fxH = stitch * 0.2;
  metal = 0.0; rough = 1.0;
#elif FX == 29  // holly: glossy spiky leaves overlapping on deep green, with clusters of red berries
  vec2 g = uv * 0.62; g.x += 0.5 * mod(floor(g.y), 2.0);
  vec2 cell = floor(g), f = fract(g) - 0.5;
  float ang = (h2(cell) - 0.5) * 2.4 + 0.5;
  vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * f;
  float w = 0.2 * sqrt(max(0.0, 1.0 - q.x * q.x / 0.2)) * (0.72 + 0.28 * abs(sin(q.x * 22.0)));
  float leaf = smoothstep(0.012, 0.0, abs(q.y) - w);
  float vein = smoothstep(0.012, 0.0, abs(q.y)) * leaf;
  float side = sin(q.x * 40.0) * 0.5 + 0.5;
  col = mix(uC1 * 0.55, mix(uC2, uC2 * 0.62, step(0.0, q.y)), leaf);
  col = mix(col, uC2 * 1.5, vein);
  vec2 bc = f - vec2(0.3, -0.3) * sign(h2(cell + 4.0) - 0.5);
  float berry = 0.0;
  for (int i = 0; i < 3; i++) berry = max(berry, smoothstep(0.075, 0.055, length(bc - vec2(cos(float(i) * 2.1), sin(float(i) * 2.1)) * 0.06)));
  col = mix(col, uC3, berry);
  fxH = leaf * (0.1 + (abs(q.y) / max(w, 0.01)) * 0.08 + side * 0.012) + berry * 0.16;
  glow = uC3 * berry * 0.1;
  metal = 0.05; rough = mix(0.8, 0.28, max(leaf, berry));
#elif FX == 30  // candle wax: smooth cream wax with fat drips running down it, lit softly from inside
  float xw = uv.x * 0.9 + fbm(vec3(uv * 0.4, 3.0)) * 1.2;
  float lengthOf = 0.5 + 0.5 * sin(floor(xw) * 12.9898);
  float inDrip = smoothstep(0.42, 0.3, abs(fract(xw) - 0.5));
  float tipY = 1.2 - lengthOf * 2.4;
  float drip = inDrip * smoothstep(tipY - 0.25, tipY + 0.1, uv.y) ;
  col = mix(uC1, uC2, 0.2 + fbm(p * 0.7) * 0.4);
  col = mix(col, uC1 * 1.08, drip);
  fxH = drip * 0.26 + fbm(p * 1.1) * 0.05;
  float warm = 0.72 + 0.28 * sin(t * 1.4 + uv.x * 0.2);
  glow = uC3 * (0.08 + 0.2 * drip) * warm + uC3 * fres * 0.2;
  metal = 0.0; rough = 0.3;
#elif FX == 31  // sleigh bells: red harness leather, stitched, with rows of polished gold bells
  float grain = fbm(p * 5.0);
  col = uC1 * (0.72 + 0.55 * grain);
  float rowY = uv.y * 0.55, strap = abs(fract(rowY) - 0.5);
  float belt = smoothstep(0.33, 0.31, strap);
  col = mix(col, uC2 * (0.8 + 0.5 * grain), belt);
  float stitch = smoothstep(0.022, 0.01, abs(strap - 0.37)) * step(0.45, fract(uv.x * 3.2));
  col = mix(col, vec3(0.92, 0.82, 0.58), stitch);
  vec2 g = vec2(uv.x * 0.55, rowY); vec2 cell = floor(g), f = fract(g) - 0.5;
  float dist = length(f);
  float bell = smoothstep(0.29, 0.265, dist);
  float slot = smoothstep(0.03, 0.012, abs(f.y + 0.09)) * smoothstep(0.2, 0.16, abs(f.x)) * bell;
  float dot1 = smoothstep(0.05, 0.03, length(f + vec2(0.0, 0.09 + 0.06)));
  col = mix(col, uC3 * (0.72 + 1.0 * (f.y + 0.25)), bell);
  col = mix(col, vec3(0.05, 0.03, 0.01), max(slot, dot1 * bell));
  fxH = grain * 0.03 + belt * 0.1 + bell * sqrt(max(0.0, 1.0 - dist * dist * 12.5)) * 0.42 - slot * 0.1;
  float gleam = pow(0.5 + 0.5 * sin(t * 2.2 + cell.x * 1.4 + cell.y), 7.0);
  glow = uC3 * bell * (0.05 + gleam * 0.8);
  metal = mix(0.08, 1.0, bell); rough = mix(0.58, 0.17, bell);
#elif FX == 32  // mulled wine: deep red liquid slowly swirling, with orange slices and star anise floating in it
  vec2 sw = uv * 0.28 + vec2(fbm(vec3(uv * 0.32, t * 0.1)), fbm(vec3(uv * 0.32 + 7.0, t * 0.08))) * 1.6;
  float liq = 0.5 + 0.5 * sin((sw.x + sw.y) * 7.0);
  col = mix(uC1, uC2, liq * liq);
  vec2 g = uv * 0.42 + vec2(t * 0.05, 0.0); vec2 cell = floor(g), f = fract(g) - 0.5;
  f -= (h22(cell) - 0.5) * 0.45;
  float r = length(f), a = atan(f.y, f.x) + t * 0.12 + h2(cell) * 6.28, kind = h2(cell + 3.0);
  float rind = step(0.55, kind) * smoothstep(0.2, 0.185, r);
  float pith = step(0.55, kind) * smoothstep(0.172, 0.16, r);
  float seg = step(0.55, kind) * smoothstep(0.15, 0.14, r) * smoothstep(0.04, 0.1, abs(sin(a * 4.0)) * r * 3.0);
  float anise = step(kind, 0.3) * smoothstep(0.01, 0.0, r - 0.17 * (0.5 + 0.5 * abs(cos(a * 4.0))));
  col = mix(col, uC3 * 0.85, rind);
  col = mix(col, vec3(0.98, 0.86, 0.62), pith);
  col = mix(col, uC3, seg);
  col = mix(col, vec3(0.2, 0.09, 0.04), anise);
  fxH = rind * 0.08 + anise * 0.1 + liq * 0.012;
  glow = uC3 * seg * 0.38 + uC2 * liq * liq * 0.22 + uC3 * pow(fres, 3.0) * 0.45;
  metal = mix(0.5, 0.05, max(rind, anise)); rough = mix(0.1, 0.6, max(rind, anise));
#elif FX == 33  // fresh snowfall: soft white drifts with blue shadows, and big six-pointed flakes drifting past
  float drift = fbm(p * 0.5 + vec3(0.0, 0.0, 2.0));
  float d2 = fbm(p * 1.8);
  col = mix(uC2, uC1, smoothstep(0.28, 0.6, drift + vObjN.y * 0.3));
  fxH = drift * 0.32 + d2 * 0.05;
  float layers = 0.0;
  for (int i = 0; i < 2; i++) {
    float sc = i == 0 ? 0.46 : 0.82;
    vec2 g = uv * sc + vec2(sin(t * 0.3 + float(i)) * 0.3, t * (0.2 + float(i) * 0.08)); vec2 cell = floor(g), f = fract(g) - 0.5;
    f -= (h22(cell + float(i)) - 0.5) * 0.5;
    float r = length(f), a = atan(f.y, f.x) + t * 0.2 + h2(cell) * 6.28;
    float spoke = smoothstep(0.022, 0.006, abs(sin(a * 3.0)) * r) * smoothstep(0.17, 0.13, r);
    float tip = smoothstep(0.02, 0.006, abs(sin((a + 0.52) * 3.0)) * r) * smoothstep(0.1, 0.13, r) * smoothstep(0.17, 0.14, r);
    layers = max(layers, max(spoke, tip) * step(0.38, h2(cell + 9.0)));
  }
  col = mix(col, vec3(0.5, 0.72, 0.95), layers * 0.8);
  glow = uC3 * step(0.975, h2(floor(uv * 12.0) + floor(t * 1.5))) * 1.2 + vec3(0.65, 0.85, 1.0) * layers * 0.4;
  metal = 0.0; rough = 0.72;
#elif FX == 34  // silver tinsel: thousands of metal strands, each catching the light as you turn the gun
  vec2 g = uv * vec2(2.4, 0.42);
  g.y += 0.5 * mod(floor(g.x), 2.0);
  vec2 cell = floor(g), f = fract(g);
  float rnd = h2(cell);
  float strand = smoothstep(0.5, 0.25, abs(f.x - 0.5));
  float wave = sin(rnd * 40.0 + fres * 16.0 + t * 1.4 + f.y * 6.0);
  float shine = pow(0.5 + 0.5 * wave, 4.0);
  vec3 tint = rnd < 0.68 ? uC2 : rnd < 0.84 ? uC3 : vec3(0.65, 0.82, 1.0);
  col = mix(uC1 * 0.62, tint * (0.5 + 0.7 * shine), strand);
  fxH = strand * 0.09 * (0.6 + 0.4 * sin(f.y * 6.28 + rnd * 30.0));
  float sweep = band(uv.x * 0.06 + uv.y * 0.03 - t * 0.28, 0.07);
  glow = tint * strand * shine * (0.3 + 0.9 * sweep);
  metal = 1.0; rough = 0.2;
#elif FX == 35  // northern star: a deep night sky, a curtain of aurora, and big four-pointed stars that flare
  float neb = fbm(p * 0.5 + vec3(t * 0.03, 0.0, 0.0));
  float x = uv.x * 0.28 + fbm(vec3(uv * 0.18, t * 0.12)) * 2.2;
  float curtain = pow(0.5 + 0.5 * sin(x * 3.2 + t * 0.35), 3.0) * smoothstep(-5.0, 2.0, uv.y);
  col = uC1 * (0.7 + neb) + uC2 * curtain * 0.2;
  vec2 g = uv * 0.42; vec2 cell = floor(g), f = fract(g) - 0.5;
  f -= (h22(cell) - 0.5) * 0.55;
  float seed = h2(cell), flare = 0.45 + 0.55 * sin(t * 1.6 + seed * 40.0);
  float cr = smoothstep(0.22, 0.0, abs(f.x) * 10.0 + abs(f.y)) + smoothstep(0.22, 0.0, abs(f.y) * 10.0 + abs(f.x));
  float big = step(0.55, seed) * (cr + smoothstep(0.05, 0.0, length(f)) * 2.0);
  vec2 tg = uv * 2.6; float tiny = step(0.93, h2(floor(tg))) * smoothstep(0.32, 0.0, length(fract(tg) - 0.5)) * (0.4 + 0.6 * sin(t * 3.0 + h2(floor(tg) + 4.0) * 40.0));
  fxH = neb * 0.02;
  glow = uC3 * (big * flare * 1.5 + tiny * 1.3) + uC2 * curtain * 0.7;
  metal = 0.45; rough = 0.3;
#elif FX == 36  // yule fire: a charred log with deep glowing cracks, heat pulsing through it, flames licking up the lower parts
  float ring = sin((uv.y * 2.0 + fbm(p * 0.5) * 2.5) * 4.0);
  vec3 v = vor(uv * vec2(0.45, 0.95));
  float crack = 1.0 - smoothstep(0.02, 0.1, v.y);
  float heat = fbm(p * 0.9 + vec3(0.0, -t * 0.5, 0.0));
  col = uC1 * (0.75 + 0.3 * ring + 1.1 * v.z);
  float base = clamp(-vGun.y * 8.0 - 0.1, 0.0, 1.0);
  float lick = fbm(vec3(uv.x * 0.7, uv.y * 0.7 - t * 1.4, t * 0.25));
  float flames = smoothstep(0.56, 0.84, lick + base * 0.42);
  vec3 fc = mix(uC2, uC3, smoothstep(0.35, 0.95, lick + base * 0.25));
  col = mix(col, fc * 0.45, flames);
  fxH = (1.0 - crack) * 0.2 + ring * 0.03 + v.z * 0.1;
  glow = mix(uC2, uC3, heat * heat) * crack * (0.55 + 0.45 * sin(t * 2.2 + v.z * 6.28)) + fc * flames * 0.9 + uC2 * heat * 0.03;
  metal = 0.05; rough = mix(0.95, 0.5, crack);
#elif FX == 37  // silent night: a sleeping snowy village along the gun, under a big moon and stars, while snow falls past
  vec2 sky = vGun.zy * 14.0;
  float ridgeOf = -0.3 + 0.16 * sin(sky.x * 0.9) + 0.09 * sin(sky.x * 2.3 + 1.0);
  col = mix(uC1 * 1.0, vec3(0.1, 0.17, 0.38), smoothstep(1.2, -0.3, sky.y));
  float hill = smoothstep(0.02, -0.02, sky.y - ridgeOf);
  vec2 hc = vec2(floor(sky.x * 0.9), 0.0);
  float hx = fract(sky.x * 0.9) - 0.5, hrand = h2(hc), hbase = -0.3 + 0.16 * sin((hc.x + 0.5) / 0.9 * 0.9) + 0.09 * sin((hc.x + 0.5) / 0.9 * 2.3 + 1.0);
  float wall = hbase + 0.2;
  float house = step(0.35, hrand) * step(abs(hx), 0.25) * step(sky.y, wall + (0.25 - abs(hx)) * 0.62) * step(hbase - 0.15, sky.y);
  float roof = house * step(wall, sky.y);
  float win = house * step(abs(abs(hx) - 0.1), 0.045) * step(abs(sky.y - wall + 0.09), 0.05);
  col = mix(col, uC2 * 0.92, hill);
  col = mix(col, vec3(0.16, 0.1, 0.1), house);
  col = mix(col, uC2, roof);
  vec2 g = sky * 1.8; vec2 cell = floor(g), f = fract(g) - 0.5; f -= (h22(cell) - 0.5) * 0.6;
  float clear = (1.0 - hill) * (1.0 - house);
  float star = step(0.55, h2(cell)) * smoothstep(0.12, 0.0, length(f)) * (0.4 + 0.6 * sin(t * 2.0 + h2(cell + 2.0) * 40.0)) * clear;
  vec2 mp = sky - vec2(floor(sky.x * 0.13 + 0.5) / 0.13, 0.62);
  float moon = smoothstep(0.42, 0.39, length(mp)) * clear;
  col = mix(col, vec3(0.96, 0.95, 0.82), moon);
  vec2 fg = uv * 0.9 + vec2(sin(t * 0.3) * 0.2, t * 0.32); vec2 fc = floor(fg);
  float flake = step(0.55, h2(fc)) * smoothstep(0.13, 0.03, length(fract(fg) - 0.5));
  fxH = hill * 0.08 + house * 0.1 + moon * 0.04;
  glow = uC3 * (win * 2.2 + star * 1.8) + vec3(0.96, 0.95, 0.82) * moon * 0.5 + vec3(0.6, 0.72, 1.0) * smoothstep(1.3, 0.42, length(mp)) * 0.3 * clear + vec3(1.0) * flake * 0.55;
  metal = 0.2; rough = 0.45;
#else           // pixels: blocky camo whose colours slowly shift
  vec2 g = floor(uv * 1.5);
  float n = n3(vec3(g * 0.35, t * 0.15));
  vec3 c = n < 0.38 ? uC1 : n < 0.62 ? uC2 : uC3;
  col = c * 0.6;
  glow = c * 0.35 * step(0.62, n) * (0.6 + 0.4 * sin(t * 2.0 + g.x));
  metal = 0.4; rough = 0.45;
#endif
}
`;

const FRAGMENT = /* glsl */ `
#include <emissivemap_fragment>
{
  // Flat coordinates on whichever face this is (the side, top or end of the part)
  vec3 an = abs(vObjN);
  vec2 uv = (an.x > an.y && an.x > an.z ? vGun.zy : an.y > an.z ? vGun.zx : vGun.xy) * uScale;
  vec3 pp = vGun * uScale;
  float t = uTime * uSpeed;
  float fres = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
  vec3 fxCol, fxGlow; float fxMetal = metalnessFactor, fxRough = roughnessFactor;
  if (uRole < 1.5) {
    skinFx(uv, pp, t, fres, fxCol, fxGlow, fxMetal, fxRough);
#if FX >= 21
    if (uRole > 0.5) { fxCol *= 0.82; fxGlow *= 0.8; }             // the furniture: only a little darker, so the pattern carries across
    {
      // Bend the surface by the effect's height, so raised parts catch the light
      vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
      vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
      float det = dot(sx, r1), hgt = fxH / uScale;
      vec3 grad = sign(det) * (dFdx(hgt) * r1 + dFdy(hgt) * r2);
      normal = normalize(abs(det) * normal - grad);
    }
#else
    if (uRole > 0.5) { fxCol *= 0.55; fxGlow *= 0.45; }            // the furniture: a darker take on the same effect
#endif
#if FX >= 21
  } else if (uRole < 2.5) {
    // metal: polished in the skin's own metal colour, with a sheen of light sliding along the gun
    float sheen = band(vGun.z * 2.2 + vGun.y * 3.0 - t * 0.35, 0.08);
    fxCol = uSteel; fxGlow = uSteel * sheen * 0.45 + uC3 * fres * 0.1;
    fxMetal = 0.95; fxRough = 0.26;
  } else {
    // sights, vents and the optic housing, in the skin's accent colour, softly pulsing
    float pulse = 0.65 + 0.35 * sin(t * 2.4 + vGun.z * 8.0);
    fxCol = uTrim; fxGlow = uTrim * pulse * 0.35; fxMetal = 0.4; fxRough = 0.35;
  }
#else
  } else if (uRole < 2.5) {
    // metal: dark polish tinted by the skin, and a sheen of light sliding along the gun
    float sheen = band(vGun.z * 2.2 + vGun.y * 3.0 - t * 0.35, 0.08);
    fxCol = uC1 * 0.3 + 0.06; fxGlow = uC2 * sheen * 0.5 + uC3 * fres * 0.12;
    fxMetal = 1.0; fxRough = 0.22;
  } else {
    // sights, vents and the optic housing: a glow that pulses along the gun
    float pulse = 0.55 + 0.45 * sin(t * 3.0 + vGun.z * 8.0);
    fxCol = uC3 * 0.5; fxGlow = uC3 * pulse; fxMetal = 0.5; fxRough = 0.3;
  }
#endif
  diffuseColor.rgb = fxCol;
  totalEmissiveRadiance = fxGlow * uGlow;
  metalnessFactor = fxMetal;
  roughnessFactor = fxRough;
}
`;

/** Turn a gun material into an Exclusive skin material for one role. */
function exclusiveMaterial(skin, role) {
  const m = new THREE.MeshStandardMaterial({ color: skin.c1, metalness: skin.metal, roughness: 0.35 });
  const uniforms = {
    uTime: clock, uScale: { value: skin.scale }, uSpeed: { value: skin.speed }, uGlow: { value: skin.glow },
    uVar: { value: skin.variant || 0 }, uRole: { value: ROLE[role] },
    uC1: { value: new THREE.Color(skin.c1) }, uC2: { value: new THREE.Color(skin.c2) }, uC3: { value: new THREE.Color(skin.c3) },
    uSteel: { value: new THREE.Color(skin.sc ?? skin.c1) }, uTrim: { value: new THREE.Color(skin.tc ?? skin.c3) },
  };
  const fx = FX[skin.fx] ?? 0;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aGun;\nvarying vec3 vGun;\nvarying vec3 vObjN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGun = aGun;\nvObjN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n#define FX ${fx}\n${COMMON}`)
      .replace('#include <emissivemap_fragment>', FRAGMENT);
  };
  m.customProgramCacheKey = () => `exclusive-${fx}`;
  return m;
}

/**
 * Apply an Exclusive skin to a gun being built. `b` is the gun builder (its group `g`, its
 * role materials `mats`). Each part gets its position on the gun as an attribute, so the
 * effect lines up across parts.
 */
export function applyExclusiveSkin(b, skin) {
  startClock();
  b.g.updateMatrixWorld(true);
  const toGun = new THREE.Matrix4().copy(b.g.matrixWorld).invert();
  const mats = {};
  for (const role of Object.keys(ROLE)) if (b.mats[role]) mats[role] = exclusiveMaterial(skin, role);
  const m = new THREE.Matrix4(), v = new THREE.Vector3();
  b.g.traverse((o) => {
    if (!o.isMesh || !mats[o.userData.role]) return;
    m.multiplyMatrices(toGun, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    const arr = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
    }
    o.geometry.setAttribute('aGun', new THREE.BufferAttribute(arr, 3));
    o.material = mats[o.userData.role];
  });
  for (const role of Object.keys(mats)) b.mats[role] = mats[role];
  if (skin.particles) b.g.add(makeParticles(b.g, skin.particles));
}

// ---------------------------------------------------------------- particles

const PARTICLE_VERT = /* glsl */ `
uniform float uTime, uSize;
uniform vec3 uMin, uMax;
uniform float uKind;
attribute vec4 aRnd;
varying float vFade;
void main() {
  vec3 size = uMax - uMin;
  float t = uTime * (0.15 + aRnd.w * 0.2);
  vec3 p = uMin + aRnd.xyz * size;
  float life;
  if (uKind < 0.5) {            // rise: from below the gun to above it, wobbling
    life = fract(aRnd.y + t);
    p.y = uMin.y + life * size.y;
    p.x += sin(t * 6.0 + aRnd.z * 20.0) * 0.02;
  } else if (uKind < 1.5) {     // fall: drifting down
    life = fract(aRnd.y + t);
    p.y = uMax.y - life * size.y;
    p.x += sin(t * 4.0 + aRnd.x * 20.0) * 0.03; p.z += cos(t * 3.0 + aRnd.y * 20.0) * 0.02;
  } else if (uKind < 2.5) {     // drift: along the gun, slowly
    life = fract(aRnd.z + t * 0.6);
    p.z = uMin.z + life * size.z;
    p.y += sin(t * 3.0 + aRnd.x * 30.0) * 0.015;
  } else {                      // orbit: circling the barrel
    life = fract(aRnd.x + t * 0.3);
    float a = aRnd.y * 6.28 + uTime * (1.5 + aRnd.w * 2.0);
    vec3 c = (uMin + uMax) * 0.5;
    float r = max(size.x, size.y) * (0.45 + aRnd.w * 0.3);
    p = vec3(c.x + cos(a) * r, c.y + sin(a) * r, uMin.z + aRnd.z * size.z);
  }
  vFade = sin(life * 3.14159);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * length(modelMatrix[0].xyz) * (0.6 + aRnd.w * 0.8) * projectionMatrix[1][1] * 300.0 / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vFade;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(uColor, smoothstep(0.5, 0.0, d) * vFade);
}`;

const KIND = { rise: 0, fall: 1, drift: 2, orbit: 3 };

function makeParticles(gun, spec) {
  const box = new THREE.Box3().setFromObject(gun);
  box.expandByVector(new THREE.Vector3(0.03, 0.06, 0.02));
  const n = spec.count || 20;
  const rnd = new Float32Array(n * 4);
  for (let i = 0; i < rnd.length; i++) rnd[i] = Math.random();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4));
  geo.boundingSphere = new THREE.Sphere(box.getCenter(new THREE.Vector3()), box.getSize(new THREE.Vector3()).length());
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: clock, uSize: { value: spec.size || 0.015 }, uKind: { value: KIND[spec.kind] ?? 0 },
      uMin: { value: box.min.clone() }, uMax: { value: box.max.clone() }, uColor: { value: new THREE.Color(spec.color) },
    },
    vertexShader: PARTICLE_VERT, fragmentShader: PARTICLE_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.name = 'skin.particles';
  pts.frustumCulled = false;
  return pts;
}
