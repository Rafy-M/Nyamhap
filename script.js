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
      if (!res.ok) throw new Error(await res.text());
      return await res.json();
    } catch (e) { console.error('SB.list error', table, e); return []; }
  },
  async insert(table, row) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(row) });
      if (!res.ok) throw new Error(await res.text());
      return await res.json();
    } catch (e) { console.error('SB.insert error', table, e); showToast('Gagal menyimpan ke server'); return null; }
  },
  async update(table, id, row) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, { method: 'PATCH', headers: this.headers(), body: JSON.stringify(row) });
      if (!res.ok) throw new Error(await res.text());
      return await res.json();
    } catch (e) { console.error('SB.update error', table, e); showToast('Gagal memperbarui di server'); return null; }
  },
  async remove(table, id) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, { method: 'DELETE', headers: this.headers() });
      if (!res.ok) throw new Error(await res.text());
      return true;
    } catch (e) { console.error('SB.remove error', table, e); showToast('Gagal menghapus di server'); return false; }
  },
  async updateKas(row) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/kas?id=eq.1`, { method: 'PATCH', headers: this.headers(), body: JSON.stringify(row) });
      if (!res.ok) throw new Error(await res.text());
      return await res.json();
    } catch (e) { console.error('SB.updateKas error', e); showToast('Gagal update kas di server'); return null; }
  }
};

/* ---------- State ---------- */
let data = { penjualan: [], pengeluaran: [], stok: [], aset: [], kas: { fikar: 0, tasia: 0, piutang: 0 } };
let currentPeriod = 'all'; // weekly | monthly | yearly | all

const escapeHTML = str => String(str || '').replace(/[&<>'"]/g,
  tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
);

const fmtRp = n => 'Rp' + Math.round(n).toLocaleString('id-ID');

function todayStr() { return new Date().toISOString().slice(0, 10); }

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
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }
}

/* ---------- Load ---------- */
async function loadAll() {
  const [penjualan, pengeluaran, stok, aset, kasRows] = await Promise.all([
    SB.list('penjualan'), SB.list('pengeluaran'), SB.list('stok'), SB.list('aset'), SB.list('kas')
  ]);
  data.penjualan = penjualan;
  data.pengeluaran = pengeluaran;
  data.stok = stok;
  data.aset = aset;
  data.kas = (kasRows && kasRows[0]) ? kasRows[0] : { fikar: 0, tasia: 0, piutang: 0 };
  render();
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
  document.getElementById('kpi-omzet-sub').textContent = pj.length ? `${pj.length} hari transaksi` : 'Belum ada data';
  document.getElementById('kpi-hpp').textContent = fmtRp(totalHpp);
  document.getElementById('kpi-laba').textContent = fmtRp(laba);
  document.getElementById('kpi-40').textContent = fmtRp(p40);
  document.getElementById('kpi-60').textContent = fmtRp(p60);
  document.getElementById('kpi-60-per').textContent = fmtRp(perOrang) + '/orang';

  document.getElementById('split-a-txt').textContent = fmtRp(p40) + ' kas usaha';
  document.getElementById('split-b-txt').textContent = fmtRp(p60) + ' dibagi 3 orang (' + fmtRp(perOrang) + '/orang)';
}

function renderChart() {
  const sorted = [...filteredPenjualan()].sort((a, b) => a.tanggal.localeCompare(b.tanggal));
  const labels = sorted.map(r => {
    const d = new Date(r.tanggal + 'T00:00:00');
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  });
  const omzetArr = sorted.map(r => Number(r.omzet || 0));
  const labaArr = sorted.map(r => Number(r.omzet || 0) - Number(r.hpp || 0));

  const ctx = document.getElementById('trendChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels.length ? labels : ['Belum ada data'],
      datasets: [
        { label: 'Omzet', data: omzetArr, borderColor: '#5A7D5A', backgroundColor: 'rgba(90,125,90,0.07)', tension: 0.3, fill: true, pointRadius: 3, pointBackgroundColor: '#5A7D5A', borderWidth: 2 },
        { label: 'Laba', data: labaArr, borderColor: '#B8763E', backgroundColor: 'rgba(184,118,62,0.07)', tension: 0.3, fill: true, pointRadius: 3, pointBackgroundColor: '#B8763E', borderWidth: 2 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { font: { family: 'Inter', size: 11 }, color: '#1C1917', boxWidth: 8, usePointStyle: true } } },
      scales: {
        y: { ticks: { callback: v => 'Rp' + (v / 1000) + 'k', font: { family: 'Inter', size: 10 }, color: '#8A8578' }, grid: { color: '#EDEBE6' } },
        x: { ticks: { font: { family: 'Inter', size: 10 }, color: '#8A8578' }, grid: { display: false } }
      }
    }
  });
}

function fmtTanggal(t) {
  const d = new Date(t + 'T00:00:00');
  return d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
}

function renderPenjualanTable() {
  const tbody = document.getElementById('table-penjualan');
  const sorted = [...filteredPenjualan()].sort((a, b) => b.tanggal.localeCompare(a.tanggal));
  if (sorted.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Tidak ada penjualan di periode ini.</td></tr>`;
    return;
  }
  tbody.innerHTML = sorted.map(r => {
    const laba = Number(r.omzet) - Number(r.hpp);
    return `<tr>
      <td>${fmtTanggal(r.tanggal)}</td>
      <td class="num">${fmtRp(r.omzet)}</td>
      <td class="num">${fmtRp(r.hpp)}</td>
      <td class="num" style="color:var(--sage);font-weight:600;">${fmtRp(laba)}</td>
      <td class="del">
        <button class="row-edit" data-edit="penjualan" data-id="${r.id}" title="Edit">✎</button>
        <button class="row-del" data-del="penjualan" data-id="${r.id}" title="Hapus">✕</button>
      </td>
    </tr>`;
  }).join('');
}

