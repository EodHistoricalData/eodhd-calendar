// Money — one formatter for every price, market cap, dividend and EPS the
// asset page and the calendar print.
//
// Why: nothing in js/ knew about currencies. Every
// figure was prefixed with a hard-coded "$", so VOD.LSE — quoted in pence —
// showed "$123.90" for a 123.9p share, a market cap of "£28.63B" as
// "$28.63B", and a GBP dividend as "$0.0204".
//
// Rules the callers rely on:
//   • A value that is not a finite number ("NA", null, "", NaN) is MISSING.
//     It is never formatted as 0 and never used as a price or a rate
//     ("NA" is truthy, so `close || previousClose` kept it).
//   • Minor-unit currencies stay in their minor unit: GBX (and the GBp
//     spelling) prints "123.90p", ZAC "1,234.00c", ILA "1,234.00 ag". That is
//     how the exchange quotes them and how EODHD delivers prices, technicals
//     and 52-week ranges. Market cap, EPS and dividends-per-share come from
//     EODHD in the MAJOR unit (VOD.LSE: MarketCapitalization 28.6e9 GBP,
//     DividendShare 0.046 GBP, measured 2026-09-30) — callers pass
//     Money.majorOf(ccy) for those.
//   • An unknown currency (indices, bond yields, commodities) prints the bare
//     number: no symbol is better than a wrong one.
//
// Pure, no React, no DOM — loaded early from CORE_FILES and unit-tested.
(function () {
  if (window.Money) return;

  // Minor units: code -> { major, suffix }.
  const MINOR = {
    GBX: { major: 'GBP', suffix: 'p' },
    ZAC: { major: 'ZAR', suffix: 'c' },
    ILA: { major: 'ILS', suffix: ' ag' },
  };

  // Listing currency by exchange suffix — the fallback when fundamentals are
  // not loaded (or not available: forex, crypto). Only exchanges whose quote
  // currency is unambiguous; anything else stays null (bare number).
  const EXCHANGE_CCY = {
    US: 'USD', NYSE: 'USD', NASDAQ: 'USD', BATS: 'USD', AMEX: 'USD', OTC: 'USD', PINK: 'USD',
    LSE: 'GBX',
    XETRA: 'EUR', F: 'EUR', BE: 'EUR', DU: 'EUR', HM: 'EUR', MU: 'EUR', STU: 'EUR', HA: 'EUR',
    PA: 'EUR', AS: 'EUR', BR: 'EUR', LS: 'EUR', IR: 'EUR', MC: 'EUR', MI: 'EUR', VI: 'EUR', HE: 'EUR',
    SW: 'CHF', VX: 'CHF',
    ST: 'SEK', CO: 'DKK', OL: 'NOK', IC: 'ISK', WAR: 'PLN', PR: 'CZK', BUD: 'HUF',
    TO: 'CAD', V: 'CAD', NEO: 'CAD', CN: 'CAD',
    HK: 'HKD', SHG: 'CNY', SHE: 'CNY', TW: 'TWD', TWO: 'TWD', KO: 'KRW', KQ: 'KRW',
    T: 'JPY', TSE: 'JPY', AU: 'AUD', NZ: 'NZD', SG: 'SGD', KLSE: 'MYR', BK: 'THB', JK: 'IDR', PSE: 'PHP',
    NSE: 'INR', BSE: 'INR', SR: 'SAR', TA: 'ILA', JSE: 'ZAC', SA: 'BRL', MX: 'MXN', BA: 'ARS', SN: 'CLP',
    IS: 'TRY', AT: 'EUR',
  };

  // First finite number of a value; null for "NA", "", null, undefined, NaN.
  function num(v) {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }

  function firstFinite() {
    for (let i = 0; i < arguments.length; i++) {
      const n = num(arguments[i]);
      if (n != null) return n;
    }
    return null;
  }

  function norm(ccy) {
    if (!ccy || typeof ccy !== 'string') return null;
    const c = ccy.trim();
    if (!c) return null;
    // "GBp" is the other common spelling of pence (Yahoo, some EODHD rows).
    if (c === 'GBp') return 'GBX';
    return c.toUpperCase();
  }

  function isMinor(ccy) { return !!MINOR[norm(ccy)]; }

  function majorOf(ccy) {
    const c = norm(ccy);
    if (!c) return null;
    return MINOR[c] ? MINOR[c].major : c;
  }

  // Currency a symbol is quoted in, from its suffix alone.
  //   AAPL.US -> USD, VOD.LSE -> GBX, EURUSD.FOREX -> USD, BTC-USD.CC -> USD
  // Returns null for indices, bonds, commodities and unknown exchanges.
  function currencyForSymbol(symbol) {
    const s = String(symbol || '').toUpperCase();
    if (!s) return null;
    const dot = s.lastIndexOf('.');
    if (dot === -1) {
      // A bare pair is read as SymbolCode reads it: "EURGBP" is EURGBP.FOREX
      // in pounds, not a US listing in dollars.
      const SC = typeof window !== 'undefined' ? window.SymbolCode : null;
      const venue = SC && SC.pairVenue ? SC.pairVenue(s) : null;
      if (venue) return currencyForSymbol(s + '.' + venue);
      return /^[A-Z0-9-]{1,6}$/.test(s) ? 'USD' : null; // bare = US listing
    }
    const code = s.slice(0, dot);
    const ex = s.slice(dot + 1);
    if (ex === 'FOREX') return /^[A-Z]{6}$/.test(code) ? code.slice(3) : null;
    if (ex === 'CC') {
      const q = code.split('-')[1];
      return q && /^[A-Z]{3}$/.test(q) ? q : null;
    }
    return EXCHANGE_CCY[ex] || null;
  }

  // The listing's own currency where the app has seen it (fundamentals, a
  // search row). The suffix is a guess: 0R0X.LSE is Tesla on the LSE quoted
  // in US dollars, and the alerts table showed "900.00p ... from 379.07p"
  // while the card said $379.52. Kept per browser, bounded.
  const KNOWN_KEY = 'mi_listing_ccy';
  const KNOWN_MAX = 400;
  // Storage may be blocked or full: what this tab learned is kept in memory
  // too, and a re-read (another tab wrote) merges into it rather than
  // replacing it. Stored values win for keys both have, except this tab's
  // writes storage refused (unsaved), which are newer.
  let known = null;
  let stale = true;               // storage may hold writes this copy has not seen
  const unsaved = {};
  function readStored() {
    try {
      const o = JSON.parse(localStorage.getItem(KNOWN_KEY) || 'null');
      return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
    } catch (_) { return null; }
  }
  function bound(m) {
    const keys = Object.keys(m);
    if (keys.length > KNOWN_MAX) keys.slice(0, keys.length - KNOWN_MAX).forEach((x) => { delete m[x]; delete unsaved[x]; });
  }
  function knownMap() {
    if (known && !stale) return known;
    stale = false;
    const stored = readStored();
    if (!stored) { known = known || {}; return known; }
    if (known) Object.keys(known).forEach((x) => { if (!(x in stored)) stored[x] = known[x]; });
    Object.keys(unsaved).forEach((x) => { delete stored[x]; stored[x] = unsaved[x]; });
    bound(stored);
    known = stored;
    return known;
  }
  function symKey(symbol) {
    const s = String(symbol || '').trim().toUpperCase();
    return s && s.indexOf('.') !== -1 ? s : (s ? s + '.US' : '');
  }
  function remember(symbol, ccy) {
    const k = symKey(symbol);
    const c = norm(ccy);
    if (!k || !c || !/^[A-Z]{3}$/.test(c)) return;
    stale = true;                 // another tab may have written since: merge, not overwrite
    const m = knownMap();
    if (m[k] === c) return;
    delete m[k];
    m[k] = c;
    bound(m);
    try {
      localStorage.setItem(KNOWN_KEY, JSON.stringify(m));
      Object.keys(unsaved).forEach((x) => { delete unsaved[x]; });
    } catch (_) { unsaved[k] = c; }
  }
  try { window.addEventListener('storage', (e) => { if (!e || e.key === KNOWN_KEY || e.key === null) stale = true; }); } catch (_) { /* no window events */ }
  function knownCurrency(symbol) {
    const k = symKey(symbol);
    return (k && knownMap()[k]) || null;
  }
  // What a price of this symbol is in: the seen currency, else the suffix.
  function listingCurrency(symbol) {
    return knownCurrency(symbol) || currencyForSymbol(symbol);
  }

  // The instrument's currency: fundamentals first (General.CurrencyCode is the
  // listing currency EODHD prices it in), then the quote, then what was seen
  // before, then the suffix.
  function currencyOf(symbol, fundamentals, quote) {
    const g = fundamentals && fundamentals.General;
    const seen = norm(g && g.CurrencyCode) || norm(quote && (quote.currency || quote.Currency));
    if (seen) { remember(symbol, seen); return seen; }
    return listingCurrency(symbol);
  }

  function groupDigits(n, decimals) {
    return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  // "$123.90", "€201.50", "123.90p", "1,234 KRW"-style fallback; 'N/A' when missing.
  //   opts.decimals — fixed decimals (default 2)
  //   opts.missing  — text for a missing value (default 'N/A')
  function format(value, ccy, opts) {
    const o = opts || {};
    const n = num(value);
    if (n == null) return o.missing != null ? o.missing : 'N/A';
    const decimals = o.decimals != null ? o.decimals : 2;
    const c = norm(ccy);
    if (!c) return groupDigits(n, decimals);
    if (MINOR[c]) return groupDigits(n, decimals) + MINOR[c].suffix;
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: c, currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: decimals, maximumFractionDigits: decimals,
      }).format(n);
    } catch (_) {
      // Not an ISO code Intl knows — say the code rather than guess a symbol.
      return groupDigits(n, decimals) + ' ' + c;
    }
  }

  // "$28.63B" / "£28.63B" — for market caps and other large sums.
  function compact(value, ccy, opts) {
    const o = opts || {};
    const n = num(value);
    if (n == null || n === 0) return o.missing != null ? o.missing : 'N/A';
    const abs = Math.abs(n);
    const [div, unit] = abs >= 1e12 ? [1e12, 'T'] : abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'K'] : [1, ''];
    const decimals = o.decimals != null ? o.decimals : (unit ? 2 : 0);
    const c = norm(ccy);
    if (c && MINOR[c]) return groupDigits(n / div, decimals) + unit + MINOR[c].suffix;
    return format(n / div, c, { decimals }) + unit;
  }

  // A flow or a difference: the sign goes before the currency, as a real
  // minus. "NET $-92.91M" on the Insiders tab is now
  // "-$92.91M" with a real minus (U+2212); opts.plus adds "+" to a gain.
  // Zero is "$0", not N/A.
  function signedCompact(value, ccy, opts) {
    const o = opts || {};
    const n = num(value);
    if (n == null) return o.missing != null ? o.missing : 'N/A';
    if (n === 0) return format(0, ccy, { decimals: 0 });
    const body = compact(Math.abs(n), ccy, { decimals: o.decimals });
    // U+2060 WORD JOINER keeps the sign on the amount's line: at 390/320
    // the Insiders tile broke after the minus.
    const sign = n < 0 ? '\u2212' : (o.plus ? '+' : '');
    return sign ? sign + '\u2060' + body : body;
  }

  window.Money = {
    num, firstFinite, isMinor, majorOf, currencyForSymbol, currencyOf, format, compact, signedCompact,
    remember, knownCurrency, listingCurrency,
    _MINOR: MINOR, _EXCHANGE_CCY: EXCHANGE_CCY,
  };
})();
