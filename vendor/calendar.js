// The ticker as shown: a US listing as the bare code, any other with its
// exchange. NK5A.F and NK5A.STU (Frankfurt, Stuttgart) both read "NK5A" and
// looked like one company listed twice.
window.CalendarFormat = {
  // Keys for a list of event cards that name the event, not its place in the
  // list. "date-index" kept the open card open on whatever event took that
  // place after a filter change: All -> open VOLVF -> Economic left an
  // economic release open. Identical events (same type, date,
  // symbol, title and time) are told apart by their order among themselves.
  eventKeys(events, prefix) {
    const seen = {};
    return (events || []).map((e) => {
      const base = [prefix || '', e && e.type, e && e.date, e && e.symbol, e && e.title, e && e.time].map((x) => (x == null ? '' : String(x))).join('|');
      const n = seen[base] = (seen[base] || 0) + 1;
      return n === 1 ? base : `${base}#${n}`;
    });
  },
  // An economic release's period as a reader says it. EODHD sends "Aug",
  // "Oct/02" (the week to 2 Oct), "Q3"; the first two were printed as typed
  // next to the figure.
  periodLabel(p) {
    const s = String(p == null ? '' : p).trim();
    if (!s) return '';
    let m = s.match(/^([A-Z][a-z]{2})$/);
    if (m) return `for ${m[1]}`;
    m = s.match(/^([A-Z][a-z]{2})\/(\d{1,2})$/);
    if (m) return `week of ${m[1]} ${parseInt(m[2], 10)}`;
    return s;
  },
  // A row's currency: its own; a US listing without one is in dollars;
  // any other listing without one stays unknown.
  // Except a foreign share traded over the counter: a five-letter code
  // ending in F carries its home market's figures, so ALNPF read "$96.32"
  // for the 96.32 yen of 9202.TSE.
  rowCurrency(own, symbol) {
    if (own) return String(own).toUpperCase();
    const s = String(symbol || '').toUpperCase();
    const code = s.endsWith('.US') ? s.slice(0, -3) : s;
    if (/^[A-Z]{4}F$/.test(code)) return null;
    return (s && (!s.includes('.') || s.endsWith('.US'))) ? 'USD' : null;
  },
  displaySymbol(sym) {
    if (!sym) return '';
    const str = String(sym);
    const i = str.lastIndexOf('.');
    if (i < 0) return str;
    const base = str.slice(0, i), ex = str.slice(i + 1).toUpperCase();
    return ex === 'US' ? base : `${base}.${ex}`;
  },

  // One row per company out of the earnings feed, the biggest first.
  //
  // The feed lists every listing of a report: on 2026-10-29 it sent 2,146
  // rows, eight of them Société Générale (SGE.F, SGE.HA, SGE.XETRA, GLE.PA,
  // 1GLE.MI ...). The calendar kept the first twenty a day in the feed's own
  // order and dropped the rest, so that day read as SocGen, BMS and Merck,
  // and AAPL, which reports that evening, was not on it.
  //
  // The rows carry no issuer id and no market cap, so (collapseListings):
  //  - listings join only on positive evidence -- one code on venues that
  //    quote one listing under it (German venues, NSE/BSE, US/Mexico), or
  //    one company name from the screener; never on a matching estimate
  //    (that folded China Mobile into Hancock Whitney);
  //  - the row shown is the primary listing: a US one, else a home exchange,
  //    then an OTC line of a foreign share, then XETRA, then a mirror venue;
  //  - a day is ordered by market cap where it is known (`caps`, USD, by
  //    code: the screener's largest US names, one request a day), then by
  //    venue, then by how many listings a company has. The row itself says
  //    nothing about size, and AAPL sat 113th of 1,283 on its own day
  //    without it.
  // Nothing is dropped: the other listings ride along in `listings`.
  // What the Week Ahead Briefing is written from. It was handed the first 30
  // events of the list, all of them today and 26 dividends, with mirrored
  // listings twice over (SYY x4) and no macro. Now: the
  // next five trading days from `todayKey`, one row per company, earnings
  // (largest first, as the list already orders them) and US macro releases
  // before everything else, a few per day so every day is in it, `cap` in all.
  weekAhead(events, todayKey, cap) {
    const max = cap || 30;
    const days = [];
    const [y, m, d] = String(todayKey).split('-').map(Number);
    for (let t = new Date(y, m - 1, d); days.length < 5; t.setDate(t.getDate() + 1)) {
      const dow = t.getDay();
      if (dow !== 0 && dow !== 6) days.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`);
    }
    const inWeek = new Set(days);
    const PER_DAY = { earnings: 4, economic: 2 };
    const seen = new Set();
    const counts = {};
    const base = (s) => String(s || '').toUpperCase().split('.')[0];
    const pick = { earnings: [], economic: [], other: [] };
    (events || []).forEach((e) => {
      if (!e || !inWeek.has(e.date)) return;
      // A company is every code it is listed under (raw.listings): Intel as
      // INTC and 0R24.LSE was two of a day's four.
      const keys = e.type === 'economic'
        ? [`${e.date}|${e.title}`]
        : [e.symbol].concat((e.raw && Array.isArray(e.raw.listings)) ? e.raw.listings : []).map(s => `${e.type}|${base(s)}`);
      if (keys.some(k => seen.has(k))) return;
      keys.forEach(k => seen.add(k));
      const bucket = e.type === 'earnings' || e.type === 'economic' ? e.type : 'other';
      const ck = `${bucket}|${e.date}`;
      const limit = PER_DAY[bucket] || 1;
      if ((counts[ck] || 0) >= limit) return;
      counts[ck] = (counts[ck] || 0) + 1;
      pick[bucket].push(e);
    });
    const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    // Stable sorts: within a day the list's own order (largest first) stays.
    return pick.earnings.slice().sort(byDate)
      .concat(pick.economic.slice().sort(byDate), pick.other.slice().sort(byDate))
      .slice(0, max);
  },

  // An earnings row's figures, each a number or null. "NA" -- how EODHD
  // writes an empty number -- became NaN and the badge read "MISS NaN%";
  // and the feed sends difference 0 before a report
  // exists, which the card showed as "Surprise 0.00": no actual,
  // no surprise.
  earningsNumbers(r) {
    const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    const actual = n(r && r.actual);
    return {
      estimate: n(r && r.estimate),
      actual,
      difference: actual == null ? null : n(r.difference),
      percent: actual == null ? null : n(r.percent),
    };
  },

  // A calendar earnings row as one quarter in the shape the preview card and
  // its prompt read (fundamentals' Earnings.History: date = period end).
  toQuarter(r) {
    if (!r) return null;
    const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    return {
      date: String(r.date || r.report_date || '').slice(0, 10),
      reportDate: r.report_date ? String(r.report_date).slice(0, 10) : null,
      epsEstimate: n(r.estimate),
      epsActual: n(r.actual),
      // The feed sends difference 0 before a report exists; no actual, no
      // surprise.
      epsDifference: n(r.actual) == null ? null : n(r.difference),
      surprisePercent: n(r.actual) == null ? null : n(r.percent),
    };
  },

  // US dollars per unit, to put caps and estimates of different listings on
  // one scale. Approximate on purpose (October 2026): the calendar only
  // orders a day and tells a $0.85 estimate from a C$0.07 one with them; no
  // figure on screen is converted. A live rate would cost a request per
  // currency on every open, and the free tier has twenty a day.
  USD_PER: {
    USD: 1, EUR: 1.10, GBP: 1.30, CHF: 1.15, SEK: 0.095, DKK: 0.147, NOK: 0.094, ISK: 0.0073,
    PLN: 0.26, CZK: 0.044, HUF: 0.0028, CAD: 0.73, HKD: 0.128, CNY: 0.14, TWD: 0.031,
    KRW: 0.00072, JPY: 0.0068, AUD: 0.66, NZD: 0.60, SGD: 0.77, MYR: 0.23, THB: 0.029,
    IDR: 0.000062, PHP: 0.017, INR: 0.012, SAR: 0.267, ILS: 0.27, ZAR: 0.055, BRL: 0.18,
    MXN: 0.054, ARS: 0.001, CLP: 0.00105, TRY: 0.029,
  },
  _venueCcy(code) {
    const s = String(code || '').toUpperCase();
    const i = s.lastIndexOf('.');
    const ex = i < 0 ? 'US' : s.slice(i + 1);
    const M = window.Money;
    // The exchanges the caps come from, for a page without money.js.
    const OWN = { US: 'USD', LSE: 'GBP', XETRA: 'EUR', PA: 'EUR', AS: 'EUR', MI: 'EUR', MC: 'EUR', SW: 'CHF', TO: 'CAD', ST: 'SEK', CO: 'DKK' };
    const c = (M && M._EXCHANGE_CCY && M._EXCHANGE_CCY[ex]) || OWN[ex] || null;
    return c && M && M.majorOf ? M.majorOf(c) : c;
  },
  toUsd(value, ccy) {
    const v = Number(value);
    const rate = this.USD_PER[String(ccy || '').toUpperCase()];
    return Number.isFinite(v) && rate ? v * rate : null;
  },
  // A depositary receipt or a foreign line that quotes another market's
  // company: AAPL34.SA, NVDA80.BK, the mirror venues, LSE 0xxx, Milan 1xxx.
  // XETRA (tier 2) is not one: it is SAP's home; its lines of US companies
  // (APC for Apple) are caught by name in capsFromScreener.
  isMirror(code) {
    if (this.venueTier(code) >= 3) return true;
    const s = String(code || '').toUpperCase();
    const i = s.lastIndexOf('.');
    return i > 0 && /\d{2}$/.test(s.slice(0, i)) && /^[A-Z]{3,}/.test(s) && s.slice(i + 1) !== 'US';
  },

  // Screener pages → { caps: { 'CODE.EXCHANGE': cap in USD }, names: { code:
  // name } }. A US row is keyed .US whatever venue it names.
  //
  // Only primary listings carry a cap. The world page answered in each
  // listing's own currency and was mostly other markets' lines of US
  // giants: NVDA.MX 104,601bn (pesos) outranked everything, a day's label
  // read TSLA.MX, INTC.SW, GOOGL.MX, and JPMorgan held five of a day's first
  // seven rows. A mirror line, a depositary receipt, and a
  // non-US line of a company the US pages already name are skipped; the rest
  // is converted to dollars. Their listings still join the company's row
  // through collapseListings, which ranks by the company's own cap.
  //
  // Receipts and funds carry their underlying's size, not a company's own:
  // META.TO (a CDR) stood at 1,797bn, SPY.AU (an ETF) at 597bn, MYSE.LSE (a
  // GDR) high on its day. They give a name, never a cap; and no
  // non-US line may outsize the largest US company.
  RECEIPT_NAME: /\b(CDR|GDR|BDR|DRC|ADR|ADS|CEDEARS?|ETF|ETN|ETC|UCITS|FUND|TRACKER|INDEX)\b/,
  capsFromScreener(pages) {
    const US_VENUES = ['US', 'NYSE', 'NASDAQ', 'NYSE ARCA', 'NYSE MKT', 'AMEX', 'BATS', 'OTC'];
    // London answers 'p' (pence) for the price while the cap is in pounds
    // (SHEL: 206.9bn on 06.10, the same company as SHELL.AS at €244bn).
    const SYMBOL_CCY = { '$': null, '€': 'EUR', '£': 'GBP', 'p': 'GBP', 'GBX': 'GBP', 'CHF': 'CHF', '¥': 'JPY', 'R$': 'BRL', '₹': 'INR', '₩': 'KRW', 'C$': 'CAD', 'A$': 'AUD', 'HK$': 'HKD' };
    const caps = {};
    const names = {};
    const usNames = new Set();
    const all = [];
    (pages || []).forEach((rows) => {
      (Array.isArray(rows) ? rows : []).forEach((r) => {
        if (!r || !r.code) return;
        const ex = String(r.exchange || 'US').toUpperCase();
        const us = US_VENUES.indexOf(ex) !== -1;
        const key = `${String(r.code).toUpperCase()}.${us ? 'US' : ex}`;
        all.push({ r, key, us });
        if (r.name) names[key] = String(r.name);
        if (us && r.name) usNames.add(this.normName(r.name));
      });
    });
    const usMax = all.reduce((m, x) => (x.us && Number(x.r.market_capitalization) > m ? Number(x.r.market_capitalization) : m), 0);
    all.forEach(({ r, key, us }) => {
      let cap = Number(r.market_capitalization);
      if (!(cap > 0)) return;
      if (!us) {
        if (this.isMirror(key)) return;
        if (r.name && this.RECEIPT_NAME.test(String(r.name).toUpperCase())) return;
        if (r.name && usNames.has(this.normName(r.name))) return;
        const sym = String(r.currency_symbol || '').trim();
        const ccy = (SYMBOL_CCY[sym] !== undefined && SYMBOL_CCY[sym]) || this._venueCcy(key);
        cap = this.toUsd(cap, ccy);
        if (!(cap > 0)) return;
        if (usMax > 0 && cap > usMax * 1.1) return;
      }
      if (!(caps[key] >= cap)) caps[key] = cap;
    });
    return { caps, names };
  },

  // A company name for comparison: no accents, punctuation, legal forms,
  // share classes or receipt labels ("Apple Inc." = "APPLE INC",
  // "Apple CDR (CAD Hedged)" = "Apple").
  normName(n) {
    return String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
      .replace(/\(.*?\)/g, ' ')
      // ASML's US line is "ASML Holding N.V. New York Registry Shares".
      .replace(/\b(NEW YORK|NY) REGISTRY\b|\bAMERICAN DEPOSITARY\b|\b(UN)?SPONSORED\b|\bDEPOSITARY RECEIPTS?\b/g, ' ')
      .replace(/[^A-Z0-9 ]+/g, ' ')
      // GROEP is GROUP in Dutch: the US list spells ING's receipt "ING Group NV
      // ADR" and Amsterdam's own line "ING Groep NV", and 29 Oct showed the
      // bank twice. Nothing else is translated.
      .replace(/\b(INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|SA|S A|AG|SE|NV|N V|AB|ASA|SPA|S P A|HOLDINGS?|GROUP|GROEP|THE|CLASS [A-Z]|SERIES [A-Z]|ADR|ADS|CDR|DRC|BDR|GDR|DR|CEDEARS?|ORD|ORDINARY|SHARES?|COMMON|STOCK|REGISTERED|REG|PUBL)\b/g, ' ')
      .replace(/\s+/g, ' ').trim()
      // A share class left at the end: "...ERICSSON B" (ERIC.US) is the same
      // company as "...Ericsson (publ)" (ERIC-B.ST).
      .replace(/ [A-Z]$/, '');
  },

  MIRROR_VENUES: ['F', 'STU', 'MU', 'DU', 'HM', 'HA', 'BE', 'MX', 'BA', 'VI', 'NEO', 'SN', 'LIM', 'IL'],
  venueTier(code) {
    const s = String(code || '');
    const i = s.lastIndexOf('.');
    const ex = i < 0 ? 'US' : s.slice(i + 1).toUpperCase();
    if (ex === 'US') return 0;
    if (ex === 'XETRA') return 2;
    // 0KBI.LSE and 1GLE.MI: London's and Milan's lines for foreign shares,
    // not home listings.
    const base = s.slice(0, i);
    if (this.MIRROR_VENUES.indexOf(ex) !== -1
      || (ex === 'LSE' && /^0[A-Z0-9]{3}$/.test(base))
      || (ex === 'MI' && /^\d[A-Z]{2,}$/.test(base))) return 3;
    return 1;
  },
  // One base code on two home exchanges is not one company because the
  // letters match (VHI.US Valhi, VHI.TO Vitalhub), and a matching estimate is
  // not evidence either: Hancock Whitney took China Mobile's Hamburg quotes on
  // 20 Oct (both 1.65, after the close), General Electric took Grupo México's
  // 4GE.F, and stripping a leading digit made Frankfurt's 1TK (THK) and 2TK
  // (Eledon) one code. A false merge hides a company; a
  // duplicate row only repeats one. So listings join only on positive
  // evidence:
  //  - the same code on venues that quote one listing under one code: the
  //    German exchanges among themselves (XETRA, F, BE, DU, HM, HA, MU, STU),
  //    NSE and BSE, the US and Mexico's SIC (AAPL.MX is Apple); a US preferred
  //    series is its issuer's (JPM-PC);
  //  - the same company name, where the screener (or the row) names both
  //    codes: ASML.AS, ASML.US and the OTC line ASMLF; SHEL.LSE, SHELL.AS and
  //    SHEL.US; SHOP.US and SHOP.TO. Different names never join.
  // Everything else stays its own row; a nameless mirror quote carries no
  // cap and sinks to the bottom of its day.
  GERMAN_VENUES: ['XETRA', 'F', 'BE', 'DU', 'HM', 'HA', 'MU', 'STU'],
  // The label a company is shown under: a US listing, then its home
  // exchange; an OTC line of a foreign share (ASMLF, UNCFF, ERIXF -- five
  // letters ending F or Y) ranks after the home listing, never as the label of
  // a day that has the real one.
  labelTier(code) {
    const s = String(code || '').toUpperCase();
    const i = s.lastIndexOf('.');
    const base = i < 0 ? s : s.slice(0, i);
    const t = this.venueTier(code);
    return t === 0 && /^[A-Z]{4}[FY]$/.test(base) ? 1.5 : t;
  },
  // collapseListings' rows before the names are in (the exchanges' lists and
  // the screener's, which comes with the caps), without the ones most likely
  // to be another listing of a company the day already has at home: a row
  // whose label is an OTC line of a foreign share, XETRA or a mirror venue.
  // Drawn, APC.XETRA stood beside AAPL as a second company, ~200 such rows on
  // a day, then vanished when the names folded them in, and the day was
  // redrawn twice. When both are in, the day is drawn
  // from everything. A names list that failed does not end the wait: drawn
  // from everything then, APC.XETRA stood beside AAPL for good; the names are asked again (NAMES_RETRY_MS).
  // A row the screener gave a cap is a home listing whatever its venue
  // (SAP.XETRA): `capsIn`, what capsFromScreener returns, keeps it.
  withoutLikelyTwins(rows, capsIn) {
    const caps = capsIn && capsIn.caps && typeof capsIn.caps === 'object' ? capsIn.caps : (capsIn || null);
    const capped = (code) => { const v = caps && Number(caps[String(code || '').toUpperCase()]); return v > 0; };
    return (rows || []).filter(r => r && (this.labelTier(r.code) < 1.5
      || capped(r.code) || (Array.isArray(r.listings) && r.listings.some(capped))));
  },
  // The waits before the exchanges' names lists are asked again after a
  // failure (a 429's own wait when it is longer).
  NAMES_RETRY_MS: [5000, 15000, 45000],
  collapseListings(rows, capsIn, namesIn) {
    // capsIn: { code: USD cap } or what capsFromScreener returns.
    const caps = capsIn && capsIn.caps && typeof capsIn.caps === 'object' ? capsIn.caps : capsIn;
    const names = namesIn || (capsIn && capsIn.names) || null;
    const capOf = (code) => {
      if (!caps) return null;
      const s = String(code || '').toUpperCase();
      const v = caps[s] != null ? caps[s] : (s.endsWith('.US') ? caps[s.slice(0, -3)] : caps[s + '.US']);
      return Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null;
    };
    if (!Array.isArray(rows)) return [];
    const PREFERRED = /-P[A-Z]{0,2}$/;
    const venueOf = (code) => { const s = String(code || '').toUpperCase(); const i = s.lastIndexOf('.'); return i < 0 ? 'US' : s.slice(i + 1); };
    const rawBase = (code) => { const s = String(code || '').toUpperCase(); const i = s.lastIndexOf('.'); return i < 0 ? s : s.slice(0, i); };
    const TWINS = [this.GERMAN_VENUES, ['NSE', 'BSE'], ['US', 'MX']];
    const family = (code) => { const v = venueOf(code); const t = TWINS.findIndex(set => set.indexOf(v) !== -1); return t >= 0 ? `T${t}` : `V${v}`; };
    // Leading digits stay: on Frankfurt 1TK and 2TK are two issuers.
    const baseOf = (code) => (venueOf(code) === 'US' ? rawBase(code).replace(PREFERRED, '') : rawBase(code));
    const dayOf = (r) => String(r.report_date || r.date || '').slice(0, 10);
    const nameOfRow = (r) => {
      const s = String(r.code || '').toUpperCase();
      // German venues quote one listing under one code: Frankfurt's symbol list
      // names them all (FFV = F5 Networks).
      const german = this.GERMAN_VENUES.indexOf(venueOf(s)) !== -1 ? `${rawBase(s)}.F` : null;
      const n = (names && (names[s] || (s.endsWith('.US') ? names[s.slice(0, -3)] : names[s + '.US']) || (german && names[german]))) || r.name;
      const k = n ? this.normName(n) : '';
      return k.length >= 2 ? k : null;   // "3M" is a name
    };
    const list = rows.filter(r => r && r.code);
    const parent = list.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
    const byListing = new Map();
    const byName = new Map();
    list.forEach((r, i) => {
      const day = dayOf(r);
      const k = `${day}|${family(r.code)}|${baseOf(r.code)}`;
      if (byListing.has(k)) join(byListing.get(k), i); else byListing.set(k, i);
      const n = nameOfRow(r);
      if (n) { const nk = `${day}|${n}`; if (byName.has(nk)) join(byName.get(nk), i); else byName.set(nk, i); }
    });
    const groups = new Map();
    list.forEach((r, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); });
    // A company whose US line (an ADR) has no report that day still has that
    // line's cap: INGA.AS, GLE.PA, ADS.XETRA sank to #431-#630 of 1,270 on
    // 29 Oct. Looked up by name, and only from a US line that is a
    // foreign company's receipt (an ADR/ADS, or a five-letter OTC code ending
    // F/Y): a US company's own name on a German mirror dated another day
    // (Caterpillar's CAT1.XETRA on 29 Oct, CAT itself on 4 Nov) must not take
    // its cap and head a day it does not report on.
    const usCapByName = new Map();
    if (caps && names) {
      Object.keys(caps).forEach((k) => {
        if (k.indexOf('.') !== -1 && !/\.US$/.test(k)) return;
        const n = names[k] || names[k.replace(/\.US$/, '')] || names[k + '.US'];
        const base = k.replace(/\.US$/, '');
        const receipt = /^[A-Z]{4}[FY]$/.test(base) || /\b(ADR|ADS|DEPOSITARY|SPONSORED)\b/i.test(String(n || ''));
        if (!receipt) return;
        const nk = n ? this.normName(n) : '';
        const v = Number(caps[k]);
        if (nk.length >= 2 && v > 0 && !(usCapByName.get(nk) >= v)) usCapByName.set(nk, v);
      });
    }
    const ranked = [...groups.values()].map((g) => {
      // The label: the lowest tier, then the largest listing -- ASML.AS over
      // its Swiss line ASML.SW, both "home" by tier.
      const primary = g.slice().sort((a, b) => (this.labelTier(a.code) - this.labelTier(b.code))
        || ((capOf(b.code) || 0) - (capOf(a.code) || 0)))[0];
      const listings = [...new Set(g.map(r => r.code))];
      let cap = listings.reduce((m, c) => Math.max(m, capOf(c) || 0), 0) || null;
      if (!cap) {
        for (const r of g) { const n = nameOfRow(r); const v = n && usCapByName.get(n); if (v) { cap = v; break; } }
      }
      return { ...primary, listings, _cap: cap, _rank: listings.length, _tier: this.labelTier(primary.code) };
    });
    ranked.sort((a, b) => {
      const da = dayOf(a), db = dayOf(b);
      if (da !== db) return da < db ? -1 : 1;
      if ((b._cap || 0) !== (a._cap || 0)) return (b._cap || 0) - (a._cap || 0);
      if (a._tier !== b._tier) return a._tier - b._tier;
      if (b._rank !== a._rank) return b._rank - a._rank;
      const ea = a.estimate != null ? 0 : 1, eb = b.estimate != null ? 0 : 1;
      if (ea !== eb) return ea - eb;
      return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
    });
    return ranked.map(({ _cap, _rank, _tier, ...r }) => r);
  },
  // Whether a feed row's code names a listing. A code of digits alone was
  // dropped as unreadable, and with it most of Asia: Toyota 7203.TSE,
  // Samsung 005930.KO, TSMC 2330.TW, Tencent 0700.HK and 600519.SHG -- 796 of
  // 13,542 reports for 27.10-10.11. Those exchanges
  // number their listings, and so are read here. What stays out: no code,
  // a code with no ticker before the dot, digits alone where the exchange
  // uses letters (".US", or no exchange at all) and anything with spaces or
  // symbols a ticker does not carry.
  NUMERIC_CODE_EXCHANGES: ['TSE', 'KO', 'KQ', 'TW', 'TWO', 'HK', 'SHG', 'SHE', 'SR', 'KLSE', 'BSE'],
  isReadableTicker(code) {
    const s = String(code == null ? '' : code).trim().toUpperCase();
    // What a code is, is the shared reader's call: this
    // rule's own pattern kept "M&.NSE" and "AAPL..US". The caret is an index mark typed by people, not a report's code.
    if (!s || s.charAt(0) === '^' || !window.SymbolCode || !window.SymbolCode.of(s)) return false;
    const dot = s.lastIndexOf('.');
    const head = dot === -1 ? s : s.slice(0, dot);
    const ex = dot === -1 ? '' : s.slice(dot + 1);
    if (/[A-Z]/.test(head)) return true;
    return /^\d+$/.test(head) && !!ex && this.NUMERIC_CODE_EXCHANGES.includes(ex);
  },
  // An exchange's wall-clock time ("13:00" in America/New_York on a day) as
  // the viewer's, with the zone named: "EARLY CLOSE 13:00" sat unlabelled
  // beside economic events in local time ("18:00 GMT+1"), and in Madrid
  // read as 13:00 there. `viewerTz` is for tests; the browser's
  // zone otherwise. Without the exchange's zone: the time, called exchange
  // time.
  exchangeLocalTime(day, hhmm, exchangeTz, viewerTz) {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
    const t = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
    if (!t) return null;
    const exchangeTime = `${t[1].padStart(2, '0')}:${t[2]}`;
    const city = exchangeTz ? String(exchangeTz).split('/').pop().replace(/_/g, ' ') : '';
    const fallback = { label: `${exchangeTime} exchange time`, exchange: exchangeTime, city };
    if (!d || !exchangeTz) return fallback;
    try {
      const parts = (ms, tz) => {
        const o = {};
        new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
          .formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; });
        return o;
      };
      const wall = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
      // The zone's offset at that moment, found by reading the guess back;
      // twice, for a day the clocks change.
      let at = wall;
      for (let i = 0; i < 2; i++) {
        const p = parts(at, exchangeTz);
        const seen = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
        at += wall - seen;
      }
      const opts = { hourCycle: 'h23', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' };
      if (viewerTz) opts.timeZone = viewerTz;
      const fp = new Intl.DateTimeFormat('en-US', opts).formatToParts(new Date(at));
      const get = (k) => (fp.find((p) => p.type === k) || {}).value || '';
      const local = `${get('hour').padStart(2, '0')}:${get('minute')}`;
      const v = parts(at, viewerTz || undefined);
      const localDay = `${v.year}-${v.month}-${v.day}`;
      const dayNote = localDay !== d[0]
        ? ' ' + new Date(Date.UTC(+v.year, +v.month - 1, +v.day, 12)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
        : '';
      return { label: `${local} ${get('timeZoneName')}`.trim() + dayNote, exchange: exchangeTime, city };
    } catch (_) { return fallback; }
  },
};

// The 429 wait (window.RateLimitWait) is rateLimitWait.js, loaded before this file.

// What the calendar's feeds answered, kept across reloads until the end of
// the day. Every open used to cost sixteen requests -- a quarter of
// earnings, splits and IPOs, a week of dividend days, economic events and
// three exchanges' holidays -- and a reload the same sixteen again, so the
// free tier's twenty a day lasted one visit. The earnings
// quarter alone is 4 MB, past what localStorage holds, so this is
// IndexedDB; without it (private mode, a blocked store) every call simply
// misses and the view fetches as before.
window.CalendarStore = (() => {
  const DB = 'eodhd-calendar';
  const STORE = 'answers';
  let dbp = null;
  const open = () => {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined' || !indexedDB) return resolve(null);
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => { try { req.result.createObjectStore(STORE); } catch (_) { /* exists */ } };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (_) { resolve(null); }
    });
    return dbp;
  };
  const run = async (mode, fn) => {
    const db = await open();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req ? req.result : null);
        tx.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  };
  // Local midnight: the day the answer was for is over.
  const midnight = (now) => { const d = new Date(now); d.setHours(24, 0, 0, 0); return d.getTime(); };
  return {
    // A stored answer still in date, or null.
    async get(key) {
      const hit = await run('readonly', s => s.get(key));
      if (!hit || typeof hit !== 'object' || !(hit.expires > Date.now())) return null;
      return hit.value;
    },
    // Kept for maxAgeMs, and never past midnight.
    // `opts.pastMidnight`: kept for maxAgeMs, not cut at midnight -- the
    // exchanges' name lists change rarely and cost five requests.
    async set(key, value, maxAgeMs, opts) {
      const now = Date.now();
      const ttl = now + (maxAgeMs || 6 * 3600 * 1000);
      const expires = opts && opts.pastMidnight ? ttl : Math.min(ttl, midnight(now));
      await run('readwrite', (s) => {
        // Yesterday's answers go as today's arrive; nothing else prunes them.
        const all = s.openCursor();
        all.onsuccess = () => {
          const c = all.result;
          if (!c) return;
          if (!(c.value && c.value.expires > now)) c.delete();
          c.continue();
        };
        s.put({ value, expires }, key);
        return null;
      });
    },
    async clear() { await run('readwrite', s => s.clear()); },
  };
})();

// Events Calendar Component — Full-Featured Financial Events Tool
window.EventsCalendarView = ({ apiKey, watchlist = [], portfolio = [], onClose, onUpgradeClick, theme, activeTab, onTabChange, onSettingsClick, onSelectAsset, initialFilter, initialScope, initialView, onStateChange, embedded }) => {
  // The prices of this screen's AI actions, from the server's list.
  const useFeatureCost = (() => null);
  const briefingCost = useFeatureCost('week_briefing');
  const mattersCost = useFeatureCost('what_matters');
  // Everything the feeds returned for the period, whoever's symbols. The
  // scope (All / Portfolio / Watchlist) is a view of it, below: switching it
  // used to reload every feed, the list emptied and refilled and the
  // "Dividends cover ..." line blinked (Mini App Calendar).
  const [loadedEvents, setEvents] = React.useState([]);
  // After "Try again" the button leaves while the view loads, and focus fell
  // to <body>. When loading ends it goes back to a Try again that is there
  // again (still refused), else to the view's heading (the effect is with
  // the feeds' state, below).
  const retryFocusRef = React.useRef(false);
  const retryHeadingRef = React.useRef(null);
  // The month you paged to, and what you were looking at in it, belong in the
  // URL — a reload used to land you back on today with everything reset.
  //
  // Read once, before the first render, into the initial state. It was read
  // in an effect after the first render, so a shared link loaded the default
  // "All" view first -- fifteen requests -- and then the linked one.
  //
  // `filter` is the event type, `scope` whose symbols. The URL's scope was
  // checked against the event types and handed to setScope, so
  // `#?scope=splits` set a scope that matched no symbol and dropped every
  // split, and the chip itself was never written at all -- a reload lost it.
  // In any case: "?filter=Earnings" and "view=GRID" were dropped.
  const readUrlState = () => {
    let st = {};
    try { st = (window.ViewState && window.ViewState.read('calendar')) || {}; } catch (e) { st = {}; }
    const low = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
    const m = /^(\d{4})-(\d{2})$/.exec(low(st.month));
    const year = m ? Number(m[1]) : NaN;
    const month = m ? Number(m[2]) - 1 : NaN;
    return {
      view: low(st.view) === 'grid' || low(st.view) === 'feed' ? low(st.view) : null,
      filter: /^(all|earnings|dividends|splits|ipos|economic|holidays)$/.test(low(st.filter)) ? low(st.filter) : null,
      scope: /^(all|portfolio|watchlist)$/.test(low(st.scope)) ? low(st.scope) : null,
      // A month outside the feeds' reach is not a month anyone linked to.
      month: m && year >= 2000 && year <= 2100 && month >= 0 && month <= 11 ? new Date(year, month, 1) : null,
    };
  };
  const urlStateRef = React.useRef(null);
  if (urlStateRef.current === null) urlStateRef.current = readUrlState();
  const fromUrl = urlStateRef.current;
  const [view, setView] = React.useState(fromUrl.view || initialView || 'feed');
  const [filter, setFilter] = React.useState(fromUrl.filter || initialFilter || 'all');
  // Listen for external filter change from sidebar
  React.useEffect(() => {
    const handler = (e) => { if (e.detail) setFilter(e.detail); };
    window.addEventListener('calendar-filter', handler);
    return () => window.removeEventListener('calendar-filter', handler);
  }, []);
  const [scope, setScope] = React.useState(fromUrl.scope || initialScope || 'all');
  const [selectedMonth, setSelectedMonth] = React.useState(fromUrl.month || new Date());

  // A calendar link followed while the calendar is open, and Back / Forward
  // between two of its states, change only the hash: the view stays mounted
  // and read the address once, so "#/calendar?filter=earnings&view=grid"
  // typed over the open feed changed nothing (found driving by a
  // link). What the link leaves out is the default, as the view writes it.
  React.useEffect(() => {
    const onHash = () => {
      const VS = window.ViewState;
      if (!VS) return;
      // The terminal's address names the tab; a page that is the calendar
      // alone has none. The Mini App's hash is Telegram's, not a link.
      const parts = typeof VS.splitHash === 'function' ? VS.splitHash(window.location.hash || '') : { tab: '' };
      const terminal = window.APP_PLATFORM === 'WEB' || window.APP_PLATFORM === 'TELEGRAM';
      // "#/calendar-dividends" is the calendar at that feed:
      // typed over the open calendar it was ignored.
      // It sets the feed as the sidebar's entry does; the rest stays.
      const sub = /^calendar-([a-z]+)$/.exec(parts.tab || '');
      const routeFilter = sub && window.WebRoutes && window.WebRoutes.CALENDAR_FILTERS.indexOf(sub[1]) !== -1 ? sub[1] : null;
      if (routeFilter) { setFilter(routeFilter); return; }
      if (parts.tab !== 'calendar' && (terminal || parts.tab)) return;
      const st = readUrlState();
      setView(st.view || 'feed');
      setFilter(st.filter || 'all');
      setScope(st.scope || 'all');
      const month = st.month || new Date();
      setSelectedMonth((prev) => (prev.getFullYear() === month.getFullYear() && prev.getMonth() === month.getMonth() ? prev : month));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!window.ViewState) return;
    const now = new Date();
    const isThisMonth = selectedMonth.getFullYear() === now.getFullYear()
      && selectedMonth.getMonth() === now.getMonth();
    window.ViewState.merge({
      view: view === 'feed' ? '' : view,      // feed is the default
      filter: filter === 'all' ? '' : filter,
      scope: scope === 'all' ? '' : scope,
      // The current month is where the calendar opens anyway.
      month: isThisMonth ? '' : selectedMonth.getFullYear() + '-'
        + String(selectedMonth.getMonth() + 1).padStart(2, '0'),
    });
  }, [view, filter, scope, selectedMonth]);
  // How far the dividend strand reached. It is one request per weekday, so it
  // covers days where the other feeds cover a quarter, and nothing on screen
  // said so.
  const [divCoverage, setDivCoverage] = React.useState(null);
  const monthKey = React.useMemo(
    () => (view === 'grid' ? selectedMonth.getFullYear() + '-' + selectedMonth.getMonth() : 'feed'),
    [view, selectedMonth]
  );
  const [expandedEventId, setExpandedEventId] = React.useState(null);
  const [selectedDay, setSelectedDay] = React.useState(null);
  const [briefingLoading, setBriefingLoading] = React.useState(false);
  const [briefingResult, setBriefingResult] = React.useState(null);
  const [briefingError, setBriefingError] = React.useState(null);
  const [mattersLoading, setMattersLoading] = React.useState(false);
  const [mattersResult, setMattersResult] = React.useState(null);
  const [mattersError, setMattersError] = React.useState(null);

  const C3 = window.C3;
  const isDark = theme === 'dark';
  // Each event type's colour is a fill; as text on the light theme it fell
  // short of AA: the orange tickers 2.80:1, the amber EARNINGS badge 2.02:1
  // (of 494 texts). Text on light takes the same hue a
  // few steps darker (Tailwind 700s, 4.9:1 and up on white); the dark theme
  // and every fill keep the originals.
  const INK_LIGHT = {
    '#f59e0b': '#b45309', '#10b981': '#047857', '#8b5cf6': '#6d28d9',
    '#ec4899': '#be185d', '#3b82f6': '#1d4ed8', '#94a3b8': '#475569',
    '#f97316': '#c2410c', '#ef4444': '#b91c1c', '#a855f7': '#7e22ce',
  };
  const ink = (color) => (isDark ? color : (INK_LIGHT[String(color || '').toLowerCase()] || color));
  const isDemo = window.APP_PLATFORM === 'WEB' ? false : window.EODHD_API?.isDemo(apiKey);

  const COUNTRY_FLAGS = {
    US: '\u{1F1FA}\u{1F1F8}', USA: '\u{1F1FA}\u{1F1F8}',
    UK: '\u{1F1EC}\u{1F1E7}', GB: '\u{1F1EC}\u{1F1E7}',
    EU: '\u{1F1EA}\u{1F1FA}', EA: '\u{1F1EA}\u{1F1FA}',
    JP: '\u{1F1EF}\u{1F1F5}', CN: '\u{1F1E8}\u{1F1F3}',
    DE: '\u{1F1E9}\u{1F1EA}', FR: '\u{1F1EB}\u{1F1F7}',
    CA: '\u{1F1E8}\u{1F1E6}', AU: '\u{1F1E6}\u{1F1FA}',
    IN: '\u{1F1EE}\u{1F1F3}', KR: '\u{1F1F0}\u{1F1F7}',
    CH: '\u{1F1E8}\u{1F1ED}', BR: '\u{1F1E7}\u{1F1F7}',
    MX: '\u{1F1F2}\u{1F1FD}', NZ: '\u{1F1F3}\u{1F1FF}',
    SE: '\u{1F1F8}\u{1F1EA}', NO: '\u{1F1F3}\u{1F1F4}',
    IT: '\u{1F1EE}\u{1F1F9}', ES: '\u{1F1EA}\u{1F1F8}',
    HK: '\u{1F1ED}\u{1F1F0}', SG: '\u{1F1F8}\u{1F1EC}',
    ZA: '\u{1F1FF}\u{1F1E6}', RU: '\u{1F1F7}\u{1F1FA}',
  };

  const Icon = ({ name, size = 24, color = 'currentColor' }) => {
    return React.createElement('svg', { 'aria-hidden': true, focusable: 'false',
      width: size, height: size, viewBox: "0 0 24 24", fill: "none",
      stroke: color, strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round"
    }, React.createElement('path', { d: window.IconPaths[name] || "" }));
  };

  // Full CODE.EXCHANGE, ".US" only when there is no suffix. These used to be
  // cut to the bare code, so a watchlist holding VOD.LSE and SAP.XETRA asked
  // the earnings calendar for VOD and SAP and got VOD.US / SAP.US back — the
  // ADRs, not the holdings. The endpoints take the full form.
  const fullSym = (s) => (window.EODHD_API && window.EODHD_API.fullSymbol
    ? window.EODHD_API.fullSymbol(s)
    : (String(s || '').includes('.') ? String(s || '') : (s ? s + '.US' : '')));
  const sameSymbol = (a, b) => fullSym(a).toUpperCase() === fullSym(b).toUpperCase();

  const getSymbols = () => {
    const portfolioSymbols = portfolio.map(p => p.symbol && fullSym(p.symbol)).filter(Boolean);
    const watchlistSymbols = watchlist.map(w => fullSym((w && w.symbol) || w)).filter(Boolean);
    if (scope === 'portfolio') return portfolioSymbols;
    if (scope === 'watchlist') return watchlistSymbols;
    // scope 'all' → empty array = no filtering, show all available events
    return [];
  };
  const getOwnSymbols = () => [...new Set([
    ...portfolio.map(p => p.symbol && fullSym(p.symbol)),
    ...watchlist.map(w => fullSym((w && w.symbol) || w)),
  ].filter(Boolean))];

  // What is shown: the loaded events through the scope. Full-symbol match
  // (VOD.LSE in the watchlist is not VOD.US); an earnings row that stands for
  // several listings of one report matches any of them.
  const scopeSymbolsKey = getSymbols().join(',');
  const events = React.useMemo(() => {
    const symbols = scopeSymbolsKey ? scopeSymbolsKey.split(',') : [];
    let shown = loadedEvents;
    if (symbols.length > 0) {
      const symbolSet = new Set(symbols.map(s => fullSym(s).toUpperCase()));
      shown = loadedEvents.filter(e => symbolSet.has(fullSym(e.symbol || '').toUpperCase())
        || (e.raw && Array.isArray(e.raw.listings) && e.raw.listings.some(c => symbolSet.has(fullSym(c).toUpperCase()))));
    } else if (scope !== 'all') {
      shown = [];
    }
    // Demo mode: limit each event type to 5 items
    if (isDemo) {
      const typeCounts = {};
      shown = shown.filter(ev => {
        typeCounts[ev.type] = (typeCounts[ev.type] || 0) + 1;
        return typeCounts[ev.type] <= 5;
      });
    }
    return shown;
  }, [loadedEvents, scopeSymbolsKey, scope, isDemo]);

  // An economic-event timestamp ("YYYY-MM-DD HH:MM:SS", UTC) as the viewer's
  // local date and "HH:MM <zone>". Date-only input stays as it is.
  const localEventTime = (raw) => {
    const s = String(raw || '');
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
    if (!m) return { dateStr: s.split(' ')[0] || '', timeStr: '' };
    if (m[4] == null) return { dateStr: `${m[1]}-${m[2]}-${m[3]}`, timeStr: '' };
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    let timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    try {
      const tz = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(d)
        .find((p) => p.type === 'timeZoneName');
      if (tz && tz.value) timeStr += ' ' + tz.value;
    } catch (_) { /* the time alone is still local */ }
    return { dateStr, timeStr };
  };

  // Currency for a calendar row: the row's own. Unknown stays unknown: a
  // bare number beats a wrong "$". The listing's currency used
  // to stand in when the feed sent none, and a secondary listing is exactly
  // where it sends none: Costco's 0I47.LSE read "EPS Est: £6.52" and CTO.F
  // "€6.52" for a dollar estimate.
  //
  // A US listing with no currency in the feed is in dollars, though: only
  // APOG of 6 Oct carried "USD", so it alone read "$0.59" beside bare 0.59s.
  // Other exchanges stay unguessed, for the reason above.
  const rowCcy = window.CalendarFormat.rowCurrency;
  const money = (v, ccy, decimals = 2) => (window.Money
    ? window.Money.format(v, ccy, { decimals })
    : (v == null || isNaN(v) ? 'N/A' : Number(v).toFixed(decimals)));

  const displaySymbol = window.CalendarFormat.displaySymbol;

  // A code that names a listing, numbered ones included (CalendarFormat).
  const isReadableTicker = (code) => window.CalendarFormat.isReadableTicker(code);

  // Request-id latch. Each invocation of loadEvents bumps the id; only the
  // latest run is allowed to commit setEvents/setLoading. Without this, the
  // initial filter='all' load (6 endpoints, slow) could finish AFTER a quick
  // chip click to filter='holidays' and overwrite the user's selection — the
  // visible "Holidays shows briefly then reverts to All" symptom.
  const reqIdRef = React.useRef(0);

  // What each feed answered, by the window it was asked for. Switching Feed
  // to Grid refetched everything (11 requests) and every month step another
  // 13, against a free tier of 20 a day. A
  // window already covered by an earlier answer is now read from it: the
  // feed's quarter covers the next two months of the grid, and a dividend
  // day is asked for once. Kept for the life of the view; a new key starts
  // over.
  const feedCacheRef = React.useRef({});
  const divDayCacheRef = React.useRef({});
  // Answers also outlive the view: window.CalendarStore keeps them until
  // midnight, so a reload or a second visit costs nothing. Filed
  // under a hash of the key, never the key itself, so one key's answers are
  // not read under another's and the key is not written to the browser.
  const keyTag = React.useMemo(() => {
    let h = 0x811c9dc5;
    const s = String(apiKey || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  }, [apiKey]);
  const store = window.CalendarStore;
  const cachedRange = async (key, f, t, fetcher, maxAgeMs) => {
    const list = feedCacheRef.current[key] || [];
    const hit = list.find(c => c.from <= f && c.to >= t);
    if (hit) return hit.items;
    const storeKey = `${keyTag}|${key}|${f}|${t}`;
    let items = store ? await store.get(storeKey) : null;
    const fresh = !Array.isArray(items);
    if (fresh) items = await fetcher();
    // Only an answer of the right shape is kept: a refusal is asked again.
    if (Array.isArray(items)) {
      feedCacheRef.current[key] = [{ from: f, to: t, items }, ...list].slice(0, 6);
      if (fresh && store) store.set(storeKey, items, maxAgeMs);
    }
    return items;
  };
  // Market caps, to put a day's biggest reports first
  // (CalendarFormat.collapseListings). The thousand largest US listings ended
  // at $31.6bn -- the list carries ETFs, OTC receipts and preferred lines --
  // so APOG ($0.7bn), LW, NEOG and PENG still came before STZ ($19bn) and
  // RPM ($12bn) on 6 Oct. Now the US listings above
  // $100m by bands of cap (up to a thousand rows a band) and a page per major
  // exchange, primary listings only, in dollars
  // (CalendarFormat.capsFromScreener), kept until midnight. The first goes
  // alone -- a plan without the screener refuses it, and the others are not
  // sent. The list orders a day's reports; the events never wait for it.
  const capsRef = React.useRef(null);
  const CAP_PAGE = 500;
  // The world list gave a cap to 17 non-US companies, half of them receipts
  // and funds, and SHEL.LSE sat 512th of its day. One page
  // per major exchange instead -- the ones the screener answers for (MI, MC
  // and HK come back empty). London's page is mostly order-book lines of
  // foreign shares (0R2V = Apple, 471 of its 500) and misses Shell itself:
  // it is asked for their names, which join those lines to their company;
  // London's own companies get a cap through Amsterdam, Stockholm or the US
  // where they list there. Requests a day: 5-10 US + 9 here = 14-19 screener
  // calls (≈ 70-95 API call units, the screener costing 5), kept until midnight; a
  // plan without the screener sends one and stops.
  // NSE: most of a day's reports are Indian (557 on 5 Oct), and without their
  // caps a C$1.7bn Toronto holding company headed the day.
  const CAP_EXCHANGES = ['LSE', 'XETRA', 'PA', 'AS', 'SW', 'TO', 'ST', 'CO', 'NSE'];
  // The US list by bands of cap, asked side by side. Each page used to start
  // below the last cap of the one before, so the six went one after another
  // and a slow screener (3 s a request) kept the first load waiting 30 s.
  // A band is under the screener's thousand rows a query, so
  // its second page (offset 500) is still answered; it is asked only when
  // the first came back full.
  const US_BANDS = [[1e11, null], [3e10, 1e11], [1e10, 3e10], [4e9, 1e10], [1e8, 4e9]];
  // One asking at a time: a feed's Try again while the first is out joins it.
  const capsAskRef = React.useRef(null);
  const loadCaps = () => {
    if (capsRef.current) return Promise.resolve(capsRef.current);
    if (!capsAskRef.current) capsAskRef.current = askCaps().finally(() => { capsAskRef.current = null; });
    return capsAskRef.current;
  };
  const askCaps = async () => {
    if (window.Entitlement && window.Entitlement.get && window.Entitlement.get('screener').allowed === false) return null;
    const storeKey = `${keyTag}|caps4`;
    let caps = store ? await store.get(storeKey) : null;
    if (!caps || !caps.caps) {
      caps = null;
      const API = window.EODHD_API;
      const page = async (filters, offset) => {
        const params = { filters: JSON.stringify(filters), sort: 'market_capitalization.desc', limit: CAP_PAGE, offset };
        try {
          const body = API.needsProxy && API.needsProxy(apiKey)
            ? await API._proxyFetch('screener', params)
            : await API._directFetch('screener', apiKey, params);
          const rows = Array.isArray(body) ? body : (body && Array.isArray(body.data) ? body.data : null);
          return rows;
        } catch (_) { return null; }
      };
      // The screener answers 422 past roughly the thousandth row of one
      // query, so offsets 1000 and on were refused and the list stopped at
      // page one (found taking the README screenshot). "> low - 1"
      // keeps a cap exactly on a boundary; capsFromScreener dedupes by code.
      const band = ([lo, hi]) => [['market_capitalization', '>', lo - 1]]
        .concat(hi ? [['market_capitalization', '<', hi]] : [])
        .concat([['exchange', '=', 'us']]);
      const bandPages = async (b, firstPage) => {
        const one = firstPage || await page(band(b), 0);
        if (!Array.isArray(one) || !one.length) return [];
        if (one.length < CAP_PAGE) return [one];
        const two = await page(band(b), CAP_PAGE);
        return Array.isArray(two) && two.length ? [one, two] : [one];
      };
      // The largest band goes first and alone: a plan without the screener
      // refuses it, and the others are not sent.
      const first = API && (API._proxyFetch || API._directFetch) ? await page(band(US_BANDS[0]), 0) : null;
      if (Array.isArray(first) && first.length) {
        const all = await Promise.all([
          bandPages(US_BANDS[0], first),
          ...US_BANDS.slice(1).map(b => bandPages(b)),
          ...CAP_EXCHANGES.map(ex => page([['exchange', '=', ex]], 0).then(p => (Array.isArray(p) ? [p] : []))),
        ]);
        caps = window.CalendarFormat.capsFromScreener([].concat(...all));
        if (store && Object.keys(caps.caps).length) store.set(storeKey, caps, 24 * 3600 * 1000);
      }
    }
    capsRef.current = caps || null;
    return capsRef.current;
  };
  // Company names per listing, from the exchanges' own symbol lists: the
  // evidence that joins a nameless mirror to its company. The
  // screener names only the 3,000 largest US companies and a page per
  // exchange, so FFIV and Frankfurt's FFV, WFG.US and WFG.TO, AZN.US and
  // AZN.LSE stayed separate rows. One source spells a company one way
  // ("F5 Networks Inc" on both lines). Five requests a week (US common stock,
  // Frankfurt for every German venue, London, Toronto, Stockholm; ≈ 6 MB),
  // kept in IndexedDB; without them merging works as before.
  const namesRef = React.useRef(null);
  // The names lists failed and were asked again, NAMES_RETRY_MS, to no avail:
  // the listings they would place are not shown, and the list says so.
  const [namesProblem, setNamesProblem] = React.useState(false);
  // A retry of the names waits seconds; not after the view is gone.
  const viewAliveRef = React.useRef(true);
  React.useEffect(() => () => { viewAliveRef.current = false; }, []);
  const NAME_EXCHANGES = [['US', { type: 'common_stock' }], ['F'], ['LSE'], ['TO'], ['ST']];
  const namesAskRef = React.useRef(null);
  const loadListingNames = () => {
    if (namesRef.current) return Promise.resolve(namesRef.current);
    if (!namesAskRef.current) namesAskRef.current = askListingNames().finally(() => { namesAskRef.current = null; });
    return namesAskRef.current;
  };
  const askListingNames = async () => {
    const storeKey = `${keyTag}|names1`;
    let names = store ? await store.get(storeKey) : null;
    if (!names || typeof names !== 'object') {
      const API = window.EODHD_API;
      const list = async (ex, extra) => {
        const params = { fmt: 'json', ...(extra || {}) };
        try {
          const body = API.needsProxy && API.needsProxy(apiKey) && API._genericProxyFetch
            ? await API._genericProxyFetch(`exchange-symbol-list/${ex}`, params)
            : await API._directFetch(`exchange-symbol-list/${ex}`, apiKey, params);
          return Array.isArray(body) ? body : null;
        } catch (_) { return null; }
      };
      const lists = API && (API._genericProxyFetch || API._directFetch)
        ? await Promise.all(NAME_EXCHANGES.map(([ex, extra]) => list(ex, extra))) : [];
      names = {};
      lists.forEach((rows, i) => {
        const ex = NAME_EXCHANGES[i][0];
        (rows || []).forEach((r) => { if (r && r.Code && r.Name) names[`${String(r.Code).toUpperCase()}.${ex}`] = String(r.Name); });
      });
      // Kept for the week only when every list answered, and for this view
      // only when some did: a refused list (a 429 with the feeds) was kept as
      // "no names" and the day stayed unfolded until the view was opened again.
      const answered = lists.filter(Array.isArray).length;
      if (store && answered === NAME_EXCHANGES.length && Object.keys(names).length) store.set(storeKey, names, 7 * 24 * 3600 * 1000, { pastMidnight: true });
      if (!answered) names = null;
    }
    namesRef.current = names;
    return names;
  };
  // Each feed's state for the load on screen: 'loading', 'ok' or 'failed'
  // (with the dividend days that did not answer). One feed hung or refused
  // was a nameless "EODHD did not answer", with a Try again only when the
  // whole list was empty. Each is named now, with its
  // own Try again, and the list shows whatever did load.
  const FEED_ORDER = ['earnings', 'dividends', 'splits', 'economic', 'holidays', 'ipos'];
  const FEED_NAMES = { earnings: 'Earnings', dividends: 'Dividends', splits: 'Splits', economic: 'Economic events', holidays: 'Market holidays', ipos: 'IPOs' };
  const feedsFor = (f) => FEED_ORDER.filter(x => f === 'all' || f === x);
  const [feedStatus, setFeedStatus] = React.useState(() => Object.fromEntries(feedsFor(filter).map(f => [f, { state: 'loading' }])));
  // Each feed's events for the load on screen, and which asking of the feed
  // may still put them there (a Try again of one feed starts a new one).
  const feedListsRef = React.useRef({});
  const feedGenRef = React.useRef({});
  // A dividend's detail fetched when its row was opened, by `${symbol}_${date}`,
  // and the rows already asked: a rebuild of the day (the late market caps,
  // another feed coming in) drew the row again from the feed alone, its
  // amount read N/A, and opening it once more spent another request.
  const divDetailRef = React.useRef({});
  const divAskedRef = React.useRef(new Set());
  const pendingFeeds = FEED_ORDER.filter(f => feedStatus[f] && feedStatus[f].state === 'loading');
  const failedFeeds = FEED_ORDER.filter(f => feedStatus[f] && feedStatus[f].state === 'failed');
  // A refusal or a failure, not an empty calendar: 'all' when every
  // feed asked for came back without an answer.
  const loadFailed = failedFeeds.length === 0 ? false
    : failedFeeds.length === FEED_ORDER.filter(f => feedStatus[f]).length ? 'all' : 'some';
  // The list waits only for the first feed with something in it. A hung
  // auxiliary request -- market caps, company names, an exchange's hours --
  // held "Loading events..." for 26-33 s over events that had arrived;
  // what is still out is named under the list instead.
  const loading = pendingFeeds.length > 0 && events.length === 0;
  React.useEffect(() => {
    if (pendingFeeds.length > 0 || !retryFocusRef.current) return;
    retryFocusRef.current = false;
    setTimeout(() => {
      const a = document.activeElement;
      if (a && a !== document.body && document.contains(a)) return;
      const back = document.querySelector('[data-retry-focus]');
      const target = back || retryHeadingRef.current;
      if (target) target.focus();
    }, 0);
  }, [loading, pendingFeeds.length]);
  // A 429 asks for a minute (RateLimitWait): Try again waits it out, with
  // the seconds on the button, instead of sending nine requests that are
  // refused the same way.
  // A press inside it says why nothing was sent (RateLimitWait.useWait, the
  // same on every screen).
  const rlWait = window.RateLimitWait.useWait();
  const waitLeft = rlWait.left;

  // `only`: the feeds a Try again asks for again; the others keep what they
  // have. Without it, everything the filter shows, from the start.
  const loadEvents = async (only) => {
    const reqId = only ? reqIdRef.current : ++reqIdRef.current;
    const wanted = feedsFor(filter).filter(f => !only || only.includes(f));
    if (!wanted.length) return;
    const gen = {};
    wanted.forEach((f) => { gen[f] = feedGenRef.current[f] = (feedGenRef.current[f] || 0) + 1; });
    if (!only) { feedListsRef.current = {}; setEvents([]); }
    setFeedStatus(prev => ({ ...(only ? prev : {}), ...Object.fromEntries(wanted.map(f => [f, { state: 'loading' }])) }));
    const live = (f) => reqId === reqIdRef.current && feedGenRef.current[f] === gen[f];
    // A feed is on screen as soon as it is in. The feeds are joined in this
    // order and the sort keeps it, so a day still lists earnings first.
    const show = (f, list) => {
      if (!live(f)) return;
      feedListsRef.current[f] = list;
      const all = [].concat(...FEED_ORDER.map(x => feedListsRef.current[x] || []));
      all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      setEvents(all);
    };
    const settled = new Set();
    const settle = (f, answer) => {
      settled.add(f);
      if (!live(f)) return;
      const ok = answer === true || (answer && answer.ok);
      setFeedStatus(prev => ({ ...prev, [f]: { state: ok ? 'ok' : 'failed', ...(answer && typeof answer === 'object' ? answer : {}) } }));
    };
    // Each feed's task fills its own list and returns whether it answered.
    // A feed that did not keeps what it was (`fail`, RateLimitWait.failure)
    // from the moment it failed: the line under the list said "did not
    // answer" for an HTML page served with 200, and turned from "the limit"
    // into "did not answer" on the second the wait ended. A body that is not the feed's list could not be read.
    const RLW = window.RateLimitWait;
    const run = (f, body) => (async () => {
      const out = [];
      let answer = false;
      try { answer = await body(out); } catch (e) { answer = feedFail(f, e); }
      if (answer === false) answer = { ok: false, fail: RLW.failure(null) };
      show(f, out);
      settle(f, answer);
    })();
    const feedFail = (f, e) => {
      // Said on the page with its reason; an error the client did not name
      // is a bug, and logged as one.
      if (e && (e.unreadable || e.rateLimited || e.status || e.upstreamStatus)) console.warn(`${FEED_NAMES[f]} did not load:`, e.message);
      else console.error(`${FEED_NAMES[f]} load error:`, e);
      return { ok: false, fail: RLW.failure(e) };
    };
    // A feed's body, unwrapped: its list, null when nothing came back, and a
    // throw for a body of another shape ({"message": ...} with 200).
    const listOf = (data, field) => {
      if (data == null) return null;
      const list = field ? (data && data[field]) : data;
      if (Array.isArray(list)) return list;
      throw RLW.unreadableError('Unreadable response (' + (field || 'list') + ')', 200);
    };
    const asking = { throwErrors: true };
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const shift = (d, days) => { const x = new Date(d); x.setDate(x.getDate() + days); return x; };
    // Two windows. The feed: a week back and a quarter ahead of today. The
    // grid: the month on screen, its first day to its last, for every feed.
    // The grid used to anchor on the 15th with each feed's own offsets, so
    // earnings, splits and IPOs started on the 8th, economic events stopped
    // on the 22nd and dividends covered the 12th to the 22nd -- empty cells
    // that the feed view showed full. Local
    // dates, not toISOString(): east of UTC that moved each bound a day back.
    const now = new Date();
    const isGrid = view === 'grid' && !!selectedMonth;
    const monthStart = isGrid ? new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1) : null;
    const monthEnd = isGrid ? new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0) : null;
    const from = isGrid ? ymd(monthStart) : ymd(shift(now, -7));
    const to = isGrid ? ymd(monthEnd) : ymd(shift(now, 90));
    const inRange = (d) => { const x = String(d || '').slice(0, 10); return x >= from && x <= to; };
    // Fetched for everybody's view (scope 'all'); the scope filters what is
    // shown, without a reload. Dividend amounts are prefetched for the
    // person's own symbols, portfolio and watchlist both, whichever is shown.
    const symbols = [];
    const ownSymbols = getOwnSymbols();
    // The feeds load side by side. One after another, each waiting out its
    // own 25 s timeout, a hung upstream kept "Loading events..." spinning for
    // almost three minutes under a panel that had already said EODHD did not
    // answer.
    const tasks = [];

    // One company, one row, in every feed that lists companies: earnings,
    // splits and dividends. PCU.DU, PCU.F and PCU.STU stood beside SCCO on
    // Splits, Dividends and All; only earnings folded second listings.
    // The earnings rule, shared: the market
    // caps and the exchanges' names go out with the first such feed, once a
    // load; until the names are in no likely second listing is drawn
    // (withoutLikelyTwins), so a day's count does not move when they come;
    // names that failed are asked again after NAMES_RETRY_MS, once for every
    // feed, and when the last try fails too the list says what is left out.
    // Not for a plan already known to refuse the calendar: nothing would be
    // shown from them.
    const calendarRefused = window.Entitlement && window.Entitlement.get && window.Entitlement.get('calendar').allowed === false;
    let aux = null;
    const askAux = () => aux || (aux = {
      caps: loadCaps().then(() => true, () => true),
      names: loadListingNames().then(() => true, () => true),
    });
    // The feeds waiting for the names; the retries stop when none of them is
    // the one on screen any more (a Try again of a feed starts its own).
    const namesWanted = new Set();
    let namesWait = null;
    const waitForNames = () => {
      if (namesWait) return namesWait;
      const waits = window.CalendarFormat.NAMES_RETRY_MS || [];
      let tries = 0;
      const wanted = () => viewAliveRef.current && [...namesWanted].some(f => live(f));
      namesWait = new Promise((resolve) => {
        const namesSettled = () => {
          if (!wanted()) { resolve(null); return; }
          if (namesRef.current) { resolve(true); return; }
          if (tries >= waits.length) { resolve(false); return; }
          // A 429's own wait when it is longer.
          const until = window.RateLimitWait && window.RateLimitWait.until ? window.RateLimitWait.until() : 0;
          const ms = Math.max(waits[tries++], until ? until - Date.now() + 250 : 0);
          setTimeout(() => {
            if (!wanted()) { resolve(null); return; }
            loadListingNames().then(namesSettled, namesSettled);
          }, ms);
        };
        askAux().names.then(namesSettled);
      });
      return namesWait;
    };
    // A feed's rows as one row per company (CalendarFormat.collapseListings),
    // drawn now with whatever caps and names are in, and again when the rest
    // come. `rows`: the feed's readable rows, each with its `code` and its
    // day in `date`; `toEvents`: rows -> the feed's events (each row carries
    // its other `listings`). `out` is what the task shows when it returns:
    // one that comes in before that is not drawn over by the earlier list.
    // `ownRows` (splits, dividends): the person's own listings, each its own
    // line with its own figures, drawn first and never folded into another
    // listing's row -- holding PCU.F, Portfolio showed SCCO.US's row for it
    // and opening it fetched SCCO.US's dollar dividend. Earnings folds them, as accepted.
    const collapseInto = (f, out, rows, toEvents, ownRows) => {
      const own = ownRows && ownRows.length ? ownRows : null;
      // Nothing of anybody else's to fold (splits, dividends): the own lines.
      if (ownRows && !rows.length) { if (own) out.push(...toEvents(own)); return; }
      const a = askAux();
      const settled = { caps: !!capsRef.current };
      a.caps.then(() => { settled.caps = true; });
      // Once a load, by its first such feed: a later feed of the same load
      // cleared a line the names' last try had just put up, and it was put
      // up -- and announced -- again a moment later.
      if (live(f) && !namesWait) setNamesProblem(false);
      const collapse = () => {
        const capsNow = capsRef.current;
        // The exchanges' symbol lists win over the screener's, so both lines
        // of a pair are spelled by the same source.
        const mergedNames = { ...((capsNow && capsNow.names) || {}), ...(namesRef.current || {}) };
        const grouped = window.CalendarFormat.collapseListings(rows, capsNow, mergedNames);
        // Until the names are in, no likely second listing. The screener's
        // names, with the caps, are the only ones for Paris, Amsterdam and
        // the other home exchanges.
        const folded = toEvents(settled.caps && namesRef.current ? grouped : window.CalendarFormat.withoutLikelyTwins(grouped, capsNow));
        return own ? toEvents(own).concat(folded) : folded;
      };
      out.push(...collapse());
      const again = () => { const next = collapse(); out.length = 0; out.push(...next); show(f, next); };
      // Each on its own: a hung names list does not hold the caps back.
      if (!settled.caps) a.caps.then(again);
      if (!namesRef.current) {
        namesWanted.add(f);
        waitForNames().then((got) => {
          if (got === null || !viewAliveRef.current || !live(f)) return;
          if (got) again(); else setNamesProblem(RLW.failure(null));
        });
      }
    };

    try {
      // Load earnings. Earnings season days (Mon-Fri after a quarter end)
      // can have 300+ companies reporting; the prior code took the first
      // 200 globally, which meant a single fat day swallowed the entire
      // budget and dates after it disappeared.
      //
      // Strategy: fetch a wider window, then distribute the cap across
      // days — keep up to N per date, cap total at 250. This gives an
      // even spread across the visible month instead of a single wall
      // of tickers on the busiest day.
      if (wanted.includes('earnings')) tasks.push(run('earnings', async (out) => {
        // Market caps and company names go out with the feed, not after it.
        // Asked once the feed had answered, they came 2-3 s behind it and the
        // day was drawn three times: 557 rows with ~200 second listings, then
        // 432, then 431 in another order. The feed is
        // the slowest of the three (4 MB), so they are usually in when it
        // lands and the day is drawn once. Not for a plan already known to
        // refuse the calendar: nothing would be shown from them.
        if (!(symbols.length > 0 || calendarRefused)) askAux();
        // The feed's window was +45 once (cut off mid-June for a May
        // query); +90 catches the full next quarter. EODHD returns
        // whatever it has within the range; days without scheduled
        // earnings just stay empty.
        const earningsParams = { from, to };
        if (symbols.length > 0) earningsParams.symbols = symbols.join(',');
        const list = await cachedRange('earnings|' + (earningsParams.symbols || ''), from, to, async () => {
          return listOf(await window.EODHD_API.getCalendarEarnings(apiKey, earningsParams, asking), 'earnings');
        });
        if (!Array.isArray(list)) return false;
        const readable = list.filter(e => isReadableTicker(e.code) && inRange(e.report_date || e.date));
        const toEvents = (items) => items.map((item) => {
          const { estimate, actual, difference, percent } = window.CalendarFormat.earningsNumbers(item);
          let beatMiss = null;
          if (estimate != null && actual != null) {
            beatMiss = actual >= estimate ? 'beat' : 'miss';
          }
          return {
            type: 'earnings',
            date: item.report_date || item.date,
            symbol: item.code,
            title: `${item.code} Earnings`,
            icon: 'activity',
            color: '#f59e0b',
            raw: {
              estimate, actual,
              difference, percent,
              before_after_market: item.before_after_market,
              report_date: item.report_date,
              period_end: item.date,
              currency: item.currency,
              // The same report's other listings (SGE.F, SGE.HA ...).
              listings: Array.isArray(item.listings) ? item.listings.filter(c => c !== item.code) : [],
            },
            beatMiss,
            time: item.before_after_market === 'BeforeMarket' ? 'Pre-Market' : item.before_after_market === 'AfterMarket' ? 'After-Hours' : '',
          };
        });
        if (symbols.length > 0) {
          out.push(...toEvents(readable));
          return true;
        }
        // One row per company, the largest first, and every company
        // kept. This used to keep the first twenty rows a day in the
        // feed's order, after dropping every row without an estimate:
        // a day read as eight listings of Société Générale, AAPL was
        // not on it, and JPM's whole 14 January was gone. The
        // feed shows twenty a day with "Show all N" for the rest.
        // The caps settle when they answer or fail; the names only when they
        // are in. A names list that failed kept nothing back: the day was
        // drawn again from every listing, APC.XETRA a company of its own
        // beside AAPL. It is asked again instead
        // (collapseInto, shared with splits and dividends). The plan was
        // thought to refuse the calendar, and the feed answered: asked now.
        // The events go up with whatever caps and names are already in;
        // the rest re-order and join them when they come (#15 above).
        collapseInto('earnings', out, readable, toEvents);
        return true;
      }));

      // Load dividends — new API uses filter[date_eq] per day + /div/SYMBOL for details
      if (wanted.includes('dividends')) tasks.push(run('dividends', async (out) => {
        let divResult = false;
        // The names and caps go out with the feed, as for earnings (one row
        // per company).
        if (!(symbols.length > 0 || calendarRefused)) askAux();
        try {
          // Strategy: query each day for ex-date symbols, then fetch details per symbol
          // calendar/dividends has no range filter -- it answers 422
          // "filter.date_eq is required" to from/to and every spelling of a
          // range -- so this feed costs one request per weekday whatever we
          // do. A month was 24 requests before a single event rendered; the
          // free tier is twenty a day. So: a week when dividends are one strand
          // among five on the "All" view, two weeks when somebody has asked
          // for dividends in particular. Measured on the All view in the
          // browser: sixteen requests for the whole page, down from sixty-one,
          // nine of them these day queries (three days back, seven ahead).
          //
          // The feed: three days back, a week (two for the Dividends filter)
          // ahead. The grid: those same days where they fall in the month on
          // screen -- the feed already asked for them -- and with the
          // Dividends filter two weeks of the month (from three days back in
          // the current one). The rest of a month would be a request per
          // weekday; the note under the filters names the days covered.
          const span = filter === 'dividends' && !isDemo ? 14 : 7;
          let divFrom;
          let divTo;
          if (!isGrid) {
            divFrom = shift(now, -3);
            divTo = shift(now, span);
          } else if (filter === 'dividends') {
            const inMonth = now >= monthStart && now <= shift(monthEnd, 1);
            divFrom = inMonth && shift(now, -3) > monthStart ? shift(now, -3) : monthStart;
            divTo = shift(divFrom, span);
            if (divTo > monthEnd) divTo = monthEnd;
          } else {
            divFrom = shift(now, -3) > monthStart ? shift(now, -3) : monthStart;
            divTo = shift(now, 7) < monthEnd ? shift(now, 7) : monthEnd;
          }
          const divCovered = ymd(divFrom) <= ymd(divTo);
          // Said once the days have answered, and only of those: it was set
          // before the requests, and a day refused (500, a dropped
          // connection) vanished under "Dividends cover 24 Oct – 10 Nov".
          if (!divCovered && live('dividends')) setDivCoverage({ none: true, grid: isGrid });

          // Build array of dates (only weekdays). Entirely in UTC: the day of
          // the week and the date string have to come from the same clock.
          // Mixing a local getDay() with a UTC toISOString() asked for a Sunday
          // at UTC+14 and shifted every event a day early at UTC-11
          const datesToQuery = [];
          const utcDay = (d) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
          for (let d = utcDay(divFrom), end = utcDay(divTo); divCovered && d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
            const dow = d.getUTCDay();
            if (dow !== 0 && dow !== 6) datesToQuery.push(d.toISOString().split('T')[0]);
          }

          // Fetch all days in parallel (batches of 5 to avoid overwhelming)
          // Still one request per day: measured 2026-10-02, the dividend
          // calendar answers 422 "filter.date eq field is required" to
          // filter[date_from]/[date_to], [date_gte]/[date_lte] and from/to
          // alike -- a range is only accepted together with one symbol. So
          // each day is kept until midnight (CalendarStore) and asked once.
          const divSymbolsByDate = {};
          let divAnswered = 0;
          const divMissed = [];
          // What the first day that failed was (RateLimitWait.failure).
          let divFail = null;
          for (let i = 0; i < datesToQuery.length; i += 5) {
            // Once the plan has refused this feed there is nothing to gain from
            // the remaining days; they would all come back 403.
            if (i > 0 && window.Entitlement && window.Entitlement.get('dividends').allowed === false) break;
            const batch = datesToQuery.slice(i, i + 5);
            const results = await Promise.all(batch.map(async (dateStr) => {
              if (divDayCacheRef.current[dateStr]) { divAnswered++; return divDayCacheRef.current[dateStr]; }
              const storeKey = `${keyTag}|div|${dateStr}`;
              const kept = store ? await store.get(storeKey) : null;
              if (Array.isArray(kept)) { divDayCacheRef.current[dateStr] = kept; divAnswered++; return kept; }
              try {
                const data = listOf(await window.EODHD_API.getCalendarDividends(apiKey, { 'filter[date_eq]': dateStr }, asking), 'data');
                if (!data) return null;
                const rows = data.filter(d => isReadableTicker(d.symbol)).map(d => ({ date: d.date, symbol: d.symbol }));
                divDayCacheRef.current[dateStr] = rows;
                if (store) store.set(storeKey, rows);
                divAnswered++;
                return rows;
              } catch (e) { divFail = divFail || e; return null; }
            }));
            results.forEach((x, k) => { if (!Array.isArray(x)) divMissed.push(batch[k]); });
            results.filter(Array.isArray).flat().forEach(d => {
              if (!divSymbolsByDate[d.date]) divSymbolsByDate[d.date] = [];
              divSymbolsByDate[d.date].push(d.symbol);
            });
            // Not one day of the first batch answered: the feed is down or
            // hung, and the next batches would each wait out the same timeout.
            if (divAnswered === 0 && results.every(x => x === null)) break;
          }
          // Days the loop stopped before (a refusal, a first batch that all
          // failed) were not read either.
          const asked = new Set(divMissed.concat(Object.keys(divDayCacheRef.current)));
          datesToQuery.forEach((d) => { if (!asked.has(d)) divMissed.push(d); });
          divMissed.sort();
          // "Dividends cover 29 Sep – 9 Oct" under a refusal promised days
          // nothing was read for.
          if (divCovered && live('dividends')) {
            setDivCoverage(datesToQuery.length > 0 && divAnswered === 0 ? null
              : { from: ymd(divFrom), to: ymd(divTo), grid: isGrid, missed: divMissed });
          }
          divResult = divMissed.length ? { ok: false, days: divMissed, fail: divFail ? feedFail('dividends', divFail).fail : RLW.failure(null) } : true;

          // If user has symbols, fetch detailed /div/SYMBOL data for matching ones
          const detailCache = {};
          const allDivSymbols = [...new Set(Object.values(divSymbolsByDate).flat())];
          // For portfolio/watchlist, fetch details for matching; otherwise top US symbols
          // Details are fetched for the user's own symbols and for nothing
          // else. This used to fall back to "the first forty US names" -- thirty
          // requests to put an amount on thirty arbitrary rows out of the two
          // hundred-odd a day carries, leaving the rest blank. The list read as
          // inconsistent, and cost more than every other feed combined. A row
          // without an amount fetches its own when it is opened (see
          // toggleExpand), which is one request per thing somebody wanted.
          const symbolsToDetail = ownSymbols.length > 0
            ? allDivSymbols.filter(s => ownSymbols.some(us => sameSymbol(s, us)))
            : [];

          if (symbolsToDetail.length > 0) {
            const detailResults = await Promise.all(symbolsToDetail.slice(0, 30).map(async (sym) => {
              try {
                const json = await window.EODHD_API.getDividendHistory(apiKey, sym, ymd(divFrom));
                if (Array.isArray(json)) {
                  json.forEach(d => { detailCache[`${sym}_${d.date}`] = d; });
                }
              } catch {}
            }));
          }

          // Build dividend events
          const divRows = [];
          Object.entries(divSymbolsByDate).forEach(([dateStr, syms]) => {
            // When user has symbols, only show matching; otherwise show all
            const filteredSyms = symbols.length > 0
              ? syms.filter(s => symbols.some(us => sameSymbol(s, us)))
              : syms;
            filteredSyms.forEach(sym => divRows.push({ code: sym, date: dateStr }));
          });
          const toDivEvents = (rows) => rows.map((row) => {
            const sym = row.code;
            const dateStr = row.date;
            // Fetched with the feed (the person's own), or when the row was opened.
            const detail = detailCache[`${sym}_${dateStr}`] || divDetailRef.current[`${sym}_${dateStr}`];
            const code = displaySymbol(sym);
            return {
              type: 'dividends',
              date: dateStr,
              symbol: sym,
              title: `${code} Dividend`,
              icon: 'dollar',
              color: '#10b981',
              raw: {
                dividend: detail?.value != null ? parseFloat(detail.value) : null,
                // Unknown until the row's detail loads; the card falls back
                // to the listing's currency, never to a blanket 'USD'.
                currency: detail?.currency || null,
                ex_date: dateStr,
                declaration_date: detail?.declarationDate || null,
                record_date: detail?.recordDate || null,
                payment_date: detail?.paymentDate || null,
                period: detail?.period || null,
                // The same company's other listings that day (PCU.F ...).
                listings: Array.isArray(row.listings) ? row.listings.filter(c => c !== sym) : [],
              },
            };
          });
          // One row per company, as earnings: only for everybody's view --
          // the person's own symbols are each their own line.
          // The person's own listings stay their own lines (collapseInto).
          const isOwnDiv = (r) => ownSymbols.some(us => sameSymbol(r.code, us));
          if (symbols.length > 0) out.push(...toDivEvents(divRows));
          else if (divRows.length) collapseInto('dividends', out, divRows.filter(r => !isOwnDiv(r)), toDivEvents, divRows.filter(isOwnDiv));
        } catch (e) { console.error('Dividends load error:', e); }
        return divResult;
      }));

      // Load splits
      if (wanted.includes('splits')) tasks.push(run('splits', async (out) => {
        // The names and caps go out with the feed, as for earnings (one row
        // per company).
        if (!(symbols.length > 0 || calendarRefused)) askAux();
        try {
          const splitsList = await cachedRange('splits', from, to, async () => {
            return listOf(await window.EODHD_API.getCalendarSplits(apiKey, { from, to }, asking), 'splits');
          });
          if (Array.isArray(splitsList)) {
            // By the symbols, not by the scope's name: an unexpected scope
            // value used to drop every split. The day goes in
            // `date`, which is what the listings are joined by.
            const splitRows = splitsList
              .filter(item => isReadableTicker(item.code) && inRange(item.split_date || item.date))
              .filter(item => symbols.length === 0 || symbols.some(us => sameSymbol(item.code, us)))
              .map(item => ({ ...item, date: item.split_date || item.date }));
            const toSplitEvents = (rows) => rows.map((item) => {
              // The calendar sends old_shares / new_shares (measured
              // 2026-09-30: {"old_shares":5,"new_shares":1} for a 1-for-5
              // reverse split), not a `split` string — reading only
              // item.split made every ratio "N/A". Ratio is
              // new:old, the usual "2:1" for a two-for-one.
              const splitStr = item.split || '';
              const parts = splitStr.split('/').map(Number);
              const newSh = Number(item.new_shares), oldSh = Number(item.old_shares);
              const ratio = (Number.isFinite(newSh) && Number.isFinite(oldSh) && newSh > 0 && oldSh > 0)
                ? `${newSh}:${oldSh}`
                : (parts.length === 2 && parts[1] ? `${parts[0]}:${parts[1]}` : splitStr);
              return {
                type: 'splits',
                date: item.split_date || item.date,
                symbol: item.code,
                title: `${item.code} Stock Split`,
                icon: 'activity',
                color: '#8b5cf6',
                raw: {
                  old_shares: item.old_shares || (parts[1] || null),
                  new_shares: item.new_shares || (parts[0] || null),
                  split: item.split,
                  optionable: item.optionable,
                  split_date: item.split_date,
                  // The same company's other listings that day (PCU.F ...).
                  listings: Array.isArray(item.listings) ? item.listings.filter(c => c !== item.code) : [],
                },
                ratio,
              };
            });
            // One row per company, as earnings: only for everybody's view --
            // the person's own symbols are each their own line.
            // The person's own listings stay their own lines (collapseInto).
            const isOwnSplit = (r) => ownSymbols.some(us => sameSymbol(r.code, us));
            if (symbols.length > 0) out.push(...toSplitEvents(splitRows));
            else if (splitRows.length) collapseInto('splits', out, splitRows.filter(r => !isOwnSplit(r)), toSplitEvents, splitRows.filter(isOwnSplit));
          }
          return Array.isArray(splitsList);
        } catch (e) { return feedFail('splits', e); }
      }));

      // Load economic events — use wider past window + limit, filter to events with data
      if (wanted.includes('economic')) tasks.push(run('economic', async (out) => {
        try {
          // The feed: two weeks back, one ahead. The grid: the whole month,
          // with room for all of it (the feed's cap of 150 cut a month off
          // around the 22nd).
          const eFrom = isGrid ? from : ymd(shift(now, -14));
          const eTo = isGrid ? to : ymd(shift(now, 7));
          // An hour, not the day: releases fill in `actual` as they land.
          const data = await cachedRange('economic', eFrom, eTo, async () => {
            return listOf(await window.EODHD_API.getEconomicEvents(apiKey, { from: eFrom, to: eTo, limit: isGrid ? 1000 : 500, country: 'US' }, asking));
          }, 3600 * 1000);
          if (Array.isArray(data)) {
            // Only show events that have at least some data. In time order:
            // the feed's own order ran backwards within a day (16:30, 13:00
            // ... 08:30), and only the days were sorted. The
            // stamps are "YYYY-MM-DD HH:MM:SS" in UTC, so as text.
            data.filter(item => (item.actual != null || item.estimate != null || item.previous != null)
              && String(item.date || '').slice(0, 10) >= eFrom && String(item.date || '').slice(0, 10) <= eTo)
              .slice(0, isGrid ? 1000 : 150)
              .sort((a, b) => (String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : 0))
              .forEach(item => {
              const forecast = item.estimate != null ? parseFloat(item.estimate) : null;
              const actual = item.actual != null ? parseFloat(item.actual) : null;
              const previous = item.previous != null ? parseFloat(item.previous) : null;
              // "2026-03-06 20:30:00" is UTC. It used to be shown as-is and
              // unlabelled, so NFP read "12:30" to a New York user for an
              // 08:30 release. Convert to the viewer's zone
              // (date AND time, so a late-evening UTC event lands on the
              // right local day) and name the zone.
              const { dateStr, timeStr } = localEventTime(item.date);
              out.push({
                type: 'economic',
                date: dateStr,
                symbol: item.country,
                title: item.type || item.event || item.name || 'Economic Event',
                icon: 'map',
                color: '#3b82f6',
                time: timeStr,
                raw: {
                  forecast, actual, previous,
                  country: item.country,
                  time: timeStr,
                  type: item.type,
                  comparison: item.comparison,
                  period: item.period,
                  change: item.change != null ? parseFloat(item.change) : null,
                  change_percentage: item.change_percentage != null ? parseFloat(item.change_percentage) : null,
                },
                countryFlag: COUNTRY_FLAGS[item.country] || COUNTRY_FLAGS[item.country?.toUpperCase()] || '',
              });
            });
          }
          return Array.isArray(data);
        } catch (e) { return feedFail('economic', e); }
      }));

      // Load Market Holidays — pulls v2/exchange-details for the major
      // exchanges and surfaces upcoming closures (incl. EarlyClose half-days)
      // alongside earnings / dividends. Coverage is manually verified for
      // 2026 in v2; v1 only had a rolling ±6-month window.
      if (wanted.includes('holidays')) tasks.push(run('holidays', async (out) => {
        try {
          const ES = window.ExchangeStatus;
          if (!ES) return true;
          // EODHD v2/exchange-details only ships a subset of exchanges
          // (US confirmed; LSE/XETRA/TO/HK/TSE 404 with a non-JSON body).
          // Limited to the ones that respond — adding the others polluted
          // the console with red errors and produced nothing useful.
          const exchanges = ['US', 'LSE', 'TO'];
          // Days from today to the window's last day: getUpcomingHolidays counts
          // from today, and the window's own length (about forty days) left a
          // grid two months ahead without 24 and 25 Dec.
          const HORIZON_DAYS = Math.max(0, Math.ceil(
            (new Date(`${to}T23:59:59`).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
          )) + 1;
          await Promise.all(exchanges.map(async (ex) => {
            // A holiday list changes a few times a year; kept for the day.
            // "v2": entries kept before 28.10 may be failures read as answers.
            const storeKey = `${keyTag}|exchange-details-v2|${ex}`;
            if (store && ES.prime && !(ES.isLoaded && ES.isLoaded(ex))) {
              const kept = await store.get(storeKey);
              if (kept) ES.prime(ex, kept);
            }
            const had = ES.isLoaded ? ES.isLoaded(ex) : false;
            // A Try again asks again over a failure kept from before.
            try { await ES.load(ex, apiKey, only ? { fresh: true } : undefined); } catch (_) {}
            // A failure is not kept for the day.
            const got = ES.peek ? ES.peek(ex) : null;
            if (!had && store && got && !got._failed) store.set(storeKey, got, 24 * 3600 * 1000);
            // The window's own days, past ones included: a month paged back
            // showed no holiday at all -- January, opened on 28 Feb, had no
            // New Year's Day -- since only upcoming ones
            // were read. The exchange's list carries the year.
            const inWindow = ES.getHolidaysBetween
              ? ES.getHolidaysBetween(ex, from, to)
              : ES.getUpcomingHolidays(ex, Math.max(60, HORIZON_DAYS));
            const tz = (ES.getRegularHours && (ES.getRegularHours(ex) || {}).tz) || null;
            inWindow.forEach((h) => {
              if (!h.date) return;
              if (h.date < from || h.date > to) return;
              const isEarly = /early|half/i.test(h.type || '');
              out.push({
                type: 'holidays',
                date: h.date,
                symbol: ex,
                title: `${ex}: ${h.name}${isEarly ? ' (early close)' : ''}`,
                name: h.name,
                icon: 'calendar',
                color: isEarly ? '#f59e0b' : '#94a3b8',
                raw: { exchange: ex, holiday: h.name, type: h.type, closeAt: h.closeAt, from: h.from, to: h.to, tz },
              });
            });
          }));
          // Answered when every exchange did (a 404 counts: it is an answer).
          // US down beside London's 404 said nothing of the missing US days.
          // A 5xx or a 429 is no answer. An answer
          // that could not be read is said as that.
          if (ES.unreadable && exchanges.some(ex => ES.unreadable(ex))) return { ok: false, fail: RLW.failure(RLW.unreadableError('Unreadable response (exchange-details)', 200)) };
          return !ES.isLoaded || exchanges.every(ex => ES.isLoaded(ex) && !(ES.failed && ES.failed(ex)));
        } catch (e) { console.error('Holidays load error:', e); return false; }
      }));

      // Load IPOs
      if (wanted.includes('ipos')) tasks.push(run('ipos', async (out) => {
        try {
          const iposList = await cachedRange('ipos', from, to, async () => {
            return listOf(await window.EODHD_API.getCalendarIpos(apiKey, { from, to }, asking), 'ipos');
          });
          if (Array.isArray(iposList)) {
            iposList.filter(item => isReadableTicker(item.code || item.ticker)
              && inRange(item.start_date || item.date || item.filing_date)).forEach(item => {
              out.push({
                type: 'ipos',
                date: item.start_date || item.date || item.filing_date,
                symbol: item.code || item.ticker,
                title: `${item.code || item.ticker || ''} IPO`,
                name: item.name,
                icon: 'trendUp',
                color: '#ec4899',
                raw: {
                  code: item.code || item.ticker,
                  name: item.name,
                  exchange: item.exchange,
                  start_date: item.start_date,
                  filing_date: item.filing_date,
                  price_from: item.price_from && parseFloat(item.price_from) > 0 ? parseFloat(item.price_from) : null,
                  price_to: item.price_to && parseFloat(item.price_to) > 0 ? parseFloat(item.price_to) : null,
                  offer_price: item.offer_price && parseFloat(item.offer_price) > 0 ? parseFloat(item.offer_price) : null,
                  shares: item.shares && parseFloat(item.shares) > 0 ? parseFloat(item.shares) : null,
                  deal_type: item.deal_type,
                },
              });
            });
          }
          return Array.isArray(iposList);
        } catch (e) { return feedFail('ipos', e); }
      }));

      await Promise.all(tasks);
    } catch (error) {
      console.error('[Calendar] FATAL load error:', error);
    } finally {
      // Every feed of the latest request settles -- even if an early line
      // threw -- so the view can never get stuck on "Loading events…". A
      // newer load (a quicker holidays-only one after the slow first
      // all-load) is not overwritten: live() is false for the old one.
      wanted.forEach((f) => { if (!settled.has(f)) settle(f, false); });
    }
  };

  // A different key may see different feeds: nothing cached under the old
  // one carries over. Declared before the load below, so it runs first.
  React.useEffect(() => {
    feedCacheRef.current = {};
    divDayCacheRef.current = {};
    capsRef.current = null;
  }, [apiKey]);

  React.useEffect(() => {
    // No apiKey guard: keyless/demo users load via the backend proxy
    // (useProxy). Guarding on apiKey left demo web users stuck loading.
    loadEvents();
    // monthKey, so paging the grid fetches that month. The window is fixed at
    // today-7 to today+90, and paging changed only which cells were drawn:
    // October and November showed no dividends, January 2027 nothing at all,
    // and no request went out to say otherwise.
  }, [apiKey, filter, monthKey]);

  // Report state changes to parent so it can restore on re-mount
  React.useEffect(() => {
    if (onStateChange) onStateChange({ filter, scope, view });
  }, [filter, scope, view]);

  // Day events are rendered inline now; no body-scroll-lock needed.
  // Keeping the lock made Opera mobile unable to scroll the page after
  // selecting a date.

  // Scroll the inline day-events panel into view when a date is picked.
  // Without this the panel renders below a full-screen month grid and the
  // user has to manually scroll to find what they just clicked.
  const dayPanelRef = React.useRef(null);
  // "Clear" removes the panel it sits in, and focus fell to <body>: a keyboard
  // user was sent back to the top of the page. It returns to the day that was
  // open, which is where they came from.
  const dayGridRef = React.useRef(null);
  const clearSelectedDay = () => {
    const key = selectedDay ? ymdLocal(selectedDay) : null;
    setSelectedDay(null);
    if (!key) return;
    requestAnimationFrame(() => {
      const cell = dayGridRef.current && dayGridRef.current.querySelector('[data-day="' + key + '"]');
      if (cell) cell.focus();
    });
  };
  React.useEffect(() => {
    if (!selectedDay || !dayPanelRef.current) return;
    // requestAnimationFrame so the DOM has the panel rendered before we scroll.
    const raf = requestAnimationFrame(() => {
      try {
        dayPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (_) {}
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedDay]);

  // A day of another month stays selected no more: after "Next month" the
  // panel under the grid still showed 15 October.
  React.useEffect(() => {
    setSelectedDay((d) => (d && (d.getFullYear() !== selectedMonth.getFullYear() || d.getMonth() !== selectedMonth.getMonth()) ? null : d));
  }, [selectedMonth]);

  const formatDate = (dateStr) => {
    // A bare "YYYY-MM-DD" parses as UTC midnight, which toLocaleDateString
    // then shows as the previous evening anywhere west of Greenwich. Read
    // the parts and build a local date instead.
    const parts = String(dateStr || '').split('-').map(Number);
    const date = parts.length === 3 && parts.every(Number.isFinite)
      ? new Date(parts[0], parts[1] - 1, parts[2])
      : new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const groupedEvents = React.useMemo(() => {
    const groups = {};
    events.forEach(event => {
      const dateKey = event.date;
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(event);
    });
    // ISO date strings sort as text; no Date parsing, no time zone.
    return Object.entries(groups).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }, [events]);

  // Feed paging (see the feed render): days before today behind a button,
  // FEED_DAYS days at a time, FEED_PER_DAY events a day until opened.
  const FEED_DAYS = 7;
  const FEED_PER_DAY = 20;
  const [showPastDays, setShowPastDays] = React.useState(false);
  const [feedDayLimit, setFeedDayLimit] = React.useState(FEED_DAYS);
  const [openDays, setOpenDays] = React.useState({});
  // The market's day, not the browser's. Events are dated by the US report
  // date, and east of UTC the browser's calendar moves on mid-session: at
  // 09:25 ET in Kiritimati (UTC+14) "Today" was Tuesday and Monday's 360
  // reports hid under "Show earlier days".
  const todayKey = (() => {
    const ES = window.ExchangeStatus;
    if (ES && ES.todayISOInTZ) return ES.todayISOInTZ('America/New_York');
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const feedPast = groupedEvents.filter(([date]) => date < todayKey);
  const feedUpcoming = groupedEvents.filter(([date]) => date >= todayKey);
  const feedDays = (showPastDays ? feedPast : []).concat(feedUpcoming.slice(0, feedDayLimit));
  const feedMoreStyle = {
    display: 'block', width: '100%', minHeight: 40, margin: '0 0 16px', padding: '10px 14px', borderRadius: '10px',
    border: '1px dashed ' + (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)'), background: 'transparent',
    color: isDark ? C3.textDark : C3.textLightTheme, fontSize: '13px', fontWeight: 600, cursor: 'pointer',
  };

  // Build the day key from LOCAL date parts, not toISOString() (which converts
  // to UTC and lands events on the wrong grid cell for users west of UTC).
  const ymdLocal = (d) => {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  };

  // By day once, not a pass over every event per cell: with each company
  // kept, a quarter is ~17,000 earnings rows.
  const eventsByDay = React.useMemo(() => new Map(groupedEvents), [groupedEvents]);
  const getEventsForDay = (day) => eventsByDay.get(ymdLocal(day)) || [];

  const generateCalendarDays = () => {
    const year = selectedMonth.getFullYear();
    const month = selectedMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPadding = firstDay.getDay();
    const days = [];
    for (let i = 0; i < startPadding; i++) days.push(null);
    for (let d = 1; d <= lastDay.getDate(); d++) days.push(new Date(year, month, d));
    return days;
  };

  const handleNavigateToAsset = (symbol, e) => {
    if (e) e.stopPropagation();
    if (!symbol || !onSelectAsset) return;
    window.Haptics?.medium();
    // The listing itself: "View asset" on VOD.LSE opened VOD.US.
    onSelectAsset({ symbol: fullSym(symbol), name: symbol.split('.')[0] });
  };

  // A dividend row arrives with its symbol and ex-date only -- the day feed
  // carries nothing else -- and fetches its amount, record and payment dates
  // when somebody opens it. One request per row that was actually looked at,
  // in place of thirty up front for rows that mostly were not.
  const fillDividendDetail = async (event) => {
    if (!event || event.type !== 'dividends' || !event.symbol) return;
    if (event.raw && event.raw.dividend != null) return;
    // Asked once a row, kept for every rebuild of the day (divDetailRef).
    const key = `${event.symbol}_${event.date}`;
    if (divAskedRef.current.has(key)) return;
    divAskedRef.current.add(key);
    try {
      const rows = await window.EODHD_API.getDividendHistory(apiKey, event.symbol, window.CalendarDate.addDays(String(event.date).slice(0, 10), -1));
      const hit = Array.isArray(rows) ? rows.find(d => d.date === event.date) : null;
      if (!hit) return;
      divDetailRef.current[key] = hit;
      // By the row's listing and day, not its object: the day may have been
      // drawn again while the detail was on its way.
      const fill = (e) => (e && e.type === 'dividends' && e.symbol === event.symbol && e.date === event.date ? {
        ...e,
        raw: {
          ...e.raw,
          dividend: hit.value != null ? parseFloat(hit.value) : null,
          currency: hit.currency || e.raw.currency,
          declaration_date: hit.declarationDate || null,
          record_date: hit.recordDate || null,
          payment_date: hit.paymentDate || null,
          period: hit.period || null,
        },
      } : e);
      // The feed's own list too: another feed coming in redraws from it.
      if (Array.isArray(feedListsRef.current.dividends)) feedListsRef.current.dividends = feedListsRef.current.dividends.map(fill);
      setEvents(prev => prev.map(fill));
    } catch (_) { /* the row keeps its date; the amount simply stays absent */ }
  };

  // What an Earnings Preview is written from: the company's last two years
  // of quarters (one calendar request) and its headline metrics
  // (fundamentals), fetched when somebody asks for the preview.
  const loadEarningsContext = async (sym) => {
    const full = fullSym(sym);
    const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    const fundamentalsRefused = window.Entitlement && window.Entitlement.get && window.Entitlement.get('fundamentals').allowed === false;
    const [hist, fund] = await Promise.all([
      Promise.resolve(window.EODHD_API.getCalendarEarnings(apiKey, { symbols: full, from: d(-730), to: d(180) })).catch(() => null),
      fundamentalsRefused || !window.EODHD_API.getFundamentals ? null
        : Promise.resolve(window.EODHD_API.getFundamentals(apiKey, full)).catch(() => null),
    ]);
    const rows = Array.isArray(hist && hist.earnings) ? hist.earnings : [];
    const earningsData = rows.filter(r => r && String(r.code || '').toUpperCase() === full.toUpperCase())
      .map(window.CalendarFormat.toQuarter)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 8);
    return { earningsData, fundamentals: fund && fund.Highlights ? fund : null };
  };

  const toggleExpand = (eventKey, event) => {
    if (expandedEventId !== eventKey && window.MIAnalytics) window.MIAnalytics.track('dl_mi_calendar_event_click', { event_key: eventKey });
    window.Haptics?.light();
    if (expandedEventId !== eventKey) fillDividendDetail(event);
    setExpandedEventId(prev => prev === eventKey ? null : eventKey);
  };

  const handleDayClick = (day, dayEvents) => {
    if (dayEvents.length === 0) return;
    window.Haptics?.light();
    setSelectedDay(day);
  };

  const fmtNum = (v, decimals = 2) => {
    if (v == null || isNaN(v)) return 'N/A';
    return typeof v === 'number' ? v.toFixed(decimals) : String(v);
  };

  // One date format in the feed: detail rows printed raw
  // YYYY-MM-DD under "Tue, Oct 6" day headers. Same words as the headers, with
  // the year when it is not this one.
  const fmtDate = (d) => {
    if (!d) return 'TBD';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
    if (!m) return String(d);
    const dt = new Date(+m[1], +m[2] - 1, +m[3]);
    const opts = { weekday: 'short', month: 'short', day: 'numeric' };
    if (+m[1] !== new Date().getFullYear()) opts.year = 'numeric';
    return dt.toLocaleDateString('en-US', opts);
  };

  const fmtShares = (n) => {
    if (n == null) return 'N/A';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  };

  // --- Rich Card Renderers ---

  const renderEarningsCard = (event, isExpanded) => {
    const r = event.raw || {};
    const surprisePct = r.percent != null ? Math.abs(r.percent).toFixed(1) + '%' : null;
    return React.createElement('div', null,
      // Collapsed summary
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
        // EPS estimate prominent
        r.estimate != null && React.createElement('span', { style: { fontSize: '16px', fontWeight: '700', color: isDark ? C3.textDark : C3.textLightTheme } },
          `EPS Est: ${money(r.estimate, rowCcy(r.currency, event.symbol))}`
        ),
        // Beat/Miss badge
        // Actual equal to the estimate is in line, not "BEAT 0.0%".
        event.beatMiss && (() => {
          const inLine = r.actual != null && r.estimate != null && Number(r.actual) === Number(r.estimate);
          const beat = event.beatMiss === 'beat' && !inLine;
          return React.createElement('span', { style: {
            fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '6px',
            background: inLine ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)') : beat ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
            color: inLine ? (isDark ? C3.textMutedDark : C3.textMutedLight) : beat ? (isDark ? '#10b981' : '#047857') : (isDark ? '#f87171' : '#c81e2c'),
          } }, inLine ? 'IN LINE' : beat ? `BEAT ${surprisePct || ''}` : `MISS ${surprisePct || ''}`);
        })(),
        // Timing ("After-Hours" is not broken at its hyphen).
        event.time && React.createElement('span', { style: { fontSize: '11px', color: isDark ? C3.textMutedDark : C3.textMutedLight, marginLeft: 'auto', whiteSpace: 'nowrap' } }, event.time),
      ),
      // Expanded detail grid
      isExpanded && React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '8px', marginTop: '12px', padding: '12px', borderRadius: '10px', background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' } },
        renderDetailRow('EPS Estimate', r.estimate != null ? money(r.estimate, rowCcy(r.currency, event.symbol)) : 'N/A'),
        renderDetailRow('EPS Actual', r.actual != null ? money(r.actual, rowCcy(r.currency, event.symbol)) : 'Pending'),
        renderDetailRow('Surprise', r.difference != null ? money(r.difference, rowCcy(r.currency, event.symbol)) : 'N/A'),
        renderDetailRow('Surprise %', r.percent != null ? `${fmtNum(r.percent)}%` : 'N/A'),
        renderDetailRow('Timing', event.time || 'N/A'),
        renderDetailRow('Report Date', fmtDate(r.report_date)),
        r.listings && r.listings.length > 0 && React.createElement('div', { key: 'listings', style: { gridColumn: '1 / -1' } },
          renderDetailRow(`Also listed as (${r.listings.length})`, r.listings.map(displaySymbol).join(', '))),
      ),
      // AI Earnings Preview
      isExpanded && window.EarningsPreviewCard && event.symbol && React.createElement(
        'div', { style: { marginTop: 8 }, onClick: (e) => e.stopPropagation() },
        React.createElement(window.EarningsPreviewCard, {
          symbol: event.symbol,
          // In the shape the card and the preview prompt read (date,
          // epsEstimate, epsActual). The calendar row went in as it was --
          // report_date, estimate, actual -- and the model was told "EPS est
          // undefined, actual undefined" with no metrics at all.
          earningsData: event.raw ? [window.CalendarFormat.toQuarter({ ...event.raw, date: event.raw.period_end })] : [],
          loadContext: () => loadEarningsContext(event.symbol),
          theme: theme
        })
      ),
      // Navigation button
      isExpanded && event.symbol && renderViewAssetButton(event.symbol),
    );
  };

  const renderDividendsCard = (event, isExpanded) => {
    const r = event.raw || {};
    return React.createElement('div', null,
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
        r.dividend != null && React.createElement('span', { style: { fontSize: '16px', fontWeight: '700', color: isDark ? C3.textDark : C3.textLightTheme } },
          `${money(r.dividend, rowCcy(r.currency, event.symbol), 4)}/share`
        ),
        React.createElement('span', { style: { fontSize: '11px', color: isDark ? C3.textMutedDark : C3.textMutedLight } },
          `Ex: ${fmtDate(r.ex_date)}`
        ),
      ),
      isExpanded && React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '8px', marginTop: '12px', padding: '12px', borderRadius: '10px', background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' } },
        renderDetailRow('Amount', r.dividend != null ? money(r.dividend, rowCcy(r.currency, event.symbol), 4) : 'N/A'),
        renderDetailRow('Currency', rowCcy(r.currency, event.symbol) || 'N/A'),
        renderDetailRow('Ex-Date', fmtDate(r.ex_date)),
        renderDetailRow('Declaration', fmtDate(r.declaration_date)),
        renderDetailRow('Record Date', fmtDate(r.record_date)),
        renderDetailRow('Payment', fmtDate(r.payment_date)),
      ),
      isExpanded && event.symbol && renderViewAssetButton(event.symbol),
    );
  };

  const renderSplitsCard = (event, isExpanded) => {
    const r = event.raw || {};
    return React.createElement('div', null,
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
        React.createElement('span', { style: { fontSize: '16px', fontWeight: '700', color: isDark ? C3.textDark : C3.textLightTheme } },
          event.ratio || r.split || 'N/A'
        ),
        React.createElement('span', { style: { fontSize: '11px', color: isDark ? C3.textMutedDark : C3.textMutedLight } }, 'split ratio'),
      ),
      isExpanded && React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '8px', marginTop: '12px', padding: '12px', borderRadius: '10px', background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' } },
        renderDetailRow('Ratio', event.ratio || r.split || 'N/A'),
        renderDetailRow('Old Shares', r.old_shares || 'N/A'),
        renderDetailRow('New Shares', r.new_shares || 'N/A'),
        renderDetailRow('Optionable', r.optionable || 'N/A'),
        renderDetailRow('Split Date', fmtDate(r.split_date)),
      ),
      isExpanded && event.symbol && renderViewAssetButton(event.symbol),
    );
  };

  const renderIPOCard = (event, isExpanded) => {
    const r = event.raw || {};
    // IPO rows name an exchange ("NASDAQ", "LSE", ...), not a currency.
    const ipoCcy = window.Money
      ? window.Money.currencyForSymbol('X.' + String(r.exchange || '').toUpperCase())
      : null;
    // Build price display: range > offer price > TBD
    const hasRange = r.price_from != null && r.price_to != null;
    const priceRange = hasRange
      ? (r.price_from === r.price_to ? money(r.price_from, ipoCcy) : `${money(r.price_from, ipoCcy)} – ${money(r.price_to, ipoCcy)}`)
      : r.offer_price != null ? money(r.offer_price, ipoCcy) : null;
    return React.createElement('div', null,
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
        event.name && React.createElement('span', { title: event.name, style: { fontSize: '12px', color: isDark ? C3.textMutedDark : C3.textMutedLight, maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, event.name),
        // Price or TBD
        priceRange
          ? React.createElement('span', { style: { fontSize: '16px', fontWeight: '700', color: ink('#10b981') } }, priceRange)
          : React.createElement('span', { style: { fontSize: '12px', fontWeight: '600', color: isDark ? C3.textMutedDark : C3.textMutedLight, fontStyle: 'italic' } }, 'Price TBD'),
        r.shares != null && React.createElement('span', { style: { fontSize: '11px', color: isDark ? C3.textMutedDark : C3.textMutedLight } }, `${fmtShares(r.shares)} shares`),
        r.deal_type && React.createElement('span', { style: {
          fontSize: '10px', fontWeight: '600', padding: '2px 6px', borderRadius: '4px',
          // Deal status is data: its two colours stay (design stage 1).
          background: r.deal_type === 'Priced' ? 'rgba(16,185,129,0.12)' : 'rgba(236,72,153,0.12)',
          color: ink(r.deal_type === 'Priced' ? '#10b981' : '#ec4899'),
        } }, r.deal_type),
      ),
      isExpanded && React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '8px', marginTop: '12px', padding: '12px', borderRadius: '10px', background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' } },
        renderDetailRow('Company', r.name || 'N/A'),
        renderDetailRow('Exchange', r.exchange || 'N/A'),
        renderDetailRow('Price Range', priceRange || 'TBD'),
        renderDetailRow('Offer Price', r.offer_price != null ? money(r.offer_price, ipoCcy) : 'TBD'),
        renderDetailRow('Shares', r.shares != null ? fmtShares(r.shares) : 'N/A'),
        renderDetailRow('Filing Date', fmtDate(r.filing_date)),
        renderDetailRow('Start Date', fmtDate(r.start_date)),
        renderDetailRow('Deal Type', r.deal_type || 'N/A'),
      ),
    );
  };

  const renderEconomicCard = (event, isExpanded) => {
    const r = event.raw || {};
    const deviation = (r.actual != null && r.forecast != null) ? r.actual - r.forecast : null;
    // Show the best available numbers: actual > previous > forecast
    const mainValue = r.actual != null ? r.actual : r.previous != null ? r.previous : r.forecast;
    const mainLabel = r.actual != null ? 'Actual' : r.previous != null ? 'Previous' : 'Forecast';
    return React.createElement('div', null,
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
        event.countryFlag && React.createElement('span', { style: { fontSize: '18px' } }, event.countryFlag),
        mainValue != null && React.createElement('span', { style: { fontSize: '14px', fontWeight: '700', color: isDark ? C3.textDark : C3.textLightTheme } }, `${mainLabel}: ${fmtNum(mainValue)}`),
        // A change is the release's: before it, the feed sends 0 and the
        // card read "+0.00" next to the previous figure.
        r.actual != null && r.change != null && React.createElement('span', { style: {
          fontSize: '11px', fontWeight: '600', padding: '2px 6px', borderRadius: '4px',
          background: r.change >= 0 ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
          color: ink(r.change >= 0 ? '#10b981' : '#ef4444'),
        } }, `${r.change >= 0 ? '+' : ''}${fmtNum(r.change)}`),
        r.period && React.createElement('span', { style: { fontSize: '11px', color: isDark ? C3.textMutedDark : C3.textMutedLight } }, window.CalendarFormat.periodLabel(r.period)),
        // "18:00 GMT+1" is one label: it moves as a whole, as the early
        // close's time does.
        event.time && React.createElement('span', { style: { fontSize: '11px', color: isDark ? C3.textMutedDark : C3.textMutedLight, marginLeft: 'auto', whiteSpace: 'nowrap' } }, event.time),
      ),
      isExpanded && React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '8px', marginTop: '12px', padding: '12px', borderRadius: '10px', background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' } },
        renderDetailRow('Event', event.title),
        renderDetailRow('Country', `${event.countryFlag || ''} ${r.country || 'N/A'}`),
        renderDetailRow('Period', r.period ? window.CalendarFormat.periodLabel(r.period) : 'N/A'),
        renderDetailRow('Actual', r.actual != null ? fmtNum(r.actual) : 'Pending'),
        renderDetailRow('Forecast', r.forecast != null ? fmtNum(r.forecast) : 'N/A'),
        renderDetailRow('Previous', r.previous != null ? fmtNum(r.previous) : 'N/A'),
        // Before the release the feed's change is 0, not a change: the open
        // card read "Change +0.00, Change % +0.00%" under "Actual Pending".
        // Like the collapsed card, a change needs an actual.
        renderDetailRow('Change', r.actual != null && r.change != null ? `${r.change >= 0 ? '+' : ''}${fmtNum(r.change)}` : (r.actual == null ? 'Pending' : 'N/A')),
        renderDetailRow('Change %', r.actual != null && r.change_percentage != null ? `${r.change_percentage >= 0 ? '+' : ''}${fmtNum(r.change_percentage)}%` : (r.actual == null ? 'Pending' : 'N/A')),
      ),
    );
  };

  const renderDetailRow = (label, value) => {
    return React.createElement('div', { key: label },
      React.createElement('div', { style: { fontSize: '10px', color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.3px' } }, label),
      React.createElement('div', { style: { fontSize: '13px', fontWeight: '600', color: isDark ? C3.textDark : C3.textLightTheme } }, value),
    );
  };

  const renderViewAssetButton = (symbol) => {
    if (!onSelectAsset) return null;
    const cleanSymbol = symbol.split('.')[0];
    return React.createElement('button', {
      onClick: (e) => handleNavigateToAsset(symbol, e),
      style: {
        marginTop: '12px', width: '100%', padding: '10px', border: 'none', borderRadius: '10px',
        background: C3.logoGradient, color: 'white', fontSize: '13px', fontWeight: '600',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
      }
    },
      `View ${cleanSymbol} Details`,
      React.createElement('span', { style: { fontSize: '14px' } }, '\u2192'),
    );
  };

  const renderHolidaysCard = (event, isExpanded) => {
    const r = event.raw || {};
    const isEarly = /early|half/i.test(r.type || '');
    const closeAt = (r.closeAt || '').slice(0, 5) || (r.to || '').slice(0, 5);
    // The exchange's close in the viewer's time, zone named, like the
    // economic events beside it (CalendarFormat.exchangeLocalTime).
    const closeLocal = closeAt ? window.CalendarFormat.exchangeLocalTime(event.date, closeAt, r.tz) : null;
    return React.createElement('div', null,
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
        React.createElement('span', { style: { fontSize: '14px', fontWeight: '700', color: isDark ? C3.textDark : C3.textLightTheme } },
          r.exchange || 'Exchange'
        ),
        React.createElement('span', { style: { fontSize: '12px', color: isDark ? C3.textMutedDark : C3.textMutedLight } }, r.holiday || event.name || 'Holiday'),
        // The badge breaks between "EARLY CLOSE" and the time when the card
        // is too narrow for both, never inside the time: at 320 in Madrid it
        // read "EARLY CLOSE 19:00 / GMT+1", at 390 in Tokyo "... GMT+9 Nov /
        // 28".
        isEarly && React.createElement('span', { 'data-early-close': 'true', style: {
          display: 'inline-block', maxWidth: '100%',
          fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '6px',
          // Amber on its own tint read 4.48:1 in the light theme.
          background: 'rgba(245,158,11,0.15)', color: isDark ? ink('#f59e0b') : '#92400e',
        } },
          React.createElement('span', { style: { whiteSpace: 'nowrap' } }, 'EARLY CLOSE'),
          closeLocal && ' ',
          closeLocal && React.createElement('span', { style: { whiteSpace: 'nowrap' } }, closeLocal.label)),
      ),
      isExpanded && React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '8px', marginTop: '12px', padding: '12px', borderRadius: '10px', background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' } },
        renderDetailRow('Exchange', r.exchange || 'N/A'),
        renderDetailRow('Holiday', r.holiday || 'N/A'),
        renderDetailRow('Type', isEarly ? 'Early close (half-day)' : (r.type || 'Closed')),
        renderDetailRow('Close Time', isEarly
          ? (closeLocal ? React.createElement(React.Fragment, null,
            React.createElement('span', { style: { whiteSpace: 'nowrap' } }, closeLocal.label),
            closeLocal.city ? ` (${closeLocal.exchange} ${closeLocal.city} time)` : '') : 'N/A')
          : 'Market closed'),
      ),
    );
  };

  const renderRichBody = (event, isExpanded) => {
    switch (event.type) {
      case 'earnings': return renderEarningsCard(event, isExpanded);
      case 'dividends': return renderDividendsCard(event, isExpanded);
      case 'splits': return renderSplitsCard(event, isExpanded);
      case 'ipos': return renderIPOCard(event, isExpanded);
      case 'economic': return renderEconomicCard(event, isExpanded);
      case 'holidays': return renderHolidaysCard(event, isExpanded);
      default: return null;
    }
  };

  // --- Event Card ---
  const renderEventCard = (event, eventKey) => {
    const isExpanded = expandedEventId === eventKey;
    const isStock = ['earnings', 'dividends', 'splits'].includes(event.type);

    return React.createElement('div', {
      key: eventKey,
      // The EPS actual, dividend amount and pay dates live only in the
      // expanded card. The card itself was the button, with the ticker's
      // button inside it -- a button in a button. It is a container now; the
      // control is a real button laid over it (first child, below), so the
      // focus ring still goes round the whole card, it is still the first
      // stop of the row, and nothing on the card moves.
      onClick: () => toggleExpand(eventKey, event),
      style: {
        ...(isDark ? C3.glassDark : C3.glassLight),
        borderRadius: '14px', padding: '14px', marginBottom: '10px',
        cursor: 'pointer', transition: 'background-color 150ms ease, border-color 150ms ease', position: 'relative',
      }
    },
      // For the keyboard and assistive technology; the mouse goes through it
      // to the card and to what is on it.
      React.createElement('button', {
        type: 'button', 'aria-expanded': isExpanded, className: 'cal-row-toggle',
        'aria-label': [isStock && event.symbol ? displaySymbol(event.symbol) : (event.title || event.symbol || ''), event.type, 'details'].filter(Boolean).join(' '),
        onClick: (e) => { e.stopPropagation(); toggleExpand(eventKey, event); },
        style: { position: 'absolute', inset: 0, width: '100%', height: '100%', background: 'none', border: 'none', padding: 0, margin: 0, borderRadius: 'inherit', pointerEvents: 'none' },
      }),
      // Header row
      React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '12px' } },
        // Icon
        React.createElement('div', { style: {
          width: '36px', height: '36px', borderRadius: '10px',
          background: `${event.color}20`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        } }, React.createElement(Icon, { name: event.icon, size: 18, color: event.color })),
        // Title area
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' } },
            // The symbol opens the instrument. A <span onClick> could not be
            // reached from the keyboard at all (of them, WCAG 2.1.1);
            // a button can, and its keys do not toggle the card around it.
            // Plain text where nothing opens it.
            isStock && event.symbol ? React.createElement(onSelectAsset ? 'button' : 'span', {
              ...(onSelectAsset ? {
                type: 'button',
                onClick: (e) => handleNavigateToAsset(event.symbol, e),
                onKeyDown: (e) => e.stopPropagation(),
                'aria-label': `Open ${displaySymbol(event.symbol)}`,
                className: 'cal-ticker',
              } : {}),
              style: { fontWeight: '700', fontSize: '14px', color: ink(C3.glowOrange), cursor: onSelectAsset ? 'pointer' : 'default', textDecoration: onSelectAsset ? 'underline' : 'none', textDecorationStyle: 'dotted', textUnderlineOffset: '3px', background: 'none', border: 'none', padding: 0, margin: 0, fontFamily: 'inherit', lineHeight: 'inherit' },
            }, displaySymbol(event.symbol)) : React.createElement('span', {
              // Economic and holiday titles are long; the cut one says the rest on hover.
              title: event.title || undefined,
              style: { fontWeight: '600', fontSize: '14px', color: isDark ? C3.textDark : C3.textLightTheme, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px', display: 'inline-block', minWidth: 0 },
            }, event.title),
            // Type badge
            React.createElement('span', { style: {
              fontSize: '10px', padding: '2px 7px', borderRadius: '6px',
              background: `${event.color}15`, color: ink(event.color), fontWeight: '600',
              textTransform: 'uppercase', letterSpacing: '0.3px',
            } }, event.type === 'ipos' ? 'IPO' : event.type === 'holidays' ? 'HOLIDAY' : event.type),
          ),
          // Rich body content
          renderRichBody(event, isExpanded),
        ),
        // Expand indicator
        React.createElement('div', { style: {
          width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s',
          color: isDark ? C3.textMutedDark : C3.textMutedLight, flexShrink: 0,
        } }, React.createElement(Icon, { name: 'chevronDown', size: 16 })),
      ),
    );
  };

  // --- Day Detail Overlay ---
  const renderDayOverlay = () => {
    if (!selectedDay) return null;
    const dayEvents = getEventsForDay(selectedDay);
    const dateLabel = selectedDay.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    return React.createElement('div', {
      onClick: () => setSelectedDay(null),
      style: {
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        // Removed overscrollBehavior:contain on the backdrop and removed
        // onTouchMove stopPropagation. Both blocked inner-scroll on Opera;
        // the inner
        // sheet still has its own contain, which is what we actually want.
      }
    },
      // The page behind pinned, Tab held in the sheet (ModalLayer).
      window.ModalLayer && React.createElement(window.ModalLayer.Hold),
      React.createElement('div', {
        onClick: (e) => e.stopPropagation(),
        style: {
          // Use both vh and svh so iOS / Opera mobile chrome collapse
          // doesn't push the sheet off-screen. svh = stable visible
          // viewport height. Cap at 700px so desktop doesn't render an
          // overly tall sheet.
          maxHeight: 'min(75svh, 75vh, 700px)',
          minHeight: '40vh',
          width: '100%', maxWidth: 720, margin: '0 auto',
          borderRadius: '20px 20px 0 0',
          padding: '20px 20px 32px',
          background: isDark ? '#1a1a2e' : '#ffffff',
          overflowY: 'auto', WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          boxSizing: 'border-box',
        }
      },
        // Handle bar
        React.createElement('div', { style: { width: '40px', height: '4px', borderRadius: '2px', background: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)', margin: '0 auto 16px' } }),
        // Header
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' } },
          React.createElement('h2', { style: { margin: 0, fontSize: '16px', fontWeight: '700', color: isDark ? C3.textDark : C3.textLightTheme } }, dateLabel),
          React.createElement('button', {
            onClick: () => setSelectedDay(null),
            style: { width: '32px', height: '32px', borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)', color: isDark ? C3.textDark : C3.textLightTheme },
          }, React.createElement(Icon, { name: 'x', size: 16 })),
        ),
        // Event count
        React.createElement('div', { style: { fontSize: '12px', color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: '12px' } }, `${dayEvents.length} event${dayEvents.length !== 1 ? 's' : ''}`),
        // Events list
        dayEvents.length === 0
          ? React.createElement('p', { style: { textAlign: 'center', color: isDark ? C3.textMutedDark : C3.textMutedLight, padding: '24px 0' } }, 'No events on this day')
          : (() => { const keys = window.CalendarFormat.eventKeys(dayEvents, 'day'); return dayEvents.map((event, i) => renderEventCard(event, keys[i])); })(),
      ),
    );
  };

  // --- Filter & Scope Buttons ---
  const filterButtons = [
    { id: 'all', label: 'All' },
    { id: 'earnings', label: 'Earnings' },
    { id: 'dividends', label: 'Dividends' },
    { id: 'splits', label: 'Splits' },
    { id: 'ipos', label: 'IPOs' },
    { id: 'economic', label: 'Economic' },
    { id: 'holidays', label: 'Holidays' },
  ];

  // Days of the dividend window that did not answer are not covered.
  const dayLabel = (d) => { const p = String(d).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  const divMissedNote = divCoverage && divCoverage.missed && divCoverage.missed.length
    ? ` except ${divCoverage.missed.map(dayLabel).join(', ')}, which did not load` : '';
  const retryFeeds = (list) => {
    if (rlWait.hold()) return;
    retryFocusRef.current = true;
    loadEvents(list);
  };
  // The feeds that fold second listings and are on screen: the names line
  // is about them, and its Try again asks for them again (splits and
  // dividends fold as earnings do).
  const namesFeeds = ['earnings', 'dividends', 'splits'].filter(f => feedStatus[f] && feedStatus[f].state === 'ok');
  const mutedInk = isDark ? C3.textMutedDark : C3.textMutedLight;
  // Nothing on the list and more than one feed down (or the only one): the
  // list names them, with one Try again for all, rather than a stack of
  // buttons over an empty page. The grid too: it showed a line and a Try
  // again per feed over the month, six of them when every feed failed, and
  // moved down by 204-468 px.
  const emptyAllFailed = groupedEvents.length === 0
    && (failedFeeds.length > 1 || loadFailed === 'all');
  const failedNames = (() => {
    const n = failedFeeds.map(f => FEED_NAMES[f]);
    return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : (n[0] || '');
  })();
  // Why the list or the month is empty, in one sentence: the limit when it was the limit; the feeds that did not load
  // named when not all did; "the other feeds have nothing" only when some
  // did answer.
  const explainedAbove = !!(window.Entitlement && window.Entitlement.explained && window.Entitlement.explained());
  // Why, from what each feed's failure was when it failed (feedFail): not
  // from the wait running now -- the words changed when it ended, and were
  // read out again -- and an answer that could not be
  // read is said as that, not as "did not answer" (new #1).
  const RLW = window.RateLimitWait;
  const failOf = (f) => (feedStatus[f] && feedStatus[f].fail) || null;
  const NO_ANSWER = ' — EODHD did not answer.';
  const whyOf = (fail) => {
    if (!fail || !(fail.limited || fail.unreadable || fail.status)) return NO_ANSWER;
    return ' — ' + RLW.failReason(fail);
  };
  // The one reason every failed feed shares, or null when they differ.
  const sharedWhy = (() => {
    const all = failedFeeds.map(f => whyOf(failOf(f)));
    return all.length && all.every(w => w === all[0]) ? all[0] : null;
  })();
  const emptyReason = !loadFailed ? null
    : emptyAllFailed && loadFailed === 'all' && failedFeeds.length > 1 ? (
      explainedAbove
        ? 'Nothing below is missing data — the requests were not served. See the panel above.'
        : (sharedWhy && sharedWhy !== NO_ANSWER ? "Couldn't load the calendar: " + sharedWhy.slice(3)
          : "Couldn't load the calendar right now — the requests were not answered.")
    ) : emptyAllFailed ? (
      `${failedNames} did not load`
      + (explainedAbove ? '. See the panel above.' : (sharedWhy || NO_ANSWER))
      + (loadFailed === 'some' ? ' The other feeds have nothing in this window.' : '')
    ) : (explainedAbove
      ? 'The feeds named above were not served; the rest have nothing in this window.'
      : "The feeds named above didn't answer; the rest have nothing in this window.");
  // A failed feed's line, and the names lists'.
  const feedLine = (f, what) => `${what || FEED_NAMES[f]} did not load${explainedAbove ? '. See the panel above.' : whyOf(failOf(f))}`;
  const namesLine = `Company names did not load, so some listings on other exchanges are left out${namesProblem && namesProblem.limited ? " — EODHD's per-minute request limit was reached." : '.'}`;
  // ── One live region for the calendar's failures ──────────────────────
  // Each feed's line, the names line and the empty list's sentence were
  // live regions of their own, and their words followed the wait: about
  // nine announcements a pause -- when it started, when it ended ("See the
  // panel above."), after the reload. One region now,
  // its words what failed and why, never the seconds; put in once the load
  // has settled, so a feed failing a moment after another is not read
  // twice. The end of a wait is said once, by RateLimitWait (below).
  const failSummary = pendingFeeds.length ? null : ([]
    .concat(emptyAllFailed ? [emptyReason] : failedFeeds.map((f) => {
      const st = feedStatus[f] || {};
      return feedLine(f, f === 'dividends' && st.days && st.days.length && divCoverage && !divCoverage.none
        ? `Dividends for ${st.days.map(dayLabel).join(', ')}` : null);
    }))
    .concat(namesProblem && namesFeeds.length > 0 ? [namesLine] : [])
    .filter(Boolean).join(' '));
  const [liveSummary, setLiveSummary] = React.useState('');
  React.useEffect(() => {
    if (failSummary == null) return;
    setLiveSummary(failSummary);
  }, [failSummary]);
  // The wait that stopped a feed is over: said once, as on every screen.
  const limitShown = failedFeeds.some(f => failOf(f) && failOf(f).limited) || Boolean(namesProblem && namesProblem.limited);
  const waitWasRef = React.useRef(0);
  React.useEffect(() => {
    const was = waitWasRef.current;
    waitWasRef.current = waitLeft;
    if (was && !waitLeft && limitShown) RLW.announce(RLW.OVER);
  }, [waitLeft, limitShown]);
  // One Try again for every feed that failed, and the wait under it.
  const retryAllButton = (pad) => (
    <button type="button" data-retry-focus="true" aria-disabled={waitLeft ? 'true' : undefined} onClick={() => retryFeeds(failedFeeds)} style={{
      padding: pad, background: waitLeft ? 'transparent' : C3.logoGradient,
      border: waitLeft ? '1px solid ' + (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)') : 'none',
      borderRadius: '12px', color: waitLeft ? mutedInk : 'white', fontSize: '14px', fontWeight: '600',
      cursor: waitLeft ? 'not-allowed' : 'pointer',
    }}>
      {waitLeft ? `Try again in ${waitLeft} s` : 'Try again'}
    </button>
  );
  // Not a live region: the note counts every second; the press was said
  // once when it was held, by RateLimitWait.
  const allFailedWait = (margin) => rlWait.note && (
    <p data-wait-note="true" style={{ fontSize: 13, margin, color: isDark ? C3.textDark : C3.textLightTheme }}>{rlWait.note}</p>
  );
  // One line per feed that did not load, named, each with its own Try again;
  // and, while the list is up, the feeds still on their way.
  const feedProblems = (
    <React.Fragment>
      {/* Every feed failed and the list is empty: the list says so, with
          one Try again for all of them (below). */}
      {failedFeeds.length > 0 && !emptyAllFailed && (
        <div data-feed-problems="true" style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {failedFeeds.map((f) => {
            const st = feedStatus[f] || {};
            const what = f === 'dividends' && st.days && st.days.length && divCoverage && !divCoverage.none
              ? `Dividends for ${st.days.map(dayLabel).join(', ')}` : FEED_NAMES[f];
            return (
              <div key={f} data-feed-problem={f} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13, color: mutedInk }}>
                {/* Not a live region of its own: the calendar's one
                    (failSummary) reads every feed's line once. */}
                <span>{feedLine(f, what)}</span>
                <button type="button" data-retry-focus="true" aria-disabled={waitLeft ? 'true' : undefined}
                  aria-label={`Try again: ${FEED_NAMES[f]}${waitLeft ? ` (in ${waitLeft} s)` : ''}`}
                  onClick={() => retryFeeds([f])} style={{
                    padding: '6px 14px', background: waitLeft ? 'transparent' : C3.logoGradient,
                    border: waitLeft ? '1px solid ' + (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)') : 'none',
                    borderRadius: 10, color: waitLeft ? mutedInk : 'white', fontSize: 13, fontWeight: 600,
                    cursor: waitLeft ? 'not-allowed' : 'pointer',
                  }}>
                  {waitLeft ? `Try again in ${waitLeft} s` : 'Try again'}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {/* The names lists failed after every retry: what is left out, and a
          Try again that asks for them again. */}
      {namesProblem && namesFeeds.length > 0 && (
        <div data-names-problem="true" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13, color: mutedInk }}>
          {/* Read out by the calendar's one live region (failSummary). */}
          <span style={{ flex: '1 1 200px', minWidth: 0 }}>{namesLine}</span>
          <button type="button" data-retry-focus="true" aria-disabled={waitLeft ? 'true' : undefined}
            aria-label={`Try again: company names${waitLeft ? ` (in ${waitLeft} s)` : ''}`}
            onClick={() => retryFeeds(namesFeeds)} style={{
              padding: '6px 14px', background: waitLeft ? 'transparent' : C3.logoGradient,
              border: waitLeft ? '1px solid ' + (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)') : 'none',
              borderRadius: 10, color: waitLeft ? mutedInk : 'white', fontSize: 13, fontWeight: 600,
              cursor: waitLeft ? 'not-allowed' : 'pointer',
            }}>
            {waitLeft ? `Try again in ${waitLeft} s` : 'Try again'}
          </button>
        </div>
      )}
      {rlWait.note && !emptyAllFailed && (
        <p data-wait-note="true" style={{ fontSize: 13, margin: '0 0 12px', color: isDark ? C3.textDark : C3.textLightTheme }}>{rlWait.note}</p>
      )}
      {!loading && pendingFeeds.length > 0 && (
        <p role="status" style={{ fontSize: 12, margin: '0 0 12px', color: mutedInk }}>
          {`Still loading: ${pendingFeeds.map(f => FEED_NAMES[f]).join(', ')}…`}
        </p>
      )}
    </React.Fragment>
  );

  const Wrapper = embedded ? React.Fragment : window.AppLayout;
  const wrapperProps = embedded ? {} : { activeTab, onTabChange, onSettingsClick, theme };

  return (
    <Wrapper {...wrapperProps}>
      {/* The spinners' keyframes travel with the view: a host page without
          the terminal's global CSS showed a frozen ring. */}
      {/* A focused day cell had no outline and no shadow: Tab landed on it
          and nothing showed where. */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }
.cal-day:focus-visible, .cal-ticker:focus-visible, .cal-row-toggle:focus-visible { outline: 2px solid ${isDark ? '#f97316' : '#c2410c'}; outline-offset: 2px; }`}</style>
      {/* Header */}
      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <h1 ref={retryHeadingRef} tabIndex={-1} style={{ fontSize: '20px', fontWeight: '700', margin: 0 }}>Events Calendar</h1>
            {window.HelpTooltip && <HelpTooltip title="Events Calendar" text="Track upcoming earnings reports, dividend dates, stock splits, IPOs, and economic events that may impact your portfolio." isDark={isDark} />}
          </div>
          <p style={{ fontSize: '12px', color: isDark ? C3.textMutedDark : C3.textMutedLight, margin: 0 }}>
            Earnings, dividends, splits, IPOs & more
          </p>
        </div>
        <div style={{ display: 'flex', gap: '4px', background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)', borderRadius: '10px', padding: '4px' }}>
          <button aria-pressed={view === 'feed'} onClick={() => { window.Haptics?.light(); setView('feed'); }} style={{
            padding: '6px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer',
            background: 'transparent',
            color: isDark ? C3.textMutedDark : C3.textMutedLight,
            ...window.ToggleStyle.value(view === 'feed', isDark),
            fontSize: '12px', fontWeight: '600',
          }}>Feed</button>
          <button aria-pressed={view === 'grid'} onClick={() => { window.Haptics?.light(); setView('grid'); }} style={{
            padding: '6px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer',
            background: 'transparent',
            color: isDark ? C3.textMutedDark : C3.textMutedLight,
            ...window.ToggleStyle.value(view === 'grid', isDark),
            fontSize: '12px', fontWeight: '600',
          }}>Grid</button>
        </div>
      </div>

      <div style={{ padding: '0 20px' }}>
        {/* Event Type Filters */}
        {/* Web: underlined text tabs (the terminal's stylesheet .mi-tabbar, design stage
            2). The scope row under them and Feed/Grid are toggles of a value.
            Mini App: the pills. */}
        {window.APP_PLATFORM === 'WEB' ? (
          <div className="mi-tabbar" role="group" aria-label="Event types" style={{ marginBottom: 12 }}>
            {filterButtons.map(btn => (
              <button key={btn.id} type="button" className="mi-tab" aria-pressed={filter === btn.id} onClick={() => { window.Haptics?.light(); setFilter(btn.id); }}>
                {btn.label}
              </button>
            ))}
          </div>
        ) : (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', overflowX: 'auto', paddingBottom: '4px' }}>
          {filterButtons.map(btn => (
            <button key={btn.id} aria-pressed={filter === btn.id} onClick={() => { window.Haptics?.light(); setFilter(btn.id); }} style={{
              padding: '6px 14px', borderRadius: '100px', fontSize: '12px', fontWeight: '600',
              whiteSpace: 'nowrap', cursor: 'pointer', border: 'none',
              background: filter === btn.id ? C3.logoGradient : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'),
              color: filter === btn.id ? 'white' : (isDark ? C3.textDark : C3.textLightTheme),
            }}>
              {btn.label}
            </button>
          ))}
        </div>
        )}

        {/* How far the dividend strand reaches. EODHD's dividend calendar has
            no date range -- it answers one day per request -- so it covers
            days where earnings, splits and IPOs cover a quarter, and the
            screen used to leave that difference unexplained. */}
        {divCoverage && (filter === 'all' || filter === 'dividends') && (
          <div style={{ fontSize: '11px', marginBottom: '12px', color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
            {divCoverage.none
              ? 'Dividends are not loaded for this month (one request per day); pick the Dividends filter to load two weeks of it.'
              : divCoverage.grid
                ? `Dividends cover ${divCoverage.from} – ${divCoverage.to}${divMissedNote}; the other feeds cover the whole month.`
                : `Dividends cover ${divCoverage.from} – ${divCoverage.to}${divMissedNote}; earnings, splits and IPOs reach 90 days, economic events one week.`}
          </div>
        )}

        {/* AI Calendar Features */}
        {(() => {
          if (!events || events.length === 0) return null;
          if (!window.AIService.getSettings().enabled) return null;

          // Upcoming events (today on, by the local date). The briefing gets
          // the next five trading days in order of weight
          // (CalendarFormat.weekAhead), not the list's first thirty.
          const upcomingEvents = events.filter(e => e.date >= todayKey);
          const briefingEvents = window.CalendarFormat.weekAhead(events, todayKey, 30);

          const runBriefing = async () => {
            if (briefingLoading) return;
            setBriefingLoading(true);
            setBriefingError(null);
            setBriefingResult(null);
            window.Haptics?.medium();
            if (window.MIAnalytics) window.MIAnalytics.track('dl_mi_calendar_briefing', { event_count: briefingEvents.length });
            try {
              const result = await window.AIService.weekAheadBriefing(briefingEvents);
              setBriefingResult(result);
            } catch (e) {
              setBriefingError(e.message === 'AI_TOKENS_REQUIRED' ? (window.AIText ? window.AIText.OUT_OF_TOKENS : 'AI analysis is off. Add OPENAI_API_KEY to .env and restart to enable it.') : (window.AIText ? window.AIText.error(e) : e.message));
            }
            setBriefingLoading(false);
          };

          const runMatters = async () => {
            if (mattersLoading) return;
            setMattersLoading(true);
            setMattersError(null);
            setMattersResult(null);
            window.Haptics?.medium();
            try {
              let holdings, holdingsData;
              if (scope === 'watchlist') {
                // Build pseudo-holdings from watchlist symbols
                holdings = watchlist.map((w, i) => ({
                  id: 'wl-' + i,
                  symbol: w.symbol || w,
                  name: w.name || (w.symbol || w).split('.')[0],
                  type: 'stock',
                }));
                holdingsData = {};
                holdings.forEach(h => {
                  holdingsData[h.id] = { currentValue: 1, quantity: 0, pnl: 0 };
                });
              } else {
                // Portfolio holdings with transaction quantities
                const Storage = window.PortfolioStorage;
                const Calc = window.PortfolioCalculations;
                holdings = portfolio;
                holdingsData = {};
                portfolio.forEach(p => {
                  if (p.symbol) {
                    const txns = Storage ? Storage.getTransactionsByHolding(p.id) : [];
                    const qty = Calc && txns.length > 0 ? Calc.getHoldingQuantity(txns) : 0;
                    holdingsData[p.id] = { currentValue: qty || 1, quantity: qty, pnl: 0 };
                  }
                });
              }
              const result = await window.AIService.whatMattersForMe(upcomingEvents, holdings, holdingsData);
              setMattersResult(result);
            } catch (e) {
              setMattersError(e.message === 'AI_TOKENS_REQUIRED' ? (window.AIText ? window.AIText.OUT_OF_TOKENS : 'AI analysis is off. Add OPENAI_API_KEY to .env and restart to enable it.') : (window.AIText ? window.AIText.error(e) : e.message));
            }
            setMattersLoading(false);
          };

          return React.createElement('div', { style: { marginBottom: 16 } },
            // Buttons row
            (!briefingResult && !briefingLoading && !mattersResult && !mattersLoading) && React.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: briefingError || mattersError ? 8 : 0 } },
              // Week Ahead Briefing button
              React.createElement('button', {
                onClick: runBriefing,
                style: {
                  flex: 1, padding: '12px 14px', borderRadius: 14, border: 'none', cursor: 'pointer',
                  background: C3.logoGradient,
                  color: 'white', fontSize: 13, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                },
              },
                React.createElement('span', null, briefingCost ? `Week Ahead Briefing · ${briefingCost}` : 'Week Ahead Briefing'),
              ),
              // What Matters For Me button (only if portfolio/watchlist scope)
              (scope === 'portfolio' || scope === 'watchlist') && React.createElement('button', {
                onClick: runMatters,
                style: {
                  padding: '12px 14px', borderRadius: 14, cursor: 'pointer',
                  border: `1px solid ${isDark ? C3.lineDark : C3.lineLight}`,
                  background: isDark ? C3.fillDark : C3.fillLight,
                  color: isDark ? C3.textDark : C3.textLightTheme, fontSize: 13, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                },
              },
                React.createElement(Icon, { name: 'target', size: 16, color: isDark ? C3.textMutedDark : C3.textMutedLight }),
                React.createElement('span', null, mattersCost ? `For Me · ${mattersCost}` : 'For Me'),
              ),
            ),

            // Briefing loading
            briefingLoading && React.createElement('div', {
              style: {
                ...(isDark ? C3.glassDark : C3.glassLight),
                borderRadius: 16, padding: 20, textAlign: 'center',
                border: `1px solid ${isDark ? C3.lineDark : C3.lineLight}`,
              },
            },
              React.createElement('div', {
                style: { width: 24, height: 24, margin: '0 auto 12px', border: '3px solid ' + (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'), borderTopColor: isDark ? C3.textMutedDark : C3.textMutedLight, borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
              }),
              React.createElement('p', { style: { fontSize: 13, color: isDark ? C3.textMutedDark : C3.textMutedLight, margin: 0 } },
                `Analyzing the week ahead (${briefingEvents.length} key events)...`
              ),
            ),

            // Matters loading
            mattersLoading && React.createElement('div', {
              style: {
                ...(isDark ? C3.glassDark : C3.glassLight),
                borderRadius: 16, padding: 20, textAlign: 'center',
                border: `1px solid ${isDark ? C3.lineDark : C3.lineLight}`,
              },
            },
              React.createElement('div', {
                style: { width: 24, height: 24, margin: '0 auto 12px', border: '3px solid ' + (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'), borderTopColor: isDark ? C3.textMutedDark : C3.textMutedLight, borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
              }),
              React.createElement('p', { style: { fontSize: 13, color: isDark ? C3.textMutedDark : C3.textMutedLight, margin: 0 } },
                'Analyzing events for your holdings...'
              ),
            ),

            // Briefing error
            briefingError && React.createElement('div', {
              style: { ...(isDark ? C3.glassDark : C3.glassLight), borderRadius: 16, padding: 16, border: `1px solid ${C3.error}30` },
            },
              React.createElement('div', { style: { fontSize: 13, color: C3.error, marginBottom: 8 } }, briefingError),
              React.createElement('button', { onClick: runBriefing, style: { background: 'none', border: 'none', color: ink(C3.glowOrange), fontSize: 13, fontWeight: 600, cursor: 'pointer' } }, 'Try Again'),
            ),

            // Matters error
            mattersError && React.createElement('div', {
              style: { ...(isDark ? C3.glassDark : C3.glassLight), borderRadius: 16, padding: 16, border: `1px solid ${C3.error}30`, marginTop: briefingError ? 8 : 0 },
            },
              React.createElement('div', { style: { fontSize: 13, color: C3.error, marginBottom: 8 } }, mattersError),
              React.createElement('button', { onClick: runMatters, style: { background: 'none', border: 'none', color: isDark ? C3.textDark : C3.textLightTheme, fontSize: 13, fontWeight: 600, cursor: 'pointer' } }, 'Try Again'),
            ),

            // Briefing result
            briefingResult && React.createElement('div', {
              style: {
                ...(isDark ? C3.glassDark : C3.glassLight),
                borderRadius: 16, padding: 16, marginBottom: mattersResult ? 12 : 0,
                border: `1px solid ${isDark ? C3.lineDark : C3.lineLight}`,
                background: isDark ? C3.fillDark : C3.fillLight,
              },
            },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 } },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  React.createElement('span', { style: { fontSize: 14, fontWeight: 700, color: isDark ? C3.textDark : C3.textLightTheme } }, 'Week Ahead Briefing'),
                ),
                React.createElement('button', {
                  onClick: () => { setBriefingResult(null); setBriefingError(null); },
                  style: { background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: isDark ? C3.textMutedDark : C3.textMutedLight },
                }, React.createElement(Icon, { name: 'x', size: 16 })),
              ),
              React.createElement('div', { style: { fontSize: 13, lineHeight: 1.6, color: isDark ? C3.textDark : C3.textLightTheme } },
                window.renderMarkdown ? window.renderMarkdown(briefingResult) : briefingResult,
              ),
              React.createElement('div', {
                style: { marginTop: 12, paddingTop: 8, borderTop: '1px solid ' + (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'), fontSize: 10, opacity: 0.4, textAlign: 'right' }
              }, 'AI-generated — not financial advice'),
            ),

            // Matters result
            mattersResult && React.createElement('div', {
              style: {
                ...(isDark ? C3.glassDark : C3.glassLight),
                borderRadius: 16, padding: 16,
                border: `1px solid ${isDark ? C3.lineDark : C3.lineLight}`,
                background: isDark ? C3.fillDark : C3.fillLight,
              },
            },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 } },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  React.createElement(Icon, { name: 'target', size: 16, color: isDark ? C3.textMutedDark : C3.textMutedLight }),
                  React.createElement('span', { style: { fontSize: 14, fontWeight: 700, color: isDark ? C3.textDark : C3.textLightTheme } }, 'What Matters For You'),
                ),
                React.createElement('button', {
                  onClick: () => { setMattersResult(null); setMattersError(null); },
                  style: { background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: isDark ? C3.textMutedDark : C3.textMutedLight },
                }, React.createElement(Icon, { name: 'x', size: 16 })),
              ),
              React.createElement('div', { style: { fontSize: 13, lineHeight: 1.6, color: isDark ? C3.textDark : C3.textLightTheme } },
                window.renderMarkdown ? window.renderMarkdown(mattersResult) : mattersResult,
              ),
              React.createElement('div', {
                style: { marginTop: 12, paddingTop: 8, borderTop: '1px solid ' + (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'), fontSize: 10, opacity: 0.4, textAlign: 'right' }
              }, 'AI-generated — not financial advice'),
            ),
          );
        })()}

        {feedProblems}
        {/* The calendar's failures, read out once (failSummary). There
            before anything is put in it: a region added with its words is
            not read by every reader. */}
        <div role="status" aria-live="polite" data-cal-live="true" style={{ position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, border: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap' }}>{liveSummary}</div>

        {/* Loading (Grid: under its month navigation, below). A status, as
            in the grid: the list's was read by nothing. */}
        {loading && view !== 'grid' && (
          <div role="status" style={{ textAlign: 'center', padding: '48px 0' }}>
            <div style={{
              width: '32px', height: '32px',
              border: '3px solid ' + (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'), borderTopColor: C3.glowOrange,
              borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px',
            }} />
            <p style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Loading events...</p>
          </div>
        )}

        {/* Feed View */}
        {!loading && view === 'feed' && (
          <div>
            {groupedEvents.length === 0 ? (
              loadFailed ? (
              // A refusal is not an empty calendar. Under the panel that says
              // so, "No upcoming events found" told the reader the opposite.
              <div style={{ textAlign: 'center', padding: '48px 0' }}>
                {/* Read out by the calendar's one live region
                    (failSummary); the button below counts the wait. */}
                <p style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: '16px', fontSize: '14px' }}>
                  {emptyReason}
                </p>
                {emptyAllFailed && retryAllButton('12px 24px')}
                {emptyAllFailed && allFailedWait('12px 0 0')}
              </div>
              ) : (
              <div style={{ textAlign: 'center', padding: '48px 0' }}>
                <Icon name="calendar" size={48} color={isDark ? C3.textMutedDark : C3.textMutedLight} />
                <p style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight, marginTop: '16px', fontSize: '15px', fontWeight: 600 }}>
                  {scope === 'portfolio' ? 'No events for your portfolio' : scope === 'watchlist' ? 'No events for your watchlist' : 'No upcoming events found'}
                </p>
                {scope !== 'all' && (
                  <p style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight, fontSize: '13px', marginTop: '4px' }}>
                    No earnings, dividends, or splits scheduled for your {scope === 'portfolio' ? 'holdings' : 'watchlist symbols'} right now
                  </p>
                )}
              </div>
              )
            ) : (
              <React.Fragment>
                {/* The feed drew every event of ~90 days at once: 4,153 cards,
                    64k DOM nodes, a 380,000 px page on a phone.
                    It now starts at today (earlier days behind a button), shows
                    FEED_PER_DAY events a day with "Show all N", and
                    FEED_DAYS days at a time. */}
                {feedPast.length > 0 && (
                  <button type="button" onClick={() => setShowPastDays(v => !v)} aria-expanded={showPastDays} style={feedMoreStyle}>
                    {showPastDays ? 'Hide earlier days' : `Show earlier days (${feedPast.length} day${feedPast.length !== 1 ? 's' : ''}, ${feedPast.reduce((n, [, ev]) => n + ev.length, 0)} events)`}
                  </button>
                )}
                {feedDays.map(([date, dayEvents]) => {
                  const open = openDays[date];
                  const shown = open ? dayEvents : dayEvents.slice(0, FEED_PER_DAY);
                  return (
                  <div key={date} style={{ marginBottom: '20px' }}>
                    {/* Each day is a section of the list: an H2 under the
                        page's H1 (the page had an H1
                        and nothing under it). A div with the heading role:
                        the same element, look and text as before. */}
                    <div role="heading" aria-level={2} style={{
                      fontSize: '13px', fontWeight: '700', color: isDark ? C3.textMutedDark : C3.textMutedLight,
                      marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px',
                      display: 'flex', alignItems: 'center', gap: '8px',
                    }}>
                      {formatDate(date)}
                      <span style={{ fontSize: '11px', fontWeight: '500', color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                        {dayEvents.length} event{dayEvents.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {(() => { const keys = window.CalendarFormat.eventKeys(shown, 'list'); return shown.map((event, i) => renderEventCard(event, keys[i])); })()}
                    {dayEvents.length > FEED_PER_DAY && (
                      <button type="button" onClick={() => setOpenDays(o => ({ ...o, [date]: !open }))} aria-expanded={!!open} style={feedMoreStyle}>
                        {open ? `Show the first ${FEED_PER_DAY}` : (() => { const d = formatDate(date); return /^(Today|Tomorrow|Yesterday)$/.test(d) ? `Show all ${dayEvents.length} events ${d.toLowerCase()}` : `Show all ${dayEvents.length} events on ${d}`; })()}
                      </button>
                    )}
                  </div>
                  );
                })}
                {feedUpcoming.length > feedDayLimit && (
                  <button type="button" onClick={() => setFeedDayLimit(n => n + FEED_DAYS)} style={feedMoreStyle}>
                    {`Show the next ${Math.min(FEED_DAYS, feedUpcoming.length - feedDayLimit)} days`}
                  </button>
                )}
                {/* Upgrade banner for demo users */}
                {isDemo && React.createElement('div', {
                  key: 'upgrade-banner',
                  style: {
                    ...(isDark ? C3.glassDark : C3.glassLight),
                    borderRadius: '16px', padding: '20px', marginTop: '8px', marginBottom: '20px',
                    textAlign: 'center',
                    border: `1px solid ${C3.glowOrange}30`,
                    background: isDark ? 'rgba(249, 115, 22, 0.05)' : 'rgba(249, 115, 22, 0.03)',
                  },
                },
                  React.createElement('div', { style: { marginBottom: '8px', display: 'flex', justifyContent: 'center' } }, React.createElement(Icon, { name: 'calendar', size: 24, color: C3.glowOrange })),
                  React.createElement('h2', {
                    style: { fontWeight: '700', fontSize: '16px', marginBottom: '8px', color: isDark ? C3.textDark : C3.textLightTheme }
                  }, 'Upgrade for the full calendar'),
                  React.createElement('p', {
                    style: { fontSize: '13px', color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: '12px', lineHeight: '1.5' }
                  }, 'Get unlimited access to earnings, dividends, splits, IPOs, and economic events'),
                  React.createElement('div', {
                    style: { display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginBottom: '16px' }
                  },
                    ...[
                      ['trendUp', 'All Earnings'],
                      ['dollarSign', 'Dividends'],
                      ['repeat', 'Stock Splits'],
                      ['rocket', 'IPOs'],
                      ['globe', 'Economic Events'],
                    ].map(([icon, label]) =>
                      React.createElement('span', {
                        key: label,
                        style: { fontSize: '11px', padding: '4px 8px', borderRadius: '6px', background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)', color: isDark ? C3.textMutedDark : C3.textMutedLight, display: 'inline-flex', alignItems: 'center', gap: 4 }
                      }, React.createElement(Icon, { name: icon, size: 12 }), label)
                    )
                  ),
                  React.createElement('button', {
                    onClick: onUpgradeClick,
                    style: {
                      padding: '12px 24px', background: C3.logoGradient, border: 'none',
                      borderRadius: '12px', color: 'white', fontSize: '14px', fontWeight: '600', cursor: 'pointer',
                    }
                  }, 'Upgrade Now'),
                )}
              </React.Fragment>
            )}
          </div>
        )}

        {/* Grid View. The month navigation stays while the next month loads:
            it went with the grid, and Next month left the focus on <body> */}
        {view === 'grid' && (
          <div>
            {/* Month Navigation */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <button aria-label="Previous month" onClick={() => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1))} style={{
                width: '36px', height: '36px', borderRadius: '10px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                border: 'none', cursor: 'pointer', color: isDark ? C3.textDark : C3.textLightTheme,
              }}>
                <Icon name="chevronLeft" size={18} />
              </button>
              <h2 style={{ fontWeight: '700', fontSize: '16px', margin: 0, lineHeight: 'normal' }}>
                {selectedMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </h2>
              <button aria-label="Next month" onClick={() => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1))} style={{
                width: '36px', height: '36px', borderRadius: '10px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                border: 'none', cursor: 'pointer', color: isDark ? C3.textDark : C3.textLightTheme,
                transform: 'rotate(180deg)',
              }}>
                <Icon name="chevronLeft" size={18} />
              </button>
            </div>

            {loading ? (
              <div role="status" style={{ textAlign: 'center', padding: '48px 0' }}>
                <div style={{
                  width: '32px', height: '32px',
                  border: '3px solid ' + (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'), borderTopColor: C3.glowOrange,
                  borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px',
                }} />
                <p style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Loading events...</p>
              </div>
            ) : (<>
            {/* Every feed down: one sentence and one Try again, as in the
                feed, not a line per feed. */}
            {emptyAllFailed ? (
              <div data-grid-all-failed="true" style={{ textAlign: 'center', margin: '0 0 12px' }}>
                <p style={{ fontSize: '13px', margin: '0 0 8px', color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                  {emptyReason}{loadFailed === 'all' && !explainedAbove ? ' Empty days below are not "no events".' : ''}
                </p>
                {retryAllButton('8px 18px')}
                {allFailedWait('8px 0 0')}
              </div>
            ) : loadFailed && events.length === 0 && (
              <p style={{ textAlign: 'center', fontSize: '13px', margin: '0 0 12px', color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                The feeds named above did not answer for this month.
              </p>
            )}
            {/* Day Headers -- the same width cap as the date grid below, or
                the columns drift apart on a wide window (72px at 1440) and
                a Tuesday sits under "Thu". */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '4px', marginBottom: '8px', maxWidth: 600, margin: '0 auto 8px' }}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} style={{
                  textAlign: 'center', fontSize: '11px', fontWeight: '600',
                  color: isDark ? C3.textMutedDark : C3.textMutedLight, padding: '8px 0',
                }}>
                  {day}
                </div>
              ))}
            </div>

            {(() => {
              // Inline day-detail panel — replaces the old bottom-sheet
              // overlay. The user wanted normal page scroll instead of a
              // modal that darkened the calendar and broke scroll on
              // Opera. Rendered RIGHT AFTER the grid so the events appear
              // below the calendar without obscuring it.
              return null;
            })()}

            {/* Calendar Grid — square cells back, but capped at maxWidth
                so a 7-column row on desktop doesn't stretch each square
                past ~84px. Mobile width / 7 ≈ 50px tappable. */}
            <div ref={dayGridRef} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '4px', maxWidth: 600, margin: '0 auto' }}>
              {generateCalendarDays().map((day, i) => {
                if (!day) return <div key={i} style={{ aspectRatio: '1' }} />;
                const dayEvents = getEventsForDay(day);
                const isToday = day.toDateString() === new Date().toDateString();
                const isSelected = selectedDay && day.toDateString() === selectedDay.toDateString();
                const hasEvents = dayEvents.length > 0;
                const dominantColor = hasEvents ? dayEvents[0].color : null;
                // The one label a cell prints, in full. At 320 px it is cut
                // to "GR…" or "D…", which says nothing: the whole text is the
                // label's title and part of the cell's name.
                const top = hasEvents ? dayEvents[0] : null;
                const topShown = top && top.symbol
                  ? (top.type === 'economic' ? (top.countryFlag || top.symbol) : displaySymbol(top.symbol)) : '';
                const topFull = top && top.symbol
                  ? (top.type === 'economic' ? [top.symbol, top.title].filter(Boolean).join(' · ') : displaySymbol(top.symbol)) : '';
                const dayName = hasEvents
                  ? `${day.toDateString()}, ${dayEvents.length} event${dayEvents.length !== 1 ? 's' : ''}`
                    + (topFull ? (dayEvents.length > 1 ? `, first ${topFull}` : `: ${topFull}`) : '')
                  : undefined;

                return (
                  // A day with events opens them, so it is a control: it was
                  // a plain div with an onClick, and none of the twenty-one
                  // cells could be reached from the keyboard.
                  <div key={i}
                    onClick={hasEvents ? () => handleDayClick(day, dayEvents) : undefined}
                    className={hasEvents ? 'cal-day' : undefined}
                    role={hasEvents ? 'button' : undefined}
                    tabIndex={hasEvents ? 0 : undefined}
                    aria-label={dayName}
                    data-day={hasEvents ? ymdLocal(day) : undefined}
                    onKeyDown={hasEvents ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleDayClick(day, dayEvents); } } : undefined}
                    style={{
                    aspectRatio: '1',
                    ...(isDark ? C3.glassDark : C3.glassLight),
                    borderRadius: '10px', padding: '4px',
                    border: isSelected
                      ? `2px solid ${C3.glowOrange}`
                      : (isToday ? `2px solid ${C3.glowOrange}` : 'none'),
                    boxShadow: isSelected ? `0 0 0 2px ${C3.glowOrange}40` : 'none',
                    position: 'relative',
                    cursor: hasEvents ? 'pointer' : 'default',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
                    boxSizing: 'border-box',
                    // A grid item is as wide as its content unless told
                    // otherwise: CUYTMDKA.JK and EQMEBKIS-B.ST ran into the
                    // next day at 320-390 px. minWidth alone
                    // keeps the width; overflow stays visible so a 40 px cell
                    // grows a few px taller instead of cutting the ticker under
                    // the badge to orange slivers. The ticker cuts
                    // itself with an ellipsis.
                    minWidth: 0,
                  }}>
                    <span style={{
                      fontSize: '12px', lineHeight: '14px', fontWeight: isToday ? '700' : '500',
                      color: isToday ? ink(C3.glowOrange) : (isDark ? C3.textDark : C3.textLightTheme),
                    }}>
                      {day.getDate()}
                    </span>
                    {/* Count badge + symbol preview */}
                    {hasEvents && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '2px', gap: '1px', width: '100%', minWidth: 0 }}>
                        {/* Gradient count badge */}
                        <div style={{
                          minWidth: '18px', height: '16px', borderRadius: '8px', padding: '0 4px',
                          background: C3.logoGradient,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '10px', fontWeight: '700', color: 'white',
                        }}>
                          {dayEvents.length}
                        </div>
                        {/* Top event symbol preview */}
                        {dayEvents[0]?.symbol && (
                          <span title={topFull} style={{
                            fontSize: '9px', fontWeight: '600', // was 7px: unreadable
                            color: dominantColor ? ink(dominantColor) : (isDark ? C3.textMutedDark : C3.textMutedLight),
                            maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            textAlign: 'center', lineHeight: '11px', display: 'block',
                          }}>
                            {topShown}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Inline day-detail panel — sits below the calendar grid and
                scrolls with the page. Replaces the bottom-sheet modal
                that broke scroll on Opera and looked cramped. */}
            {selectedDay && (() => {
              const dayEvents = getEventsForDay(selectedDay);
              const dateLabel = selectedDay.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
              return (
                <div ref={dayPanelRef} style={{ marginTop: 20, maxWidth: 720, marginLeft: 'auto', marginRight: 'auto', scrollMarginTop: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
                    <div>
                      <h2 style={{ fontWeight: 700, fontSize: 16, margin: 0, lineHeight: 'normal', color: isDark ? C3.textDark : C3.textLightTheme }}>{dateLabel}</h2>
                      <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginTop: 2 }}>
                        {dayEvents.length} event{dayEvents.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <button onClick={clearSelectedDay} style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: isDark ? C3.textMutedDark : C3.textMutedLight,
                      fontSize: 12, fontWeight: 600, padding: '6px 10px',
                    }}>Clear</button>
                  </div>
                  {dayEvents.length === 0
                    ? <div style={{ padding: '16px 0', textAlign: 'center', color: isDark ? C3.textMutedDark : C3.textMutedLight, fontSize: 13 }}>No events on this day</div>
                    : (() => {
                      // Every company now stays in the calendar, so a busy
                      // day holds over a thousand: twenty first, like the feed.
                      const dk = 'grid-' + ymdLocal(selectedDay);
                      const open = openDays[dk];
                      return (
                        <React.Fragment>
                          {(() => { const list = open ? dayEvents : dayEvents.slice(0, FEED_PER_DAY); const keys = window.CalendarFormat.eventKeys(list, 'day'); return list.map((event, i) => renderEventCard(event, keys[i])); })()}
                          {dayEvents.length > FEED_PER_DAY && (
                            <button type="button" onClick={() => setOpenDays(o => ({ ...o, [dk]: !open }))} aria-expanded={!!open} style={feedMoreStyle}>
                              {open ? `Show the first ${FEED_PER_DAY}` : `Show all ${dayEvents.length} events`}
                            </button>
                          )}
                        </React.Fragment>
                      );
                    })()
                  }
                </div>
              );
            })()}
            </>)}
          </div>
        )}
      </div>
    </Wrapper>
  );
};
