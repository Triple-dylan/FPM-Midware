/** Single-page admin UI (no separate frontend build). */
export function automationAdminHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FPM DataTool — Automations</title>
  <style>
    :root { font-family: system-ui, sans-serif; color: #e8eaed; background: #12141a; }
    body { max-width: 52rem; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.25rem; font-weight: 600; }
    p, li { color: #9aa0a6; line-height: 1.5; }
    .card { background: #1e2128; border-radius: 8px; padding: 1rem 1.25rem; margin: 1rem 0; border: 1px solid #2d3139; }
    label { display: flex; gap: 0.75rem; align-items: flex-start; cursor: pointer; padding: 0.5rem 0; border-bottom: 1px solid #2d3139; }
    label:last-child { border-bottom: 0; }
    input[type=checkbox] { margin-top: 0.2rem; }
    .id { font-family: ui-monospace, monospace; font-size: 0.8rem; color: #8ab4f8; }
    button { background: #8ab4f8; color: #12141a; border: 0; border-radius: 6px; padding: 0.5rem 1rem; font-weight: 600; cursor: pointer; margin-top: 1rem; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .msg { margin-top: 0.75rem; font-size: 0.9rem; }
    .err { color: #f28b82; }
    .ok { color: #81c995; }
    code { background: #2d3139; padding: 0.1em 0.35em; border-radius: 4px; font-size: 0.85em; }
  </style>
</head>
<body>
  <h1>Automation controls</h1>
  <p>Turn pipeline steps on or off. Inbound webhooks return <code>200</code> with <code>skipped</code> when disabled (avoids provider retries). <strong>Aryeo stays read-only</strong>; outbound GHL updates only happen when those toggles are on and <code>GHL_ACCESS_TOKEN</code> is set.</p>
  <div class="card">
    <p>API token (if <code>SYNC_ADMIN_TOKEN</code> is set on the server):</p>
    <input type="password" id="token" placeholder="Bearer token" style="width:100%;padding:0.5rem;border-radius:6px;border:1px solid #2d3139;background:#12141a;color:#e8eaed" autocomplete="off" />
    <div id="list">Loading…</div>
    <button type="button" id="save">Save</button>
    <div id="msg" class="msg"></div>
  </div>
  <p><a href="/dashboard" style="color:#8ab4f8">Dashboard</a> · <a href="/health" style="color:#8ab4f8">/health</a></p>
  <script>
    const listEl = document.getElementById('list');
    const msgEl = document.getElementById('msg');
    const tokenEl = document.getElementById('token');
    const saveBtn = document.getElementById('save');
    let rows = [];

    function authHeaders(includeJson) {
      const t = tokenEl.value.trim();
      const h = {};
      if (t) h['Authorization'] = 'Bearer ' + t;
      if (includeJson) h['Content-Type'] = 'application/json';
      return h;
    }

    async function load() {
      msgEl.textContent = '';
      msgEl.className = 'msg';
      const res = await fetch('/api/automations', { headers: authHeaders(false) });
      if (!res.ok) { listEl.textContent = 'Failed to load (' + res.status + ')'; return; }
      const data = await res.json();
      rows = data.toggles || [];
      listEl.innerHTML = rows.map((r, i) => '<label><input type="checkbox" data-i="' + i + '" ' + (r.enabled ? 'checked' : '') + ' /><span><span class="id">' + escapeHtml(r.id) + '</span><br/>' + escapeHtml(r.label) + (r.description ? '<br/><small>' + escapeHtml(r.description) + '</small>' : '') + '</span></label>').join('');
    }

    function escapeHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    saveBtn.addEventListener('click', async () => {
      msgEl.textContent = 'Saving…';
      const toggles = {};
      rows.forEach((r, i) => {
        const cb = listEl.querySelector('[data-i="' + i + '"]');
        toggles[r.id] = cb && cb.checked;
      });
      const res = await fetch('/api/automations', { method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ toggles }) });
      if (!res.ok) {
        msgEl.textContent = 'Save failed: ' + res.status;
        msgEl.className = 'msg err';
        return;
      }
      msgEl.textContent = 'Saved.';
      msgEl.className = 'msg ok';
      load();
    });

    load();
  </script>
</body>
</html>`;
}
