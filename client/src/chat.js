// In-match chat (Stage 2I): press the all-chat key (Y) or team-chat key (U) to type, Enter to send, Esc to cancel.
// Messages show at the bottom left for a few seconds with the sender's name, badge and [ALL] or [TEAM]. The server
// limits the length and how fast you can send, and only sends a message to the people it is for.

import { badgeEls } from './badge.js';

const SHOW_MS = 9000;      // how long a message stays up
const FADE_MS = 1500;
const MAX_LINES = 7;

export class Chat {
  constructor({ network, getMe, onOpenChange }) {
    this.network = network;
    this.getMe = getMe;                      // () => my socket id
    this.onOpenChange = onOpenChange;
    this.log = document.getElementById('chat-log');
    this.input = document.getElementById('chat-input');
    this.box = document.getElementById('chat');
    this.scope = 'all';
    this.open = false;
    this.lines = [];                         // { el, born }
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.send(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    network.on('chat', (m) => this.receive(m));
    setInterval(() => this.tick(), 250);
  }

  start(scope) {
    this.scope = scope;
    this.open = true;
    this.box.classList.add('open');
    this.box.dataset.scope = scope;
    document.getElementById('chat-scope').textContent = scope === 'team' ? 'TEAM' : 'ALL';
    this.input.value = '';
    this.input.focus();
    this.onOpenChange?.(true);
    this.tick();
  }

  close() {
    this.open = false;
    this.box.classList.remove('open');
    this.input.value = '';
    this.input.blur();
    this.onOpenChange?.(false);
    this.tick();
  }

  async send() {
    const text = this.input.value.trim();
    const scope = this.scope;
    this.close();
    if (!text) return;
    const res = await this.network.request('chat', { scope, text });
    if (res?.error) this.system(res.error);
  }

  /** A line of small print, for example "Slow down." */
  system(text) { this.add({ system: true, text }); }

  receive(m) { this.add(m); }

  add(m) {
    const li = document.createElement('li');
    if (m.system) {
      li.className = 'sys';
      li.textContent = m.text;
    } else {
      const tag = document.createElement('span');
      tag.className = `chat-tag ${m.scope}`;
      tag.textContent = m.scope === 'team' ? '[TEAM]' : '[ALL]';
      const name = document.createElement('span');
      name.className = `chat-name ${m.team}`;
      name.textContent = m.name;
      const text = document.createElement('span');
      text.className = 'chat-text';
      text.textContent = m.text;                  // textContent: nothing a player types can become markup
      li.append(tag, ' ', name, ...badgeEls(m), ': ', text);
      if (m.id === this.getMe?.()) li.classList.add('mine');
    }
    this.log.appendChild(li);
    this.lines.push({ el: li, born: performance.now() });
    while (this.lines.length > 60) { this.lines.shift().el.remove(); }
    this.tick();
  }

  /** Show the newest lines; each fades out after a few seconds (all stay while you're typing). */
  tick() {
    const now = performance.now();
    const recent = this.lines.slice(-MAX_LINES);
    for (const l of this.lines) {
      const show = recent.includes(l) && (this.open || now - l.born < SHOW_MS);
      const fading = !this.open && now - l.born > SHOW_MS - FADE_MS;
      l.el.style.display = show ? '' : 'none';
      l.el.classList.toggle('fade', show && fading);
    }
  }

  /** Match over or left: clear it. */
  reset() {
    for (const l of this.lines) l.el.remove();
    this.lines = [];
    if (this.open) this.close();
  }
}
