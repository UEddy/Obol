/**
 * Obol dashboard tab: a paper desk of invoice index cards with rubber-stamp statuses.
 * Plain IIFE against the Hermes Plugin SDK (no build step, no imports, no network beyond
 * this plugin's own /api/plugins/obol routes).
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

  var POLL_MS = 10000;        // re-read the local ledger (cheap, no Stripe call)
  var AUTO_SYNC_MS = 45000;   // pull from Stripe while the tab is open

  var FILTERS = [
    ["all", "All"], ["open", "Open"], ["overdue", "Overdue"], ["paid", "Paid"], ["draft", "Draft"], ["void", "Void"],
  ];
  var STAMP_TEXT = { paid: "Paid", overdue: "Overdue", open: "Unpaid", draft: "Draft", void: "Void", uncollectible: "Written off" };
  var KIND_TEXT = { created: "Drafted", sent: "Sent", reminded: "Reminded", paid: "Paid", voided: "Voided", deleted: "Deleted", synced: "Synced" };

  function fmtDate(ts) {
    if (!ts) return "—";
    var d = new Date(ts * 1000);
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  }
  function fmtTime(ts) {
    if (!ts) return "";
    var d = new Date(ts * 1000);
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" }) + " " +
      d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  function safeUrl(u) { return typeof u === "string" && u.indexOf("https://") === 0 ? u : null; }

  function Chop(props) {
    var mode = props.mode;
    var label = mode === "test" ? "Stripe · Test mode" : mode === "live" ? "Stripe · Live" : "Not configured";
    var cls = "obol-chop" + (mode === "live" ? " live" : mode === "test" ? "" : " missing");
    return h("span", { className: cls, title: "Which Stripe key Obol is using" },
      h("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
        h("circle", { cx: 12, cy: 12, r: 9.5, fill: "none", stroke: "currentColor", strokeWidth: 2 }),
        h("circle", { cx: 12, cy: 12, r: 4.5, fill: "none", stroke: "currentColor", strokeWidth: 2 }),
        h("path", { d: "M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3", stroke: "currentColor", strokeWidth: 2 })),
      label);
  }

  function Kpi(props) {
    return h("div", { className: "obol-card obol-kpi" },
      h("h2", { className: "obol-display" }, props.title),
      h("div", { className: "obol-kpi-value" + (props.hot ? " hot" : "") }, props.value),
      h("div", { className: "obol-kpi-sub obol-mono" }, props.sub));
  }

  function InvoiceCard(props) {
    var inv = props.inv;
    var url = safeUrl(inv.payment_link);
    var open = function () { if (url) window.open(url, "_blank", "noopener,noreferrer"); };
    var stamp = inv.status;
    return h("article", {
      className: "obol-card obol-inv" + (url ? " clickable" : "") + (props.justPaid ? " just-paid" : ""),
      role: url ? "link" : undefined,
      tabIndex: url ? 0 : undefined,
      title: url ? "Open the Stripe payment page" : undefined,
      onClick: open,
      onKeyDown: function (e) { if (e.key === "Enter") open(); },
    },
      h("div", { className: "obol-inv-top obol-mono" },
        h("span", null, inv.number || "DRAFT " + inv.invoice_id.slice(-6)),
        h("span", null, inv.status === "paid" ? "paid " + (inv.paid_at ? inv.paid_at.slice(0, 10) : "") :
          inv.due_date ? "due " + inv.due_date : fmtDate(inv.created))),
      h("h3", { className: "obol-display obol-inv-who" }, inv.customer || "Unknown customer"),
      h("div", { className: "obol-inv-desc" }, inv.description || inv.customer_email || " "),
      h("div", { className: "obol-inv-amt" }, inv.amount_due),
      h("div", { className: "obol-inv-foot obol-mono" },
        inv.status === "overdue" ? inv.days_overdue + " days late · " + inv.amount_remaining + " owed" :
          inv.status === "open" ? inv.amount_remaining + " owed" : inv.customer_email || ""),
      h("span", { className: "obol-stamp " + stamp + (props.justPaid ? " slam" : ""), "aria-label": "Status: " + stamp },
        STAMP_TEXT[stamp] || stamp));
  }

  function Ledger(props) {
    var rows = props.events || [];
    return h("section", { className: "obol-card obol-ledger" },
      h("h3", { className: "obol-display" }, "Ledger"),
      rows.length === 0 ? h("p", { className: "obol-mono", style: { padding: "14px 20px" } }, "No entries yet.") :
        h("table", null,
          h("thead", null, h("tr", null, h("th", null, "Date"), h("th", null, "Entry"), h("th", null, "Detail"))),
          h("tbody", null, rows.slice(0, 12).map(function (e) {
            return h("tr", { key: e.seq },
              h("td", { className: "obol-mono" }, fmtTime(e.at)),
              h("td", { className: "kind " + e.kind }, KIND_TEXT[e.kind] || e.kind),
              h("td", { className: "detail" }, e.detail || ""));
          }))));
  }

  function Flow() {
    var steps = [["Hermes drafts", "you ask in chat"], ["You approve", "every send asks"], ["Stripe bills", "payment link"], ["Ledger settles", "paid, stamped"]];
    return h("section", { className: "obol-flow", "aria-label": "How Obol works" }, steps.map(function (s, i) {
      return h("div", { className: "obol-flow-step", key: i },
        h("b", null, (i < steps.length - 1 ? s[0] + " →" : s[0])), h("span", { className: "obol-mono" }, s[1]));
    }));
  }

  function EmptyCard(props) {
    if (props.mode === "missing" || props.mode === "invalid") {
      return h("div", { className: "obol-card obol-empty" },
        h("h3", { className: "obol-display", style: { fontSize: "28px" } }, "No Stripe key"),
        h("p", null, "Add a test key (", h("code", null, "sk_test_…"), ") as ", h("code", null, "STRIPE_API_KEY"),
          " in Keys, or run ", h("code", null, "hermes plugins install"), " again. Live keys stay refused unless you turn on ",
          h("code", null, "allow_live"), "."),
        h("span", { className: "obol-stamp draft" }, "Not configured"));
    }
    return h("div", { className: "obol-card obol-empty" },
      h("h3", { className: "obol-display", style: { fontSize: "28px" } }, props.filtered ? "Nothing here" : "No invoices yet"),
      h("p", null, props.filtered ? "No invoices with this status." :
        h(React.Fragment, null, "Ask Hermes: ", h("code", null, "Invoice billing@acme.com $1,200 for October consulting and send it"))));
  }

  function ObolPage() {
    var _s = useState(null), status = _s[0], setStatus = _s[1];
    var _m = useState(null), summary = _m[0], setSummary = _m[1];
    var _i = useState([]), invoices = _i[0], setInvoices = _i[1];
    var _e = useState([]), events = _e[0], setEvents = _e[1];
    var _f = useState("all"), filter = _f[0], setFilter = _f[1];
    var _y = useState(false), syncing = _y[0], setSyncing = _y[1];
    var _r = useState(null), error = _r[0], setError = _r[1];
    var _p = useState({}), justPaid = _p[0], setJustPaid = _p[1];
    var prevStatus = useRef(null);

    var load = useCallback(function () {
      return Promise.all([
        SDK.fetchJSON(API + "/status"), SDK.fetchJSON(API + "/summary"),
        SDK.fetchJSON(API + "/invoices?limit=120"), SDK.fetchJSON(API + "/events?limit=20"),
      ]).then(function (r) {
        setStatus(r[0]); setSummary(r[1]); setEvents(r[3].events || []);
        var list = r[2].invoices || [];
        var prev = prevStatus.current, fresh = {};
        if (prev) list.forEach(function (inv) {
          if (inv.status === "paid" && prev[inv.invoice_id] && prev[inv.invoice_id] !== "paid") fresh[inv.invoice_id] = true;
        });
        prevStatus.current = {};
        list.forEach(function (inv) { prevStatus.current[inv.invoice_id] = inv.status; });
        if (Object.keys(fresh).length) {
          setJustPaid(fresh);
          setTimeout(function () { setJustPaid({}); }, 1600);
        }
        setInvoices(list);
      }).catch(function (err) { setError("Could not read the Obol ledger: " + (err && err.message || err)); });
    }, []);

    var sync = useCallback(function () {
      setSyncing(true);
      return SDK.fetchJSON(API + "/sync", { method: "POST" })
        .then(function () { setError(null); return load(); })
        .catch(function (err) { setError("Stripe sync failed: " + (err && err.message || err)); })
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
    var counts = { all: invoices.length };
    invoices.forEach(function (inv) { counts[inv.status] = (counts[inv.status] || 0) + 1; });
    var shown = filter === "all" ? invoices : invoices.filter(function (inv) { return inv.status === filter; });

    return h("div", { className: "obol-desk" },
      h("header", { className: "obol-head" },
        h("div", { className: "obol-head-left" },
          h("div", { className: "obol-brand-row" }, mode && h(Chop, { mode: mode }),
            h("span", { className: "obol-kicker" }, "Obol / receivables")),
          h("h1", { className: "obol-display obol-h1" }, "Invoices.", h("br"), "Paid or not.")),
        h("div", { className: "obol-actions" },
          h("button", { className: "obol-btn", onClick: sync, disabled: syncing || mode === "missing" || mode === "invalid" },
            syncing ? "Syncing…" : "Sync with Stripe"),
          h("span", { className: "obol-mono", style: { color: "var(--muted)" } },
            status && status.last_sync ? "last synced " + fmtTime(status.last_sync) : "not synced yet"))),

      error && h("div", { className: "obol-error", role: "alert" }, error),

      h("section", { className: "obol-kpis" },
        h(Kpi, { title: "Outstanding", value: cur ? cur.outstanding_fmt : "—", sub: cur ? cur.count_outstanding + " open" : "no invoices" }),
        h(Kpi, { title: "Overdue", value: cur ? cur.overdue_fmt : "—", hot: cur && cur.overdue > 0, sub: cur ? cur.count_overdue + " late" : "—" }),
        h(Kpi, { title: "Paid", value: cur ? cur.paid_fmt : "—", sub: cur ? cur.count_paid + " settled" : "—" })),

      h("nav", { className: "obol-tabs", role: "tablist" }, FILTERS.map(function (f) {
        return h("button", { key: f[0], className: "obol-tab", role: "tab", "aria-selected": filter === f[0] ? "true" : "false",
          onClick: function () { setFilter(f[0]); } }, f[1], h("span", { className: "n" }, counts[f[0]] || 0));
      })),
      h("section", { className: "obol-drawer" },
        shown.length === 0 ? h(EmptyCard, { mode: mode, filtered: filter !== "all" && invoices.length > 0 }) :
          h("div", { className: "obol-grid" }, shown.map(function (inv) {
            return h(InvoiceCard, { key: inv.invoice_id, inv: inv, justPaid: !!justPaid[inv.invoice_id] });
          }))),

      h("div", { className: "obol-lower" }, h(Flow), h(Ledger, { events: events })),
      h("p", { className: "obol-caption" }, "Hermes proposes. ", h("em", null, "You approve."), " Stripe settles."));
  }

  function AnalyticsStrip() {
    var _m = useState(null), summary = _m[0], setSummary = _m[1];
    useEffect(function () {
      SDK.fetchJSON(API + "/summary").then(setSummary).catch(function () {});
    }, []);
    var cur = summary && summary.currencies && summary.currencies[0];
    if (!cur) return null;
    return h("div", { className: "obol-strip" },
      h("b", null, "Receivables"),
      h("span", null, cur.outstanding_fmt + " outstanding"),
      h("span", { className: cur.overdue > 0 ? "hot" : "" }, cur.overdue_fmt + " overdue"),
      h("span", null, cur.paid_fmt + " paid"));
  }

  window.__HERMES_PLUGINS__.register("obol", ObolPage);
  window.__HERMES_PLUGINS__.registerSlot("obol", "analytics:top", AnalyticsStrip);
})();
