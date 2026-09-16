/* ---------- Konfigurasi Supabase ---------- */
const SUPABASE_URL = 'https://gbnxfuafjmfbfoqhsqjo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_1FnQL6fSNKdB1Bgdv4p95w_qZArM7Rg';

/* ---------- Supabase REST client ---------- */
const SB = {
  headers() {
    return {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
  },
  async list(table) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=id.asc`, { headers: this.headers() });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { console.warn('SB.list error', table, e); return null; }
  },
  async insert(table, row) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(row) });
      if (!res.ok) throw new Error(await res.text());
      return await res.json();
    } catch (e) { console.error('SB.insert error', table, e); return null; }
  },
  async update(table, id, row) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, { method: 'PATCH', headers: this.headers(), body: JSON.stringify(row) });
      if (!res.ok) throw new Error(await res.text());
      return await res.json();
    } catch (e) { console.error('SB.update error', table, e); return null; }
  },
  async remove(table, id) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, { method: 'DELETE', headers: this.headers() });
      if (!res.ok) throw new Error(await res.text());
      return true;
    } catch (e) { console.error('SB.remove error', table, e); return false; }
  },
  async updateKas(row) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/kas?id=eq.1`, { method: 'PATCH', headers: this.headers(), body: JSON.stringify(row) });
      if (!res.ok) throw new Error(await res.text());
      return await res.json();
    } catch (e) { console.error('SB.updateKas error', e); showToast('Gagal update kas di server'); return null; }
  }
};

/* ---------- Local Storage Helper for Offline / Fallback ---------- */
const LS = {
  get(key, def = []) {
    try {
      const val = localStorage.getItem('nyamhap_' + key);
      return val ? JSON.parse(val) : def;
    } catch { return def; }
  },
  set(key, val) {
    try { localStorage.setItem('nyamhap_' + key, JSON.stringify(val)); } catch (e) { console.error(e); }
  }
};

/* ---------- State ---------- */
let data = { penjualan: [], pengeluaran: [], stok: [], aset: [], kas: { fikar: 0, tasia: 0, piutang: 0 }, income: [] };
let currentPeriod = 'all'; // weekly | monthly | yearly | all
const DEFAULT_HPP_SATUAN = 2238;

/* ---------- Pagination State (Maksimal 7 Baris per Tabel) ---------- */
const PAGE_SIZE = 7;
const tablePages = {
  penjualan: 1,
  pengeluaran: 1,
  stok: 1,
  income: 1
};

function renderPaginationControls(tableKey, totalItems, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  if (tablePages[tableKey] > totalPages) tablePages[tableKey] = totalPages;
  if (tablePages[tableKey] < 1) tablePages[tableKey] = 1;
  const current = tablePages[tableKey];

  if (totalItems <= PAGE_SIZE) {
    if (totalItems === 0) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = `
      <span class="page-info">Menampilkan ${totalItems} data (Maks. 7/hal)</span>
      <span class="page-info" style="font-size:0.75rem;color:var(--ink-soft);">Hal 1 dari 1</span>
    `;
    return;
  }

  const startIdx = (current - 1) * PAGE_SIZE + 1;
  const endIdx = Math.min(current * PAGE_SIZE, totalItems);

  let buttonsHtml = `
    <button class="page-btn" data-page-table="${tableKey}" data-page="${current - 1}" ${current === 1 ? 'disabled' : ''}>&larr; Prev</button>
  `;

  for (let p = 1; p <= totalPages; p++) {
    buttonsHtml += `
      <button class="page-btn ${p === current ? 'active' : ''}" data-page-table="${tableKey}" data-page="${p}">${p}</button>
    `;
  }

  buttonsHtml += `
    <button class="page-btn" data-page-table="${tableKey}" data-page="${current + 1}" ${current === totalPages ? 'disabled' : ''}>Next &rarr;</button>
  `;

  container.innerHTML = `
    <span class="page-info">Menampilkan ${startIdx}&ndash;${endIdx} dari ${totalItems} data</span>
    <div class="page-controls">${buttonsHtml}</div>
  `;
}

const escapeHTML = str => String(str || '').replace(/[&<>'"]/g,
  tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
);

const fmtRp = n => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');

function todayStr() { return new Date().toISOString().slice(0, 10); }

function getStockValue(item) {
  if (item.harga_total !== undefined && item.harga_total !== null) {
    return Number(item.harga_total) || 0;
  }
  return Number(item.nilai) || 0;
}

function getStockQty(item) {
  return item.qty !== undefined && item.qty !== null ? Number(item.qty) : 0;
}

// Tabel `stok` di Supabase memakai kolom `harga_total`; jangan kirim kolom
// `nilai` karena kolom itu tidak ada dan membuat PATCH/POST ditolak.
function stockPayload(nama, qty, hargaTotal) {
  return {
    nama,
    qty,
    harga_total: hargaTotal
  };
}

// Tabel stok belum memiliki kolom untuk asal dana pembelian. Metadata ini
// disimpan pada catatan pengeluaran yang memang dibuat bersama stok, sehingga
// pengembalian kas tetap dapat dilakukan dari perangkat mana pun.
const STOCK_EXPENSE_MARKER = '[[NYAMHAP_STOCK:';

function stockExpenseLabel(stockId, nama, kasSource = 'none', kasAmount = 0) {
  return `Bahan: ${nama} ${STOCK_EXPENSE_MARKER}${stockId}|${kasSource}|${kasAmount}]]`;
}

function parseStockExpense(item) {
  const match = String(item || '').match(/\[\[NYAMHAP_STOCK:(\d+)\|(fikar|tasia|none)\|(\d+(?:\.\d+)?)\]\]/);
  if (!match) return null;
  return { stockId: match[1], kasSource: match[2], kasAmount: Number(match[3]) || 0 };
}

function displayExpenseItem(item) {
  return String(item || '').replace(/\s*\[\[NYAMHAP_STOCK:\d+\|(fikar|tasia|none)\|\d+(?:\.\d+)?\]\]$/, '');
}

function findLinkedStockExpense(stockRow) {
  return data.pengeluaran.find(exp => {
    const meta = parseStockExpense(exp.item);
    return meta && String(meta.stockId) === String(stockRow.id);
  }) || null;
}

function getStockCashRefund(stockRow) {
  const expense = findLinkedStockExpense(stockRow);
  const meta = expense && parseStockExpense(expense.item);
  return meta && (meta.kasSource === 'fikar' || meta.kasSource === 'tasia') && meta.kasAmount > 0
    ? { expense, source: meta.kasSource, amount: meta.kasAmount }
    : null;
}

function notifyOutOfStock() {
  const emptyItems = data.stok
    .filter(item => getStockQty(item) <= 0)
    .map(item => escapeHTML(item.nama).trim())
    .filter(Boolean);

  if (emptyItems.length > 0) {
    showToast(`⚠️ Stok habis: ${emptyItems.join(', ')}. Segera restok.`);
  }
}

/* ---------- Filter periode ---------- */
function getPeriodRange(period) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (period === 'weekly') {
    const day = today.getDay(); // 0=Minggu
    const diffToMonday = (day === 0 ? 6 : day - 1);
    const monday = new Date(today);
    monday.setDate(today.getDate() - diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: monday, end: sunday };
  }
  if (period === 'monthly') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { start, end };
  }
  if (period === 'yearly') {
    const start = new Date(today.getFullYear(), 0, 1);
    const end = new Date(today.getFullYear(), 11, 31);
    return { start, end };
  }
  return null; // all
}

function inRange(dateStr, range) {
  if (!range) return true;
  if (!dateStr) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  return target >= range.start && target <= range.end;
}

function filteredPenjualan() {
  const range = getPeriodRange(currentPeriod);
  return data.penjualan.filter(r => inRange(r.tanggal, range));
}
function filteredPengeluaran() {
  const range = getPeriodRange(currentPeriod);
  return data.pengeluaran.filter(r => inRange(r.tanggal, range));
}
function filteredIncome() {
  const range = getPeriodRange(currentPeriod);
  return data.income.filter(r => inRange(r.tanggal, range));
}

