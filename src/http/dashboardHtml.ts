/** Ops dashboard — polls /api/dashboard/feed. No separate frontend build. */
export const DASHBOARD_POLL_MS = 15_000;

export function dashboardPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FPM — Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      /* FPM brand */
      --dark:        #232932;
      --dark2:       #2d3340;
      --charcoal:    #32373c;
      --blue:        #2ea3f2;
      --blue-dim:    rgba(46,163,242,0.12);
      --blue-border: rgba(46,163,242,0.28);

      /* Surface */
      --bg:          #f0f2f5;
      --surface:     #ffffff;
      --surface2:    #f7f9fb;
      --border:      #e2e8ed;
      --border-light:#eef1f4;

      /* Text */
      --text:        #1a2530;
      --text2:       #4a5568;
      --muted:       #8fa0af;

      /* Status */
      --green:       #15803d;
      --green-bg:    #f0fdf4;
      --green-border:#bbf7d0;
      --amber:       #b45309;
      --amber-bg:    #fffbeb;
      --red:         #dc2626;
      --red-bg:      #fef2f2;
      --red-border:  #fecaca;

      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: var(--text);
      background: var(--bg);
    }
    body { margin: 0; }

    /* ── Nav ── */
    .nav {
      background: var(--dark);
      padding: 0 1.5rem;
      display: flex; align-items: center; gap: 1rem;
      height: 48px; flex-shrink: 0;
      position: sticky; top: 0; z-index: 100;
    }
    .nav-brand { font-size: 0.82rem; font-weight: 700; letter-spacing: 0.04em; color: #fff; white-space: nowrap; }
    .nav-brand em { color: var(--blue); font-style: normal; }
    .nav-spacer { flex: 1; }
    .nav-right { display: flex; align-items: center; gap: 0.5rem; }
    #next-in { font-size: 0.68rem; color: rgba(255,255,255,0.35); white-space: nowrap; }
    .pill {
      display: inline-flex; align-items: center; gap: 0.25rem;
      font-size: 0.68rem; font-weight: 600;
      padding: 0.15rem 0.5rem; border-radius: 99px; border: 1px solid transparent; white-space: nowrap;
    }
    .pill::before { content:""; width:5px; height:5px; border-radius:50%; background:currentColor; flex-shrink:0; }
    .pill.ok  { background:var(--green-bg);  border-color:var(--green-border); color:var(--green); }
    .pill.bad { background:var(--red-bg);    border-color:var(--red-border);   color:var(--red); }

    /* ── Main layout ── */
    .main { max-width: 80rem; margin: 0 auto; padding: 1.5rem 1.5rem 4rem; }

    /* ── Token ── */
    .token-row { margin-bottom: 1.25rem; }
    .token-row input {
      font-size: 0.78rem; padding: 0.3rem 0.6rem;
      border: 1px solid var(--border); border-radius: 6px;
      width: 100%; max-width: 22rem;
      background: var(--surface); color: var(--text); outline: none;
    }
    .token-row input:focus { border-color: var(--blue); box-shadow: 0 0 0 3px var(--blue-dim); }

    /* ── Commission banner ── */
    .commission {
      background: var(--dark); border-radius: 10px;
      padding: 1.2rem 1.4rem 1rem; margin-bottom: 1.25rem; color: #fff;
    }
    .commission-top {
      display: flex; align-items: flex-start; justify-content: space-between;
      flex-wrap: wrap; gap: 0.75rem; margin-bottom: 0.9rem;
    }
    .commission-id .c-role  { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.45); margin-bottom: 0.1rem; }
    .commission-id .c-name  { font-size: 1rem; font-weight: 700; color: #fff; }
    .commission-amt { text-align: right; }
    .commission-amt .c-lbl  { font-size: 0.67rem; color: rgba(255,255,255,0.45); margin-bottom: 0.1rem; }
    .commission-amt .c-val  { font-size: 2.2rem; font-weight: 800; letter-spacing: -0.04em; color: var(--blue); line-height: 1; }
    .commission-amt .c-rate { font-size: 0.65rem; color: rgba(255,255,255,0.35); margin-top: 0.1rem; }

    .commission-bottom {
      display: flex; align-items: center; justify-content: space-between;
      flex-wrap: wrap; gap: 0.5rem;
      border-top: 1px solid rgba(255,255,255,0.1); padding-top: 0.75rem;
    }
    .period-btns { display: flex; gap: 0.3rem; flex-wrap: wrap; }
    .period-btn {
      font-size: 0.68rem; font-weight: 600; padding: 0.2rem 0.6rem;
      border-radius: 5px; border: 1px solid rgba(255,255,255,0.18);
      background: transparent; color: rgba(255,255,255,0.55); cursor: pointer;
      transition: all 0.1s;
    }
    .period-btn:hover { background: rgba(255,255,255,0.08); color: #fff; }
    .period-btn.active { background: var(--blue); color: #fff; border-color: var(--blue); }
    .c-stats { display: flex; gap: 1.25rem; flex-wrap: wrap; align-items: center; }
    .c-stat { font-size: 0.73rem; color: rgba(255,255,255,0.5); }
    .c-stat span { font-weight: 700; color: rgba(255,255,255,0.9); }
    .manage-btn {
      font-size: 0.68rem; font-weight: 600; padding: 0.2rem 0.65rem;
      border-radius: 5px; border: 1px solid rgba(255,255,255,0.25);
      background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7); cursor: pointer;
      transition: all 0.1s; white-space: nowrap;
    }
    .manage-btn:hover { background: rgba(255,255,255,0.15); color: #fff; }
    .manage-btn.open  { background: var(--blue); color: #fff; border-color: var(--blue); }

    /* ── Lead selector panel ── */
    .lead-selector {
      display: none; background: var(--dark2);
      border-top: 1px solid rgba(255,255,255,0.1);
      padding: 0.875rem 1.4rem 1rem;
    }
    .lead-selector.visible { display: block; }
    .ls-searchbar { margin-bottom: 0.75rem; }
    .ls-searchbar input {
      width: 100%; font-size: 0.75rem; padding: 0.35rem 0.65rem;
      border: 1px solid rgba(255,255,255,0.15); border-radius: 5px;
      background: rgba(255,255,255,0.06); color: #fff; outline: none;
    }
    .ls-searchbar input:focus { border-color: var(--blue); }
    .ls-searchbar input::placeholder { color: rgba(255,255,255,0.3); }
    .ls-section-hdr { font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: rgba(255,255,255,0.35); margin-bottom: 0.4rem; }
    .ls-grid {
      display: flex; flex-direction: column; gap: 0.22rem;
      max-height: 220px; overflow-y: auto; padding-right: 4px; margin-bottom: 0.6rem;
    }
    .ls-grid::-webkit-scrollbar { width: 4px; }
    .ls-grid::-webkit-scrollbar-track { background: transparent; }
    .ls-grid::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
    .ls-item {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.28rem 0.5rem; border-radius: 5px;
      border: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.03);
    }
    .ls-info { flex: 1; min-width: 0; }
    .ls-name { font-size: 0.72rem; color: rgba(255,255,255,0.8); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
    .ls-email { font-size: 0.63rem; color: rgba(255,255,255,0.3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
    .ls-val { font-size: 0.65rem; color: rgba(255,255,255,0.4); flex-shrink: 0; }
    .ls-toggle-btn {
      flex-shrink: 0; font-size: 0.63rem; font-weight: 600; padding: 0.12rem 0.42rem;
      border-radius: 4px; cursor: pointer; white-space: nowrap; transition: all 0.1s;
    }
    .ls-toggle-btn.add    { border: 1px solid rgba(46,163,242,0.5); color: var(--blue); background: transparent; }
    .ls-toggle-btn.add:hover    { background: var(--blue-dim); }
    .ls-toggle-btn.remove { border: 1px solid rgba(220,38,38,0.4); color: #f87171; background: transparent; }
    .ls-toggle-btn.remove:hover { background: rgba(220,38,38,0.12); }
    .ls-empty-msg { font-size: 0.72rem; color: rgba(255,255,255,0.3); padding: 0.3rem 0 0.5rem; }

    /* ── KPI tiles ── */
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; margin-bottom: 1.25rem; }
    .kpi {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 8px; padding: 0.85rem 1rem;
    }
    .kpi-val   { font-size: 1.6rem; font-weight: 800; letter-spacing: -0.035em; line-height: 1; color: var(--dark); }
    .kpi-label { font-size: 0.67rem; color: var(--muted); margin-top: 0.28rem; text-transform: uppercase; letter-spacing: 0.05em; }

    /* ── Two-col section ── */
    .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 0.75rem; }
    @media (max-width: 720px) { .row2 { grid-template-columns: 1fr; } }

    /* ── Cards ── */
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 0.75rem; overflow: hidden; }
    .card-hdr {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.6rem 1rem; border-bottom: 1px solid var(--border);
      background: var(--surface2);
    }
    .card-hdr h2 { font-size: 0.76rem; font-weight: 700; flex: 1; color: var(--dark); letter-spacing: 0.01em; }
    .card-hdr a  { font-size: 0.7rem; color: var(--blue); text-decoration: none; font-weight: 600; }
    .card-hdr a:hover { text-decoration: underline; }
    .card-body { padding: 1rem; }

    /* ── Revenue chart ── */
    .chart-wrap { overflow-x: auto; }
    .chart-svg { display: block; min-width: 300px; }

    /* ── Status pills row ── */
    .status-grid { display: flex; flex-direction: column; gap: 0.6rem; padding: 0.5rem 0; }
    .status-row { display: flex; align-items: center; gap: 0.75rem; }
    .status-lbl { font-size: 0.72rem; font-weight: 600; width: 5.5rem; flex-shrink: 0; }
    .status-bar-wrap { flex: 1; background: var(--border-light); border-radius: 99px; height: 8px; overflow: hidden; }
    .status-bar { height: 100%; border-radius: 99px; transition: width 0.4s; }
    .status-n { font-size: 0.72rem; font-weight: 700; width: 2.5rem; text-align: right; flex-shrink: 0; }
    .bar-open      { background: var(--blue); }
    .bar-fulfilled { background: var(--green); }
    .bar-confirmed { background: #8b5cf6; }
    .bar-canceled  { background: var(--muted); }

    /* ── Tables ── */
    table { width: 100%; border-collapse: collapse; }
    th {
      font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--muted);
      padding: 0.48rem 0.875rem; border-bottom: 1px solid var(--border);
      background: var(--surface2); white-space: nowrap; text-align: left;
    }
    td { padding: 0.48rem 0.875rem; border-bottom: 1px solid var(--border-light); font-size: 0.78rem; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #f4f7fa; }
    .mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.71rem; color: var(--text2); }
    .dim  { color: var(--muted); }
    .em   { font-weight: 600; color: var(--dark); }
    .num  { text-align: right; font-variant-numeric: tabular-nums; }
    .blue { color: var(--blue); font-weight: 700; }

    /* leaderboard rank + mini bar */
    .rank { font-size: 0.68rem; font-weight: 700; color: var(--muted); width: 1.5rem; text-align: center; }
    .mini-bar-wrap { width: 80px; background: var(--border-light); border-radius: 3px; height: 6px; overflow: hidden; display: inline-block; vertical-align: middle; }
    .mini-bar { height: 100%; background: var(--blue); border-radius: 3px; }

    /* ── Filter bar ── */
    .filter-bar { display: flex; align-items: center; gap: 0.5rem; padding: 0.65rem 1rem; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
    .filter-bar input {
      font-size: 0.75rem; padding: 0.28rem 0.6rem;
      border: 1px solid var(--border); border-radius: 5px;
      background: var(--surface); color: var(--text); outline: none; flex: 1; min-width: 140px; max-width: 220px;
    }
    .filter-bar input:focus { border-color: var(--blue); box-shadow: 0 0 0 2px var(--blue-dim); }
    .filter-btns { display: flex; gap: 0.25rem; flex-wrap: wrap; }
    .filter-btn {
      font-size: 0.68rem; font-weight: 600; padding: 0.2rem 0.55rem;
      border-radius: 5px; border: 1px solid var(--border);
      background: var(--surface); color: var(--text2); cursor: pointer;
    }
    .filter-btn.active { background: var(--dark); color: #fff; border-color: var(--dark); }

    /* ── Badge ── */
    .badge { display: inline-block; font-size: 0.63rem; font-weight: 700; padding: 0.08rem 0.38rem; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.03em; }
    .badge-open      { background: var(--blue-dim); color: var(--blue); border: 1px solid var(--blue-border); }
    .badge-confirmed { background: #ede9fe; color: #6d28d9; border: 1px solid #c4b5fd; }
    .badge-fulfilled { background: var(--green-bg); color: var(--green); border: 1px solid var(--green-border); }
    .badge-canceled  { background: var(--border-light); color: var(--muted); border: 1px solid var(--border); }

    /* ── Footer ── */
    #fetch-line { font-size: 0.68rem; color: var(--muted); margin: 0.5rem 0 0.75rem; }
    .footer-links { font-size: 0.73rem; }
    .footer-links a { color: var(--blue); text-decoration: none; margin-right: 0.75rem; font-weight: 600; }
    .footer-links a:hover { text-decoration: underline; }
    .err { color: var(--red); }
    .empty-row td { color: var(--muted); text-align: center; padding: 1.25rem; }
  </style>
</head>
<body>
  <nav class="nav">
    <span class="nav-brand">Full <em>Package</em> Media</span>
    <span class="nav-spacer"></span>
    <div class="nav-right">
      <span id="next-in"></span>
      <span id="mw-status" class="pill bad">middleware</span>
      <span id="db-status" class="pill bad">database</span>
    </div>
  </nav>

  <div class="main">
    <div class="token-row">
      <input type="password" id="token" placeholder="Bearer token (optional)" autocomplete="off" />
    </div>

    <!-- Commission banner -->
    <div class="commission">
      <div class="commission-top">
        <div class="commission-id">
          <div class="c-role">Sales Manager</div>
          <div class="c-name">Dylan Dahl &mdash; Commission Tracker</div>
        </div>
        <div class="commission-amt">
          <div class="c-lbl">Commission owed</div>
          <div class="c-val" id="c-amount">—</div>
          <div class="c-rate">4% of tracked order value</div>
        </div>
      </div>
      <div class="commission-bottom">
        <div class="period-btns">
          <button class="period-btn" data-p="h24">24h</button>
          <button class="period-btn" data-p="d7">7 days</button>
          <button class="period-btn" data-p="d30">30 days</button>
          <button class="period-btn" data-p="mo6">6 months</button>
          <button class="period-btn" data-p="yr1">1 year</button>
          <button class="period-btn active" data-p="all_time">All time</button>
        </div>
        <div class="c-stats">
          <div class="c-stat">Clients&nbsp;<span id="c-clients">—</span></div>
          <div class="c-stat">Orders&nbsp;<span id="c-orders">—</span></div>
          <div class="c-stat">Value&nbsp;<span id="c-value">—</span></div>
          <button class="manage-btn" id="manage-leads-btn">Manage clients</button>
        </div>
      </div>
      <!-- Lead selector panel -->
      <div class="lead-selector" id="lead-selector">
        <div class="ls-searchbar">
          <input type="text" id="ls-search" placeholder="Search all leads by name or email to add…" autocomplete="off" />
        </div>
        <div id="ls-results-wrap" style="display:none">
          <div class="ls-section-hdr">Search results</div>
          <div class="ls-grid" id="ls-results"></div>
        </div>
        <div class="ls-section-hdr">Tracked clients</div>
        <div class="ls-grid" id="ls-grid"></div>
      </div>
    </div>

    <!-- KPI tiles -->
    <div class="kpis">
      <div class="kpi"><div class="kpi-val" id="k-leads">—</div><div class="kpi-label">Tracked clients</div></div>
      <div class="kpi"><div class="kpi-val" id="k-total-leads">—</div><div class="kpi-label">Total leads in DB</div></div>
      <div class="kpi"><div class="kpi-val" id="k-month">—</div><div class="kpi-label">Orders this month</div></div>
      <div class="kpi"><div class="kpi-val" id="k-avg">—</div><div class="kpi-label">Avg order value</div></div>
      <div class="kpi"><div class="kpi-val" id="k-ytd">—</div><div class="kpi-label">YTD order value</div></div>
      <div class="kpi"><div class="kpi-val" id="k-sync">—</div><div class="kpi-label">Sync events (1h)</div></div>
    </div>

    <!-- Revenue chart + Status -->
    <div class="row2">
      <div class="card">
        <div class="card-hdr"><h2>Monthly revenue</h2></div>
        <div class="card-body">
          <div class="chart-wrap"><svg id="trend-chart" class="chart-svg" height="130"></svg></div>
        </div>
      </div>
      <div class="card">
        <div class="card-hdr"><h2>Order status</h2></div>
        <div class="card-body">
          <div class="status-grid" id="status-grid"></div>
        </div>
      </div>
    </div>

    <!-- Top customers leaderboard -->
    <div class="card">
      <div class="card-hdr"><h2>Top customers by order value</h2></div>
      <table>
        <thead><tr><th></th><th>Customer</th><th class="num">Orders</th><th class="num">Value</th><th>Share</th></tr></thead>
        <tbody id="leaderboard"></tbody>
      </table>
    </div>

    <!-- Commission breakdown -->
    <div class="card">
      <div class="card-hdr"><h2>Commission by client (all-time)</h2></div>
      <table>
        <thead><tr><th>Client</th><th class="num">Orders</th><th class="num">Order value</th><th class="num">Commission (4%)</th></tr></thead>
        <tbody id="commission-breakdown"></tbody>
      </table>
    </div>

    <!-- Orders table with filter -->
    <div class="card">
      <div class="card-hdr"><h2>Orders</h2></div>
      <div class="filter-bar">
        <input type="text" id="order-search" placeholder="Search lead or order #…" />
        <div class="filter-btns" id="status-filter">
          <button class="filter-btn active" data-s="">All</button>
          <button class="filter-btn" data-s="OPEN">Open</button>
          <button class="filter-btn" data-s="CONFIRMED">Confirmed</button>
          <button class="filter-btn" data-s="FULFILLED">Fulfilled</button>
          <button class="filter-btn" data-s="CANCELED">Canceled</button>
        </div>
      </div>
      <table>
        <thead><tr><th>Order date</th><th>Lead</th><th>Order #</th><th class="num">Value</th><th>Status</th></tr></thead>
        <tbody id="orders-body"></tbody>
      </table>
    </div>

    <!-- All tracked leads -->
    <div class="card">
      <div class="card-hdr"><h2>Commission clients</h2></div>
      <table>
        <thead><tr><th>Client</th><th class="num">Orders</th><th class="num">Value</th><th class="num">Commission</th><th>Last order</th></tr></thead>
        <tbody id="leads-body"></tbody>
      </table>
    </div>

    <!-- Sync events -->
    <div class="card">
      <div class="card-hdr"><h2>Recent sync events</h2></div>
      <table>
        <thead><tr><th>Time</th><th>System</th><th>Event</th><th>Lead</th><th>Action</th></tr></thead>
        <tbody id="events-body"></tbody>
      </table>
    </div>

    <!-- Active pipelines -->
    <div class="card">
      <div class="card-hdr"><h2>Active pipelines</h2><a href="/admin">Manage</a></div>
      <table><thead><tr><th>Pipeline</th><th>Key</th></tr></thead><tbody id="pipelines-body"></tbody></table>
    </div>

    <p id="fetch-line"></p>
    <p class="footer-links">
      <a href="/admin">Admin</a>
      <a href="/health">Health</a>
    </p>
  </div>

  <script>
  (function() {
    var POLL = ${DASHBOARD_POLL_MS};
    var pollSec = Math.round(POLL / 1000);
    var countdown = pollSec;

    // Element refs
    var elToken    = document.getElementById('token');
    var elNext     = document.getElementById('next-in');
    var elMw       = document.getElementById('mw-status');
    var elDb       = document.getElementById('db-status');
    var elFetch    = document.getElementById('fetch-line');
    var elCAmount  = document.getElementById('c-amount');
    var elCClients = document.getElementById('c-clients');
    var elCOrders  = document.getElementById('c-orders');
    var elCValue   = document.getElementById('c-value');
    var elKLeads      = document.getElementById('k-leads');
    var elKTotalLeads = document.getElementById('k-total-leads');
    var elKMonth   = document.getElementById('k-month');
    var elKAvg     = document.getElementById('k-avg');
    var elKYtd     = document.getElementById('k-ytd');
    var elKSync    = document.getElementById('k-sync');
    var elStatus   = document.getElementById('status-grid');
    var elLboard   = document.getElementById('leaderboard');
    var elCBreak   = document.getElementById('commission-breakdown');
    var elOrders   = document.getElementById('orders-body');
    var elLeads    = document.getElementById('leads-body');
    var elEvents   = document.getElementById('events-body');
    var elPipes    = document.getElementById('pipelines-body');
    var elChart    = document.getElementById('trend-chart');
    var elOSearch  = document.getElementById('order-search');

    var currentPeriod = 'all_time';
    var latestWindows = null;
    var allOrders = [];
    var allLeads = [];
    var orderStatusFilter = '';

    // ── Manage clients panel ──
    var elManageBtn   = document.getElementById('manage-leads-btn');
    var elLsPanel     = document.getElementById('lead-selector');
    var elLsGrid      = document.getElementById('ls-grid');
    var elLsResults   = document.getElementById('ls-results');
    var elLsResWrap   = document.getElementById('ls-results-wrap');
    var elLsSearch    = document.getElementById('ls-search');
    var lsSearchTimer = null;

    elManageBtn.addEventListener('click', function() {
      var open = elLsPanel.classList.toggle('visible');
      elManageBtn.classList.toggle('open', open);
      if (open) renderTrackedLeads();
      else { elLsSearch.value = ''; elLsResWrap.style.display = 'none'; elLsResults.innerHTML = ''; }
    });

    elLsSearch.addEventListener('input', function() {
      clearTimeout(lsSearchTimer);
      var q = elLsSearch.value.trim();
      lsSearchTimer = setTimeout(function() { searchLeads(q); }, 280);
    });

    function renderTrackedLeads() {
      if (!allLeads.length) {
        elLsGrid.innerHTML = '<div class="ls-empty-msg">No tracked clients yet. Search above to add one.</div>';
        return;
      }
      elLsGrid.innerHTML = allLeads.map(function(l) {
        return '<div class="ls-item">'
          + '<div class="ls-info"><span class="ls-name">' + esc(l.name) + '</span>'
          + '<span class="ls-email">' + esc(l.email||'') + '</span></div>'
          + '<span class="ls-val">' + dollarsCompact(l.value_cents) + '</span>'
          + '<button class="ls-toggle-btn remove" data-id="' + esc(l.id) + '">Remove</button>'
          + '</div>';
      }).join('');
      elLsGrid.querySelectorAll('.ls-toggle-btn').forEach(function(btn) {
        btn.addEventListener('click', function() { toggleLeadById(btn.dataset.id, false); });
      });
    }

    function searchLeads(q) {
      if (!q) { elLsResWrap.style.display = 'none'; elLsResults.innerHTML = ''; return; }
      fetch('/api/leads/search?q=' + encodeURIComponent(q) + '&limit=20', { headers: authHeaders() })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var results = data.leads || [];
          elLsResWrap.style.display = 'block';
          if (!results.length) { elLsResults.innerHTML = '<div class="ls-empty-msg">No leads found.</div>'; return; }
          var trackedIds = new Set(allLeads.map(function(l) { return l.id; }));
          elLsResults.innerHTML = results.map(function(l) {
            var tracked = l.commission_tracked || trackedIds.has(l.id);
            return '<div class="ls-item">'
              + '<div class="ls-info"><span class="ls-name">' + esc(l.name) + '</span>'
              + '<span class="ls-email">' + esc(l.email||'') + '</span></div>'
              + '<span class="ls-val">' + dollarsCompact(l.value_cents) + '</span>'
              + '<button class="ls-toggle-btn ' + (tracked ? 'remove' : 'add') + '" data-id="' + esc(l.id) + '" data-tracked="' + tracked + '">'
              + (tracked ? 'Remove' : 'Add') + '</button>'
              + '</div>';
          }).join('');
          elLsResults.querySelectorAll('.ls-toggle-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
              var next = btn.dataset.tracked !== 'true';
              toggleLeadById(btn.dataset.id, next);
            });
          });
        })
        .catch(function(err) { console.error('lead search failed', err); });
    }

    function toggleLeadById(id, value) {
      fetch('/api/leads/' + encodeURIComponent(id) + '/commission', {
        method: 'PUT',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify({ commission_tracked: value }),
      }).then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        pull().then(function() {
          if (elLsPanel.classList.contains('visible')) {
            renderTrackedLeads();
            var q = elLsSearch.value.trim();
            if (q) searchLeads(q);
          }
        });
      }).catch(function(err) { console.error('toggleLeadById failed', err); });
    }

    // ── Period toggle ──
    document.querySelectorAll('.period-btn').forEach(function(b) {
      b.addEventListener('click', function() {
        document.querySelectorAll('.period-btn').forEach(function(x) { x.classList.remove('active'); });
        b.classList.add('active');
        currentPeriod = b.dataset.p;
        renderCommission();
      });
    });

    // ── Status filter ──
    document.querySelectorAll('#status-filter .filter-btn').forEach(function(b) {
      b.addEventListener('click', function() {
        document.querySelectorAll('#status-filter .filter-btn').forEach(function(x) { x.classList.remove('active'); });
        b.classList.add('active');
        orderStatusFilter = b.dataset.s;
        renderOrders();
      });
    });

    // ── Order search ──
    elOSearch.addEventListener('input', renderOrders);

    // ── Helpers ──
    function esc(s) {
      return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
    function fmt(iso) {
      if (!iso) return '<span class="dim">—</span>';
      try {
        return new Date(iso).toLocaleString('en-US', { month:'short', day:'numeric', year:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false });
      } catch(e) { return esc(iso); }
    }
    function fmtDate(iso) {
      if (!iso) return '<span class="dim">—</span>';
      try { return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }); }
      catch(e) { return esc(iso); }
    }
    function dollars(cents) {
      if (cents == null || cents === '') return '—';
      return new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format(Number(cents) / 100);
    }
    function dollarsCompact(cents) {
      var v = Number(cents) / 100;
      if (v >= 1000) return '$' + (v/1000).toFixed(1) + 'k';
      return '$' + v.toFixed(0);
    }
    function badge(s) {
      if (!s) return '';
      var cls = s === 'OPEN' ? 'badge-open' : s === 'CANCELED' ? 'badge-canceled' : s === 'FULFILLED' ? 'badge-fulfilled' : s === 'CONFIRMED' ? 'badge-confirmed' : 'badge-canceled';
      return '<span class="badge ' + cls + '">' + esc(s) + '</span>';
    }
    function setStatus(ok, el, good, bad) {
      el.className = 'pill ' + (ok ? 'ok' : 'bad');
      el.textContent = ok ? good : bad;
    }

    // ── Commission ──
    function renderCommission() {
      if (!latestWindows) return;
      var w = latestWindows[currentPeriod] || latestWindows['all_time'];
      elCAmount.textContent  = w.commission_cents   != null ? dollars(w.commission_cents) : '—';
      elCClients.textContent = allLeads.length || '—';
      elCOrders.textContent  = w.orders_total        != null ? w.orders_total.toLocaleString() : '—';
      elCValue.textContent   = w.order_value_cents   != null ? dollars(w.order_value_cents) : '—';
    }

    // ── Revenue chart (inline SVG) ──
    function renderChart(trend) {
      if (!trend || !trend.length) { elChart.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#8fa0af" font-size="12">No data</text>'; return; }
      var W = elChart.parentElement.clientWidth || 420;
      elChart.setAttribute('width', W);
      var H = 130, padL = 8, padR = 8, padT = 16, padB = 28;
      var bars = trend.slice(-13);
      var maxVal = Math.max.apply(null, bars.map(function(b) { return b.value_cents; })) || 1;
      var n = bars.length;
      var gap = 4;
      var totalGap = gap * (n - 1);
      var barW = Math.max(8, Math.floor((W - padL - padR - totalGap) / n));
      var chartH = H - padT - padB;

      var svgParts = [];
      // gridlines
      for (var gi = 0; gi <= 3; gi++) {
        var gy = padT + (chartH / 3) * gi;
        svgParts.push('<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" stroke="#e2e8ed" stroke-width="1"/>');
      }

      bars.forEach(function(b, i) {
        var x = padL + i * (barW + gap);
        var bh = Math.max(2, Math.round((b.value_cents / maxVal) * chartH));
        var y = padT + chartH - bh;
        var isLast = i === bars.length - 1;
        var fill = isLast ? '#2ea3f2' : '#b8d8f0';
        svgParts.push('<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + bh + '" rx="3" fill="' + fill + '"><title>' + esc(fmtMonth(b.month)) + ': ' + dollars(b.value_cents) + ' (' + b.orders + ' orders)</title></rect>');

        // x-axis label (every other if crowded)
        if (n <= 8 || i % 2 === 0 || isLast) {
          svgParts.push('<text x="' + (x + barW/2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="9" fill="#8fa0af">' + esc(fmtMonthShort(b.month)) + '</text>');
        }
        // value on last bar
        if (isLast) {
          svgParts.push('<text x="' + (x + barW/2) + '" y="' + (y - 4) + '" text-anchor="middle" font-size="9" fill="#2ea3f2" font-weight="700">' + esc(dollarsCompact(b.value_cents)) + '</text>');
        }
      });

      elChart.innerHTML = svgParts.join('');
    }

    function fmtMonth(iso) {
      try { return new Date(iso).toLocaleDateString('en-US', { month:'long', year:'numeric' }); } catch(e) { return iso; }
    }
    function fmtMonthShort(iso) {
      try { return new Date(iso).toLocaleDateString('en-US', { month:'short' }); } catch(e) { return iso; }
    }

    // ── Status bars ──
    function renderStatus(counts) {
      if (!counts) { elStatus.innerHTML = ''; return; }
      var items = [
        { key:'open',      label:'Open',      n:counts.open,      cls:'bar-open' },
        { key:'fulfilled', label:'Fulfilled',  n:counts.fulfilled, cls:'bar-fulfilled' },
        { key:'confirmed', label:'Confirmed',  n:counts.confirmed, cls:'bar-confirmed' },
        { key:'canceled',  label:'Canceled',   n:counts.canceled,  cls:'bar-canceled' },
      ];
      var total = items.reduce(function(s, it) { return s + (it.n || 0); }, 0) || 1;
      elStatus.innerHTML = items.map(function(it) {
        var pct = Math.round(((it.n || 0) / total) * 100);
        return '<div class="status-row">'
          + '<span class="status-lbl">' + esc(it.label) + '</span>'
          + '<div class="status-bar-wrap"><div class="status-bar ' + it.cls + '" style="width:' + pct + '%"></div></div>'
          + '<span class="status-n">' + (it.n || 0) + '</span>'
          + '</div>';
      }).join('');
    }

    // ── Leaderboard ──
    function renderLeaderboard(customers) {
      if (!customers || !customers.length) { elLboard.innerHTML = '<tr class="empty-row"><td colspan="5">No data</td></tr>'; return; }
      var maxVal = customers[0].value_cents || 1;
      elLboard.innerHTML = customers.map(function(c, i) {
        var pct = Math.round((c.value_cents / maxVal) * 100);
        return '<tr>'
          + '<td class="rank">' + (i+1) + '</td>'
          + '<td class="em">' + esc(c.name) + '<br><span class="dim mono" style="font-weight:400">' + esc(c.email||'') + '</span></td>'
          + '<td class="num">' + c.orders + '</td>'
          + '<td class="num blue">' + dollars(c.value_cents) + '</td>'
          + '<td><div class="mini-bar-wrap"><div class="mini-bar" style="width:' + pct + '%"></div></div></td>'
          + '</tr>';
      }).join('');
    }

    // ── Commission breakdown ──
    function renderCommissionBreakdown() {
      if (!allLeads.length) { elCBreak.innerHTML = '<tr class="empty-row"><td colspan="4">No tracked clients</td></tr>'; return; }
      elCBreak.innerHTML = allLeads.map(function(c) {
        var comm = Math.round(c.value_cents * 0.04);
        return '<tr>'
          + '<td class="em">' + esc(c.name) + '<br><span class="dim mono" style="font-weight:400">' + esc(c.email||'') + '</span></td>'
          + '<td class="num">' + c.orders + '</td>'
          + '<td class="num">' + dollars(c.value_cents) + '</td>'
          + '<td class="num blue">' + dollars(comm) + '</td>'
          + '</tr>';
      }).join('');
    }

    // ── Orders ──
    function renderOrders() {
      var search = elOSearch.value.trim().toLowerCase();
      var filtered = allOrders.filter(function(o) {
        if (orderStatusFilter && (o.order_status || '') !== orderStatusFilter) return false;
        if (search) {
          var hay = ((o.lead_email || '') + (o.aryeo_identifier || '') + (o.aryeo_order_id || '')).toLowerCase();
          if (!hay.includes(search)) return false;
        }
        return true;
      });
      elOrders.innerHTML = filtered.slice(0, 50).map(function(o) {
        return '<tr>'
          + '<td class="mono">' + fmt(o.created_at || o.synced_at) + '</td>'
          + '<td class="em">' + esc(o.lead_email || o.lead_id || '—') + '</td>'
          + '<td class="mono">' + esc(o.aryeo_identifier || o.aryeo_order_id || '—') + '</td>'
          + '<td class="num mono">' + (o.total_amount != null ? dollars(o.total_amount) : '<span class="dim">—</span>') + '</td>'
          + '<td>' + badge(o.order_status) + '</td>'
          + '</tr>';
      }).join('') || '<tr class="empty-row"><td colspan="5">No orders match</td></tr>';
    }

    // ── Leads overview ──
    function renderLeads(leads) {
      if (!leads || !leads.length) { elLeads.innerHTML = '<tr class="empty-row"><td colspan="5">No tracked clients</td></tr>'; return; }
      elLeads.innerHTML = leads.map(function(l) {
        var comm = Math.round((l.value_cents || 0) * 0.04);
        return '<tr>'
          + '<td class="em">' + esc(l.name) + '<br><span class="dim mono" style="font-weight:400">' + esc(l.email||'') + '</span></td>'
          + '<td class="num">' + (l.orders || 0) + '</td>'
          + '<td class="num">' + dollars(l.value_cents) + '</td>'
          + '<td class="num blue">' + dollars(comm) + '</td>'
          + '<td class="mono">' + fmtDate(l.last_order_at) + '</td>'
          + '</tr>';
      }).join('');
    }

    // ── Sync events ──
    function renderEvents(events) {
      elEvents.innerHTML = (events || []).slice(0, 20).map(function(e) {
        return '<tr>'
          + '<td class="mono">' + fmt(e.occurred_at) + '</td>'
          + '<td>' + esc(e.system) + '</td>'
          + '<td class="mono">' + esc(e.event_type) + '</td>'
          + '<td class="em">' + esc(e.lead_email || e.lead_id || '—') + '</td>'
          + '<td>' + esc(e.action) + '</td>'
          + '</tr>';
      }).join('') || '<tr class="empty-row"><td colspan="5">No sync events</td></tr>';
    }

    // ── Poll ──
    function authHeaders() {
      var t = elToken.value.trim();
      return t ? { 'Authorization': 'Bearer ' + t } : {};
    }

    async function pull() {
      try {
        var res = await fetch('/api/dashboard/feed?limit=100', { headers: authHeaders() });
        if (!res.ok) {
          setStatus(false, elMw, '', 'middleware');
          setStatus(false, elDb, '', 'database');
          elFetch.innerHTML = '<span class="err">HTTP ' + res.status + '</span>';
          return;
        }
        var d = await res.json();
        var m = d.metrics || {};

        setStatus(true,  elMw, 'middleware', '');
        setStatus(d.middleware && d.middleware.db === 'ok', elDb, 'database', 'database error');

        // KPIs
        elKLeads.textContent      = m.tracked_leads_count != null ? m.tracked_leads_count : '—';
        elKTotalLeads.textContent = m.leads_total != null ? m.leads_total.toLocaleString() : '—';
        elKMonth.textContent = m.orders_this_month != null ? m.orders_this_month : '—';
        elKAvg.textContent   = m.avg_order_value_cents != null ? dollars(m.avg_order_value_cents) : '—';
        elKYtd.textContent   = m.ytd_order_value_cents != null ? dollars(m.ytd_order_value_cents) : '—';
        elKSync.textContent  = m.sync_events_last_hour != null ? m.sync_events_last_hour : '—';

        // Leads (set before commission so renderCommission sees allLeads)
        allLeads = d.leads || [];

        // Commission
        latestWindows = m.windows || null;
        renderCommission();

        // Chart
        renderChart(d.monthly_trend || []);

        // Status
        renderStatus(d.order_status_counts);

        // Leaderboard + breakdown
        renderLeaderboard(d.top_customers || []);
        renderCommissionBreakdown();

        // Orders
        allOrders = d.orders || [];
        renderOrders();

        // Leads (already set above)
        renderLeads(allLeads);

        // Events
        renderEvents(d.sync_events || []);

        // Pipelines
        var enabled = (d.automations || []).filter(function(a) { return a.enabled; });
        elPipes.innerHTML = enabled.map(function(a) {
          return '<tr><td class="em">' + esc(a.label) + '</td><td class="mono">' + esc(a.id) + '</td></tr>';
        }).join('') || '<tr class="empty-row"><td colspan="2">No active pipelines</td></tr>';

        elFetch.textContent = 'Updated ' + new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
        countdown = pollSec;
      } catch(err) {
        setStatus(false, elMw, '', 'middleware');
        elFetch.innerHTML = '<span class="err">' + esc(err && err.message) + '</span>';
      }
    }

    function tick() {
      countdown = Math.max(0, countdown - 1);
      elNext.textContent = 'Refreshes in ' + countdown + 's';
    }

    pull();
    setInterval(pull, POLL);
    setInterval(tick, 1000);
    window.addEventListener('resize', function() {
      if (latestWindows) pull(); // re-render chart at new width
    });
  })();
  </script>
</body>
</html>`;
}
