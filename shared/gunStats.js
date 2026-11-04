// The gun workshop's stat bars (Stage P): every number an attachment can change. A fuller bar is always better, so a
// row can be compared before and after an attachment.

import { WEAPONS, gunFor } from './weapons.js';
import { gunTuning } from './gunConfig.js';
import { ADS } from './constants.js';
import { loudnessOf } from './attachments.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// The scale of the recoil bars comes from the guns themselves: the kickiest gun is an empty bar
let worst = null;
function worstRecoil() {
  if (worst) return worst;
  worst = { up: 0.5, side: 0.5, flash: 1 };
  for (const id of Object.keys(WEAPONS)) {
    if (WEAPONS[id].shield) continue;
    const rc = gunTuning(id).recoil;
    worst.up = Math.max(worst.up, rc.up);
    worst.side = Math.max(worst.side, rc.side);
    worst.flash = Math.max(worst.flash, rc.flash * 1.3);
  }
  return worst;
}

/**
 * Rows for a gun with these attachments: [{ key, label, text, frac }]. sight: the sight in use ({ zoom }, from
 * sightOf in client/src/gunModels.js, which knows what the gun comes with).
 */
export function gunStatRows(id, att, sight) {
  const w = gunFor(id, att ? { [id]: att } : null), rc = gunTuning(id, att).recoil, top = worstRecoil();
  const dmgFar = w.damage * w.falloffMin;
  const aim = ADS.time * (w.aimTime ?? 1);
  const pct = (n) => `${Math.round(n * 100)}%`;
  return [
    { key: 'zoom', label: 'Zoom', text: `${(sight?.zoom ?? 1).toFixed(sight?.zoom % 0.5 ? 2 : 1)}x`, frac: clamp01(((sight?.zoom ?? 1) - 1) / 2.4) },
    { key: 'aim', label: 'Aim speed', text: `${aim.toFixed(2)} s`, frac: clamp01(1 - aim / 0.6) },
    { key: 'far', label: 'Damage at range', text: `${Math.round(dmgFar)}`, frac: clamp01(dmgFar / 90) },
    { key: 'range', label: 'Range', text: `${Math.round(w.falloffStart)}-${Math.round(w.falloffEnd)} m`, frac: clamp01(w.falloffEnd / 90) },
    { key: 'up', label: 'Vertical recoil', text: rc.up.toFixed(2), frac: clamp01(1 - rc.up / top.up) },
    { key: 'side', label: 'Side recoil', text: rc.side.toFixed(2), frac: clamp01(1 - rc.side / top.side) },
    { key: 'first', label: 'First-shot kick', text: (rc.up * rc.firstMul).toFixed(2), frac: clamp01(1 - (rc.up * rc.firstMul) / top.up) },
    { key: 'mag', label: 'Magazine', text: `${w.magSize}`, frac: clamp01(w.magSize / 80) },
    { key: 'reload', label: 'Reload', text: `${w.reloadTime.toFixed(1)} s`, frac: clamp01(1 - (w.reloadTime - 1) / 4.5) },
    { key: 'quiet', label: 'Quietness', text: pct(1 - loudnessOf(att)), frac: clamp01(1 - loudnessOf(att)) },
    { key: 'flash', label: 'Muzzle flash', text: rc.flash < 0.15 ? 'Almost none' : rc.flash.toFixed(1), frac: clamp01(1 - rc.flash / top.flash) },
  ];
}