function fmtRangeLabel() {
  const range = getPeriodRange(currentPeriod);
  const opt = { day: 'numeric', month: 'short', year: 'numeric' };
  if (!range) return 'Seluruh data';
  if (currentPeriod === 'yearly') return range.start.getFullYear().toString();
  return `${range.start.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} – ${range.end.toLocaleDateString('id-ID', opt)}`;
}

/* ---------- Toast ---------- */
let toastTimer = null;
function showToast(msg, opts) {
  const t = document.getElementById('toast');
  clearTimeout(toastTimer);
  if (opts && opts.undo) {
    t.innerHTML = `<span>${msg}</span><button class="toast-undo" id="toast-undo-btn">Urungkan</button>`;
    document.getElementById('toast-undo-btn').onclick = async () => { t.classList.remove('show'); await opts.undo(); };
    t.classList.add('show');
    toastTimer = setTimeout(() => t.classList.remove('show'), 6000);
  } else {
    t.innerHTML = `<span>${msg}</span>`;
    t.classList.add('show');
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }
}

/* ---------- Load ---------- */
async function loadAll() {
  const [penjualan, pengeluaran, stok, aset, kasRows, incomeRemote] = await Promise.all([
    SB.list('penjualan'), SB.list('pengeluaran'), SB.list('stok'), SB.list('aset'), SB.list('kas'), SB.list('income_diambil')
  ]);
  data.penjualan = penjualan || [];
  data.pengeluaran = pengeluaran || [];
  data.stok = stok || [];
  data.aset = aset || [];
  data.kas = (kasRows && kasRows[0]) ? kasRows[0] : { fikar: 0, tasia: 0, piutang: 0 };

  if (Array.isArray(incomeRemote)) {
    data.income = incomeRemote;
    LS.set('income', incomeRemote);
  } else {
    data.income = LS.get('income', []);
  }

  render();
  notifyOutOfStock();
}

/* ---------- Render ---------- */
let chartInstance = null;

function render() {
  document.getElementById('period-range').textContent = fmtRangeLabel();
  renderKPI();
  renderChart();
  renderPenjualanTable();
  renderPengeluaranTable();
  renderStok();
  renderAset();
  renderKas();
  renderIncome();
}

function renderKPI() {
  const pj = filteredPenjualan();
  const totalOmzet = pj.reduce((s, r) => s + Number(r.omzet || 0), 0);
  const totalHpp = pj.reduce((s, r) => s + Number(r.hpp || 0), 0);
  const laba = totalOmzet - totalHpp;
  const p40 = laba * 0.4;
  const p60 = laba * 0.6;
  const perOrang = p60 / 3;

  document.getElementById('kpi-omzet').textContent = fmtRp(totalOmzet);
  document.getElementById('kpi-omzet-sub').textContent = pj.length ? `${pj.length} transaksi penjualan` : 'Belum ada data';
  document.getElementById('kpi-hpp').textContent = fmtRp(totalHpp);
  document.getElementById('kpi-laba').textContent = fmtRp(laba);
  document.getElementById('kpi-40').textContent = fmtRp(p40);
  document.getElementById('kpi-60').textContent = fmtRp(p60);
  document.getElementById('kpi-60-per').textContent = fmtRp(perOrang) + ' / orang (Fikar, Rafy, Tasia)';

  document.getElementById('split-a-txt').textContent = fmtRp(p40) + ' kas usaha (40%)';
  document.getElementById('split-b-txt').textContent = fmtRp(p60) + ' dibagi 3 orang (' + fmtRp(perOrang) + '/orang)';
}

/* ---------- 1. Grafik Tren (Omzet, HPP, Laba) ---------- */
function renderChart() {
  const sorted = [...filteredPenjualan()].sort((a, b) => (a.tanggal || '').localeCompare(b.tanggal || ''));
  const labels = sorted.map(r => {
    const d = new Date(r.tanggal + 'T00:00:00');
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  });
  const omzetArr = sorted.map(r => Number(r.omzet || 0));
  const hppArr = sorted.map(r => Number(r.hpp || 0));
  const labaArr = sorted.map(r => Number(r.omzet || 0) - Number(r.hpp || 0));

  const ctx = document.getElementById('trendChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels.length ? labels : ['Belum ada data'],
      datasets: [
        { label: 'Omzet', data: omzetArr, borderColor: '#5A7D5A', backgroundColor: 'rgba(90,125,90,0.08)', tension: 0.3, fill: true, pointRadius: 3, pointBackgroundColor: '#5A7D5A', borderWidth: 2 },
        { label: 'HPP', data: hppArr, borderColor: '#C45B5B', backgroundColor: 'rgba(196,91,91,0.06)', tension: 0.3, fill: false, pointRadius: 3, pointBackgroundColor: '#C45B5B', borderWidth: 2, borderDash: [4, 4] },
        { label: 'Laba Bersih', data: labaArr, borderColor: '#B8763E', backgroundColor: 'rgba(184,118,62,0.08)', tension: 0.3, fill: false, pointRadius: 3, pointBackgroundColor: '#B8763E', borderWidth: 2 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { font: { family: 'Inter', size: 11 }, color: '#1C1917', boxWidth: 10, usePointStyle: true } } },
      scales: {
        y: { ticks: { callback: v => 'Rp' + (v / 1000) + 'k', font: { family: 'Inter', size: 10 }, color: '#8A8578' }, grid: { color: '#EDEBE6' } },
        x: { ticks: { font: { family: 'Inter', size: 10 }, color: '#8A8578' }, grid: { display: false } }
      }
    }
  });
}

function fmtTanggal(t) {
  if (!t) return '-';
  const d = new Date(t + 'T00:00:00');
  return d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
}

function renderPenjualanTable() {
  const tbody = document.getElementById('table-penjualan');
  const sorted = [...filteredPenjualan()].sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || ''));
  if (sorted.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">Tidak ada penjualan di periode ini.</td></tr>`;
    renderPaginationControls('penjualan', 0, 'pagination-penjualan');
    return;
  }
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  if (tablePages.penjualan > totalPages) tablePages.penjualan = totalPages;
  const page = tablePages.penjualan;
  const pageData = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  tbody.innerHTML = pageData.map(r => {
    const laba = Number(r.omzet || 0) - Number(r.hpp || 0);
    const qtyText = r.qty ? `${r.qty} pcs` : '-';
    return `<tr>
      <td>${fmtTanggal(r.tanggal)}</td>
      <td style="text-align:center;"><span class="badge-qty">${qtyText}</span></td>
      <td class="num">${fmtRp(r.omzet)}</td>
      <td class="num" style="color:#C45B5B;">${fmtRp(r.hpp)}</td>
      <td class="num" style="color:var(--sage);font-weight:600;">${fmtRp(laba)}</td>
      <td class="del">
        <button class="row-edit" data-edit="penjualan" data-id="${r.id}" title="Edit">✎</button>
        <button class="row-del" data-del="penjualan" data-id="${r.id}" title="Hapus">✕</button>
      </td>
    </tr>`;
  }).join('');

  renderPaginationControls('penjualan', sorted.length, 'pagination-penjualan');
}