function renderPengeluaranTable() {
  const tbody = document.getElementById('table-pengeluaran');
  const sorted = [...filteredPengeluaran()].sort((a, b) => b.tanggal.localeCompare(a.tanggal));
  if (sorted.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="4">Tidak ada pengeluaran di periode ini.</td></tr>`;
    return;
  }
  tbody.innerHTML = sorted.map(r => `<tr>
    <td>${fmtTanggal(r.tanggal)}</td>
    <td>${escapeHTML(r.item)}</td>
    <td class="num" style="color:var(--copper);">${fmtRp(r.jumlah)}</td>
    <td class="del">
      <button class="row-edit" data-edit="pengeluaran" data-id="${r.id}" title="Edit">✎</button>
      <button class="row-del" data-del="pengeluaran" data-id="${r.id}" title="Hapus">✕</button>
    </td>
  </tr>`).join('');
}

function renderStok() {
  const list = document.getElementById('list-stok');
  list.innerHTML = data.stok.length === 0
    ? `<li style="justify-content:center;color:var(--ink-soft);">Belum ada data</li>`
    : data.stok.map(r => `<li><span>${escapeHTML(r.nama)}</span><span class="val">${fmtRp(r.nilai)} <button class="row-del" data-del="stok" data-id="${r.id}">✕</button></span></li>`).join('');
  document.getElementById('total-stok').textContent = fmtRp(data.stok.reduce((s, r) => s + Number(r.nilai || 0), 0));
}

function renderAset() {
  const list = document.getElementById('list-aset');
  list.innerHTML = data.aset.length === 0
    ? `<li style="justify-content:center;color:var(--ink-soft);">Belum ada data</li>`
    : data.aset.map(r => `<li><span>${escapeHTML(r.nama)}</span><span class="val">${fmtRp(r.nilai)} <button class="row-del" data-del="aset" data-id="${r.id}">✕</button></span></li>`).join('');
  document.getElementById('total-aset').textContent = fmtRp(data.aset.reduce((s, r) => s + Number(r.nilai || 0), 0));
}

function renderKas() {
  const kas = data.kas || { fikar: 0, tasia: 0, piutang: 0 };
  const totalKasReal = Number(kas.fikar || 0) + Number(kas.tasia || 0);
  const totalStok = data.stok.reduce((s, r) => s + Number(r.nilai || 0), 0);
  const totalAset = data.aset.reduce((s, r) => s + Number(r.nilai || 0), 0);
  const totalKekayaan = totalKasReal + Number(kas.piutang || 0) + totalStok + totalAset;

  document.getElementById('people-row').innerHTML = `
    <div class="person"><div class="who">Di Fikar</div><div class="amt">${fmtRp(kas.fikar || 0)}</div></div>
    <div class="person"><div class="who">Di Tasia</div><div class="amt">${fmtRp(kas.tasia || 0)}</div></div>
  `;
  document.getElementById('table-kekayaan').innerHTML = `
    <tr><td>Kas Real Aktif Usaha</td><td class="num">${fmtRp(totalKasReal)}</td></tr>
    <tr><td>Piutang ke NYAMHAP</td><td class="num">${fmtRp(kas.piutang || 0)}</td></tr>
    <tr><td>Aset Bahan Baku Dapur</td><td class="num">${fmtRp(totalStok)}</td></tr>
    <tr><td>Aset Tetap (Alat Usaha)</td><td class="num">${fmtRp(totalAset)}</td></tr>
    <tr style="font-weight:700;border-top:2px solid var(--ink);"><td>Total Kekayaan Usaha</td><td class="num">${fmtRp(totalKekayaan)}</td></tr>
  `;
}

/* ---------- Toggle: detail view (ringkas/lengkap) ---------- */
document.querySelectorAll('#detail-tabs .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#detail-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    document.querySelectorAll('.view-lengkap-only').forEach(el => el.classList.toggle('hidden', view !== 'lengkap'));
    document.getElementById('view-ringkas').classList.toggle('hidden', view !== 'ringkas');
  });
});

/* ---------- Toggle: periode (weekly/monthly/yearly/all) ---------- */
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
function closeModal() { modalRoot.innerHTML = ''; }

function bindClose() {
  document.getElementById('btn-cancel').onclick = closeModal;
  document.getElementById('overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') closeModal(); });
}

function openModal(type, editRow = null) {
  let html = '';
  const isEdit = !!editRow;

  if (type === 'penjualan') {
    const tgl = isEdit ? editRow.tanggal : todayStr();
    const omz = isEdit ? editRow.omzet : '';
    const hpp = isEdit ? editRow.hpp : '';

    html = `<div class="modal-overlay" id="overlay"><div class="modal">
      <h3>${isEdit ? 'Edit Penjualan' : 'Tambah Penjualan'}</h3><p class="modal-sub">Catat omzet dan HPP hari ini</p>
      <div class="field"><label>Tanggal</label><input type="date" id="f-tanggal" value="${tgl}"></div>
      <div class="field"><label>Omzet (Rp)</label><input type="number" id="f-omzet" placeholder="180000" value="${omz}"></div>
      <div class="field"><label>HPP (Rp)</label><input type="number" id="f-hpp" placeholder="87500" value="${hpp}"></div>
      <div class="modal-actions"><button class="btn-secondary" id="btn-cancel">Batal</button><button class="btn-primary" id="btn-save">${isEdit ? 'Update' : 'Simpan'}</button></div>
    </div></div>`;
    modalRoot.innerHTML = html; bindClose();

    document.getElementById('btn-save').onclick = async (e) => {
      const btn = e.target;
      const tanggal = document.getElementById('f-tanggal').value;
      const omzet = Number(document.getElementById('f-omzet').value);
      const hppVal = Number(document.getElementById('f-hpp').value);

      if (!tanggal || !omzet) { showToast('Isi tanggal dan omzet dulu ya'); return; }

      btn.disabled = true;
      btn.textContent = 'Menyimpan...';

      const rowPayload = { tanggal, omzet, hpp: hppVal || 0 };
      const result = isEdit ? await SB.update('penjualan', editRow.id, rowPayload) : await SB.insert('penjualan', rowPayload);

      if (result) { await loadAll(); closeModal(); showToast(isEdit ? 'Penjualan diperbarui' : 'Penjualan tersimpan'); }
      else { btn.disabled = false; btn.textContent = isEdit ? 'Update' : 'Simpan'; }
    };
  }

  if (type === 'pengeluaran') {
    const tgl = isEdit ? editRow.tanggal : todayStr();
    const itm = isEdit ? editRow.item : '';
    const jml = isEdit ? editRow.jumlah : '';

    html = `<div class="modal-overlay" id="overlay"><div class="modal">
      <h3>${isEdit ? 'Edit Pengeluaran' : 'Tambah Pengeluaran'}</h3><p class="modal-sub">Catat belanja atau operasional</p>
      <div class="field"><label>Tanggal</label><input type="date" id="f-tanggal" value="${tgl}"></div>
      <div class="field"><label>Item</label><input type="text" id="f-item" placeholder="Ayam 1,5 kg" value="${escapeHTML(itm)}"></div>
      <div class="field"><label>Jumlah (Rp)</label><input type="number" id="f-jumlah" placeholder="63000" value="${jml}"></div>
      <div class="modal-actions"><button class="btn-secondary" id="btn-cancel">Batal</button><button class="btn-primary" id="btn-save">${isEdit ? 'Update' : 'Simpan'}</button></div>
    </div></div>`;
    modalRoot.innerHTML = html; bindClose();

    document.getElementById('btn-save').onclick = async (e) => {
      const btn = e.target;
      const tanggal = document.getElementById('f-tanggal').value;
      const item = document.getElementById('f-item').value.trim();
      const jumlah = Number(document.getElementById('f-jumlah').value);

      if (!tanggal || !item || !jumlah) { showToast('Lengkapi semua kolom dulu ya'); return; }

      btn.disabled = true;
      btn.textContent = 'Menyimpan...';

      const rowPayload = { tanggal, item, jumlah };
      const result = isEdit ? await SB.update('pengeluaran', editRow.id, rowPayload) : await SB.insert('pengeluaran', rowPayload);

      if (result) { await loadAll(); closeModal(); showToast(isEdit ? 'Pengeluaran diperbarui' : 'Pengeluaran tersimpan'); }
      else { btn.disabled = false; btn.textContent = isEdit ? 'Update' : 'Simpan'; }
    };
  }

  if (type === 'stok' || type === 'aset') {
    const judul = type === 'stok' ? 'Tambah Item Stok' : 'Tambah Aset Tetap';
    html = `<div class="modal-overlay" id="overlay"><div class="modal">
      <h3>${judul}</h3><p class="modal-sub">${type === 'stok' ? 'Catat sisa bahan baku dan nilainya' : 'Catat alat usaha dan nilainya'}</p>
      <div class="field"><label>Nama item</label><input type="text" id="f-nama" placeholder="${type === 'stok' ? 'Beras 0,7 L' : 'Magicom'}"></div>
      <div class="field"><label>Nilai (Rp)</label><input type="number" id="f-nilai" placeholder="9100"></div>
      <div class="modal-actions"><button class="btn-secondary" id="btn-cancel">Batal</button><button class="btn-primary" id="btn-save">Simpan</button></div>
    </div></div>`;
    modalRoot.innerHTML = html; bindClose();

    document.getElementById('btn-save').onclick = async (e) => {
      const btn = e.target;
      const nama = document.getElementById('f-nama').value.trim();
      const nilai = Number(document.getElementById('f-nilai').value);

      if (!nama || !nilai) { showToast('Lengkapi nama dan nilai dulu ya'); return; }

      btn.disabled = true;
      btn.textContent = 'Menyimpan...';

      const result = await SB.insert(type, { nama, nilai });
      if (result) { await loadAll(); closeModal(); showToast('Tersimpan'); }
      else { btn.disabled = false; btn.textContent = 'Simpan'; }
    };
  }

  if (type === 'kas') {
    const kas = data.kas || { fikar: 0, tasia: 0, piutang: 0 };
    html = `<div class="modal-overlay" id="overlay"><div class="modal">
      <h3>Update Kas Real</h3><p class="modal-sub">Update posisi kas fisik dan piutang</p>
      <div class="field"><label>Kas di Fikar (Rp)</label><input type="number" id="f-fikar" value="${kas.fikar || 0}"></div>
      <div class="field"><label>Kas di Tasia (Rp)</label><input type="number" id="f-tasia" value="${kas.tasia || 0}"></div>
      <div class="field"><label>Piutang ke NYAMHAP (Rp)</label><input type="number" id="f-piutang" value="${kas.piutang || 0}"></div>
      <div class="modal-actions"><button class="btn-secondary" id="btn-cancel">Batal</button><button class="btn-primary" id="btn-save">Simpan</button></div>
    </div></div>`;
    modalRoot.innerHTML = html; bindClose();

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
      if (result) { await loadAll(); closeModal(); showToast('Kas diperbarui'); }
      else { btn.disabled = false; btn.textContent = 'Simpan'; }
    };
  }
}

document.querySelectorAll('[data-modal]').forEach(btn => {
  btn.addEventListener('click', () => openModal(btn.dataset.modal));
});

/* ---------- Event Listener: Hapus & Edit ---------- */
const LABEL_TABLE = { penjualan: 'catatan penjualan', pengeluaran: 'catatan pengeluaran', stok: 'item stok', aset: 'item aset' };

function previewRow(table, row) {
  if (table === 'penjualan') return `${fmtTanggal(row.tanggal)} · Omzet ${fmtRp(row.omzet)}`;
  if (table === 'pengeluaran') return `${fmtTanggal(row.tanggal)} · ${row.item} · ${fmtRp(row.jumlah)}`;
  if (table === 'stok' || table === 'aset') return `${row.nama} · ${fmtRp(row.nilai)}`;
  return '';
}

function openConfirmDelete(table, row) {
  const label = LABEL_TABLE[table] || 'data ini';
  modalRoot.innerHTML = `<div class="modal-overlay" id="overlay"><div class="modal confirm-box">
    <div class="warn-icon">!</div>
    <h3>Hapus ${label}?</h3>
    <p>Data akan dihapus dari database. Kamu bisa mengurungkan sesaat setelah ini.</p>
    <div class="item-preview">${previewRow(table, row)}</div>
    <div class="modal-actions"><button class="btn-secondary" id="btn-cancel">Batal</button><button class="btn-danger" id="btn-confirm-del">Ya, Hapus</button></div>
  </div></div>`;
  bindClose();
  document.getElementById('btn-confirm-del').onclick = async () => { closeModal(); await performDelete(table, row); };
}

async function performDelete(table, row) {
  const ok = await SB.remove(table, row.id);
  if (!ok) return;
  await loadAll();
  showToast('Data dihapus', {
    undo: async () => {
      const { id, created_at, ...rest } = row;
      const restored = await SB.insert(table, rest);
      if (restored) { await loadAll(); showToast('Data dikembalikan'); }
    }
  });
}

document.addEventListener('click', (e) => {
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

/* ---------- Init ---------- */
loadAll();