// The owner's moderation tools in the Admin tab (Stage 2I): the reports inbox, the chat inbox and the list of
// suspended and banned players. Only the owner ever sees this; the server refuses every one of these requests
// from anyone else, so hiding it here is only tidiness.

import { REASONS } from './moderation.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (t) => new Date(t).toLocaleString();

const DURATIONS = [['1', '1 minute'], ['60', '1 hour'], ['1440', '1 day'], ['4320', '3 days'], ['10080', '7 days'], ['43200', '30 days'], ['custom', 'Custom...']];

function left(until) {
  const ms = new Date(until).getTime() - Date.now();
  if (ms <= 0) return 'ended';
  const m = Math.ceil(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h left` : h ? `${h}h ${m % 60}m left` : `${m}m left`;
}

export class ModPanel {
  constructor({ network }) {
    this.network = network;
    this.box = $('admin-mod');
    this.shown = false;
    this.reportsStatus = 'open';
    this.reports = [];
    this.open = null;              // the report being looked at: { report, chat, block }
    this.blocked = [];
    this.chat = { q: '', messages: [], more: false };
    this.timer = null;
    this.box.addEventListener('click', (e) => this.onClick(e));
    this.box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'mod-chat-q') this.searchChat(); });
  }

  /** Show for the owner only. */
  setEnabled(on) {
    this.box.classList.toggle('hidden', !on);
    this.enabled = on;
    if (!on) { clearInterval(this.timer); return; }
    if (!this.built) {
      this.built = true;
      this.box.innerHTML = '<div id="mod-reports" class="card"></div><div id="mod-blocked" class="card"></div><div id="mod-chat" class="card"></div>';
    }
  }

  setVisible(on) {
    this.shown = on;
    clearInterval(this.timer);
    if (!on || !this.enabled) return;
    this.refresh();
    this.searchChat(true);
    this.timer = setInterval(() => this.refresh(), 8000);
  }

  async refresh() {
    const [r, b] = await Promise.all([this.network.request('modReports', { status: this.reportsStatus }), this.network.request('modBlocked')]);
    if (!r.error) this.reports = r.reports;
    if (!b.error) this.blocked = b.blocked;
    this.render();
  }

  // ---------------------------------------------------------------- drawing

  render() {
    if (!this.enabled) return;
    const keep = this.open && document.activeElement && this.box.contains(document.activeElement) && ['INPUT', 'SELECT'].includes(document.activeElement.tagName);
    if (keep) return;       // don't redraw under someone who is typing
    this.renderReports();
    this.renderBlocked();
    this.renderChat();
  }

  renderReports() {
    const open = this.open;
    const list = this.reports.map((r) => `
      <div class="mod-item${open?.report.id === r.id ? ' selected' : ''}">
        <div class="mod-head"><span><b>${esc(r.target_name)}</b> reported by ${esc(r.reporter_name)}</span><span class="tag ${r.status}">${r.status === 'open' ? 'OPEN' : esc((r.action || 'resolved').toUpperCase())}</span></div>
        <div>${esc(r.reason_label)}${r.comment ? ` · “${esc(r.comment)}”` : ''}</div>
        <div class="muted">${when(r.created_at)} · match ${esc(r.match_id || '?')} · reported ${r.times_reported}× · ${r.sanctions} past action${r.sanctions === 1 ? '' : 's'}</div>
        <div class="mod-actions"><button type="button" data-open-report="${r.id}">${open?.report.id === r.id ? 'Close' : 'Open'}</button></div>
        ${open?.report.id === r.id ? this.detail(open) : ''}
      </div>`).join('');
    $('mod-reports').innerHTML = `
      <h2>Reports</h2>
      <div class="mod-tabs">${['open', 'resolved', 'all'].map((s) => `<button type="button" data-reports-status="${s}" class="${s === this.reportsStatus ? 'active' : ''}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
      <div class="mod-list">${list || '<div class="muted">No reports.</div>'}</div>
      <p class="adm-status" id="mod-status"></p>`;
  }

  /** One open report: the match's chat log and the buttons. */
  detail({ report, chat, block }) {
    const msgs = chat.length ? chat.map((m) => `<div class="mod-msg${m.username === report.target_name ? ' hit' : ''}"><span class="scope">${m.scope === 'team' ? `[TEAM ${esc(m.team)}]` : '[ALL]'}</span><b>${esc(m.username)}</b>: ${esc(m.text)}</div>`).join('') : '<span class="muted">Nobody chatted in that match.</span>';
    return `
      <div class="sum-sub">Chat in that match</div>
      <div class="mod-chat">${msgs}</div>
      ${block ? `<div class="mod-item"><span class="tag ${block.kind}">${block.kind.toUpperCase()}</span> already: ${block.until ? left(block.until) : 'permanent'}</div>` : ''}
      <div class="mod-actions">
        <input class="mod-reason" id="mod-reason" maxlength="200" placeholder="Reason (the player sees it)" />
      </div>
      <div class="mod-actions">
        <button type="button" data-act="resolve" data-rid="${report.id}">Mark resolved</button>
        <button type="button" data-act="warn" data-rid="${report.id}">Warn</button>
        <select id="mod-dur">${DURATIONS.map(([v, l]) => `<option value="${v}"${v === '1440' ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <input type="number" id="mod-custom" min="1" max="525600" placeholder="minutes" class="hidden" style="width:90px" />
        <button type="button" data-act="suspend" data-rid="${report.id}">Suspend</button>
        <button type="button" data-act="ban" data-rid="${report.id}" class="danger">Ban</button>
      </div>`;
  }

  renderBlocked() {
    $('mod-blocked').innerHTML = `
      <h2>Suspended and banned (${this.blocked.length})</h2>
      <div class="mod-list">${this.blocked.map((b) => `
        <div class="mod-item">
          <div class="mod-head"><b>${esc(b.username)}</b><span class="tag ${b.kind}">${b.kind === 'ban' ? 'BANNED' : 'SUSPENDED'}</span></div>
          <div class="muted">${b.kind === 'ban' ? 'Permanent' : left(b.until)} · by ${esc(b.created_by)} · ${when(b.created_at)}${b.reason ? ` · “${esc(b.reason)}”` : ''}</div>
          <div class="mod-actions"><button type="button" data-lift="${b.id}">${b.kind === 'ban' ? 'Lift ban' : 'End suspension'}</button></div>
        </div>`).join('') || '<div class="muted">Nobody right now.</div>'}</div>`;
  }

  renderChat() {
    const prev = $('mod-chat-q')?.value ?? this.chat.q;
    $('mod-chat').innerHTML = `
      <h2>Chat (kept 14 days)</h2>
      <div class="mod-search"><input type="text" id="mod-chat-q" maxlength="32" placeholder="Search by username" value="${esc(prev)}" /><button type="button" id="mod-chat-go">Search</button></div>
      <div class="mod-list">${this.chat.messages.map((m) => `
        <div class="mod-msg"><span class="muted">${when(m.created_at)} · ${esc(m.room_code || '')}</span> <span class="scope">${m.scope === 'team' ? `[TEAM ${esc(m.team || '')}]` : '[ALL]'}</span><b>${esc(m.username)}</b>: ${esc(m.text)}</div>`).join('') || '<div class="muted">No messages.</div>'}
        ${this.chat.more ? '<button type="button" id="mod-chat-more">Older...</button>' : ''}</div>`;
  }

  // ---------------------------------------------------------------- actions

  say(text, ok = false) {
    const el = $('mod-status');
    if (el) { el.textContent = text; el.className = `adm-status ${ok ? 'ok' : 'error'}`; }
  }

  async searchChat(keepQuery = false, more = false) {
    const q = keepQuery ? this.chat.q : ($('mod-chat-q')?.value ?? '');
    const before = more && this.chat.messages.length ? this.chat.messages.at(-1).id : undefined;
    const res = await this.network.request('modChat', { q, before });
    if (res.error) return;
    this.chat = { q, messages: more ? this.chat.messages.concat(res.messages) : res.messages, more: res.more };
    this.renderChat();
  }

  async onClick(e) {
    const t = e.target;
    if (t.id === 'mod-chat-go') return this.searchChat();
    if (t.id === 'mod-chat-more') return this.searchChat(true, true);
    const st = t.closest('[data-reports-status]');
    if (st) { this.reportsStatus = st.dataset.reportsStatus; this.open = null; return this.refresh(); }
    const op = t.closest('[data-open-report]');
    if (op) {
      const id = Number(op.dataset.openReport);
      if (this.open?.report.id === id) { this.open = null; return this.render(); }
      const res = await this.network.request('modReport', { id });
      if (res.error) return this.say(res.error);
      this.open = res;
      return this.render();
    }
    const lift = t.closest('[data-lift]');
    if (lift) { await this.network.request('modLift', { id: Number(lift.dataset.lift) }); return this.refresh(); }
    const act = t.closest('[data-act]');
    if (!act) return;
    const reportId = Number(act.dataset.rid), kind = act.dataset.act;
    if (kind === 'resolve') { await this.network.request('modResolve', { id: reportId }); this.open = null; return this.refresh(); }
    const reason = $('mod-reason')?.value || '';
    const name = this.open?.report.target_name || 'this player';
    let minutes;
    if (kind === 'suspend') {
      const v = $('mod-dur').value;
      minutes = v === 'custom' ? Number($('mod-custom').value) : Number(v);
      if (!(minutes >= 1)) return this.say('Enter the minutes for a custom time.');
    }
    const what = kind === 'ban' ? `Ban ${name} permanently?` : kind === 'suspend' ? `Suspend ${name} for ${$('mod-dur').selectedOptions[0].textContent === 'Custom...' ? `${minutes} minutes` : $('mod-dur').selectedOptions[0].textContent}?` : `Send ${name} a warning?`;
    if (!window.confirm(what)) return;
    const res = await this.network.request('modSanction', { kind, reportId, minutes, reason });
    if (res.error) return this.say(res.error);
    this.open = null;
    await this.refresh();
    this.say(`${kind === 'warn' ? 'Warned' : kind === 'ban' ? 'Banned' : 'Suspended'} ${res.username}.`, true);
  }
}

// The custom-minutes box appears when "Custom..." is picked
document.addEventListener('change', (e) => {
  if (e.target.id === 'mod-dur') $('mod-custom').classList.toggle('hidden', e.target.value !== 'custom');
});

export { REASONS };