function renderPengeluaranTable() {
  const tbody = document.getElementById('table-pengeluaran');
  const sorted = [...filteredPengeluaran()].sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || ''));
  if (sorted.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="4">Tidak ada pengeluaran di periode ini.</td></tr>`;
    renderPaginationControls('pengeluaran', 0, 'pagination-pengeluaran');
    return;
  }
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  if (tablePages.pengeluaran > totalPages) tablePages.pengeluaran = totalPages;
  const page = tablePages.pengeluaran;
  const pageData = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  tbody.innerHTML = pageData.map(r => `<tr>
    <td>${fmtTanggal(r.tanggal)}</td>
    <td>${escapeHTML(displayExpenseItem(r.item))}</td>
    <td class="num" style="color:var(--copper);">${fmtRp(r.jumlah)}</td>
    <td class="del">
      <button class="row-edit" data-edit="pengeluaran" data-id="${r.id}" title="Edit">✎</button>
      <button class="row-del" data-del="pengeluaran" data-id="${r.id}" title="Hapus">✕</button>
    </td>
  </tr>`).join('');

  renderPaginationControls('pengeluaran', sorted.length, 'pagination-pengeluaran');
}

/* ---------- 5. Render Stok Bahan Table & Editing ---------- */
function renderStok() {
  const tbody = document.getElementById('table-stok');
  if (data.stok.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Belum ada data stok bahan</td></tr>`;
    document.getElementById('total-stok').textContent = fmtRp(0);
    renderPaginationControls('stok', 0, 'pagination-stok');
    return;
  }
  const totalPages = Math.ceil(data.stok.length / PAGE_SIZE);
  if (tablePages.stok > totalPages) tablePages.stok = totalPages;
  const page = tablePages.stok;
  const pageData = data.stok.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  tbody.innerHTML = pageData.map(r => {
    const val = getStockValue(r);
    const qty = getStockQty(r);
    const isZero = qty <= 0;
    return `<tr>
      <td><strong>${escapeHTML(r.nama)}</strong></td>
      <td style="text-align:center;"><span class="badge-qty ${isZero ? 'zero' : ''}">${qty}</span></td>
      <td class="num">${fmtRp(val)}</td>
      <td class="del">
        <button class="row-edit" data-edit="stok" data-id="${r.id}" title="Edit">✎</button>
        <button class="row-empty" data-empty-stok="${r.id}" title="Habis — hapus stok tanpa mengembalikan kas">Habis</button>
        <button class="row-del" data-del="stok" data-id="${r.id}" title="Hapus">✕</button>
      </td>
    </tr>`;
  }).join('');

  const total = data.stok.reduce((s, r) => s + getStockValue(r), 0);
  document.getElementById('total-stok').textContent = fmtRp(total);
  renderPaginationControls('stok', data.stok.length, 'pagination-stok');
}

function renderAset() {
  const list = document.getElementById('list-aset');
  if (data.aset.length === 0) {
    list.innerHTML = `<li style="justify-content:center;color:var(--ink-soft);">Belum ada data</li>`;
    document.getElementById('total-aset').textContent = fmtRp(0);
    return;
  }
  list.innerHTML = data.aset.map(r => {
    const val = Number(r.nilai || 0);
    return `<li><span>${escapeHTML(r.nama)}</span><span class="val">${fmtRp(val)} <button class="row-edit" data-edit="aset" data-id="${r.id}" title="Edit">✎</button> <button class="row-del" data-del="aset" data-id="${r.id}">✕</button></span></li>`;
  }).join('');
  document.getElementById('total-aset').textContent = fmtRp(data.aset.reduce((s, r) => s + Number(r.nilai || 0), 0));
}

function renderKas() {
  const kas = data.kas || { fikar: 0, tasia: 0, piutang: 0 };

  // Akumulasi Laba Bersih Penjualan (Omzet - HPP)
  const pjAll = data.penjualan || [];
  const totalOmzetAll = pjAll.reduce((s, r) => s + Number(r.omzet || 0), 0);
  const totalHppAll = pjAll.reduce((s, r) => s + Number(r.hpp || 0), 0);
  const totalLabaBersih = totalOmzetAll - totalHppAll;

  // Laba bersih selalu ditampilkan sebagai bagian kas Fikar, bukan aset terpisah.
  const kasFikarDenganLaba = Number(kas.fikar || 0) + totalLabaBersih;
  const totalKasReal = kasFikarDenganLaba + Number(kas.tasia || 0);

  // Aset Stok Terkini (otomatis terhubung)
  const totalStok = (data.stok || []).reduce((s, r) => s + getStockValue(r), 0);
  const totalAset = (data.aset || []).reduce((s, r) => s + Number(r.nilai || 0), 0);
  const piutang = Number(kas.piutang || 0);
  const totalIncomeDiambil = (data.income || []).reduce((s, r) => s + Number(r.jumlah || 0), 0);

  // Laba sudah termasuk pada Kas Fikar, jadi tidak boleh ditambahkan kedua kali.
  const totalKekayaan = totalKasReal + totalStok + totalAset + piutang - totalIncomeDiambil;

  document.getElementById('people-row').innerHTML = `
    <div class="person"><div class="who">Kas di Fikar <span class="badge-sync-auto">termasuk laba bersih</span></div><div class="amt">${fmtRp(kasFikarDenganLaba)}</div></div>
    <div class="person"><div class="who">Kas di Tasia</div><div class="amt">${fmtRp(kas.tasia || 0)}</div></div>
  `;

  document.getElementById('table-kekayaan').innerHTML = `
    <tr>
      <td>Kas di Tangan (Fikar termasuk laba bersih &amp; Tasia)</td>
      <td class="num">${fmtRp(totalKasReal)}</td>
    </tr>
    <tr class="table-highlight-row">
      <td>
        <strong>Laba Bersih Usaha (Penjualan &minus; HPP)</strong>
        <span class="badge-sync-auto">sudah masuk Kas Fikar</span>
      </td>
      <td class="num" style="color:var(--sage);font-weight:700;">${fmtRp(totalLabaBersih)}</td>
    </tr>
    <tr class="table-highlight-row">
      <td>
        Aset Bahan Baku Dapur (Stok Tersedia)
        <span class="badge-sync-auto">Terkoneksi Real-time</span>
      </td>
      <td class="num" style="color:var(--ink);font-weight:600;">+${fmtRp(totalStok)}</td>
    </tr>
    <tr>
      <td>Aset Tetap (Alat Usaha)</td>
      <td class="num">+${fmtRp(totalAset)}</td>
    </tr>
    <tr>
      <td>Piutang ke NYAMHAP</td>
      <td class="num">+${fmtRp(piutang)}</td>
    </tr>
    ${totalIncomeDiambil > 0 ? `
    <tr style="color:var(--copper);">
      <td>Bagi Hasil Sudah Diambil Anggota</td>
      <td class="num">&minus;${fmtRp(totalIncomeDiambil)}</td>
    </tr>` : ''}
    <tr style="font-weight:800;font-size:0.96rem;border-top:2px solid var(--ink);background:rgba(90,125,90,0.06);">
      <td>Total Kas &amp; Kekayaan Usaha</td>
      <td class="num" style="color:var(--sage);font-size:1.05rem;">${fmtRp(totalKekayaan)}</td>
    </tr>
  `;
}

