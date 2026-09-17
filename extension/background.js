const ATR_URL = 'https://aplikasi.atrbpn.go.id/layananpublik/tatapmuka/Home/InformasiBerkas';
let running = false;
let lastAppTabId = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'PING_EXTENSION') {
    lastAppTabId = sender.tab?.id || lastAppTabId;
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return;
  }
  if (message?.type === 'CHECK_BIDANG') {
    if (running) {
      sendResponse({ ok: false, error: 'Pengecekan lain masih berjalan.' });
      return;
    }
    running = true;
    lastAppTabId = sender.tab?.id || lastAppTabId;
    sendResponse({ ok: true });
    runBatch(message.records || [], sender.tab?.id, message.requestId)
      .catch(async error => {
        await relay(sender.tab?.id, { type: 'BIDANG_ERROR', requestId: message.requestId, error: error.message });
        await notify('Pengecekan terhenti', error.message);
        await chrome.action.setBadgeText({ text: '!' });
        await chrome.action.setBadgeBackgroundColor({ color: '#B6402C' });
      })
      .finally(() => { running = false; });
    return true;
  }
});

async function runBatch(records, appTabId, requestId) {
  if (!appTabId) throw new Error('Tab aplikasi tidak ditemukan.');
  const atrTab = await openAtrTab(appTabId);
  await relay(appTabId, { type: 'BIDANG_STARTED', requestId, total: records.length });
  await waitForTab(atrTab.id);
  let success = 0;
  let failed = 0;
  await chrome.action.setBadgeBackgroundColor({ color: '#1F67AD' });
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    await chrome.action.setBadgeText({ text: `${index + 1}` });
    await relay(appTabId, { type: 'BIDANG_PROGRESS', requestId, index, total: records.length, record });
    let response;
    try {
      response = await chrome.tabs.sendMessage(atrTab.id, { type: 'CHECK_ONE', record });
    } catch {
      await chrome.tabs.reload(atrTab.id);
      await waitForTab(atrTab.id);
      try {
        response = await chrome.tabs.sendMessage(atrTab.id, { type: 'CHECK_ONE', record });
      } catch {
        throw new Error('Halaman ATR/BPN belum siap. Pastikan Anda sudah login, lalu buka menu Informasi Berkas dan muat ulang halamannya.');
      }
    }
    let result;
    if (!response?.ok) {
      const error = response?.error || `Gagal memeriksa ${record.nomor}/${record.tahun}.`;
      if (/form informasi berkas tidak ditemukan|pastikan sudah login/i.test(error)) throw new Error(error);
      result = { ...record, jumlahBidang: null, statusBidang: 'Gagal', error };
      failed += 1;
    } else {
      result = { ...record, ...response.result };
      if (result.statusBidang === 'Berhasil') success += 1; else failed += 1;
    }
    await relay(appTabId, { type: 'BIDANG_RESULT', requestId, index, total: records.length, result });
    await wait(1200);
  }
  await relay(appTabId, { type: 'BIDANG_COMPLETE', requestId, total: records.length, success, failed });
  await chrome.action.setBadgeText({ text: '✓' });
  await chrome.action.setBadgeBackgroundColor({ color: '#17805C' });
  await notify('Pengecekan selesai', `${records.length} nomor diperiksa: ${success} berhasil, ${failed} bermasalah.`);
}

async function openAtrTab(appTabId) {
  const appTab = await chrome.tabs.get(appTabId);
  const tab = await chrome.tabs.create({ windowId: appTab.windowId, url: ATR_URL, active: true });
  await chrome.windows.update(appTab.windowId, { focused: true });
  return tab;
}

async function waitForTab(tabId) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === 'complete') return current;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error('Halaman ATR/BPN terlalu lama dimuat.')); }, 30000);
    const listener = (id, info, tab) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(tab);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function relay(tabId, payload) {
  if (!tabId) return;
  try { await chrome.tabs.sendMessage(tabId, { type: 'RELAY_TO_APP', payload }); } catch {}
}

async function notify(title, message) {
  try {
    await chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 2 });
  } catch {}
}

chrome.notifications.onClicked.addListener(async () => {
  if (!lastAppTabId) return;
  try {
    const tab = await chrome.tabs.get(lastAppTabId);
    await chrome.tabs.update(lastAppTabId, { active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  } catch {}
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
