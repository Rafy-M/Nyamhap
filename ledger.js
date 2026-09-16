/* NYAMHAP Buku Besar v2: requires supabase_migration.sql. */
(() => {
  const root = document.createElement('section');
  root.id = 'ledger-v2';
  document.querySelector('footer').before(root);
  const rp = n => 'Rp' + Math.round(Number(n || 0)).toLocaleString('id-ID');
  const esc = s => String(s || '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const headers = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type':'application/json', Prefer:'return=representation' });
  async function api(path, options = {}) { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {...options, headers:headers()}); if (!r.ok) throw new Error(await r.text()); return r.status===204 ? null : r.json(); }
  const rpc = (name, body) => api(`rpc/${name}`, {method:'POST', body:JSON.stringify(body)});
  let state = {};
  let openingStockAlertShown = false;
  async function load() {
    try {
      const [kas,stok,resep,penjualan,beli,piutang,ambil,jurnal,hak] = await Promise.all([
        api('v_saldo_kas?select=*'), api('v_stok_saldo?select=*&order=nama.asc'), api('v_hpp_resep?select=*&order=nama.asc'),
        api('penjualan?select=omzet,hpp,status'), api('pembelian?select=*&status=eq.aktif&order=tanggal.desc'), api('piutang_detail?select=*&status=eq.aktif'), api('pengambilan_partner?select=*'), api('kas_transaksi?select=*&order=id.desc&limit=12'), api('v_hak_partner?select=*')
      ]);
      state={kas,stok,resep,penjualan,beli,piutang,ambil,jurnal,hak}; render();
      if (!openingStockAlertShown) { openingStockAlertShown = true; showOpeningStockAlert(); }
      document.querySelectorAll('.wrap > :not(header):not(#ledger-v2):not(footer)').forEach(el => el.classList.add('legacy-hidden'));
      const tabs = document.getElementById('detail-tabs'); if (tabs) tabs.classList.add('legacy-hidden');
      const subtitle = document.querySelector('header .brand > p'); if (subtitle) subtitle.textContent = 'Buku besar, stok, dan laporan usaha';
    } catch (e) { root.innerHTML=`<div class="ledger-error"><strong>Modul buku besar belum siap.</strong><br>Jalankan <code>supabase_migration.sql</code> di Supabase SQL Editor, lalu muat ulang.<br><small>${esc(e.message)}</small></div>`; }
  }
  function options(rows, key, label, blank='') { return `<option value="">${blank}</option>`+rows.map(r=>`<option value="${r[key]}">${esc(r[label])}</option>`).join(''); }
  function report() {
    const omzet=state.penjualan.filter(x=>x.status==='aktif').reduce((a,x)=>a+Number(x.omzet),0), hpp=state.penjualan.filter(x=>x.status==='aktif').reduce((a,x)=>a+Number(x.hpp),0), laba=omzet-hpp;
    const cash=Object.fromEntries(state.kas.map(x=>[x.akun_kas,Number(x.saldo)])), stock=state.stok.reduce((a,x)=>a+Number(x.nilai),0), debt=state.piutang.reduce((a,x)=>a+Number(x.sisa),0), taken=state.ambil.reduce((a,x)=>a+Number(x.jumlah),0);
    return {omzet,hpp,laba,cash,stock,debt,taken,wealth:(cash.fikar||0)+(cash.tasia||0)+stock+debt};
  }
  function showOpeningStockAlert() {
    const empty = state.stok.filter(item => Number(item.qty) <= 0);
    if (!empty.length) return;
    document.getElementById('stock-opening-alert')?.remove();
    const modal = document.createElement('div');
    modal.id = 'stock-opening-alert';
    modal.className = 'stock-alert-backdrop';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'stock-alert-title');
    modal.innerHTML = `<div class="stock-alert-card"><div class="stock-alert-icon">!</div><div><span class="eyebrow">Perlu tindakan</span><h2 id="stock-alert-title">${empty.length} bahan stok habis</h2><p>Stok berikut bernilai nol. Lakukan pembelian baru sebelum produksi berikutnya.</p></div><div class="stock-alert-list">${empty.map(item => `<span>${esc(item.nama)}</span>`).join('')}</div><button type="button" class="stock-alert-close" data-close-stock-alert>Saya mengerti</button></div>`;
    document.body.append(modal);
    modal.querySelector('[data-close-stock-alert]').focus();
  }
  function render() {
    const r=report(), bahanOptions=options(state.stok,'id','nama','Pilih bahan'), resepOptions=options(state.resep,'resep_id','nama','Pilih resep'), debtOptions=options(state.piutang,'id','pihak','Pilih piutang');
    const emptyCount = state.stok.filter(item => Number(item.qty) <= 0).length;
    root.innerHTML=`<div class="ledger-head"><div><span class="eyebrow">NYAMHAP · OPERASIONAL</span><h2>Buku Besar</h2><p>Kendali kas, bahan baku, penjualan, dan hak partner dalam satu tempat.</p></div><div class="ledger-head-actions"><button class="stock-status ${emptyCount ? 'attention' : ''}" data-open-stock-alert ${emptyCount ? '' : 'disabled'}>${emptyCount ? `${emptyCount} stok habis` : 'Stok aman'}</button><button class="add-btn" data-ledger-refresh>↻ Muat ulang</button></div></div>
    <div class="ledger-kpis"><div class="kpi-fikar"><span>Kas Fikar</span><b>${rp(r.cash.fikar)}</b><small>Saldo operasional</small></div><div class="kpi-tasia"><span>Kas Tasia</span><b>${rp(r.cash.tasia)}</b><small>Saldo operasional</small></div><div class="kpi-laba"><span>Laba Bersih</span><b>${rp(r.laba)}</b><small>Omzet dikurangi HPP</small></div><div class="kpi-kaya"><span>Kekayaan Usaha</span><b>${rp(r.wealth)}</b><small>Kas, stok, dan piutang</small></div></div>
    <div class="ledger-grid">
      <form class="ledger-card" data-ledger-form="purchase"><h3>Pembelian / Pengeluaran</h3><input name="nama" required placeholder="Nama belanja"><select name="bahan">${bahanOptions}</select><select name="kategori"><option value="bahan_baku">Bahan baku</option><option value="kemasan">Kemasan</option><option value="aset">Aset</option><option value="operasional">Operasional</option></select><div class="ledger-two"><input name="qty" required type="number" min="0.001" step="any" placeholder="Qty"><input name="satuan" required value="pcs" placeholder="Satuan"></div><input name="harga" required type="number" min="0" placeholder="Harga satuan"><select name="sumber"><option value="fikar">Kas Fikar</option><option value="tasia">Kas Tasia</option><option value="none">Tidak potong kas</option></select><textarea name="catatan" placeholder="Catatan"></textarea><button>Simpan pembelian</button></form>
      <form class="ledger-card" data-ledger-form="sales"><h3>Penjualan & HPP</h3><select name="resep" required>${resepOptions}</select><div class="ledger-two"><input name="produksi" required type="number" min="1" placeholder="Produksi"><input name="bonus" required type="number" min="0" value="0" placeholder="Bonus"></div><div class="ledger-two"><input name="eceran" required type="number" min="0" value="0" placeholder="Eceran pcs"><input name="reseller" required type="number" min="0" value="0" placeholder="Reseller pcs"></div><div class="ledger-two"><input name="hargaE" required type="number" min="0" value="5000" placeholder="Harga eceran"><input name="hargaR" required type="number" min="0" value="4000" placeholder="Harga reseller"></div><div class="ledger-two"><select name="metode"><option>QRIS</option><option>Cash</option><option>Transfer</option></select><select name="akun"><option value="fikar">Masuk Fikar</option><option value="tasia">Masuk Tasia</option></select></div><textarea name="catatan" placeholder="Catatan"></textarea><button>Simpan penjualan</button></form>
      <form class="ledger-card" data-ledger-form="empty"><h3>Stok Habis</h3><select name="bahan" required>${bahanOptions}</select><input name="qty" required type="number" min="0.001" step="any" placeholder="Qty habis"><textarea name="catatan" placeholder="Alasan/ catatan"></textarea><button class="warn">Tandai habis tanpa refund kas</button></form>
      <form class="ledger-card" data-ledger-form="partner"><h3>Pengambilan Laba</h3><select name="nama"><option>Fikar</option><option>Rafy</option><option>Tasia</option></select><input name="jumlah" required type="number" min="1" placeholder="Nominal"><select name="sumber"><option value="fikar">Kas Fikar</option><option value="tasia">Kas Tasia</option></select><textarea name="catatan" placeholder="Catatan"></textarea><button>Catat pengambilan</button></form>
      <form class="ledger-card" data-ledger-form="debt"><h3>Pelunasan Piutang</h3><select name="piutang" required>${debtOptions}</select><input name="jumlah" required type="number" min="1" placeholder="Nominal"><select name="akun"><option value="fikar">Masuk Fikar</option><option value="tasia">Masuk Tasia</option></select><textarea name="catatan" placeholder="Catatan"></textarea><button>Catat pelunasan</button></form>
      <form class="ledger-card" data-ledger-form="newdebt"><h3>Piutang Baru</h3><input name="pihak" required placeholder="Nama pihak yang berutang"><input name="jumlah" required type="number" min="1" placeholder="Nominal piutang"><textarea name="catatan" placeholder="Catatan"></textarea><button>Catat piutang</button></form>
      <form class="ledger-card" data-ledger-form="adjust"><h3>Penyesuaian Kas</h3><select name="akun"><option value="fikar">Kas Fikar</option><option value="tasia">Kas Tasia</option></select><input name="jumlah" required type="number" step="any" placeholder="Positif tambah, negatif kurang"><textarea name="catatan" required placeholder="Alasan penyesuaian wajib"></textarea><button class="warn">Buat jurnal penyesuaian</button></form>
      <div class="ledger-card"><h3>Laporan ringkas</h3><p>Omzet: <b>${rp(r.omzet)}</b></p><p>HPP terpakai: <b>${rp(r.hpp)}</b></p><p>Nilai stok: <b>${rp(r.stock)}</b></p><p>Piutang aktif: <b>${rp(r.debt)}</b></p><p>Pengambilan partner: <b>${rp(r.taken)}</b></p>${state.hak.map(x=>`<p>Hak ${x.nama}: <b>${rp(x.sisa_hak)}</b></p>`).join('')}</div>
    </div><div class="ledger-card ledger-wide"><h3>Kartu Stok</h3><table><thead><tr><th>Bahan</th><th>Qty</th><th>Satuan</th><th>Minimum</th><th>Nilai</th></tr></thead><tbody>${state.stok.map(x=>`<tr class="${Number(x.qty)<=Number(x.stok_minimum)?'low-stock':''}"><td>${esc(x.nama)}</td><td>${x.qty}</td><td>${esc(x.satuan)}</td><td>${x.stok_minimum}</td><td>${rp(x.nilai)}</td></tr>`).join('')}</tbody></table></div>
    <div class="ledger-card ledger-wide"><h3>Pembelian aktif</h3><table><thead><tr><th>Tanggal</th><th>Item</th><th>Kategori</th><th>Total</th><th>Kas</th><th></th></tr></thead><tbody>${state.beli.map(x=>`<tr><td>${x.tanggal}</td><td>${esc(x.nama_item)}</td><td>${esc(x.kategori)}</td><td>${rp(x.total)}</td><td>${esc(x.sumber_kas)}</td><td><button class="ledger-mini-danger" data-cancel-buy="${x.id}">Batalkan</button></td></tr>`).join('')||'<tr><td colspan="6">Belum ada pembelian baru.</td></tr>'}</tbody></table></div>
    <div class="ledger-card ledger-wide"><h3>Jurnal kas terakhir</h3><table><thead><tr><th>Tanggal</th><th>Akun</th><th>Jenis</th><th>Referensi</th><th>Nominal</th></tr></thead><tbody>${state.jurnal.map(x=>`<tr><td>${x.tanggal}</td><td>${esc(x.akun_kas)}</td><td>${esc(x.jenis)}</td><td>${esc(x.referensi)}</td><td>${rp(x.jumlah)}</td></tr>`).join('')||'<tr><td colspan="5">Belum ada jurnal.</td></tr>'}</tbody></table></div>`;
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-close-stock-alert]')) document.getElementById('stock-opening-alert')?.remove(); });
  root.addEventListener('click', async e=>{if(e.target.matches('[data-ledger-refresh]')) return load(); if(e.target.matches('[data-open-stock-alert]')) return showOpeningStockAlert(); const id=e.target.dataset.cancelBuy; if(!id)return; if(!confirm('Batalkan pembelian ini? Stok dikurangi dan kas dikembalikan secara atomik.'))return; try{await rpc('batalkan_pembelian',{p_id:Number(id),p_catatan:'Dibatalkan dari dashboard'});alert('Pembelian dibatalkan.');await load();}catch(err){alert(`Gagal: ${err.message}`)}});
  root.addEventListener('submit', async e=>{ const f=e.target, type=f.dataset.ledgerForm; if(!type)return; e.preventDefault(); const x=Object.fromEntries(new FormData(f)); const date=new Date().toISOString().slice(0,10); try {
    if(type==='purchase') await rpc('catat_pembelian',{p_tanggal:date,p_kategori:x.kategori,p_bahan_id:x.bahan?Number(x.bahan):null,p_nama_item:x.nama,p_qty:Number(x.qty),p_satuan:x.satuan,p_harga:Number(x.harga),p_sumber:x.sumber,p_catatan:x.catatan||null});
    if(type==='empty') await rpc('tandai_stok_habis',{p_bahan_id:Number(x.bahan),p_qty:Number(x.qty),p_tanggal:date,p_catatan:x.catatan||null});
    if(type==='partner') await rpc('catat_pengambilan_partner',{p_tanggal:date,p_nama:x.nama,p_jumlah:Number(x.jumlah),p_sumber:x.sumber,p_catatan:x.catatan||null});
    if(type==='debt') await rpc('catat_pelunasan_piutang',{p_piutang_id:Number(x.piutang),p_tanggal:date,p_jumlah:Number(x.jumlah),p_akun:x.akun,p_catatan:x.catatan||null});
    if(type==='newdebt') await rpc('catat_piutang',{p_tanggal:date,p_pihak:x.pihak,p_jumlah:Number(x.jumlah),p_catatan:x.catatan||null});
    if(type==='adjust') await rpc('penyesuaian_kas',{p_tanggal:date,p_akun:x.akun,p_jumlah:Number(x.jumlah),p_catatan:x.catatan});
    if(type==='sales') { const produksi=Number(x.produksi), eceran=Number(x.eceran), reseller=Number(x.reseller), bonus=Number(x.bonus); if(produksi!==eceran+reseller+bonus) throw new Error('Produksi harus sama dengan eceran + reseller + bonus'); const omzet=eceran*Number(x.hargaE)+reseller*Number(x.hargaR); await rpc('catat_penjualan',{p_tanggal:date,p_resep_id:Number(x.resep),p_produksi:produksi,p_eceran:eceran,p_reseller:reseller,p_bonus:bonus,p_harga_eceran:Number(x.hargaE),p_harga_reseller:Number(x.hargaR),p_pembayaran:[{metode:x.metode,akun_kas:x.akun,jumlah:omzet}],p_catatan:x.catatan||null}); }
    alert('Transaksi tersimpan.'); await load();
  } catch(err) { alert(`Gagal: ${err.message}`); }});
  load();
})();
