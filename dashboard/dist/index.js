/**
 * Obol dashboard tab: totals and an invoice ledger table, read from Obol's local cache.
 * Plain IIFE against the Hermes Plugin SDK: no build step, no imports, and no network calls
 * beyond this plugin's own /api/plugins/obol routes.
 */
(function () {
  "use strict";

  var SDK = window.__HERMES_PLUGIN_SDK__;
  var React = SDK.React;
  var h = React.createElement;
  var useState = SDK.hooks.useState;
  var useEffect = SDK.hooks.useEffect;
  var useRef = SDK.hooks.useRef;
  var useCallback = SDK.hooks.useCallback;
  var API = "/api/plugins/obol";

  var POLL_MS = 10000;       // re-read the local cache (no Stripe call)
  var AUTO_SYNC_MS = 45000;  // pull from Stripe while the tab is open (polling; Obol uses no webhooks)

  var FILTERS = [["all", "Active"], ["open", "Open"], ["overdue", "Overdue"], ["paid", "Paid"], ["draft", "Draft"], ["void", "Void"]];
  var STAMP = { paid: "Paid", overdue: "Overdue", open: "Unpaid", draft: "Draft", void: "Void", uncollectible: "Written off" };
  var KIND = { created: "Drafted", sent: "Sent", reminded: "Reminded", paid: "Paid", voided: "Voided", deleted: "Deleted", synced: "Synced", proposed: "Proposed" };

  function fmtTime(ts) {
    if (!ts) return "";
    var d = new Date(ts * 1000);
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" }) + " " +
      d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  function safeUrl(u) { return typeof u === "string" && u.indexOf("https://") === 0 ? u : null; }
  function errText(err) { return (err && (err.message || err.detail)) || String(err); }

  function ModeBadge(props) {
    var mode = props.mode;
    if (mode === "test") return h("span", { className: "obol-badge test", title: "Obol is using a Stripe TEST key. No real money moves." }, "Test mode");
    if (mode === "live") return h("span", { className: "obol-badge live", title: "Obol is using a Stripe LIVE key." }, "Live");
    return h("span", { className: "obol-badge missing" }, "Not configured");
  }

  function Kpi(props) {
    return h("div", { className: "obol-card obol-kpi" },
      h("h2", { className: "obol-display" }, props.title),
      h("div", { className: "obol-kpi-value" + (props.hot ? " hot" : "") }, props.value),
      h("div", { className: "obol-kpi-sub obol-mono" }, props.sub));
  }

  function RiskCell(props) {
    var inv = props.inv || {};
    var flags = (props.flags || []).slice();
    if (inv.disputed) flags.unshift({ check: "dispute", severity: "high", message: "Disputed by the client" + (inv.dispute_reason ? " (" + inv.dispute_reason + ")" : "") });
    if (inv.radar_risk_level === "elevated" || inv.radar_risk_level === "highest")
      flags.push({ check: "radar_" + inv.radar_risk_level, severity: inv.radar_risk_level === "highest" ? "high" : "medium", message: "Stripe Radar risk: " + inv.radar_risk_level });
    if (!flags.length) {
      if (inv.radar_risk_level) return h("span", { className: "obol-risk none", title: "Stripe Radar risk level for this payment" + (inv.radar_risk_score != null ? " (score " + inv.radar_risk_score + ")" : "") }, "Radar " + inv.radar_risk_level);
      return h("span", { className: "obol-risk none" }, "—");
    }
    var worst = flags.some(function (f) { return f.severity === "high"; }) ? "high" : "medium";
    return h("span", { className: "obol-risk " + worst, title: flags.map(function (f) { return f.message; }).join("\n") },
      flags.length === 1 ? flags[0].check.replace(/_/g, " ") : flags.length + " flags");
  }

  function Row(props) {
    var inv = props.inv;
    var url = safeUrl(inv.payment_link);
    var dateText = (inv.status === "paid" ? (inv.paid_at || "").slice(0, 10) : inv.due_date) || "—";
    return h("tr", { id: "inv-" + inv.invoice_id, className: (props.justPaid ? "just-paid " : "") + (props.highlight ? "highlight" : "") },
      h("td", { className: "obol-mono nowrap" }, inv.number || "draft"),
      h("td", null, h("div", { className: "who" }, inv.customer || "—"), h("div", { className: "obol-mono sub" }, inv.customer_email || "")),
      h("td", { className: "desc" }, inv.description || ""),
      h("td", { className: "num" }, inv.amount_due),
      h("td", { className: "obol-mono" }, h("div", { className: "nowrap" }, dateText),
        inv.status === "overdue" ? h("div", { className: "nowrap late" }, inv.days_overdue + " days late") : null),
      h("td", { className: "stamp-cell" },
        h("span", { className: "obol-stamp " + inv.status + (props.justPaid ? " slam" : ""), "aria-label": "Status " + inv.status }, STAMP[inv.status] || inv.status)),
      h("td", null, h(RiskCell, { flags: inv.risk, inv: inv })),
      h("td", null, url ? h("a", { className: "obol-link", href: url, target: "_blank", rel: "noopener noreferrer" }, "Pay page ↗") : ""));
  }

  function Ledger(props) {
    var rows = props.events || [];
    return h("section", { className: "obol-card obol-activity" },
      h("h3", { className: "obol-display" }, "Activity"),
      rows.length === 0 ? h("p", { className: "obol-mono pad" }, "No entries yet.") :
        h("table", null, h("tbody", null, rows.slice(0, 12).map(function (e) {
          return h("tr", { key: e.seq },
            h("td", { className: "obol-mono nowrap" }, fmtTime(e.at)),
            h("td", { className: "kind " + e.kind }, KIND[e.kind] || e.kind),
            h("td", { className: "detail" }, e.detail || ""));
        }))));
  }

  function Empty(props) {
    if (props.mode === "missing" || props.mode === "invalid") {
      return h("div", { className: "obol-empty" },
        h("b", null, "No Stripe key."),
        " Set ", h("code", null, "STRIPE_API_KEY"), " to a test key (", h("code", null, "sk_test_…"), ") in Keys, then Sync.");
    }
    return h("div", { className: "obol-empty" }, props.filtered ? "No invoices with this status." :
      h(React.Fragment, null, h("b", null, "No invoices yet."), " Ask Hermes: ",
        h("code", null, "Invoice billing@acme.example.com $1,200 for the landing page and send it")));
  }

  var LABEL_COLOR = { prompt_injection: "#de3f87", lookalike_domain: "#d4471f", impersonation: "#b3201a", dispute: "#151311",
    payment_risk: "#3b3631", contact_change: "#9a6a00", duplicate: "#7a7266", unusual_amount: "#a08c6e", live_key: "#151311", unattended_write: "#5b544b",
    guard_injection: "#de3f87", guard_unusual_amount: "#9a6a00", guard_new_recipient: "#a08c6e", guard_address_poisoning: "#b3201a",
    guard_lookalike_recipient: "#d4471f", guard_unattended: "#5b544b" };
  var OUTCOME = { flagged: "Flagged in approval", withheld: "Recipient withheld", blocked: "Blocked" };

  function SecurityView(props) {
    var _d = useState(null), data = _d[0], setData = _d[1];
    var _e = useState(null), error = _e[0], setError = _e[1];
    useEffect(function () {
      var alive = true;
      function load() {
        SDK.fetchJSON(API + "/security?days=30").then(function (d) { if (alive) { setData(d); setError(null); } })
          .catch(function (err) { if (alive) setError("Could not read the security log: " + errText(err)); });
      }
      load();
      var t = setInterval(function () { if (!document.hidden) load(); }, POLL_MS);
      return function () { alive = false; clearInterval(t); };
    }, []);
    if (error) return h("div", { className: "obol-error", role: "alert" }, error);
    if (!data) return h("p", { className: "obol-mono muted" }, "Loading…");
    var o = data.by_outcome || {};
    var integ = data.integrity || {};
    var ok = integ.activity && integ.activity.ok && integ.security && integ.security.ok;
    var max = 1;
    data.timeline.forEach(function (d) { var t = 0; for (var k in d.counts) t += d.counts[k]; if (t > max) max = t; });
    return h("div", { className: "obol-security" },
      h("section", { className: "obol-kpis" },
        h(Kpi, { title: "Threats flagged", value: String(o.flagged || 0), hot: (o.flagged || 0) > 0, sub: "shown in approval prompts" }),
        h(Kpi, { title: "Recipients withheld", value: String(o.withheld || 0), hot: (o.withheld || 0) > 0, sub: "injected messages never chose the payee" }),
        h(Kpi, { title: "Writes blocked", value: String(o.blocked || 0), sub: "live key or unattended run" })),
      h("div", { className: "obol-integrity " + (ok ? "ok" : "bad") },
        h("span", { className: "obol-stamp " + (ok ? "open" : "overdue") }, ok ? "Log verified" : "Log tampered"),
        h("span", { className: "obol-mono" }, ok
          ? "Hash chain intact · " + integ.activity.entries + " activity + " + integ.security.entries + " security entries · head " + String((integ.security.entries ? integ.security.head : integ.activity.head) || "").slice(0, 12) + "…"
          : "Edited outside Obol" + (integ.security && integ.security.first_bad_seq ? " at security entry #" + integ.security.first_bad_seq : "") + ". Run hermes obol doctor.")),
      h("section", { className: "obol-card obol-chart" },
        h("h3", { className: "obol-display" }, "Last 30 days"),
        h("div", { className: "obol-bars", role: "img", "aria-label": "Security events per day, last 30 days" }, data.timeline.map(function (d) {
          var segs = [];
          for (var k in d.counts) segs.push(h("span", { key: k, style: { height: (100 * d.counts[k] / max) + "%", background: LABEL_COLOR[k] || "#7a7266" }, title: d.day + ": " + d.counts[k] + " " + k.replace(/_/g, " ") }));
          return h("div", { key: d.day, className: "bar", title: d.day }, segs);
        })),
        h("div", { className: "obol-legend" }, (data.by_type || []).map(function (t) {
          return h("span", { key: t.check }, h("i", { style: { background: LABEL_COLOR[t.check] || "#7a7266" } }), t.label + " · " + t.count);
        }))),
      h("section", { className: "obol-card obol-table-wrap" },
        data.events.length === 0 ? h("div", { className: "obol-empty" }, h("b", null, "Nothing flagged."), " Every forwarded message and every Stripe write is checked; findings appear here.") :
        h("table", { className: "obol-table" },
          h("thead", null, h("tr", null, ["When", "Threat", "Severity", "What happened", "Detail", "Invoice"].map(function (c, i) { return h("th", { key: i }, c); }))),
          h("tbody", null, data.events.map(function (e) {
            return h("tr", { key: e.seq },
              h("td", { className: "obol-mono nowrap" }, fmtTime(e.at)),
              h("td", { className: "who" }, e.label),
              h("td", null, h("span", { className: "obol-risk " + (e.severity === "high" ? "high" : e.severity === "medium" ? "medium" : "none") }, e.severity)),
              h("td", { className: "nowrap" }, OUTCOME[e.outcome] || e.outcome),
              h("td", { className: "desc sec-detail" }, e.detail),
              h("td", null, e.invoice_id ? h("button", { className: "obol-link-btn", onClick: function () { props.onOpenInvoice(e.invoice_id); } },
                (e.invoice_number || "draft") + (e.customer ? " · " + e.customer : "") + " →") :
                e.tool ? h("span", { className: "obol-mono" }, "Guard · " + e.tool) : h("span", { className: "muted" }, "not created")));
          })))));
  }

  function readView() {
    try { return /[?&#]view=security/.test(window.location.search + window.location.hash) ? "security" : "invoices"; } catch (e) { return "invoices"; }
  }

  function ObolPage() {
    var _v = useState(readView()), view = _v[0], setView = _v[1];
    var _hl = useState(null), highlight = _hl[0], setHighlight = _hl[1];
    function openInvoice(id) {
      setView("invoices"); setHighlight(id);
      setTimeout(function () { var el = document.getElementById("inv-" + id); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }, 120);
      setTimeout(function () { setHighlight(null); }, 3500);
    }
    var _s = useState(null), status = _s[0], setStatus = _s[1];
    var _m = useState(null), summary = _m[0], setSummary = _m[1];
    var _i = useState([]), invoices = _i[0], setInvoices = _i[1];
    var _e = useState([]), events = _e[0], setEvents = _e[1];
    var _f = useState("all"), filter = _f[0], setFilter = _f[1];
    var _y = useState(false), syncing = _y[0], setSyncing = _y[1];
    var _r = useState(null), error = _r[0], setError = _r[1];
    var _p = useState({}), justPaid = _p[0], setJustPaid = _p[1];
    var prev = useRef(null);

    var load = useCallback(function () {
      return Promise.all([
        SDK.fetchJSON(API + "/status"), SDK.fetchJSON(API + "/summary"),
        SDK.fetchJSON(API + "/invoices?limit=200"), SDK.fetchJSON(API + "/events?limit=20"),
      ]).then(function (r) {
        setStatus(r[0]); setSummary(r[1]); setEvents(r[3].events || []);
        var list = r[2].invoices || [], fresh = {}, before = prev.current;
        if (before) list.forEach(function (inv) {
          if (inv.status === "paid" && before[inv.invoice_id] && before[inv.invoice_id] !== "paid") fresh[inv.invoice_id] = true;
        });
        prev.current = {};
        list.forEach(function (inv) { prev.current[inv.invoice_id] = inv.status; });
        if (Object.keys(fresh).length) { setJustPaid(fresh); setTimeout(function () { setJustPaid({}); }, 1800); }
        setInvoices(list);
      }).catch(function (err) { setError("Could not read the Obol ledger: " + errText(err)); });
    }, []);

    var sync = useCallback(function () {
      setSyncing(true);
      return SDK.fetchJSON(API + "/sync", { method: "POST" })
        .then(function () { setError(null); return load(); })
        .catch(function (err) { setError("Stripe sync failed: " + errText(err)); })
        .finally(function () { setSyncing(false); });
    }, [load]);

    useEffect(function () {
      var alive = true;
      load().then(function () { if (alive) sync(); });
      var poll = setInterval(function () { if (!document.hidden) load(); }, POLL_MS);
      var auto = setInterval(function () { if (!document.hidden) sync(); }, AUTO_SYNC_MS);
      return function () { alive = false; clearInterval(poll); clearInterval(auto); };
    }, [load, sync]);

    var mode = status ? status.mode : null;
    var cur = summary && summary.currencies && summary.currencies[0];
    var counts = { all: 0 };
    invoices.forEach(function (inv) {
      counts[inv.status] = (counts[inv.status] || 0) + 1;
      if (inv.status !== "void") counts.all += 1;
    });
    var shown = invoices.filter(function (inv) { return filter === "all" ? inv.status !== "void" : inv.status === filter; });
    if (highlight && !shown.some(function (inv) { return inv.invoice_id === highlight; })) shown = invoices;

    return h("div", { className: "obol-desk" },
      h("header", { className: "obol-head" },
        h("div", null,
          h("div", { className: "obol-brand-row" }, mode && h(ModeBadge, { mode: mode }), h("span", { className: "obol-kicker" }, "Obol / receivables")),
          h("h1", { className: "obol-display obol-h1" }, view === "security" ? "Security." : "Invoices."),
          h("div", { className: "obol-switch", role: "tablist" },
            [["invoices", "Invoices"], ["security", "Security"]].map(function (v) {
              return h("button", { key: v[0], role: "tab", "aria-selected": view === v[0] ? "true" : "false", className: "obol-switch-btn",
                onClick: function () { setView(v[0]); } }, v[1]);
            }))),
        h("div", { className: "obol-actions" },
          h("button", { className: "obol-btn", onClick: sync, disabled: syncing || mode === "missing" || mode === "invalid" }, syncing ? "Syncing…" : "Sync with Stripe"),
          h("span", { className: "obol-mono muted" }, status && status.last_sync ? "last synced " + fmtTime(status.last_sync) : "not synced yet"))),

      error && h("div", { className: "obol-error", role: "alert" }, error),
      view === "security" ? h(SecurityView, { onOpenInvoice: openInvoice }) : h(React.Fragment, null,

      h("section", { className: "obol-kpis" },
        h(Kpi, { title: "Outstanding", value: cur ? cur.outstanding_fmt : "$0.00", sub: (cur ? cur.count_outstanding : 0) + " open" }),
        h(Kpi, { title: "Overdue", value: cur ? cur.overdue_fmt : "$0.00", hot: cur && cur.overdue > 0, sub: (cur ? cur.count_overdue : 0) + " late" }),
        h(Kpi, { title: "Paid", value: cur ? cur.paid_fmt : "$0.00", sub: (cur ? cur.count_paid : 0) + " settled" })),

      h("nav", { className: "obol-tabs", role: "tablist" }, FILTERS.map(function (f) {
        return h("button", { key: f[0], className: "obol-tab", role: "tab", "aria-selected": filter === f[0] ? "true" : "false",
          onClick: function () { setFilter(f[0]); } }, f[1], h("span", { className: "n" }, counts[f[0]] || 0));
      })),
      h("section", { className: "obol-card obol-table-wrap" },
        shown.length === 0 ? h(Empty, { mode: mode, filtered: filter !== "all" && invoices.length > 0 }) :
          h("table", { className: "obol-table" },
            h("thead", null, h("tr", null, ["No.", "Client", "For", "Amount", "Due / paid", "Status", "Risk", ""].map(function (c, i) {
              return h("th", { key: i, className: c === "Amount" ? "num" : "" }, c);
            }))),
            h("tbody", null, shown.map(function (inv) {
              return h(Row, { key: inv.invoice_id, inv: inv, justPaid: !!justPaid[inv.invoice_id], highlight: highlight === inv.invoice_id });
            })))),

      h(Ledger, { events: events })),
      h("p", { className: "obol-foot obol-mono" }, "Synced from Stripe by polling every 45 s while this tab is open. Obol flags the attacks that hit invoicing and puts every decision in front of you. It does not catch all fraud."));
  }

  window.__HERMES_PLUGINS__.register("obol", ObolPage);
})();
