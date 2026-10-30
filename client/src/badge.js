// The gold OWNER tag. The server says who the owner is (the `owner` flag on names it sends);
// the client only draws it.

export const ownerTag = '<span class="owner-tag" title="Owner">OWNER</span>';

/** An element for the tag, for code that builds the DOM instead of HTML strings. */
export function ownerTagEl() {
  const el = document.createElement('span');
  el.className = 'owner-tag';
  el.title = 'Owner';
  el.textContent = 'OWNER';
  return el;
}
