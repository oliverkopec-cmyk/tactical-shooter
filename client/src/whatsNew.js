// "What's new" (Stage 2J): CHANGELOG.md in the repo is bundled into the game when it is built. The newest entries
// the account hasn't seen are shown in a pop-up after login; the whole list opens from the menu.
// The account remembers the newest entry it has seen (the `lastSeenUpdate` setting, saved with the other settings).

import changelog from '../../CHANGELOG.md?raw';
import { settings, setSetting } from './settings.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Entries, newest first: { id, date, title, items }. Lines other than "## id · date · title" and "- item" are ignored. */
export function parseChangelog(text) {
  const entries = [];
  for (const line of String(text).split('\n')) {
    const head = line.match(/^##\s+(\S+)\s+·\s+(\S+)\s+·\s+(.+?)\s*$/);
    if (head) { entries.push({ id: head[1], date: head[2], title: head[3], items: [] }); continue; }
    const item = line.match(/^\s*-\s+(.+?)\s*$/);
    if (item && entries.length) entries.at(-1).items.push(item[1]);
  }
  return entries;
}

export const ENTRIES = parseChangelog(changelog);
const MAX_UNSEEN = 5;

/** The entries an account hasn't seen: everything newer than the one it last saw (just the newest if it has never seen any). */
export function unseenEntries(entries, lastSeen) {
  if (!entries.length) return [];
  const at = entries.findIndex((e) => e.id === lastSeen);
  if (at === 0) return [];
  if (at < 0) return entries.slice(0, 1);
  return entries.slice(0, Math.min(at, MAX_UNSEEN));
}

export class WhatsNew {
  constructor() {
    this.box = $('whatsnew');
    $('whatsnew-ok').addEventListener('click', () => this.close());
    $('whatsnew-btn').addEventListener('click', () => this.open(ENTRIES.slice(0, 8), 'What\'s new'));
    this.box.addEventListener('click', (e) => { if (e.target === this.box) this.close(); });
  }

  render(list) {
    $('whatsnew-body').innerHTML = list.map((e) => `
      <div class="wn-entry"><div class="wn-head"><b>${esc(e.title)}</b><span class="muted">${esc(e.date)}</span></div>
      <ul>${e.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('') || '<p class="muted">Nothing to show yet.</p>';
  }

  open(list, title) {
    $('whatsnew-title').textContent = title;
    this.render(list);
    this.box.classList.remove('hidden');
  }

  close() {
    this.box.classList.add('hidden');
    if (ENTRIES[0] && settings.lastSeenUpdate !== ENTRIES[0].id) setSetting('lastSeenUpdate', ENTRIES[0].id);   // saved to the account with the other settings
  }

  /** After login: show what's new since this account last looked. */
  showIfNew() {
    const fresh = unseenEntries(ENTRIES, settings.lastSeenUpdate);
    if (fresh.length) this.open(fresh, 'What\'s new');
  }
}
