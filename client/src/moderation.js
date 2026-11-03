// The player's side of moderation (Stage 2I): reporting someone, and being told about a warning or a suspension.
// The owner's tools are in modAdmin.js. The server checks everything again; this is only the forms.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const REASONS = { cheating: 'Cheating', chat: 'Abusive chat', name: 'Offensive name', griefing: 'Griefing', other: 'Other' };

/** Report dialog. Any element with data-report="<their id>" data-name="<their name>" opens it. */
export class ReportDialog {
  constructor({ network }) {
    this.network = network;
    this.target = null;
    this.box = $('report-dialog');
    $('report-reasons').innerHTML = Object.entries(REASONS).map(([k, v], i) => `<label class="adm-radio"><input type="radio" name="report-reason" value="${k}"${i === 0 ? ' checked' : ''}> ${v}</label>`).join('');
    $('report-send').addEventListener('click', () => this.send());
    $('report-cancel').addEventListener('click', () => this.close());
    this.box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') this.close(); });
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-report]');
      if (b) this.open({ id: b.dataset.report, name: b.dataset.name });
    });
  }

  open({ id, name }) {
    this.target = id;
    if (document.pointerLockElement) document.exitPointerLock();
    $('report-who').textContent = name;
    $('report-comment').value = '';
    $('report-status').textContent = '';
    $('report-send').disabled = false;
    this.box.classList.remove('hidden');
  }

  close() { this.box.classList.add('hidden'); this.target = null; }

  async send() {
    const reason = document.querySelector('input[name="report-reason"]:checked')?.value;
    $('report-send').disabled = true;
    const res = await this.network.request('report', { target: this.target, reason, comment: $('report-comment').value });
    if (res.error) { $('report-status').className = 'adm-status error'; $('report-status').textContent = res.error; $('report-send').disabled = false; return; }
    $('report-status').className = 'adm-status ok';
    $('report-status').textContent = 'Report sent. Thank you.';
    setTimeout(() => this.close(), 1100);
  }
}

/** A warning from the owner, shown in the menu until the player dismisses it. */
export class WarningPopup {
  constructor({ network }) {
    this.network = network;
    this.shown = new Set();
    this.box = $('warn-dialog');
    $('warn-ok').addEventListener('click', () => this.dismiss());
  }

  show(list) {
    const fresh = (list || []).filter((w) => !this.shown.has(w.id));
    if (!fresh.length) return;
    this.current = fresh;
    for (const w of fresh) this.shown.add(w.id);
    $('warn-body').innerHTML = fresh.map((w) => `<p>${w.reason ? esc(w.reason) : 'Please follow the rules.'}</p>`).join('');
    this.box.classList.remove('hidden');
  }

  dismiss() {
    this.box.classList.add('hidden');
    if (this.current?.length) this.network.request('warningsSeen', this.current.map((w) => w.id));
    this.current = null;
  }

  /** Ask the server for unread warnings (in the menu only: it sends none while you are in a match). */
  async check() {
    const res = await this.network.request('warnings');
    this.show(res.warnings);
  }
}
