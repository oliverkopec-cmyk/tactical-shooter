// Simple side-view gun silhouettes (SVG, drawn in code) for the crate shop.

const SHAPES = {
  rifle: '<rect x="14" y="19" width="62" height="7" rx="2"/><rect x="2" y="17" width="16" height="10" rx="2"/><rect x="40" y="26" width="6" height="11" rx="1"/><rect x="74" y="20" width="22" height="3" rx="1"/><rect x="30" y="15" width="16" height="4" rx="1"/>',
  smg: '<rect x="18" y="19" width="48" height="8" rx="2"/><rect x="8" y="20" width="12" height="6" rx="2"/><rect x="38" y="27" width="6" height="14" rx="1"/><rect x="64" y="21" width="22" height="3" rx="1"/><rect x="24" y="27" width="6" height="8" rx="1"/>',
  shotgun: '<rect x="12" y="20" width="76" height="6" rx="2"/><rect x="2" y="17" width="16" height="12" rx="2"/><rect x="40" y="26" width="22" height="5" rx="1"/><rect x="86" y="21" width="10" height="3" rx="1"/>',
  lmg: '<rect x="14" y="18" width="66" height="9" rx="2"/><rect x="2" y="17" width="16" height="11" rx="2"/><rect x="38" y="27" width="16" height="12" rx="2"/><rect x="78" y="20" width="18" height="3" rx="1"/><rect x="26" y="13" width="18" height="5" rx="1"/>',
  dmr: '<rect x="14" y="20" width="70" height="6" rx="2"/><rect x="2" y="18" width="16" height="10" rx="2"/><rect x="40" y="26" width="6" height="10" rx="1"/><rect x="82" y="21" width="14" height="3" rx="1"/><rect x="32" y="12" width="22" height="6" rx="3"/>',
  pistol: '<rect x="30" y="15" width="40" height="9" rx="2"/><rect x="30" y="24" width="12" height="18" rx="2"/><rect x="64" y="17" width="12" height="4" rx="1"/>',
  revolver: '<rect x="34" y="15" width="22" height="11" rx="3"/><rect x="54" y="17" width="34" height="5" rx="1"/><rect x="30" y="26" width="12" height="17" rx="2" transform="rotate(8 36 34)"/>',
  machinePistol: '<rect x="26" y="15" width="40" height="9" rx="2"/><rect x="28" y="24" width="10" height="16" rx="2"/><rect x="46" y="24" width="7" height="20" rx="1"/><rect x="64" y="17" width="16" height="4" rx="1"/>',
};

/** An SVG silhouette of a gun model in the given colour (a hex string like '#8a6a3c'). */
export function gunIcon(model, color = '#c9ced6', width = 96) {
  const body = SHAPES[model] || SHAPES.rifle;
  return `<svg class="gun-icon" width="${width}" height="${Math.round(width * 0.5)}" viewBox="0 0 100 50" fill="${color}" aria-hidden="true">${body}</svg>`;
}
