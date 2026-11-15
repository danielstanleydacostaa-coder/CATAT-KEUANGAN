/* ============================================================
   CATAT KEUANGAN - logika aplikasi (frontend)
   ============================================================ */
(function () {
  'use strict';

  // ===================== KONFIGURASI (ubah baris pertama) =====================
  const CONFIG = {
    API_URL: 'GANTI_DENGAN_URL_APPS_SCRIPT_ANDA', // URL dari Apps Script, berakhiran /exec
    TOKEN_KEY: 'catatKeuangan.token',
    LAST_ACCOUNT_KEY: 'catatKeuangan.lastAccount',
    PAGE_SIZE: 50,
    TRANSFER: 'Transfer Antar Rekening' // kategori transfer: tidak dihitung sebagai pemasukan/pengeluaran
  };

  const PALETTE = ['#14b8a6', '#3b82f6', '#8b5cf6', '#f43f5e', '#f59e0b', '#22c55e',
    '#06b6d4', '#ec4899', '#84cc16', '#a855f7', '#0ea5e9', '#f97316'];
  const PREV_LABEL = { today: 'kemarin', week: 'minggu lalu', month: 'bulan lalu', custom: 'periode sebelumnya' };

  const state = {
    config: null,
    tx: [],
    period: 'month',
    custom: { from: '', to: '' },
    filters: { q: '', jenis: '', kategori: '', rekening: '', from: '', to: '' },
    shown: CONFIG.PAGE_SIZE,
    charts: {},
    form: null,
    pending: null
  };

  // ===================== UTILITAS =====================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.prototype.slice.call(document.querySelectorAll(sel));
  const pad = (n) => String(n).padStart(2, '0');
  const rp = (n) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseIso = (s) => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const todayD = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
  const daysBetween = (a, b) => Math.round((b - a) / 86400000) + 1;
  const fmtDate = (d, opts) => d.toLocaleDateString('id-ID', opts);
  const fmtDateFromIso = (s) => fmtDate(parseIso(s), { day: 'numeric', month: 'short', year: 'numeric' });
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const formatDigits = (n) => (n ? Math.round(n).toLocaleString('id-ID') : '');
  const compactRp = (v) => v >= 1e6 ? (v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt'
    : v >= 1e3 ? Math.round(v / 1e3) + ' rb' : String(v);
  const show = (sel) => $(sel).classList.remove('hidden');
  const hide = (sel) => $(sel).classList.add('hidden');
  const groupSum = (list, key) => {
    const o = {};
    list.forEach((t) => { o[t[key]] = (o[t[key]] || 0) + t.jumlah; });
    return o;
  };

  function showLoading(on) { $('#loading').classList.toggle('hidden', !on); }

  let toastTimer = null;
  function toast(msg, type) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show ' + (type || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2800);
  }

  // ===================== KOMUNIKASI DENGAN APPS SCRIPT =====================
  function getToken() { return localStorage.getItem(CONFIG.TOKEN_KEY) || ''; }

  async function api(action, body) {
    const token = getToken();
    let res;
    try {
      if (body) {
        res = await fetch(CONFIG.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(Object.assign({ action: action, token: token }, body))
        });
      } else {
        res = await fetch(CONFIG.API_URL + '?action=' + encodeURIComponent(action) +
          '&token=' + encodeURIComponent(token));
      }
    } catch (err) {
      throw new Error('Tidak bisa terhubung. Periksa koneksi internet.');
    }
    if (!res.ok) throw new Error('Server bermasalah (kode ' + res.status + ').');
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Terjadi kesalahan.');
    return json;
  }

  // ===================== PERIODE & PERHITUNGAN =====================
  function currentRange() {
    const today = todayD();
    if (state.period === 'today') return { start: today, end: today, key: 'today' };
    if (state.period === 'week') {
      const offset = (today.getDay() + 6) % 7; // Senin = hari pertama
      return { start: addDays(today, -offset), end: today, key: 'week' };
    }
    if (state.period === 'custom' && state.custom.from && state.custom.to) {
      let s = parseIso(state.custom.from);
      let e = parseIso(state.custom.to);
      if (e < s) { const tmp = s; s = e; e = tmp; }
      return { start: s, end: e, key: 'custom' };
    }
    return {
      start: new Date(today.getFullYear(), today.getMonth(), 1),
      end: new Date(today.getFullYear(), today.getMonth() + 1, 0),
      key: 'month'
    };
  }

  function elapsedDays(r) {
    const today = todayD();
    const last = r.end < today ? r.end : today;
    return Math.max(1, daysBetween(r.start, last));
  }

  function previousRange(r) {
    if (r.key === 'month') {
      // bandingkan jumlah hari yang sama di bulan sebelumnya
      const start = new Date(r.start.getFullYear(), r.start.getMonth() - 1, 1);
      const fullEnd = new Date(r.start.getFullYear(), r.start.getMonth(), 0);
      const len = Math.min(elapsedDays(r), daysBetween(start, fullEnd));
      return { start: start, end: addDays(start, len - 1), key: 'month' };
    }
    const len = daysBetween(r.start, r.end);
    const end = addDays(r.start, -1);
    return { start: addDays(end, -(len - 1)), end: end, key: r.key };
  }

  function inRange(list, r) {
    const s = iso(r.start);
    const e = iso(r.end);
    return list.filter(function (t) { return t.tanggal >= s && t.tanggal <= e; });
  }

  function totals(list) {
    let masuk = 0, keluar = 0;
    list.forEach(function (t) {
      if (t.kategori === CONFIG.TRANSFER) return;
      if (t.jenis === 'Pemasukan') masuk += t.jumlah;
      else if (t.jenis === 'Pengeluaran') keluar += t.jumlah;
    });
    return { masuk: masuk, keluar: keluar, saldo: masuk - keluar };
  }

  function periodLabel(r) {
    if (r.key === 'today') return 'Hari ini · ' + fmtDate(r.start, { weekday: 'long', day: 'numeric', month: 'long' });
    if (r.key === 'week') return 'Minggu ini · ' + fmtDate(r.start, { day: 'numeric', month: 'short' }) +
      ' – ' + fmtDate(r.end, { day: 'numeric', month: 'short' });
    return fmtDate(r.start, { day: 'numeric', month: 'short' }) + ' – ' +
      fmtDate(r.end, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function pctText(now, before) {
    if (!before) return now ? 'baru ada data' : 'belum ada data';
    const d = Math.round((now - before) / before * 100);
    if (d === 0) return 'sama';
    return (d > 0 ? 'naik ' : 'turun ') + Math.abs(d) + '%';
  }

  function accountBalances() {
    return state.config.accounts.map(function (a) {
      let masuk = 0, keluar = 0;
      state.tx.forEach(function (t) {
        if (t.rekening !== a.name) return;
        if (t.jenis === 'Pemasukan') masuk += t.jumlah;
        else if (t.jenis === 'Pengeluaran') keluar += t.jumlah;
      });
      return { name: a.name, saldo: a.openingBalance + masuk - keluar };
    });
  }

  function buildInsights(r, cur, prev, t) {
    const items = [];
    const expenses = cur.filter(function (x) { return x.jenis === 'Pengeluaran' && x.kategori !== CONFIG.TRANSFER; });
    if (!expenses.length) {
      items.push('Belum ada pengeluaran pada periode ini.');
    } else {
      const byCat = groupSum(expenses, 'kategori');
      const top = Object.entries(byCat).sort(function (a, b) { return b[1] - a[1]; })[0];
      const pct = t.keluar ? Math.round(top[1] / t.keluar * 100) : 0;
      items.push('Kategori pengeluaran terbesar: <b>' + esc(top[0]) + '</b> (' + rp(top[1]) + ', ' + pct + '% dari total).');
      items.push('Rata-rata pengeluaran harian: <b>' + rp(t.keluar / elapsedDays(r)) + '</b>.');
      const biggest = expenses.slice().sort(function (a, b) { return b.jumlah - a.jumlah; })[0];
      items.push('Pengeluaran tunggal terbesar: <b>' + esc(biggest.keterangan || biggest.kategori) + '</b> (' + rp(biggest.jumlah) + ').');
    }
    const pt = totals(inRange(state.tx, prev));
    if (pt.keluar > 0) {
      items.push('Pengeluaran ' + pctText(t.keluar, pt.keluar) + ' dibanding ' + PREV_LABEL[r.key] + '.');
    } else {
      items.push('Belum ada pembanding dari ' + PREV_LABEL[r.key] + '.');
    }
    return items;
  }

  // ===================== RENDER: BERANDA =====================
  function renderHome() {
    if (!state.config) return;
    const r = currentRange();
    const prev = previousRange(r);
    const cur = inRange(state.tx, r);
    const t = totals(cur);
    const pt = totals(inRange(state.tx, prev));

    $('#period-label').textContent = periodLabel(r);
    $('#sum-masuk').textContent = rp(t.masuk);
    $('#sum-keluar').textContent = rp(t.keluar);
    $('#sum-saldo').textContent = (t.saldo < 0 ? '− ' : '') + rp(Math.abs(t.saldo));
    $('#sum-prev').textContent = 'Dibanding ' + PREV_LABEL[r.key] + ': pemasukan ' +
      pctText(t.masuk, pt.masuk) + ', pengeluaran ' + pctText(t.keluar, pt.keluar) + '.';

    $('#account-cards').innerHTML = accountBalances().map(function (a) {
      return '<div class="account"><span class="small">' + esc(a.name) + '</span>' +
        '<strong>' + (a.saldo < 0 ? '− ' : '') + rp(Math.abs(a.saldo)) + '</strong>' +
        '<span class="small">Saldo awal + semua transaksi</span></div>';
    }).join('');

    $('#insight-list').innerHTML = buildInsights(r, cur, prev, t).map(function (s) {
      return '<li><span class="dot"></span><span>' + s + '</span></li>';
    }).join('');
  }

  // ===================== RENDER: RIWAYAT =====================
  function readFilters() {
    state.filters = {
      q: $('#f-q').value.trim(),
      jenis: $('#f-jenis').value,
      kategori: $('#f-kategori').value,
      rekening: $('#f-rekening').value,
      from: $('#f-from').value,
      to: $('#f-to').value
    };
  }

  function hasAnyFilter() { return Object.keys(state.filters).some(function (k) { return !!state.filters[k]; }); }

  function filteredTx() {
    const f = state.filters;
    const q = f.q.toLowerCase();
    return state.tx.filter(function (t) {
      if (f.jenis && t.jenis !== f.jenis) return false;
      if (f.kategori && t.kategori !== f.kategori) return false;
      if (f.rekening && t.rekening !== f.rekening) return false;
      if (f.from && t.tanggal < f.from) return false;
      if (f.to && t.tanggal > f.to) return false;
      if (q && (t.keterangan + ' ' + t.kategori).toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) {
      return b.tanggal.localeCompare(a.tanggal) || b.row - a.row;
    });
  }

  function renderRiwayat() {
    if (!state.config) return;
    const list = filteredTx();
    const box = $('#riwayat-list');

    if (!list.length) {
      box.innerHTML = '<div class="empty-state"><div class="orb"></div>' +
        '<p>' + (hasAnyFilter() ? 'Tidak ada transaksi yang cocok dengan filter.' : 'Belum ada transaksi. Mulai catat sekarang!') + '</p>' +
        '<button class="btn-primary" data-add="1" type="button">+ Tambah transaksi</button></div>';
      $('#btn-more').classList.add('hidden');
      return;
    }

    let html = '';
    let lastDate = '';
    list.slice(0, state.shown).forEach(function (t) {
      if (t.tanggal !== lastDate) {
        html += '<div class="day-head">' + fmtDate(parseIso(t.tanggal), { weekday: 'long', day: 'numeric', month: 'long' }) + '</div>';
        lastDate = t.tanggal;
      }
      const isIn = t.jenis === 'Pemasukan';
      html += '<button type="button" class="tx" data-row="' + t.row + '">' +
        '<span class="tx-badge ' + (isIn ? 'in' : 'out') + '">' + (isIn ? '↑' : '↓') + '</span>' +
        '<span class="tx-body"><span class="tx-title">' + esc(t.keterangan || t.kategori) + '</span>' +
        '<span class="tx-sub">' + esc(t.kategori) + ' · ' + esc(t.rekening) +
        (t.nota ? ' · <span class="nota-tag">📎 nota</span>' : '') + '</span></span>' +
        '<span class="tx-amount ' + (isIn ? 'in' : 'out') + '">' + (isIn ? '+ ' : '− ') + rp(t.jumlah) + '</span>' +
        '</button>';
    });
    box.innerHTML = html;
    $('#btn-more').classList.toggle('hidden', list.length <= state.shown);
  }

  function populateFilters() {
    const kat = $('#f-kategori');
    const cats = state.config.expenseCategories.map(function (c) { return c.name; })
      .concat(state.config.incomeCategories);
    const uniq = cats.filter(function (c, i) { return c && cats.indexOf(c) === i; });
    const currentKat = kat.value;
    kat.innerHTML = '<option value="">Semua kategori</option>' +
      uniq.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    kat.value = currentKat;

    const rek = $('#f-rekening');
    const currentRek = rek.value;
    rek.innerHTML = '<option value="">Semua rekening</option>' +
      state.config.accounts.map(function (a) { return '<option>' + esc(a.name) + '</option>'; }).join('');
    rek.value = currentRek;
  }

  // ===================== RENDER: GRAFIK =====================
  function destroyChart(key) {
    if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; }
  }

  function drawChart(key, id, cfg) {
    if (typeof Chart === 'undefined') return; // Chart.js belum termuat (offline pertama kali)
    destroyChart(key);
    state.charts[key] = new Chart(document.getElementById(id), cfg);
  }

  function renderGrafik() {
    if (!state.config) return;
    const r = currentRange();
    const cur = inRange(state.tx, r).filter(function (x) { return x.kategori !== CONFIG.TRANSFER; });
    $('#chart-period-label').textContent = periodLabel(r);

    // Donat: pengeluaran per kategori
    const exp = groupSum(cur.filter(function (x) { return x.jenis === 'Pengeluaran'; }), 'kategori');
    const entries = Object.entries(exp).sort(function (a, b) { return b[1] - a[1]; });
    const hasExp = entries.length > 0;
    $('#chart-kategori').parentElement.classList.toggle('hidden', !hasExp);
    $('#empty-kategori').classList.toggle('hidden', hasExp);
    if (hasExp) {
      drawChart('kategori', 'chart-kategori', {
        type: 'doughnut',
        data: {
          labels: entries.map(function (e) { return e[0]; }),
          datasets: [{ data: entries.map(function (e) { return e[1]; }),
            backgroundColor: entries.map(function (_, i) { return PALETTE[i % PALETTE.length]; }), borderWidth: 0 }]
        },
        options: {
          cutout: '62%',
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
            tooltip: { callbacks: { label: function (c) { return ' ' + c.label + ': ' + rp(c.parsed); } } }
          }
        }
      });
    } else {
      destroyChart('kategori');
    }

    // Garis: tren harian
    const last = r.end < todayD() ? r.end : todayD();
    const days = [];
    for (let d = new Date(r.start); d <= last && days.length < 366; d = addDays(d, 1)) days.push(iso(d));
    const inc = {}, out = {};
    cur.forEach(function (x) {
      if (x.jenis === 'Pemasukan') inc[x.tanggal] = (inc[x.tanggal] || 0) + x.jumlah;
      else if (x.jenis === 'Pengeluaran') out[x.tanggal] = (out[x.tanggal] || 0) + x.jumlah;
    });
    drawChart('harian', 'chart-harian', {
      type: 'line',
      data: {
        labels: days.map(function (d) { return fmtDate(parseIso(d), { day: 'numeric', month: 'short' }); }),
        datasets: [
          { label: 'Pemasukan', data: days.map(function (d) { return inc[d] || 0; }),
            borderColor: '#059669', backgroundColor: 'rgba(5,150,105,.12)', fill: true, tension: 0.35, pointRadius: 0 },
          { label: 'Pengeluaran', data: days.map(function (d) { return out[d] || 0; }),
            borderColor: '#e11d48', backgroundColor: 'rgba(225,29,72,.10)', fill: true, tension: 0.35, pointRadius: 0 }
        ]
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: { y: { ticks: { callback: function (v) { return compactRp(v); } } } },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: function (c) { return ' ' + c.dataset.label + ': ' + rp(c.parsed.y); } } }
        }
      }
    });

    // Batang: 6 bulan terakhir (tanpa transfer)
    const today = todayD();
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(new Date(today.getFullYear(), today.getMonth() - i, 1));
    const sums = months.map(function (m) {
      const k = m.getFullYear() + '-' + pad(m.getMonth() + 1);
      let a = 0, b = 0;
      state.tx.forEach(function (x) {
        if (x.kategori === CONFIG.TRANSFER || x.tanggal.indexOf(k) !== 0) return;
        if (x.jenis === 'Pemasukan') a += x.jumlah;
        else if (x.jenis === 'Pengeluaran') b += x.jumlah;
      });
      return { a: a, b: b };
    });
    drawChart('bulanan', 'chart-bulanan', {
      type: 'bar',
      data: {
        labels: months.map(function (m) { return fmtDate(m, { month: 'short' }); }),
        datasets: [
          { label: 'Pemasukan', data: sums.map(function (s) { return s.a; }), backgroundColor: '#10b981', borderRadius: 8 },
          { label: 'Pengeluaran', data: sums.map(function (s) { return s.b; }), backgroundColor: '#f43f5e', borderRadius: 8 }
        ]
      },
      options: {
        scales: { y: { ticks: { callback: function (v) { return compactRp(v); } } } },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: function (c) { return ' ' + c.dataset.label + ': ' + rp(c.parsed.y); } } }
        }
      }
    });

    renderBudget();
  }

  function renderBudget() {
    const ym = iso(todayD()).slice(0, 7);
    const spentList = state.tx.filter(function (t) {
      return t.tanggal.indexOf(ym) === 0 && t.jenis === 'Pengeluaran' && t.kategori !== CONFIG.TRANSFER;
    });
    const spent = groupSum(spentList, 'kategori');
    const rows = state.config.expenseCategories.filter(function (c) { return c.budget > 0; }).map(function (c) {
      const s = spent[c.name] || 0;
      const p = s / c.budget * 100;
      const cls = p > 100 ? 'over' : p >= 80 ? 'warn' : '';
      const status = p > 100 ? 'Melebihi budget' : p >= 80 ? 'Waspada' : 'Aman';
      return '<div class="budget-item">' +
        '<div class="budget-head"><span>' + esc(c.name) + '</span><span>' + rp(s) + ' / ' + rp(c.budget) + '</span></div>' +
        '<div class="bar"><i class="' + cls + '" style="width:' + Math.min(p, 100).toFixed(0) + '%"></i></div>' +
        '<div class="budget-status muted">' + status + ' · ' + Math.round(p) + '% terpakai</div></div>';
    });
    $('#budget-list').innerHTML = rows.length ? rows.join('') :
      '<p class="empty">Belum ada budget yang diisi di sheet Pengaturan.</p>';
  }

  // ===================== FORM TAMBAH / EDIT =====================
  function openForm(mode, tx) {
    const isEdit = mode === 'edit';
    const accounts = state.config.accounts.map(function (a) { return a.name; });
    const lastAcc = localStorage.getItem(CONFIG.LAST_ACCOUNT_KEY);

    state.form = {
      mode: mode,
      original: isEdit ? {
        row: tx.row, tanggal: tx.tanggal, rekening: tx.rekening, jenis: tx.jenis,
        kategori: tx.kategori, keterangan: tx.keterangan, jumlah: tx.jumlah
      } : null,
      jenis: isEdit ? tx.jenis : 'Pengeluaran',
      kategori: isEdit ? tx.kategori : '',
      rekening: isEdit ? tx.rekening : (accounts.indexOf(lastAcc) !== -1 ? lastAcc : (accounts[0] || '')),
      amount: isEdit ? tx.jumlah : 0,
      nota: null
    };

    $('#form-title').textContent = isEdit ? 'Edit transaksi' : 'Tambah transaksi';
    $('#f-amount').value = isEdit ? formatDigits(tx.jumlah) : '';
    $('#f-tanggal').value = isEdit ? tx.tanggal : iso(todayD());
    $('#f-ket').value = isEdit ? tx.keterangan : '';
    $('#f-nota').value = '';
    $('#form-error').textContent = '';
    $('#btn-delete').classList.toggle('hidden', !isEdit);
    setNotaPreview(null);
    if (isEdit && tx.nota) {
      $('#nota-link').href = tx.nota;
      $('#nota-link').classList.remove('hidden');
    } else {
      $('#nota-link').classList.add('hidden');
    }
    setJenisUI(state.form.jenis);
    renderFormChips();
    show('#sheet-form');
    if (!isEdit) setTimeout(function () { $('#f-amount').focus(); }, 250);
  }

  function closeForm() {
    hide('#sheet-form');
    state.form = null;
  }

  function setJenisUI(jenis) {
    $$('.seg').forEach(function (b) { b.classList.toggle('active', b.dataset.jenis === jenis); });
  }

  function renderFormChips() {
    const f = state.form;
    const cats = f.jenis === 'Pemasukan'
      ? state.config.incomeCategories
      : state.config.expenseCategories.map(function (c) { return c.name; });
    $('#kategori-chips').innerHTML = cats.map(function (c) {
      return '<button type="button" class="chip ' + (f.kategori === c ? 'active' : '') + '" data-kat="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('') || '<p class="muted small">Kategori belum diisi di sheet Pengaturan.</p>';
    $('#rekening-chips').innerHTML = state.config.accounts.map(function (a) {
      return '<button type="button" class="chip ' + (f.rekening === a.name ? 'active' : '') + '" data-rek="' + esc(a.name) + '">' + esc(a.name) + '</button>';
    }).join('');
  }

  function setNotaPreview(src) {
    $('#nota-preview').classList.toggle('hidden', !src);
    if (src) $('#nota-img').src = src;
  }

  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        const maxSide = 1280;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const dataUrl = c.toDataURL('image/jpeg', 0.75);
        URL.revokeObjectURL(url);
        resolve({ base64: dataUrl.split(',')[1], mime: 'image/jpeg', preview: dataUrl });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Foto tidak bisa dibaca.')); };
      img.src = url;
    });
  }

  function clientCheck(d) {
    if (!d.jumlah || d.jumlah <= 0) return 'Nominal harus diisi dan lebih dari 0.';
    if (!d.tanggal) return 'Tanggal wajib diisi.';
    if (!d.kategori) return 'Pilih kategori dulu.';
    if (!d.rekening) return 'Pilih rekening dulu.';
    return '';
  }

  async function runBusy(fn, okMsg) {
    showLoading(true);
    try {
      await fn();
      if (okMsg) toast(okMsg, 'success');
      await refreshData();
      return true;
    } catch (err) {
      toast(err.message, 'error');
      return false;
    } finally {
      showLoading(false);
    }
  }

  async function saveForm() {
    const f = state.form;
    if (!f) return;
    const data = {
      tanggal: $('#f-tanggal').value,
      jenis: f.jenis,
      kategori: f.kategori,
      rekening: f.rekening,
      keterangan: $('#f-ket').value.trim(),
      jumlah: f.amount
    };
    const err = clientCheck(data);
    if (err) {
      $('#form-error').textContent = err;
      toast(err, 'error');
      return;
    }
    $('#form-error').textContent = '';
    if (f.nota) { data.notaBase64 = f.nota.base64; data.notaMime = f.nota.mime; }

    $('#btn-save').disabled = true;
    const ok = await runBusy(function () {
      return f.mode === 'add'
        ? api('add', { data: data })
        : api('update', { row: f.original.row, original: f.original, data: data });
    }, f.mode === 'add' ? 'Transaksi tersimpan ✓' : 'Perubahan tersimpan ✓');
    $('#btn-save').disabled = false;
    if (ok) {
      localStorage.setItem(CONFIG.LAST_ACCOUNT_KEY, data.rekening);
      closeForm();
    }
  }

  function confirmBox(title, text, okLabel, onOk) {
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    $('#confirm-ok').textContent = okLabel;
    state.pending = onOk;
    show('#modal-confirm');
  }

  // ===================== DATA =====================
  async function refreshData() {
    const list = await api('list');
    state.tx = list.transactions;
    renderAll();
  }

  function renderAll() {
    populateFilters();
    renderHome();
    renderRiwayat();
    if (!$('#view-grafik').classList.contains('hidden')) renderGrafik();
  }

  async function startApp() {
    if (CONFIG.API_URL.indexOf('GANTI_') === 0) {
      showLogin('Alamat server (API_URL) belum diisi di app.js.');
      return false;
    }
    showLoading(true);
    try {
      const results = await Promise.all([api('config'), api('list')]);
      state.config = results[0];
      state.tx = results[1].transactions;
      hide('#view-login');
      show('#app');
      renderAll();
      return true;
    } catch (err) {
      showLogin(err.message);
      return false;
    } finally {
      showLoading(false);
    }
  }

  function showLogin(message) {
    show('#view-login');
    hide('#app');
    $('#login-error').textContent = message || '';
  }

  // ===================== NAVIGASI & EVENT =====================
  function goto(view) {
    ['home', 'riwayat', 'grafik'].forEach(function (v) {
      $('#view-' + v).classList.toggle('hidden', v !== view);
    });
    $$('.nav-btn[data-nav]').forEach(function (b) { b.classList.toggle('active', b.dataset.nav === view); });
    if (view === 'grafik') renderGrafik();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setPeriod(p) {
    state.period = p;
    $$('[data-period]').forEach(function (b) { b.classList.toggle('active', b.dataset.period === p); });
    $('#custom-range').classList.toggle('hidden', p !== 'custom');
    if (p === 'custom' && !state.custom.from) {
      const t = iso(todayD());
      state.custom = { from: t, to: t };
      $('#period-from').value = t;
      $('#period-to').value = t;
    }
    renderHome();
    renderGrafik();
  }

  function init() {
    if (typeof Chart !== 'undefined') {
      Chart.defaults.responsive = true;
      Chart.defaults.maintainAspectRatio = false;
      Chart.defaults.font.family = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    }

    // Login
    $('#login-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const token = $('#login-token').value.trim();
      if (!token) return;
      localStorage.setItem(CONFIG.TOKEN_KEY, token);
      const ok = await startApp();
      if (!ok) localStorage.removeItem(CONFIG.TOKEN_KEY);
    });

    $('#btn-logout').addEventListener('click', function () {
      localStorage.removeItem(CONFIG.TOKEN_KEY);
      location.reload();
    });

    // Navigasi bawah
    $$('.nav-btn[data-nav]').forEach(function (b) {
      b.addEventListener('click', function () { goto(b.dataset.nav); });
    });
    $('#nav-refresh').addEventListener('click', function () { runBusy(function () {}, 'Data diperbarui'); });
    $('#fab').addEventListener('click', function () { openForm('add'); });

    // Periode (beranda & grafik)
    $$('[data-period]').forEach(function (b) {
      b.addEventListener('click', function () { setPeriod(b.dataset.period); });
    });
    ['#period-from', '#period-to'].forEach(function (sel) {
      $(sel).addEventListener('change', function () {
        state.custom = { from: $('#period-from').value, to: $('#period-to').value };
        renderHome();
        renderGrafik();
      });
    });

    // Riwayat: filter & daftar
    ['#f-q', '#f-jenis', '#f-kategori', '#f-rekening', '#f-from', '#f-to'].forEach(function (sel) {
      $(sel).addEventListener(sel === '#f-q' ? 'input' : 'change', function () {
        readFilters();
        state.shown = CONFIG.PAGE_SIZE;
        renderRiwayat();
      });
    });
    $('#f-reset').addEventListener('click', function () {
      ['#f-q', '#f-from', '#f-to'].forEach(function (s) { $(s).value = ''; });
      ['#f-jenis', '#f-kategori', '#f-rekening'].forEach(function (s) { $(s).value = ''; });
      readFilters();
      state.shown = CONFIG.PAGE_SIZE;
      renderRiwayat();
    });
    $('#btn-more').addEventListener('click', function () {
      state.shown += CONFIG.PAGE_SIZE;
      renderRiwayat();
    });
    $('#riwayat-list').addEventListener('click', function (e) {
      if (e.target.closest('[data-add]')) { openForm('add'); return; }
      const el = e.target.closest('[data-row]');
      if (!el) return;
      const tx = state.tx.find(function (t) { return String(t.row) === el.dataset.row; });
      if (tx) openForm('edit', tx);
    });

    // Form: jenis, nominal, kategori, rekening, tanggal, nota
    $$('.seg').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!state.form || state.form.jenis === b.dataset.jenis) return;
        state.form.jenis = b.dataset.jenis;
        state.form.kategori = '';
        setJenisUI(state.form.jenis);
        renderFormChips();
      });
    });
    $('#f-amount').addEventListener('input', function (e) {
      const digits = e.target.value.replace(/\D/g, '').slice(0, 12);
      if (state.form) state.form.amount = digits ? Number(digits) : 0;
      e.target.value = digits ? Number(digits).toLocaleString('id-ID') : '';
    });
    $('#kategori-chips').addEventListener('click', function (e) {
      const el = e.target.closest('[data-kat]');
      if (!el || !state.form) return;
      state.form.kategori = el.dataset.kat;
      renderFormChips();
    });
    $('#rekening-chips').addEventListener('click', function (e) {
      const el = e.target.closest('[data-rek]');
      if (!el || !state.form) return;
      state.form.rekening = el.dataset.rek;
      renderFormChips();
    });
    $$('[data-date]').forEach(function (b) {
      b.addEventListener('click', function () {
        const d = todayD();
        if (b.dataset.date === 'yesterday') d.setDate(d.getDate() - 1);
        $('#f-tanggal').value = iso(d);
      });
    });
    $('#btn-nota').addEventListener('click', function () { $('#f-nota').click(); });
    $('#f-nota').addEventListener('change', async function (e) {
      const file = e.target.files[0];
      if (!file || !state.form) return;
      showLoading(true);
      try {
        const img = await compressImage(file);
        state.form.nota = img;
        setNotaPreview(img.preview);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        showLoading(false);
      }
    });
    $('#nota-remove').addEventListener('click', function () {
      if (state.form) state.form.nota = null;
      $('#f-nota').value = '';
      setNotaPreview(null);
    });
    $('#btn-save').addEventListener('click', saveForm);
    $('#form-close').addEventListener('click', closeForm);
    $('#sheet-form').addEventListener('click', function (e) {
      if (e.target.id === 'sheet-form') closeForm();
    });
    $('#btn-delete').addEventListener('click', function () {
      const o = state.form && state.form.original;
      if (!o) return;
      confirmBox('Hapus transaksi ini?',
        rp(o.jumlah) + ' · ' + (o.keterangan || o.kategori) + ' (' + fmtDateFromIso(o.tanggal) + '). ' +
        'Baris akan dikosongkan di sheet. Foto nota di Drive tidak ikut terhapus.',
        'Ya, hapus',
        async function () {
          const ok = await runBusy(function () {
            return api('delete', { row: o.row, original: o });
          }, 'Transaksi dihapus.');
          if (ok) closeForm();
        });
    });

    // Konfirmasi
    $('#confirm-ok').addEventListener('click', async function () {
      const fn = state.pending;
      state.pending = null;
      hide('#modal-confirm');
      if (fn) await fn();
    });
    $('#confirm-cancel').addEventListener('click', function () {
      state.pending = null;
      hide('#modal-confirm');
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('#modal-confirm').classList.contains('hidden')) { hide('#modal-confirm'); state.pending = null; }
      else if (!$('#sheet-form').classList.contains('hidden')) closeForm();
    });

    // Sapaan sesuai jam
    const h = new Date().getHours();
    $('#greeting').textContent = h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 19 ? 'Selamat sore' : 'Selamat malam';

    // Mulai
    if (!getToken()) {
      showLogin('');
    } else {
      startApp();
    }
  }

  init();
})();
