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

chrome.tabs.onActivated.addListener(report);
chrome.windows.onFocusChanged.addListener(report);
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  if (tab.active && (change.title || change.url || change.status === 'complete')) report();
});
