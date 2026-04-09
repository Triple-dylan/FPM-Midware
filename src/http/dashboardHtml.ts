/** Minimal ops dashboard — polls one JSON feed (no separate frontend build). */
export const DASHBOARD_POLL_MS = 10_000;

export function dashboardPageHtml(): string {
  const pollSec = Math.round(DASHBOARD_POLL_MS / 1000);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FPM middleware — dashboard</title>
  <style>
    :root { font-family: system-ui, sans-serif; color: #111; background: #f0f0f0; }
    body { max-width: 56rem; margin: 1.25rem auto; padding: 0 1rem; }
    h1 { font-size: 1.15rem; font-weight: 700; margin: 0 0 0.35rem 0; }
    .muted { color: #555; font-size: 0.85rem; margin: 0 0 1rem 0; }
    .row { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1rem; }
    .metric { background: #fff; border: 1px solid #ccc; border-radius: 4px; padding: 0.6rem 0.85rem; min-width: 8.5rem; }
    .metric b { font-size: 1.1rem; display: block; }
    .metric span { font-size: 0.75rem; color: #555; }
    .status { padding: 0.35rem 0.6rem; border-radius: 4px; font-size: 0.8rem; display: inline-block; margin-right: 0.5rem; }
    .ok { background: #cfc; border: 1px solid #8c8; }
    .bad { background: #fcc; border: 1px solid #c88; }
    .card { background: #fff; border: 1px solid #ccc; border-radius: 4px; padding: 0.75rem 1rem; margin: 0.75rem 0; overflow-x: auto; }
    .card h2 { font-size: 0.95rem; margin: 0 0 0.5rem 0; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    th, td { text-align: left; padding: 0.35rem 0.45rem; border-bottom: 1px solid #ddd; }
    th { color: #333; font-weight: 600; }
    .mono { font-family: ui-monospace, monospace; font-size: 0.78rem; word-break: break-all; }
    a { color: #06c; }
    input[type=password] { width: 100%; max-width: 20rem; padding: 0.35rem; border: 1px solid #999; border-radius: 3px; }
    #line { font-size: 0.8rem; color: #333; margin: 0.5rem 0 0.75rem 0; }
    .err { color: #a00; }
    .badge { font-size: 0.72rem; font-weight: 700; padding: 0.12rem 0.45rem; border-radius: 3px; display: inline-block; }
    .badge.on { background: #6b6; color: #020; }
    .badge.off { background: #ccc; color: #333; }
  </style>
</head>
<body>
  <h1>Middleware dashboard</h1>
  <p class="muted">Plain view · no reporting module. Data comes from this server&rsquo;s PostgreSQL. Set token if <code>SYNC_ADMIN_TOKEN</code> is configured.</p>
  <input type="password" id="token" placeholder="Bearer token (optional)" autocomplete="off" />
  <div class="row" style="margin-top:0.75rem;align-items:center">
    <span id="mw-status" class="status bad">middleware …</span>
    <span id="db-status" class="status bad">database …</span>
    <span class="muted" style="margin:0">Poll: <strong>${pollSec}s</strong> · <span id="next-in"></span></span>
  </div>
  <div class="row" id="metrics-row">
    <div class="metric"><b id="m-ev">—</b><span>sync events (60m)</span></div>
    <div class="metric"><b id="m-ord">—</b><span>orders synced (60m, linked)</span></div>
    <div class="metric"><b id="m-aut">—</b><span>automations on / total</span></div>
  </div>
  <div class="card">
    <h2>Automations <small class="muted">(edit in <a href="/admin">/admin</a>)</small></h2>
    <table><thead><tr><th>On</th><th>Label</th><th>id</th></tr></thead><tbody id="automations"></tbody></table>
  </div>
  <p id="line"></p>
  <div class="card">
    <h2>Recent orders → leads <small class="muted">(synced_at)</small></h2>
    <table><thead><tr><th>Synced</th><th>Lead</th><th>Order</th><th>Status</th></tr></thead><tbody id="orders"></tbody></table>
  </div>
  <div class="card">
    <h2>Recent sync events</h2>
    <table><thead><tr><th>Time</th><th>System</th><th>Event</th><th>Lead</th><th>Action</th></tr></thead><tbody id="events"></tbody></table>
  </div>
  <p class="muted"><a href="/admin">Automations</a> · <a href="/health">Health JSON</a> · <a href="/health/live">Liveness</a></p>
  <script>
    (function () {
      var POLL_MS = ${DASHBOARD_POLL_MS};
      var pollSec = Math.round(POLL_MS / 1000);
      var tokenEl = document.getElementById('token');
      var lineEl = document.getElementById('line');
      var nextEl = document.getElementById('next-in');
      var mwEl = document.getElementById('mw-status');
      var dbEl = document.getElementById('db-status');
      var ordersEl = document.getElementById('orders');
      var eventsEl = document.getElementById('events');
      var mEv = document.getElementById('m-ev');
      var mOrd = document.getElementById('m-ord');
      var mAut = document.getElementById('m-aut');
      var autEl = document.getElementById('automations');
      var countdown = pollSec;

      function authHeaders() {
        var t = tokenEl.value.trim();
        var h = {};
        if (t) h['Authorization'] = 'Bearer ' + t;
        return h;
      }

      function esc(s) {
        return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      }

      function setStatus(ok, el, goodText, badText) {
        el.className = 'status ' + (ok ? 'ok' : 'bad');
        el.textContent = ok ? goodText : badText;
      }

      async function pull() {
        try {
          var res = await fetch('/api/dashboard/feed?limit=60', { headers: authHeaders() });
          if (!res.ok) {
            setStatus(false, mwEl, '', 'middleware: HTTP ' + res.status);
            setStatus(false, dbEl, '', 'database: ?');
            lineEl.innerHTML = '<span class="err">Feed failed: ' + esc(res.status) + '</span>';
            return;
          }
          var data = await res.json();
          setStatus(true, mwEl, 'middleware: active', '');
          var dbOk = data.middleware && data.middleware.db === 'ok';
          setStatus(dbOk, dbEl, 'database: connected', 'database: check failed');
          mEv.textContent = String((data.metrics && data.metrics.sync_events_last_hour) != null ? data.metrics.sync_events_last_hour : '—');
          mOrd.textContent = String((data.metrics && data.metrics.orders_linked_synced_last_hour) != null ? data.metrics.orders_linked_synced_last_hour : '—');
          var ae = data.metrics && data.metrics.automations_enabled;
          var at = data.metrics && data.metrics.automations_total;
          mAut.textContent = (ae != null && at != null) ? (ae + ' / ' + at) : '—';
          autEl.innerHTML = (data.automations || []).map(function (a) {
            var badge = a.enabled
              ? '<span class="badge on">on</span>'
              : '<span class="badge off">off</span>';
            return '<tr><td style="white-space:nowrap">' + badge + '</td><td>' + esc(a.label) + '</td><td class="mono">' + esc(a.id) + '</td></tr>';
          }).join('') || '<tr><td colspan="3">No automation rows.</td></tr>';
          var now = new Date().toISOString();
          lineEl.textContent = 'Last fetch: ' + now + ' · rows in this page: ' + (data.orders && data.orders.length) + ' orders, ' + (data.sync_events && data.sync_events.length) + ' events';
          ordersEl.innerHTML = (data.orders || []).map(function (o) {
            return '<tr><td class="mono">' + esc(o.synced_at || '—') + '</td><td>' + esc(o.lead_email || o.lead_id || '—') + '</td><td class="mono">' + esc(o.aryeo_identifier || o.aryeo_order_id) + '</td><td>' + esc(o.order_status) + ' / ' + esc(o.fulfillment_status) + '</td></tr>';
          }).join('') || '<tr><td colspan="4">No orders linked to leads.</td></tr>';
          eventsEl.innerHTML = (data.sync_events || []).map(function (e) {
            return '<tr><td class="mono">' + esc(e.occurred_at || '—') + '</td><td>' + esc(e.system) + '</td><td class="mono">' + esc(e.event_type) + '</td><td>' + esc(e.lead_email || e.lead_id || '—') + '</td><td>' + esc(e.action) + '</td></tr>';
          }).join('') || '<tr><td colspan="5">No sync events.</td></tr>';
          countdown = pollSec;
        } catch (err) {
          setStatus(false, mwEl, '', 'middleware: error');
          lineEl.innerHTML = '<span class="err">' + esc(err && err.message) + '</span>';
        }
      }

      function tickCountdown() {
        countdown = Math.max(0, countdown - 1);
        nextEl.textContent = 'Next refresh in ' + countdown + 's';
      }

      pull();
      setInterval(pull, POLL_MS);
      setInterval(tickCountdown, 1000);
    })();
  </script>
</body>
</html>`;
}
