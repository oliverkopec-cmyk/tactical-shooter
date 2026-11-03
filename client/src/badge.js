// The name badges: the gold OWNER tag and the black-and-white TESTER tag. The server says who has which (the
// `owner` and `tester` flags on names it sends); the client only draws them.

export const ownerTag = '<span class="owner-tag" title="Owner">OWNER</span>';
export const testerTag = '<span class="tester-tag" title="Tester">TESTER</span>';

/** The badge HTML for anything with owner / tester flags (a player, a roster row, a friend...). */
export function badge(p) {
  return p?.owner ? ownerTag : p?.tester ? testerTag : '';
}

function tagEl(cls, title, text) {
  const el = document.createElement('span');
  el.className = cls;
  el.title = title;
  el.textContent = text;
  return el;
}

/** An element for the OWNER tag, for code that builds the DOM instead of HTML strings. */
export function ownerTagEl() { return tagEl('owner-tag', 'Owner', 'OWNER'); }
export function testerTagEl() { return tagEl('tester-tag', 'Tester', 'TESTER'); }

/** The badge elements for a player ([] if none). */
export function badgeEls(p) {
  return p?.owner ? [ownerTagEl()] : p?.tester ? [testerTagEl()] : [];
}
