/**
 * Generated. The app's identity -- used for link tags, the key screen and the
 * footer -- and the check that React loaded before anything reads it.
 */
window.APP_META = {
  "app": "calendar",
  "repo": "eodhd-calendar",
  "title": "EODHD Market Calendar",
  "description": "Earnings, dividends, splits, IPOs and economic events in one calendar — on your own EODHD key.",
  "keyNote": "Which of the five calendar feeds a key reaches depends on the plan, and whatever yours lacks is named on screen in EODHD's own words. A first load costs about 90–115 API calls, most of them Screener API pages that rank each day's companies, so the free tier's twenty a day does not cover one.",
  "storage": []
};

if (!window.React || !window.ReactDOM) {
  var bootError = document.getElementById('boot-error');
  if (bootError) bootError.style.display = 'block';
  throw new Error('React did not load from unpkg.com, so the app cannot start. See the message on the page.');
}