/* ---------- 6. Render Income Diambil Table ---------- */
function renderIncome() {
  const tbody = document.getElementById('table-income');
  const pj = filteredPenjualan();
  const totalOmzet = pj.reduce((s, r) => s + Number(r.omzet || 0), 0);
  const totalHpp = pj.reduce((s, r) => s + Number(r.hpp || 0), 0);
  const totalLaba = totalOmzet - totalHpp;
  const hakBagiHasil = totalLaba * 0.6; // 60%

  const incList = filteredIncome();
  const totalDiambil = incList.reduce((s, r) => s + Number(r.jumlah || 0), 0);
  const sisaHak = hakBagiHasil - totalDiambil;

  document.getElementById('income-total-hak').textContent = fmtRp(hakBagiHasil);
  document.getElementById('income-total-diambil').textContent = fmtRp(totalDiambil);
  document.getElementById('income-total-sisa').textContent = fmtRp(sisaHak);

  const sorted = [...incList].sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || ''));
  if (sorted.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Belum ada income yang diambil di periode ini.</td></tr>`;
    renderPaginationControls('income', 0, 'pagination-income');
    return;
  }

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  if (tablePages.income > totalPages) tablePages.income = totalPages;
  const page = tablePages.income;
  const pageData = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  tbody.innerHTML = pageData.map(r => `<tr>
    <td>${fmtTanggal(r.tanggal)}</td>
    <td><strong>${escapeHTML(r.nama)}</strong></td>
    <td style="color:var(--ink-soft);font-size:0.8rem;">${escapeHTML(r.catatan || '-')}</td>
    <td class="num" style="color:var(--copper);font-weight:600;">${fmtRp(r.jumlah)}</td>
    <td class="del">
      <button class="row-del" data-del="income" data-id="${r.id}" title="Hapus">✕</button>
    </td>
  </tr>`).join('');

  renderPaginationControls('income', sorted.length, 'pagination-income');
}

/* ---------- 4. Auto Deduct Stok Bahan Berdasarkan Penjualan ---------- */
/**
 * Ketentuan pemakaian per 40 pcs:
 * - Beras: 2.5 (L)
 * - Ayam: 1 (kg)
 * - Kertas nasi: 40 (pcs)
 * - Bumbu sambal: 2 (unit)
 */
const RECIPES_PER_40 = [
  { match: ['beras'], deductPer40: 2.5 },
  { match: ['ayam'], deductPer40: 1.0 },
  { match: ['kertas'], deductPer40: 40 },
  { match: ['sambal', 'bumbu'], deductPer40: 2 }
];

async function deductStockForSales(soldQty) {
  if (!soldQty || soldQty <= 0) return;
  const factor = soldQty / 40.0;
  const deductedNames = [];

  for (const recipe of RECIPES_PER_40) {
    const deductAmount = recipe.deductPer40 * factor;
    // Cari item stok yang namanya cocok secara fuzzy
    const targetItem = data.stok.find(item => {
      const nameLower = (item.nama || '').toLowerCase();
      return recipe.match.some(keyword => nameLower.includes(keyword));
    });

    if (targetItem) {
      const currentQty = getStockQty(targetItem);
      const currentVal = getStockValue(targetItem);
      const newQty = Math.max(0, parseFloat((currentQty - deductAmount).toFixed(2)));

      let newVal = 0;
      if (currentQty > 0) {
        newVal = Math.round((newQty / currentQty) * currentVal);
      }

      const updated = await SB.update(
        'stok',
        targetItem.id,
        stockPayload(targetItem.nama, newQty, newVal)
      );

      if (updated) {
        const itemName = String(targetItem.nama || '').trim();
        deductedNames.push(
          newQty <= 0
            ? `${itemName} (habis)`
            : `${itemName} (-${deductAmount.toFixed(1)})`
        );
      }
    }
  }

  if (deductedNames.length > 0) {
    showToast(`Stok otomatis berkurang: ${deductedNames.join(', ')}`);
  }
}

async function restoreStockForSales(soldQty) {
  if (!soldQty || soldQty <= 0) return;
  const factor = soldQty / 40.0;
  const restoredNames = [];

  const estUnitPrice = {
    'beras': 12000,
    'ayam': 35000,
    'kertas': 200,
    'sambal': 12000,
    'bumbu': 12000
  };

  const defaultNames = {
    'beras': 'Beras',
    'ayam': 'Ayam',
    'kertas': 'Kertas Nasi',
    'sambal': 'Bumbu Sambal'
  };

  for (const recipe of RECIPES_PER_40) {
    const restoreAmount = parseFloat((recipe.deductPer40 * factor).toFixed(2));
    if (restoreAmount <= 0) continue;

    const defaultKey = recipe.match[0];
    const unitPrice = estUnitPrice[defaultKey] || 10000;

    // Cari item stok yang namanya cocok secara fuzzy
    const targetItem = data.stok.find(item => {
      const nameLower = (item.nama || '').toLowerCase();
      return recipe.match.some(keyword => nameLower.includes(keyword));
    });

    if (targetItem) {
      const currentQty = getStockQty(targetItem);
      const currentVal = getStockValue(targetItem);
      const newQty = parseFloat((currentQty + restoreAmount).toFixed(2));

      let newVal = currentVal;
      if (currentQty > 0) {
        newVal = Math.round((newQty / currentQty) * currentVal);
      } else {
        newVal = Math.round(newQty * unitPrice);
      }

      const updated = await SB.update(
        'stok',
        targetItem.id,
        stockPayload(targetItem.nama, newQty, newVal)
      );

      if (updated) {
        const itemName = String(targetItem.nama || '').trim();
        restoredNames.push(`${itemName} (+${restoreAmount})`);
      }
    } else {
      // Jika item belum ada di stok, otomatis buat kembali agar data tidak hilang
      const newName = defaultNames[defaultKey] || defaultKey;
      const initialVal = Math.round(restoreAmount * unitPrice);
      const created = await SB.insert('stok', stockPayload(newName, restoreAmount, initialVal));
      if (created) {
        restoredNames.push(`${newName} (+${restoreAmount})`);
      }
    }
  }

  if (restoredNames.length > 0) {
    showToast(`Stok bahan dikembalikan: ${restoredNames.join(', ')}`);
  }
}

/* ---------- Toggle Detail & Periode ---------- */
document.querySelectorAll('#detail-tabs .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#detail-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    document.querySelectorAll('.view-lengkap-only').forEach(el => el.classList.toggle('hidden', view !== 'lengkap'));
    document.getElementById('view-ringkas').classList.toggle('hidden', view !== 'ringkas');
  });
});

document.querySelectorAll('#period-seg .period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#period-seg .period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentPeriod = btn.dataset.period;
    render();
  });
});

/* ---------- Modals ---------- */
const modalRoot = document.getElementById('modal-root');
function closeModal() {
  modalRoot.innerHTML = '';
  if (pendingDbReload) {
    pendingDbReload = false;
    loadAll();
  }
}

function bindClose() {
  const cancelBtn = document.getElementById('btn-cancel');
  if (cancelBtn) cancelBtn.onclick = closeModal;
  const overlay = document.getElementById('overlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target.id === 'overlay') closeModal();
    });
  }
}

function openModal(type, editRow = null) {
  let html = '';
  const isEdit = !!editRow;

  /* --- 2. MODAL PENJUALAN DENGAN QTY, HARGA 4k/5k, & HPP DEFAULT --- */
  if (type === 'penjualan') {
    const tgl = isEdit ? editRow.tanggal : todayStr();
    const qty = isEdit && editRow.qty ? editRow.qty : '';
    const defHarga = isEdit && editRow.omzet && editRow.qty ? Math.round(editRow.omzet / editRow.qty) : 5000;
    const currentPrice = (defHarga === 4000) ? 4000 : 5000;
    const hppPerItem = isEdit && editRow.hpp && editRow.qty ? Math.round(editRow.hpp / editRow.qty) : '';

    html = `<div class="modal-overlay" id="overlay"><div class="modal">
      <h3>${isEdit ? 'Edit Penjualan' : 'Tambah Penjualan'}</h3>
      <p class="modal-sub">Input jumlah penjualan dan harga per cup/pcs</p>
      
      <div class="field">
        <label>Tanggal</label>
        <input type="date" id="f-tanggal" value="${tgl}">
      </div>

      <div class="field">
        <label>Jumlah Penjualan (pcs)</label>
        <input type="number" id="f-qty" placeholder="contoh: 40" value="${qty}" min="1">
      </div>

      <div class="field">
        <label>Pilihan Harga Satuan</label>
        <select id="f-harga">
          <option value="4000" ${currentPrice === 4000 ? 'selected' : ''}>Rp4.000 / pcs</option>
          <option value="5000" ${currentPrice === 5000 ? 'selected' : ''}>Rp5.000 / pcs</option>
        </select>
      </div>

      <div class="field">
        <label>HPP Satuan (Rp) <span style="font-weight:normal;color:var(--ink-soft);">(Opsional)</span></label>
        <input type="number" id="f-hpp-unit" placeholder="Kosongkan = otomatis Rp2.238" value="${hppPerItem}">
        <span class="field-hint" id="hpp-hint">Jika dibiarkan kosong, HPP otomatis Rp2.238/pcs</span>
      </div>

      <div class="calc-preview" id="calc-preview">
        Total Omzet: <strong id="prev-omzet">Rp0</strong> | Total HPP: <strong id="prev-hpp">Rp0</strong>
      </div>

      <div class="modal-actions">
        <button class="btn-secondary" id="btn-cancel">Batal</button>
        <button class="btn-primary" id="btn-save">${isEdit ? 'Update' : 'Simpan'}</button>
      </div>
    </div></div>`;

    modalRoot.innerHTML = html;
    bindClose();

    const fQty = document.getElementById('f-qty');
    const fHarga = document.getElementById('f-harga');
    const fHppUnit = document.getElementById('f-hpp-unit');
    const prevOmzet = document.getElementById('prev-omzet');
    const prevHpp = document.getElementById('prev-hpp');
    const hppHint = document.getElementById('hpp-hint');

    function updateCalcPreview() {
      const q = Number(fQty.value) || 0;
      const h = Number(fHarga.value) || 5000;
      const defaultHpp = DEFAULT_HPP_SATUAN;
      const userHpp = fHppUnit.value.trim() !== '' ? Number(fHppUnit.value) : defaultHpp;

      const totalOmzet = q * h;
      const totalHpp = Math.round(q * userHpp);

      prevOmzet.textContent = fmtRp(totalOmzet);
      prevHpp.textContent = fmtRp(totalHpp);

      if (fHppUnit.value.trim() === '') {
        hppHint.textContent = `Otomatis ${fmtRp(defaultHpp)}/pcs`;
      } else {
        hppHint.textContent = `Manual: ${fmtRp(userHpp)}/pcs (${Math.round(userHpp / h * 100)}% dari harga)`;
      }
    }

    fQty.addEventListener('input', updateCalcPreview);
    fHarga.addEventListener('change', updateCalcPreview);
    fHppUnit.addEventListener('input', updateCalcPreview);
    updateCalcPreview();

    document.getElementById('btn-save').onclick = async (e) => {
      const btn = e.target;
      const tanggal = document.getElementById('f-tanggal').value;
      const qtyVal = Number(fQty.value);
      const hargaSatuan = Number(fHarga.value);
      const hppInput = fHppUnit.value.trim();

      if (!tanggal || !qtyVal || qtyVal <= 0) {
        showToast('Isi tanggal dan jumlah penjualan dulu ya');
        return;
      }

      const omzetTotal = qtyVal * hargaSatuan;
      const hppSatuan = hppInput !== '' ? Number(hppInput) : DEFAULT_HPP_SATUAN;
      const hppTotal = Math.round(qtyVal * hppSatuan);

      btn.disabled = true;
      btn.textContent = 'Menyimpan...';

      const rowPayload = {
        tanggal,
        qty: qtyVal,
        omzet: omzetTotal,
        hpp: hppTotal
      };

      const result = isEdit
        ? await SB.update('penjualan', editRow.id, rowPayload)
        : await SB.insert('penjualan', rowPayload);

      if (result) {
        // Fitur 4: Stok berkurang otomatis seiring penjualan jika data baru
        if (!isEdit) {
          await deductStockForSales(qtyVal);
        } else {
          // Jika edit penjualan: sesuaikan stok jika ada perubahan qty
          const oldQty = Number(editRow.qty || 0);
          const diffQty = qtyVal - oldQty;
          if (diffQty > 0) {
            await deductStockForSales(diffQty);
          } else if (diffQty < 0) {
            await restoreStockForSales(Math.abs(diffQty));
          }
        }
        await loadAll();
        closeModal();
        showToast(isEdit ? 'Penjualan diperbarui & stok disesuaikan' : 'Penjualan tersimpan & stok diperbarui');
      } else {
        btn.disabled = false;
        btn.textContent = isEdit ? 'Update' : 'Simpan';
        showToast('Gagal menyimpan penjualan');
      }
    };
  }

  /* --- MODAL PENGELUARAN --- */
  if (type === 'pengeluaran') {
    const tgl = isEdit ? editRow.tanggal : todayStr();
    const itm = isEdit ? editRow.item : '';
    const jml = isEdit ? editRow.jumlah : '';

    html = `<div class="modal-overlay" id="overlay"><div class="modal">
      <h3>${isEdit ? 'Edit Pengeluaran' : 'Tambah Pengeluaran'}</h3>
      <p class="modal-sub">Catat belanja operasional atau bahan</p>
      <div class="field"><label>Tanggal</label><input type="date" id="f-tanggal" value="${tgl}"></div>
      <div class="field"><label>Item</label><input type="text" id="f-item" placeholder="Ayam 1,5 kg" value="${escapeHTML(itm)}"></div>
      <div class="field"><label>Jumlah (Rp)</label><input type="number" id="f-jumlah" placeholder="63000" value="${jml}"></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="btn-cancel">Batal</button>
        <button class="btn-primary" id="btn-save">${isEdit ? 'Update' : 'Simpan'}</button>
      </div>
    </div></div>`;
    modalRoot.innerHTML = html;
    bindClose();

    document.getElementById('btn-save').onclick = async (e) => {
      const btn = e.target;
      const tanggal = document.getElementById('f-tanggal').value;
      const item = document.getElementById('f-item').value.trim();
      const jumlah = Number(document.getElementById('f-jumlah').value);

      if (!tanggal || !item || !jumlah) { showToast('Lengkapi semua kolom dulu ya'); return; }

      btn.disabled = true;
      btn.textContent = 'Menyimpan...';

      const rowPayload = { tanggal, item, jumlah };
      const result = isEdit
        ? await SB.update('pengeluaran', editRow.id, rowPayload)
        : await SB.insert('pengeluaran', rowPayload);

      if (result) {
        await loadAll();
        closeModal();
        showToast(isEdit ? 'Pengeluaran diperbarui' : 'Pengeluaran tersimpan');
      } else {
        btn.disabled = false;
        btn.textContent = isEdit ? 'Update' : 'Simpan';
      }
    };
  }

  /* --- 3 & 5. MODAL STOK BAHAN DENGAN QUANTITY & TERKONEKSI PENGELUARAN --- */
  if (type === 'stok') {
    const nama = isEdit ? editRow.nama : '';
    const qty = isEdit ? getStockQty(editRow) : 1;
    const nilai = isEdit ? getStockValue(editRow) : '';

    html = `<div class="modal-overlay" id="overlay"><div class="modal">
      <h3>${isEdit ? 'Edit Stok Bahan' : 'Tambah Stok Bahan'}</h3>
      <p class="modal-sub">${isEdit ? 'Ubah kuantitas atau nilai persediaan bahan. Transaksi kas pembelian awal tidak diubah.' : 'Menambah stok akan otomatis tercatat ke Pengeluaran'}</p>
      
      ${!isEdit ? `<div class="field">
        <label>Nama Bahan</label>
        <input type="text" id="f-nama" placeholder="Contoh: Beras, Ayam, Kertas Nasi" value="${escapeHTML(nama)}">
      </div>

      <div class="field">
        <label>Quantity / Jumlah Stok</label>
        <input type="number" id="f-qty" step="any" placeholder="Contoh: 2.5 atau 40" value="${qty}">
      </div>

      <div class="field">
        <label>Total Nilai Bahan (Rp)</label>
        <input type="number" id="f-nilai" placeholder="Contoh: 50000" value="${nilai}">
      </div>

      <div class="field">
        <label>Hubungkan ke Kas Fisik (Potong Kas saat Belanja Bahan)</label>
        <select id="f-potong-kas">
          <option value="none">Jangan potong kas fisik (hanya simpan/perbarui stok)</option>
          <option value="fikar">Potong dari Kas di Fikar (Saldo: ${fmtRp(data.kas.fikar || 0)})</option>
          <option value="tasia">Potong dari Kas di Tasia (Saldo: ${fmtRp(data.kas.tasia || 0)})</option>
        </select>
        <span class="field-hint">Saldo yang dipilih dipotong dan dikembalikan otomatis bila tombol Hapus digunakan.</span>
      </div>` : ''}

      ${!isEdit ? `
      <div class="field" style="display:flex;align-items:center;gap:8px;margin-top:8px;">
        <input type="checkbox" id="f-auto-expense" checked style="width:auto;margin:0;">
        <label for="f-auto-expense" style="margin:0;cursor:pointer;font-size:0.8rem;">Otomatis catat juga ke Pengeluaran hari ini</label>
      </div>` : ''}

      <div class="modal-actions">
        <button class="btn-secondary" id="btn-cancel">Batal</button>
        <button class="btn-primary" id="btn-save">${isEdit ? 'Update' : 'Simpan'}</button>
      </div>
    </div></div>`;

    modalRoot.innerHTML = html;
    bindClose();

    document.getElementById('btn-save').onclick = async (e) => {
      const btn = e.target;
      const namaVal = document.getElementById('f-nama').value.trim();
      const qtyVal = Number(document.getElementById('f-qty').value) || 0;
      const nilaiVal = Number(document.getElementById('f-nilai').value) || 0;
      const autoExp = document.getElementById('f-auto-expense') ? document.getElementById('f-auto-expense').checked : false;
      const potongKasEl = document.getElementById('f-potong-kas');
      const potongKas = potongKasEl ? potongKasEl.value : 'none';

      if (!namaVal) { showToast('Isi nama bahan dulu ya'); return; }

      btn.disabled = true;
      btn.textContent = 'Menyimpan...';

      const payload = stockPayload(namaVal, qtyVal, nilaiVal);

      const result = isEdit
        ? await SB.update('stok', editRow.id, payload)
        : await SB.insert('stok', payload);

      if (result) {
        let kasToastMsg = '';
        const savedStock = Array.isArray(result) ? result[0] : result;

        // Catatan pengeluaran menjadi tautan permanen stok <-> transaksi kas.
        if (!isEdit && nilaiVal > 0 && (autoExp || potongKas !== 'none')) {
          const linkedExpense = await SB.insert('pengeluaran', {
            tanggal: todayStr(),
            item: stockExpenseLabel(savedStock.id, namaVal, potongKas, potongKas === 'none' ? 0 : nilaiVal),
            jumlah: nilaiVal
          });
          if (!linkedExpense) {
            await SB.remove('stok', savedStock.id);
            btn.disabled = false;
            btn.textContent = 'Simpan';
            showToast('Stok dibatalkan karena catatan transaksi pembeliannya gagal dibuat');
            return;
          }
        }

        if (!isEdit && (potongKas === 'fikar' || potongKas === 'tasia') && nilaiVal > 0) {
          const newKas = { fikar: data.kas.fikar || 0, tasia: data.kas.tasia || 0, piutang: data.kas.piutang || 0 };
          newKas[potongKas] = Math.max(0, Number(newKas[potongKas] || 0) - nilaiVal);
          const kasUpdated = await SB.updateKas(newKas);
          if (!kasUpdated) {
            await loadAll();
            const expense = data.pengeluaran.find(p => parseStockExpense(p.item)?.stockId === String(savedStock.id));
            if (expense) await SB.remove('pengeluaran', expense.id);
            await SB.remove('stok', savedStock.id);
            btn.disabled = false;
            btn.textContent = 'Simpan';
            showToast('Stok dibatalkan karena kas gagal diperbarui');
            return;
          }
          data.kas = newKas;
          const targetNama = potongKas === 'fikar' ? 'Fikar' : 'Tasia';
          kasToastMsg = ` & Kas ${targetNama} terpotong ${fmtRp(nilaiVal)}`;
        }

        await loadAll();
        closeModal();
        showToast((isEdit ? 'Stok diperbarui' : 'Stok tersimpan') + kasToastMsg);
      } else {
        btn.disabled = false;
        btn.textContent = isEdit ? 'Update' : 'Simpan';
        showToast('Gagal menyimpan stok');
      }
    };
  }

  /* --- 3. MODAL ASET TETAP TERKONEKSI PENGELUARAN --- */
  if (type === 'aset') {
    const nama = isEdit ? editRow.nama : '';
    const nilai = isEdit ? (editRow.nilai || 0) : '';

    html = `<div class="modal-overlay" id="overlay"><div class="modal">
      <h3>${isEdit ? 'Edit Aset Tetap' : 'Tambah Aset Tetap'}</h3>
      <p class="modal-sub">Catat inventaris alat usaha dan nilainya</p>
      <div class="field"><label>Nama Alat</label><input type="text" id="f-nama" placeholder="Magicom, Panci, dll" value="${escapeHTML(nama)}"></div>
      <div class="field"><label>Nilai (Rp)</label><input type="number" id="f-nilai" placeholder="250000" value="${nilai}"></div>
      
      ${!isEdit ? `
      <div class="field" style="display:flex;align-items:center;gap:8px;margin-top:8px;">
        <input type="checkbox" id="f-auto-expense" checked style="width:auto;margin:0;">
        <label for="f-auto-expense" style="margin:0;cursor:pointer;font-size:0.8rem;">Otomatis catat juga ke Pengeluaran hari ini</label>
      </div>` : ''}

      <div class="modal-actions">
        <button class="btn-secondary" id="btn-cancel">Batal</button>
        <button class="btn-primary" id="btn-save">${isEdit ? 'Update' : 'Simpan'}</button>
      </div>
    </div></div>`;

    modalRoot.innerHTML = html;
    bindClose();

    document.getElementById('btn-save').onclick = async (e) => {
      const btn = e.target;
      const namaVal = document.getElementById('f-nama').value.trim();
      const nilaiVal = Number(document.getElementById('f-nilai').value) || 0;
      const autoExp = document.getElementById('f-auto-expense') ? document.getElementById('f-auto-expense').checked : false;

      if (!namaVal) { showToast('Isi nama alat dulu ya'); return; }

      btn.disabled = true;
      btn.textContent = 'Menyimpan...';

      const payload = { nama: namaVal, nilai: nilaiVal };
      const result = isEdit
        ? await SB.update('aset', editRow.id, payload)
        : await SB.insert('aset', payload);

      if (result) {
        // Fitur 3: Otomatis terkoneksi ke Pengeluaran
        if (!isEdit && autoExp && nilaiVal > 0) {
          await SB.insert('pengeluaran', {
            tanggal: todayStr(),
            item: `Aset: ${namaVal}`,
            jumlah: nilaiVal
          });
        }
        await loadAll();
        closeModal();
        showToast(isEdit ? 'Aset diperbarui' : 'Aset tersimpan & tercatat di Pengeluaran');
      } else {
        btn.disabled = false;
        btn.textContent = isEdit ? 'Update' : 'Simpan';
        showToast('Gagal menyimpan aset');
      }
    };
  }

  /* --- 6. MODAL INCOME DIAMBIL (FIKAR, RAFY, TASIA) --- */
  if (type === 'income') {
    html = `<div class="modal-overlay" id="overlay"><div class="modal">
      <h3>Catat Pengambilan Income</h3>
      <p class="modal-sub">Catat bagi hasil yang sudah diambil anggota</p>
      
      <div class="field">
        <label>Tanggal Pengambilan</label>
        <input type="date" id="f-tanggal" value="${todayStr()}">
      </div>

      <div class="field">
        <label>Nama Anggota</label>
        <select id="f-nama">
          <option value="Fikar">Fikar</option>
          <option value="Rafy">Rafy</option>
          <option value="Tasia">Tasia</option>
        </select>
      </div>

      <div class="field">
        <label>Jumlah Diambil (Rp)</label>
        <input type="number" id="f-jumlah" placeholder="Contoh: 100000" min="1000">
      </div>

      <div class="field">
        <label>Catatan / Keperluan (Opsional)</label>
        <input type="text" id="f-catatan" placeholder="Bagi hasil minggu 1, dsb.">
      </div>

      <div class="modal-actions">
        <button class="btn-secondary" id="btn-cancel">Batal</button>
        <button class="btn-primary" id="btn-save">Simpan</button>
      </div>
    </div></div>`;

    modalRoot.innerHTML = html;
    bindClose();

    document.getElementById('btn-save').onclick = async (e) => {
      const btn = e.target;
      const tanggal = document.getElementById('f-tanggal').value;
      const nama = document.getElementById('f-nama').value;
      const jumlah = Number(document.getElementById('f-jumlah').value);
      const catatan = document.getElementById('f-catatan').value.trim();

      if (!tanggal || !jumlah || jumlah <= 0) {
        showToast('Isi tanggal dan jumlah nominal');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Menyimpan...';

      const newRow = {
        id: Date.now(),
        tanggal,
        nama,
        jumlah,
        catatan,
        created_at: new Date().toISOString()
      };

      // Coba sync ke Supabase jika tabel income_diambil sudah tersedia
      const remoteRes = await SB.insert('income_diambil', {
        tanggal,
        nama,
        jumlah,
        catatan
      });

      if (remoteRes && remoteRes[0]) {
        newRow.id = remoteRes[0].id;
      }

      data.income.push(newRow);
      LS.set('income', data.income);

      await loadAll();
      closeModal();
      showToast(`Income ${nama} sebesar ${fmtRp(jumlah)} berhasil dicatat`);
    };
  }

  /* --- MODAL KAS REAL --- */
  if (type === 'kas') {
    const kas = data.kas || { fikar: 0, tasia: 0, piutang: 0 };
    html = `<div class="modal-overlay" id="overlay"><div class="modal">
      <h3>Update Kas Real</h3>
      <p class="modal-sub">Update posisi kas fisik dan piutang</p>
      <div class="field"><label>Kas di Fikar (Rp)</label><input type="number" id="f-fikar" value="${kas.fikar || 0}"></div>
      <div class="field"><label>Kas di Tasia (Rp)</label><input type="number" id="f-tasia" value="${kas.tasia || 0}"></div>
      <div class="field"><label>Piutang ke NYAMHAP (Rp)</label><input type="number" id="f-piutang" value="${kas.piutang || 0}"></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="btn-cancel">Batal</button>
        <button class="btn-primary" id="btn-save">Simpan</button>
      </div>
    </div></div>`;
    modalRoot.innerHTML = html;
    bindClose();

    document.getElementById('btn-save').onclick = async (e) => {
      const btn = e.target;
      const newKas = {
        fikar: Number(document.getElementById('f-fikar').value) || 0,
        tasia: Number(document.getElementById('f-tasia').value) || 0,
        piutang: Number(document.getElementById('f-piutang').value) || 0
      };

      btn.disabled = true;
      btn.textContent = 'Menyimpan...';

      const result = await SB.updateKas(newKas);
      if (result) {
        await loadAll();
        closeModal();
        showToast('Kas diperbarui');
      } else {
        btn.disabled = false;
        btn.textContent = 'Simpan';
      }
    };
  }
}

document.querySelectorAll('[data-modal]').forEach(btn => {
  btn.addEventListener('click', () => openModal(btn.dataset.modal));
});

/* ---------- Event Listener: Hapus & Edit ---------- */
const LABEL_TABLE = {
  penjualan: 'catatan penjualan',
  pengeluaran: 'catatan pengeluaran',
  stok: 'item stok bahan',
  aset: 'item aset tetap',
  income: 'catatan pengambilan income'
};

function previewRow(table, row) {
  if (table === 'penjualan') return `${fmtTanggal(row.tanggal)} · Qty: ${row.qty || '-'} · Omzet ${fmtRp(row.omzet)}`;
  if (table === 'pengeluaran') return `${fmtTanggal(row.tanggal)} · ${displayExpenseItem(row.item)} · ${fmtRp(row.jumlah)}`;
  if (table === 'stok') return `${row.nama} · Qty: ${getStockQty(row)} · Nilai: ${fmtRp(getStockValue(row))}`;
  if (table === 'aset') return `${row.nama} · ${fmtRp(row.nilai)}`;
  if (table === 'income') return `${fmtTanggal(row.tanggal)} · ${row.nama} · ${fmtRp(row.jumlah)}`;
  return '';
}

function openConfirmDelete(table, row) {
  const label = LABEL_TABLE[table] || 'data ini';
  let hintMsg = '';
  if (table === 'penjualan' && row.qty) {
    hintMsg = `<p style="color:var(--sage);font-weight:600;font-size:0.82rem;margin:6px 0 0;">ℹ️ Stok bahan (${row.qty} pcs) akan otomatis dikembalikan ke stok persediaan.</p>`;
  } else if (table === 'stok') {
    const refund = getStockCashRefund(row);
    hintMsg = refund
      ? `<p style="color:var(--sage);font-weight:600;font-size:0.82rem;margin:6px 0 0;">ℹ️ ${fmtRp(refund.amount)} akan dikembalikan ke Kas ${refund.source === 'fikar' ? 'Fikar' : 'Tasia'}.</p>`
      : `<p style="color:var(--ink-soft);font-size:0.8rem;margin:6px 0 0;">ℹ️ Menghapus item stok bahan ini. Tidak ada transaksi kas yang dapat dikembalikan.</p>`;
  }

  html = `<div class="modal-overlay" id="overlay"><div class="modal confirm-box">
    <div class="warn-icon">!</div>
    <h3>Hapus ${label}?</h3>
    <p>Data akan dihapus dari sistem.</p>
    ${hintMsg}
    <div class="item-preview">${previewRow(table, row)}</div>
    <div class="modal-actions">
      <button class="btn-secondary" id="btn-cancel">Batal</button>
      <button class="btn-danger" id="btn-confirm-del">Ya, Hapus</button>
    </div>
  </div></div>`;
  modalRoot.innerHTML = html;
  bindClose();
  document.getElementById('btn-confirm-del').onclick = async () => {
    closeModal();
    await performDelete(table, row);
  };
}

function openConfirmStockEmpty(row) {
  html = `<div class="modal-overlay" id="overlay"><div class="modal confirm-box">
    <div class="warn-icon">!</div>
    <h3>Tandai stok habis?</h3>
    <p>Item stok dihapus, tetapi kas dan catatan pengeluarannya tetap.</p>
    <div class="item-preview">${previewRow('stok', row)}</div>
    <div class="modal-actions">
      <button class="btn-secondary" id="btn-cancel">Batal</button>
      <button class="btn-danger" id="btn-confirm-empty">Ya, Stok Habis</button>
    </div>
  </div></div>`;
  modalRoot.innerHTML = html;
  bindClose();
  document.getElementById('btn-confirm-empty').onclick = async () => {
    closeModal();
    await performDelete('stok', row, { returnCash: false, removeExpense: false, label: 'Stok habis dihapus; kas tidak dikembalikan' });
  };
}

async function performDelete(table, row, options = {}) {
  if (table === 'income') {
    data.income = data.income.filter(r => String(r.id) !== String(row.id));
    LS.set('income', data.income);
    await SB.remove('income_diambil', row.id);
    render();
    showToast('Catatan income dihapus & sisa hak bagi hasil dikembalikan');
    return;
  }

  // JIKA MENGHAPUS PENJUALAN: Kembalikan stok bahan yang sebelumnya terpotong!
  let extraToast = '';
  if (table === 'penjualan') {
    const soldQty = Number(row.qty || 0);
    if (soldQty > 0) {
      await restoreStockForSales(soldQty);
      extraToast = ' & stok bahan dikembalikan';
    }
  }

  // Hapus stok normal membatalkan pembelian; aksi "Habis" melewati rollback ini.
  if (table === 'stok') {
    const returnCash = options.returnCash !== false;
    const removeExpense = options.removeExpense !== false;
    const linkedExp = findLinkedStockExpense(row) || data.pengeluaran.find(p => p.item === `Bahan: ${row.nama}`);
    const refund = returnCash ? getStockCashRefund(row) : null;

    if (refund) {
      const newKas = { fikar: data.kas.fikar || 0, tasia: data.kas.tasia || 0, piutang: data.kas.piutang || 0 };
      newKas[refund.source] = Number(newKas[refund.source] || 0) + refund.amount;
      if (!await SB.updateKas(newKas)) {
        showToast('Stok tidak dihapus karena pengembalian kas gagal');
        return;
      }
      data.kas = newKas;
      extraToast = ` & Kas ${refund.source === 'fikar' ? 'Fikar' : 'Tasia'} dikembalikan ${fmtRp(refund.amount)}`;
    }

    if (linkedExp && removeExpense) {
      if (!await SB.remove('pengeluaran', linkedExp.id)) {
        if (refund) {
          const rollbackKas = { ...data.kas, [refund.source]: Number(data.kas[refund.source] || 0) - refund.amount };
          await SB.updateKas(rollbackKas);
          data.kas = rollbackKas;
        }
        showToast('Stok tidak dihapus karena pengeluaran terkait gagal dihapus');
        return;
      }
      extraToast += ' & pengeluaran terkait dihapus';
    }
  }

  const ok = await SB.remove(table, row.id);
  if (!ok) {
    // Best-effort compensation for the two preceding stock-rollback steps.
    // A backend transaction would be ideal, but the current public REST setup
    // only exposes individual operations.
    if (table === 'stok') {
      const linkedExp = findLinkedStockExpense(row) || data.pengeluaran.find(p => p.item === `Bahan: ${row.nama}`);
      if (linkedExp && options.removeExpense !== false) {
        await SB.insert('pengeluaran', { tanggal: linkedExp.tanggal, item: linkedExp.item, jumlah: linkedExp.jumlah });
      }
      const refund = options.returnCash !== false ? getStockCashRefund(row) : null;
      if (refund) {
        const rollbackKas = { ...data.kas, [refund.source]: Number(data.kas[refund.source] || 0) - refund.amount };
        await SB.updateKas(rollbackKas);
        data.kas = rollbackKas;
      }
    }
    showToast('Stok gagal dihapus; perubahan kas dikembalikan');
    return;
  }
  await loadAll();
  const message = options.label || ('Data dihapus' + extraToast);
  if (table === 'stok') {
    // Undo stok perlu membangun ulang transaksi kas dan pengeluaran sekaligus;
    // jangan tawarkan undo parsial yang dapat membuat saldo tidak seimbang.
    showToast(message);
    return;
  }
  showToast(message, {
    undo: async () => {
      const { id, created_at, ...rest } = row;
      const restored = await SB.insert(table, rest);
      if (restored) {
        if (table === 'penjualan' && Number(row.qty || 0) > 0) {
          await deductStockForSales(Number(row.qty));
        }
        await loadAll();
        showToast('Data dikembalikan');
      }
    }
  });
}

document.addEventListener('click', (e) => {
  // Handle Klik Paginasi Tabel (Maks 7 baris per tabel)
  const btnPage = e.target.closest('[data-page-table]');
  if (btnPage && !btnPage.disabled) {
    const tableKey = btnPage.dataset.pageTable;
    const targetPage = Number(btnPage.dataset.page);
    if (tableKey && !isNaN(targetPage) && targetPage >= 1) {
      tablePages[tableKey] = targetPage;
      if (tableKey === 'penjualan') renderPenjualanTable();
      else if (tableKey === 'pengeluaran') renderPengeluaranTable();
      else if (tableKey === 'stok') renderStok();
      else if (tableKey === 'income') renderIncome();
    }
    return;
  }

  // Handle Klik Hapus
  const btnDel = e.target.closest('[data-del]');
  if (btnDel) {
    const table = btnDel.dataset.del;
    const id = btnDel.dataset.id;
    const row = data[table].find(r => String(r.id) === String(id));
    if (!row) return;
    openConfirmDelete(table, row);
    return;
  }

  const btnEmpty = e.target.closest('[data-empty-stok]');
  if (btnEmpty) {
    const row = data.stok.find(r => String(r.id) === String(btnEmpty.dataset.emptyStok));
    if (row) openConfirmStockEmpty(row);
    return;
  }

  // Handle Klik Edit
  const btnEdit = e.target.closest('[data-edit]');
  if (btnEdit) {
    const table = btnEdit.dataset.edit;
    const id = btnEdit.dataset.id;
    const row = data[table].find(r => String(r.id) === String(id));
    if (!row) return;
    openModal(table, row);
  }
});

/* ---------- Supabase Realtime & Auto-Sync System ---------- */
let realtimeClient = null;
let realtimeChannel = null;
let isUpdating = false;
let pendingDbReload = false;

function initRealtimeSync() {
  const badge = document.getElementById('live-sync-badge');
  const badgeText = document.getElementById('live-sync-text');

  // 1. WebSocket Realtime via Supabase JS SDK (jika tersedia)
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    try {
      realtimeClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

      realtimeChannel = realtimeClient.channel('nyamhap-db-sync')
        .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
          console.log('⚡ [Realtime] Perubahan database terdeteksi:', payload.table, payload.eventType);
          onDatabaseChanged();
        })
        .subscribe((status, err) => {
          console.log('[Realtime] Status koneksi:', status);
          if (status === 'SUBSCRIBED') {
            if (badge) {
              badge.className = 'live-sync-badge connected';
              if (badgeText) badgeText.textContent = 'Live Sync Aktif';
            }
          } else if (status === 'CHANNEL_ERROR' || err) {
            console.warn('[Realtime] WebSocket beralih ke polling sync:', err || status);
            if (badge) {
              badge.className = 'live-sync-badge polling';
              if (badgeText) badgeText.textContent = 'Auto Sync Aktif';
            }
          }
        });
    } catch (e) {
      console.warn('Gagal inisialisasi Realtime WebSocket:', e);
      if (badge) {
        badge.className = 'live-sync-badge polling';
        if (badgeText) badgeText.textContent = 'Auto Sync Aktif';
      }
    }
  } else {
    if (badge) {
      badge.className = 'live-sync-badge polling';
      if (badgeText) badgeText.textContent = 'Auto Sync Aktif';
    }
  }

  // 2. Heartbeat Polling Liveness (setiap 8 detik)
  setInterval(async () => {
    // Tidak fetch jika tab di latar belakang, sedang proses request, atau modal sedang terbuka
    if (!document.hidden && !document.querySelector('.modal-overlay') && !isUpdating) {
      await silentReload();
    }
  }, 8000);

  // 3. Trigger reload saat tab kembali fokus
  window.addEventListener('focus', () => {
    if (!document.querySelector('.modal-overlay') && !isUpdating) {
      silentReload();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !document.querySelector('.modal-overlay') && !isUpdating) {
      silentReload();
    }
  });
}

function onDatabaseChanged() {
  if (document.querySelector('.modal-overlay')) {
    pendingDbReload = true;
    return;
  }
  silentReload();
}

async function silentReload() {
  if (isUpdating) return;
  isUpdating = true;
  const badge = document.getElementById('live-sync-badge');
  const badgeText = document.getElementById('live-sync-text');

  try {
    const [penjualan, pengeluaran, stok, aset, kasRows, incomeRemote] = await Promise.all([
      SB.list('penjualan'), SB.list('pengeluaran'), SB.list('stok'), SB.list('aset'), SB.list('kas'), SB.list('income_diambil')
    ]);

    const hasChanged = JSON.stringify(penjualan) !== JSON.stringify(data.penjualan) ||
      JSON.stringify(pengeluaran) !== JSON.stringify(data.pengeluaran) ||
      JSON.stringify(stok) !== JSON.stringify(data.stok) ||
      JSON.stringify(aset) !== JSON.stringify(data.aset) ||
      JSON.stringify((kasRows && kasRows[0]) ? kasRows[0] : null) !== JSON.stringify(data.kas) ||
      (Array.isArray(incomeRemote) && JSON.stringify(incomeRemote) !== JSON.stringify(data.income));

    if (hasChanged) {
      console.log('🔄 [Auto-Sync] Data baru terdeteksi dari database, memperbarui UI...');
      if (badge && badgeText) {
        const prevText = badgeText.textContent;
        badge.classList.add('syncing');
        badgeText.textContent = 'Memperbarui...';
        setTimeout(() => {
          badge.classList.remove('syncing');
          badgeText.textContent = prevText;
        }, 1200);
      }

      data.penjualan = penjualan || [];
      data.pengeluaran = pengeluaran || [];
      data.stok = stok || [];
      data.aset = aset || [];
      data.kas = (kasRows && kasRows[0]) ? kasRows[0] : { fikar: 0, tasia: 0, piutang: 0 };
      if (Array.isArray(incomeRemote)) {
        data.income = incomeRemote;
        LS.set('income', incomeRemote);
      }

      render();
    }
  } catch (e) {
    console.warn('Silent reload error:', e);
  } finally {
    isUpdating = false;
  }
}

/* ---------- Init ---------- */
loadAll().then(() => {
  initRealtimeSync();
});
