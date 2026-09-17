const APP_SOURCE = 'DAFTAR_NOMINATIF_APP';
const EXT_SOURCE = 'DAFTAR_NOMINATIF_EXTENSION';

if (location.hostname === 'aplikasi.atrbpn.go.id') {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'CHECK_ONE') return;
    checkOne(message.record).then(result => sendResponse({ ok: true, result })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  });
} else {
  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.source !== APP_SOURCE) return;
    const message = event.data;
    if (message.type === 'PING_EXTENSION') {
      chrome.runtime.sendMessage({ type: 'PING_EXTENSION' }, response => {
        window.postMessage({ source: EXT_SOURCE, type: 'EXTENSION_READY', version: response?.version || '' }, '*');
      });
    }
    if (message.type === 'CHECK_BIDANG') {
      chrome.runtime.sendMessage({ type: 'CHECK_BIDANG', requestId: message.requestId, records: message.records }, response => {
        if (!response?.ok) window.postMessage({ source: EXT_SOURCE, type: 'BIDANG_ERROR', requestId: message.requestId, error: response?.error || 'Ekstensi gagal memulai pengecekan.' }, '*');
      });
    }
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'RELAY_TO_APP') window.postMessage({ source: EXT_SOURCE, ...message.payload }, '*');
  });
  window.postMessage({ source: EXT_SOURCE, type: 'EXTENSION_READY', version: chrome.runtime.getManifest().version }, '*');
}

async function checkOne(record) {
  const nomorInput = findInput('nomor berkas', 0);
  const tahunInput = findInput('tahun berkas', 1);
  const searchButton = [...document.querySelectorAll('button,input[type="submit"]')].find(el => /cari\s*berkas/i.test(el.textContent || el.value || ''));
  if (!nomorInput || !tahunInput || !searchButton) throw new Error('Form Informasi Berkas tidak ditemukan. Pastikan sudah login dan berada di menu Informasi Berkas.');

  setValue(nomorInput, String(record.nomor));
  setValue(tahunInput, String(record.tahun));
  searchButton.click();
  const text = await waitForResult(`${record.nomor}/${record.tahun}`);
  const bidang = text.match(/sejumlah\s+(\d+)\s+bidang/i);
  if (bidang) return { jumlahBidang: Number(bidang[1]), statusBidang: 'Berhasil' };
  if (/tidak\s+ditemukan|data\s+tidak\s+ada/i.test(text)) return { jumlahBidang: null, statusBidang: 'Tidak ditemukan' };
  throw new Error(`Jumlah bidang untuk ${record.nomor}/${record.tahun} tidak ditemukan pada hasil.`);
}

function findInput(labelText, fallbackIndex) {
  const label = [...document.querySelectorAll('label')].find(el => (el.textContent || '').toLowerCase().includes(labelText));
  if (label) {
    const byFor = label.htmlFor && document.getElementById(label.htmlFor);
    if (byFor) return byFor;
    const nearby = label.parentElement?.querySelector('input');
    if (nearby) return nearby;
  }
  return [...document.querySelectorAll('input:not([type="hidden"]):not([type="submit"])')].filter(el => el.offsetParent !== null)[fallbackIndex];
}

function setValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function waitForResult(expectedNumber) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30000;
    const check = () => {
      const text = document.body.innerText || '';
      if (text.includes(expectedNumber) && (/sejumlah\s+\d+\s+bidang/i.test(text) || /tidak\s+ditemukan|data\s+tidak\s+ada/i.test(text))) return resolve(text);
      if (Date.now() > deadline) return reject(new Error(`Hasil ${expectedNumber} tidak muncul dalam 30 detik.`));
      setTimeout(check, 400);
    };
    check();
  });
}
