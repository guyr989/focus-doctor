const ENDPOINT = 'http://127.0.0.1:47113/tab';

async function report() {
  const [tab] = await chrome.tabs.query({active: true, lastFocusedWindow: true});
  if (!tab?.url) return;
  let host = null;
  try {
    host = new URL(tab.url).hostname || null;
  } catch {}
  const body = JSON.stringify({host, pageTitle: tab.title ?? null});
  fetch(ENDPOINT, {method: 'POST', headers: {'content-type': 'application/json'}, body}).catch(() => {});
}

// The daemon forgets a report after 90 s, so a disabled or crashed extension cannot keep
// stamping its last site on every browser window. Alarms are the only timer that survives
// the service worker being put to sleep; 0.5 min is the smallest period Chrome allows.
chrome.alarms.create('heartbeat', {periodInMinutes: 0.5});
chrome.alarms.onAlarm.addListener(report);

chrome.tabs.onActivated.addListener(report);
chrome.windows.onFocusChanged.addListener(report);
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  if (tab.active && (change.title || change.url || change.status === 'complete')) report();
});
