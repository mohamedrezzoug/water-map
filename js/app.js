/* WATER MAP – خريطة المياه | PWA بدون خادم: البيانات محفوظة محلياً (localStorage) */
'use strict';

const TYPES = {
  dam:       { ar: 'سد / حقينة',        ico: '🏞️', col: '#0b6fa4' },
  river:     { ar: 'نهر / واد',          ico: '🌊', col: '#2a9bd6' },
  spring:    { ar: 'عين / منبع',         ico: '⛲', col: '#17a2a2' },
  well:      { ar: 'بئر / ثقب مائي',     ico: '🕳️', col: '#7a5c3e' },
  fountain:  { ar: 'سقاية عمومية',       ico: '🚰', col: '#3b8f4f' },
  tank:      { ar: 'خزان مائي',          ico: '🛢️', col: '#5b5fc7' },
  pump:      { ar: 'محطة ضخ / توزيع',    ico: '⚙️', col: '#c26a1a' },
  treatment: { ar: 'محطة معالجة',        ico: '🧪', col: '#9a3f9a' }
};
const STATUS = { ok: ['تشتغل بشكل عادي', 'b-ok'], warn: ['تحتاج مراقبة', 'b-warn'], down: ['معطلة / جافة', 'b-down'] };
const REPORT_KINDS = {
  leak: 'تسرب المياه', cut: 'انقطاع الماء', fountain: 'عطب في السقاية',
  dry: 'جفاف عين أو بئر', pollution: 'تلوث المياه', pipe: 'ضياع المياه (قناة مكسورة)'
};
const REPORT_STATUS = { new: ['جديد', 'b-new'], prog: ['في المعالجة', 'b-prog'], done: ['تمت المعالجة', 'b-done'] };

/* ---------- التخزين ---------- */
const KEY = 'watermap_v1';
let DB = { structures: [], reports: [], projects: [], farmLog: [], commune: '' };
function load() { try { const s = localStorage.getItem(KEY); if (s) DB = Object.assign(DB, JSON.parse(s)); } catch (e) {} }
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(DB)); }
  catch (e) { toast('الذاكرة ممتلئة: خفّض عدد الصور أو صدّر نسخة احتياطية'); }
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const today = () => new Date().toISOString().slice(0, 10);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = id => document.getElementById(id);
const fmtDate = d => d ? new Date(d).toLocaleDateString('ar-MA-u-nu-latn') : '—';

function toast(t) { const e = $('toast'); e.textContent = t; e.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.add('hidden'), 2800); }
function openSheet(html) { $('sheetBody').innerHTML = html; $('sheet').classList.remove('hidden'); }
function closeSheet() { $('sheet').classList.add('hidden'); }
window.closeSheet = closeSheet;
$('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });

function netState() { const e = $('netState'); e.textContent = navigator.onLine ? '● متصل' : '○ بدون إنترنت'; }
addEventListener('online', netState); addEventListener('offline', netState);

/* ---------- الصور (ضغط) ---------- */
function readPhoto(file, cb) {
  if (!file) return cb(null);
  const r = new FileReader();
  r.onload = () => {
    const img = new Image();
    img.onload = () => {
      const m = 720, k = Math.min(1, m / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      cb(c.toDataURL('image/jpeg', 0.6));
    };
    img.onerror = () => cb(null);
    img.src = r.result;
  };
  r.readAsDataURL(file);
}

/* ---------- التنقل ---------- */
const TABS = [
  ['map', '🗺️', 'الخريطة'], ['report', '📣', 'التبليغ'], ['ai', '🤖', 'Water AI'],
  ['farm', '🌾', 'Water Farm'], ['commune', '🏛️', 'الجماعة'], ['more', '☰', 'المزيد']
];
let tab = 'map';
function renderTabs() {
  $('tabs').innerHTML = TABS.map(t => `<button class="${t[0] === tab ? 'on' : ''}" onclick="go('${t[0]}')"><span>${t[1]}</span>${t[2]}</button>`).join('');
}
function go(t) { tab = t; renderTabs(); if (map) { map.remove(); map = null; } VIEWS[t](); }
window.go = go;

/* =====================================================
   1) الخريطة
   ===================================================== */
let map = null, layerGroup = null, pickMode = false, activeTypes = new Set(Object.keys(TYPES)), showReports = true;

function pinIcon(col, ico, size = 34) {
  return L.divIcon({ className: '', iconSize: [size, size], iconAnchor: [size / 2, size],
    html: `<div class="pin" style="background:${col};width:${size}px;height:${size}px"><i>${ico}</i></div>` });
}
function statusCol(s, t) { return s === 'down' ? '#d64545' : s === 'warn' ? '#e0a100' : TYPES[t].col; }

const VIEWS = {};
VIEWS.map = function () {
  $('view').innerHTML = `<div id="mapWrap">
    <div id="map"></div>
    <div class="mapbar"><div class="chips" id="mapChips"></div></div>
    <div class="fab">
      <button title="موقعي" onclick="locateMe()">📍</button>
      <button title="إضافة منشأة" onclick="startPick()">＋</button>
    </div>
    <div id="pickHint" class="pickhint hidden">اضغط على الخريطة لتحديد مكان المنشأة <button class="btn sm sec" onclick="stopPick()">إلغاء</button></div>
  </div>`;
  $('pickHint').classList.add('hidden');
  if (typeof L === 'undefined') { $('mapWrap').innerHTML = '<div class="empty" style="margin:auto">تعذر تحميل مكتبة الخريطة. اتصل بالإنترنت مرة واحدة لتخزينها، ثم تشتغل بدون اتصال.<br><br><button class="btn" onclick="location.reload()">إعادة المحاولة</button></div>'; return; }
  map = L.map('map', { zoomControl: false }).setView([31.8, -7.1], 6);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  layerGroup = L.layerGroup().addTo(map);
  map.on('click', e => { if (pickMode) { stopPick(); structForm(null, e.latlng.lat, e.latlng.lng); } });
  drawChips(); drawMarkers();
  const pts = DB.structures.map(s => [s.lat, s.lng]).concat(DB.reports.map(r => [r.lat, r.lng]));
  if (pts.length) map.fitBounds(pts, { padding: [50, 50], maxZoom: 13 });
  setTimeout(() => map && map.invalidateSize(), 200);
};
function drawChips() {
  $('mapChips').innerHTML = Object.entries(TYPES).map(([k, t]) =>
    `<span class="chip ${activeTypes.has(k) ? 'on' : ''}" onclick="toggleType('${k}')">${t.ico} ${t.ar}</span>`).join('') +
    `<span class="chip ${showReports ? 'on' : ''}" onclick="toggleReports()">📣 التبليغات</span>`;
}
window.toggleType = k => { activeTypes.has(k) ? activeTypes.delete(k) : activeTypes.add(k); drawChips(); drawMarkers(); };
window.toggleReports = () => { showReports = !showReports; drawChips(); drawMarkers(); };
function drawMarkers() {
  layerGroup.clearLayers();
  DB.structures.filter(s => activeTypes.has(s.type)).forEach(s => {
    const t = TYPES[s.type];
    L.marker([s.lat, s.lng], { icon: pinIcon(statusCol(s.status, s.type), t.ico) }).addTo(layerGroup)
      .bindPopup(`<b>${esc(s.name)}</b><br>${t.ar}<br><span class="badge ${STATUS[s.status][1]}">${STATUS[s.status][0]}</span><br><br><button class="btn sm" onclick="structView('${s.id}')">فتح الملف</button>`);
  });
  if (showReports) DB.reports.filter(r => r.status !== 'done').forEach(r => {
    L.marker([r.lat, r.lng], { icon: pinIcon('#d64545', '📣', 28) }).addTo(layerGroup)
      .bindPopup(`<b>${REPORT_KINDS[r.kind]}</b><br>${fmtDate(r.date)}<br>${esc(r.note || '')}<br><br><button class="btn sm" onclick="reportView('${r.id}')">التفاصيل</button>`);
  });
}
window.startPick = () => { pickMode = true; $('pickHint').classList.remove('hidden'); };
window.stopPick = () => { pickMode = false; const h = $('pickHint'); if (h) h.classList.add('hidden'); };
window.locateMe = () => {
  if (!navigator.geolocation) return toast('تحديد الموقع غير مدعوم');
  navigator.geolocation.getCurrentPosition(p => { map.setView([p.coords.latitude, p.coords.longitude], 14); L.circleMarker([p.coords.latitude, p.coords.longitude], { radius: 8 }).addTo(map); },
    () => toast('تعذر تحديد الموقع'), { enableHighAccuracy: true, timeout: 10000 });
};

/* ---------- نموذج منشأة ---------- */
function typeOptions(sel) { return Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${t.ico} ${t.ar}</option>`).join(''); }
function structForm(id, lat, lng) {
  const s = id ? DB.structures.find(x => x.id === id) : { type: 'fountain', status: 'ok', lat, lng, commune: DB.commune };
  openSheet(`<h2>${id ? 'تعديل المنشأة' : 'منشأة مائية جديدة'}</h2>
  <label>النوع</label><select id="f_type">${typeOptions(s.type)}</select>
  <label>الاسم</label><input id="f_name" value="${esc(s.name)}" placeholder="مثال: سقاية دوار ...">
  <label>الجماعة / الإقليم</label><input id="f_commune" value="${esc(s.commune)}">
  <label>الحالة</label><select id="f_status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === s.status ? 'selected' : ''}>${v[0]}</option>`).join('')}</select>
  <div class="row"><div><label>خط العرض</label><input id="f_lat" type="number" step="any" value="${s.lat}"></div><div><label>خط الطول</label><input id="f_lng" type="number" step="any" value="${s.lng}"></div></div>
  <label>حالة المضخة (إن وُجدت)</label><input id="f_pump" value="${esc(s.pump)}" placeholder="تشتغل / معطلة / لا توجد">
  <label>تاريخ آخر صيانة</label><input id="f_maint" type="date" value="${esc(s.lastMaint)}">
  <label>ملاحظات</label><textarea id="f_notes">${esc(s.notes)}</textarea>
  <label>صورة</label><input id="f_photo" type="file" accept="image/*" capture="environment">
  <br><button class="btn" onclick="saveStruct('${id || ''}')">حفظ</button>
  ${id ? `<button class="btn red" onclick="delStruct('${id}')">حذف</button>` : ''}`);
}
window.saveStruct = id => {
  const name = $('f_name').value.trim(), lat = parseFloat($('f_lat').value), lng = parseFloat($('f_lng').value);
  if (!name || isNaN(lat) || isNaN(lng)) return toast('الاسم والإحداثيات مطلوبة');
  readPhoto($('f_photo').files[0], ph => {
    let s = id ? DB.structures.find(x => x.id === id) : { id: uid(), history: [], incidents: [], quality: [], created: today() };
    Object.assign(s, { type: $('f_type').value, name, commune: $('f_commune').value.trim(), status: $('f_status').value, lat, lng,
      pump: $('f_pump').value.trim(), lastMaint: $('f_maint').value, notes: $('f_notes').value.trim() });
    if (ph) s.photo = ph;
    if (s.commune) DB.commune = s.commune;
    if (!id) DB.structures.push(s);
    save(); closeSheet(); toast('تم الحفظ');
    if (tab === 'map') drawMarkers(); else go(tab);
  });
};
window.delStruct = id => { if (!confirm('حذف هذه المنشأة نهائياً؟')) return; DB.structures = DB.structures.filter(s => s.id !== id); save(); closeSheet(); go(tab); };

/* ---------- ملف المنشأة ---------- */
window.structView = id => {
  const s = DB.structures.find(x => x.id === id); if (!s) return;
  const t = TYPES[s.type], last = (s.history || []).slice(-1)[0], q = (s.quality || []).slice(-1)[0];
  const isTank = ['dam', 'tank', 'well', 'spring'].includes(s.type);
  openSheet(`<h2>${t.ico} ${esc(s.name)}</h2>
  <span class="badge ${STATUS[s.status][1]}">${STATUS[s.status][0]}</span> <small>${t.ar}${s.commune ? ' – ' + esc(s.commune) : ''}</small>
  ${s.photo ? `<img class="photo" src="${s.photo}">` : ''}
  <div style="margin-top:8px">
    <div class="kv"><span>${s.type === 'dam' ? 'نسبة الامتلاء' : 'مستوى المياه'}</span><span>${last ? last.level + '% (' + fmtDate(last.date) + ')' : 'لا توجد قياسات'}</span></div>
    <div class="kv"><span>حالة المضخة</span><span>${esc(s.pump) || '—'}</span></div>
    <div class="kv"><span>آخر صيانة</span><span>${fmtDate(s.lastMaint)}</span></div>
    <div class="kv"><span>جودة المياه</span><span>${q ? (q.ok ? 'صالحة' : 'غير صالحة') + ' (' + fmtDate(q.date) + ')' : 'لا توجد تحاليل'}</span></div>
    <div class="kv"><span>الإحداثيات</span><span>${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}</span></div>
    ${s.notes ? `<div class="kv"><span>ملاحظات</span><span>${esc(s.notes)}</span></div>` : ''}
  </div>
  <div class="note">المعطيات تُدخل يدوياً من المسؤول. ربط حساسات IoT ممكن مستقبلاً لإرسال القياسات تلقائياً.</div>
  <div class="row">
    ${isTank ? `<button class="btn sec" onclick="levelForm('${id}')">＋ قياس المستوى</button>` : ''}
    <button class="btn sec" onclick="qualityForm('${id}')">🧪 تحليل جودة</button>
    <button class="btn sec" onclick="incidentForm('${id}')">🔧 عطب / صيانة</button>
  </div><br>
  <div class="row"><button class="btn" onclick="structForm('${id}')">تعديل</button>
  <a class="btn sec" style="text-align:center;text-decoration:none" target="_blank" href="https://www.google.com/maps?q=${s.lat},${s.lng}">🧭 الاتجاهات</a></div>
  ${(s.history || []).length ? `<h3>سجل المستوى</h3>${histTable(s)}` : ''}
  ${(s.incidents || []).length ? `<h3>الأعطاب والانقطاعات</h3>${s.incidents.slice().reverse().map(i => `<div class="kv"><span>${fmtDate(i.date)}</span><span>${esc(i.text)}</span></div>`).join('')}` : ''}
  ${(s.quality || []).length ? `<h3>تحاليل الجودة</h3>${s.quality.slice().reverse().map(i => `<div class="kv"><span>${fmtDate(i.date)}</span><span>${i.ok ? '✔' : '✖'} ${esc(i.text)}</span></div>`).join('')}` : ''}`);
};
window.structForm = structForm;
function histTable(s) { return `<div class="tbl"><table><tr><th>التاريخ</th><th>المستوى</th></tr>${s.history.slice(-10).reverse().map(h => `<tr><td>${fmtDate(h.date)}</td><td>${h.level}%</td></tr>`).join('')}</table></div>`; }
window.levelForm = id => openSheet(`<h2>قياس جديد</h2><label>التاريخ</label><input id="l_d" type="date" value="${today()}"><label>المستوى / نسبة الامتلاء (%)</label><input id="l_v" type="number" min="0" max="100"><br><button class="btn" onclick="saveLevel('${id}')">حفظ</button>`);
window.saveLevel = id => { const v = parseFloat($('l_v').value); if (isNaN(v) || v < 0 || v > 100) return toast('أدخل نسبة بين 0 و 100'); const s = DB.structures.find(x => x.id === id); s.history = s.history || []; s.history.push({ date: $('l_d').value, level: v }); s.history.sort((a, b) => a.date.localeCompare(b.date)); save(); structView(id); };
window.qualityForm = id => openSheet(`<h2>تحليل جودة المياه</h2><label>التاريخ</label><input id="q_d" type="date" value="${today()}"><label>النتيجة</label><select id="q_ok"><option value="1">صالحة للشرب</option><option value="0">غير صالحة</option></select><label>تفاصيل (pH، عكارة، مختبر...)</label><textarea id="q_t"></textarea><br><button class="btn" onclick="saveQuality('${id}')">حفظ</button>`);
window.saveQuality = id => { const s = DB.structures.find(x => x.id === id); s.quality = s.quality || []; s.quality.push({ date: $('q_d').value, ok: $('q_ok').value === '1', text: $('q_t').value.trim() }); if ($('q_ok').value === '0') s.status = 'warn'; save(); structView(id); };
window.incidentForm = id => openSheet(`<h2>تسجيل عطب / تدخل</h2><label>التاريخ</label><input id="i_d" type="date" value="${today()}"><label>الوصف</label><textarea id="i_t"></textarea><label><input type="checkbox" id="i_m" style="width:auto"> تدخل صيانة (يحدّث تاريخ آخر صيانة)</label><br><button class="btn" onclick="saveIncident('${id}')">حفظ</button>`);
window.saveIncident = id => { const t = $('i_t').value.trim(); if (!t) return toast('أدخل الوصف'); const s = DB.structures.find(x => x.id === id); s.incidents = s.incidents || []; s.incidents.push({ date: $('i_d').value, text: t }); if ($('i_m').checked) s.lastMaint = $('i_d').value; save(); structView(id); };

/* =====================================================
   2) التبليغ
   ===================================================== */
VIEWS.report = function () {
  $('view').innerHTML = `<div class="page"><h2>📣 التبليغ عن مشكل مائي</h2>
  <div class="card">
    <label>نوع المشكل</label><select id="r_kind">${Object.entries(REPORT_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    <label>وصف</label><textarea id="r_note" placeholder="شرح مختصر للمشكل"></textarea>
    <label>صورة</label><input id="r_photo" type="file" accept="image/*" capture="environment">
    <label>الموقع</label>
    <div class="row"><input id="r_lat" placeholder="خط العرض" type="number" step="any"><input id="r_lng" placeholder="خط الطول" type="number" step="any"></div><br>
    <button class="btn sec" onclick="getPos()">📍 استعمل موقعي الحالي</button>
    <button class="btn" onclick="saveReport()">إرسال التبليغ</button>
    <div class="note">في هذه النسخة التبليغات تُسجل في جهازك. لوصول الإشعارات للمسؤول مباشرة يلزم ربط التطبيق بخادم (Firebase/Supabase).</div>
  </div>
  <h3>التبليغات المسجلة</h3>${reportList()}</div>`;
};
window.getPos = () => {
  if (!navigator.geolocation) return toast('تحديد الموقع غير مدعوم');
  navigator.geolocation.getCurrentPosition(p => { $('r_lat').value = p.coords.latitude.toFixed(6); $('r_lng').value = p.coords.longitude.toFixed(6); toast('تم تحديد الموقع'); }, () => toast('تعذر تحديد الموقع'), { enableHighAccuracy: true, timeout: 10000 });
};
window.saveReport = () => {
  const lat = parseFloat($('r_lat').value), lng = parseFloat($('r_lng').value);
  if (isNaN(lat) || isNaN(lng)) return toast('حدد الموقع أولاً');
  readPhoto($('r_photo').files[0], ph => {
    DB.reports.push({ id: uid(), kind: $('r_kind').value, note: $('r_note').value.trim(), lat, lng, photo: ph, date: today(), status: 'new' });
    save(); toast('تم تسجيل التبليغ'); VIEWS.report();
  });
};
function reportList() {
  if (!DB.reports.length) return '<div class="empty">لا توجد تبليغات بعد</div>';
  return DB.reports.slice().reverse().map(r => `<div class="card" onclick="reportView('${r.id}')"><b>${REPORT_KINDS[r.kind]}</b> <span class="badge ${REPORT_STATUS[r.status][1]}">${REPORT_STATUS[r.status][0]}</span><br><small>${fmtDate(r.date)} – ${esc(r.note || '')}</small></div>`).join('');
}
window.reportView = id => {
  const r = DB.reports.find(x => x.id === id); if (!r) return;
  openSheet(`<h2>${REPORT_KINDS[r.kind]}</h2><span class="badge ${REPORT_STATUS[r.status][1]}">${REPORT_STATUS[r.status][0]}</span>
  <p style="margin:8px 0">${esc(r.note) || '—'}</p>${r.photo ? `<img class="photo" src="${r.photo}">` : ''}
  <div class="kv"><span>التاريخ</span><span>${fmtDate(r.date)}</span></div><div class="kv"><span>الموقع</span><span>${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}</span></div><br>
  <label>تغيير الحالة (للمسؤول)</label><select onchange="setRStatus('${id}',this.value)">${Object.entries(REPORT_STATUS).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v[0]}</option>`).join('')}</select><br>
  <button class="btn red" onclick="delReport('${id}')">حذف</button>`);
};
window.setRStatus = (id, v) => { DB.reports.find(x => x.id === id).status = v; save(); toast('تم التحديث'); };
window.delReport = id => { if (!confirm('حذف التبليغ؟')) return; DB.reports = DB.reports.filter(r => r.id !== id); save(); closeSheet(); go(tab); };

/* =====================================================
   3) WATER AI – تحليل محلي مبني على المعطيات المدخلة
   ===================================================== */
function slopePerDay(h) { // انحدار خطي بسيط: نقطة مئوية في اليوم
  if (h.length < 2) return null;
  const xs = h.map(p => new Date(p.date).getTime() / 864e5), ys = h.map(p => p.level);
  const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let num = 0, den = 0; xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  return den ? num / den : null;
}
function analysis() {
  const out = [];
  DB.structures.forEach(s => {
    const h = s.history || []; if (!h.length) return;
    const last = h[h.length - 1], sl = slopePerDay(h);
    if (last.level <= 20) out.push({ lvl: 'r', t: `${s.name}: المستوى منخفض (${last.level}%)` });
    if (sl !== null && sl < -0.05) {
      const days = last.level / -sl;
      out.push({ lvl: 'w', t: `${s.name}: المستوى في تراجع (≈ ${(sl * 30).toFixed(1)} نقطة/شهر). إن استمر نفس المنحى فتقدير بلوغ الصفر ≈ ${Math.round(days)} يوم (تقدير تقريبي)` });
    } else if (sl !== null && sl > 0.05) out.push({ lvl: 'i', t: `${s.name}: المستوى في ارتفاع (≈ +${(sl * 30).toFixed(1)} نقطة/شهر)` });
  });
  DB.structures.filter(s => s.status === 'down').forEach(s => out.push({ lvl: 'r', t: `${s.name}: معطلة أو جافة` }));
  DB.structures.filter(s => (s.quality || []).slice(-1)[0] && !(s.quality.slice(-1)[0].ok)).forEach(s => out.push({ lvl: 'r', t: `${s.name}: آخر تحليل جودة غير صالح` }));
  const open = DB.reports.filter(r => r.status === 'new').length;
  if (open) out.push({ lvl: 'w', t: `${open} تبليغ جديد في انتظار المعالجة` });
  return out;
}
VIEWS.ai = function () {
  const a = analysis();
  $('view').innerHTML = `<div class="page"><h2>🤖 WATER AI</h2>
  <div class="note">التحليلات تقديرية ومبنية على المعطيات المدخلة فقط، وليست قياسات مباشرة.</div>
  <h3>تنبيهات وتحليل تطور المستويات</h3>
  ${a.length ? a.map(x => `<div class="alert ${x.lvl === 'w' ? 'w' : x.lvl === 'i' ? 'i' : ''}">${esc(x.t)}</div>`).join('') : '<div class="empty">لا توجد معطيات كافية للتحليل بعد. أضف منشآت وسجّل قياسات المستوى بشكل دوري.</div>'}
  <h3>مقارنة المستويات عبر الزمن</h3>${compareTable()}
  <h3>مناطق معرضة للجفاف</h3>${droughtList()}
  <h3>تدابير الاقتصاد في الماء المقترحة</h3>
  <div class="card"><ul style="padding-inline-start:18px;line-height:1.9;font-size:14px">
  ${(a.some(x => x.lvl === 'r' || x.lvl === 'w') ? ['تقليص السقي الليلي والنهاري المفرط وتفضيل الصباح الباكر أو المساء', 'إصلاح التسربات في القنوات والسقايات فوراً', 'اعتماد السقي بالتنقيط بدل السقي بالغمر في الفلاحة', 'تحسيس الساكنة بترشيد استعمال الماء للغسيل وسقي الحدائق'] : ['مواصلة تسجيل القياسات لتتبع تطور الموارد', 'الحرص على الصيانة الدورية للمنشآت', 'تشجيع جمع مياه الأمطار وإعادة استعمالها']).map(x => `<li>${x}</li>`).join('')}
  </ul></div>
  <h3>صور الأقمار الصناعية</h3><div class="card empty">غير مفعّلة. تحليل الصور يتطلب مصدر بيانات مناسب (مثل Sentinel) وخادماً للمعالجة، وسيُضاف عند توفرها.</div>
  <button class="btn" onclick="printReport()">🖨️ تقرير عن الوضعية المائية</button></div>`;
};
function compareTable() {
  const rows = DB.structures.filter(s => (s.history || []).length >= 2);
  if (!rows.length) return '<div class="empty">تحتاج قياسين على الأقل لكل منشأة</div>';
  return `<div class="tbl"><table><tr><th>المنشأة</th><th>أول قياس</th><th>آخر قياس</th><th>الفرق</th></tr>${rows.map(s => { const a = s.history[0], b = s.history.slice(-1)[0], d = b.level - a.level; return `<tr><td>${esc(s.name)}</td><td>${a.level}% <small>${fmtDate(a.date)}</small></td><td>${b.level}% <small>${fmtDate(b.date)}</small></td><td style="color:${d < 0 ? 'var(--r)' : 'var(--ok)'}">${d > 0 ? '+' : ''}${d}</td></tr>`; }).join('')}</table></div>`;
}
function droughtList() {
  const at = DB.structures.filter(s => s.status === 'down' || ((s.history || []).slice(-1)[0] || { level: 100 }).level <= 20);
  return at.length ? at.map(s => `<div class="alert">${TYPES[s.type].ico} ${esc(s.name)} ${s.commune ? '– ' + esc(s.commune) : ''}</div>`).join('') : '<div class="empty">لا توجد مناطق معرضة حسب المعطيات الحالية</div>';
}
window.printReport = () => {
  const a = analysis();
  openSheet(`<h2>تقرير الوضعية المائية</h2><p><small>${fmtDate(today())} – ${esc(DB.commune) || 'غير محددة'}</small></p>
  <div class="kv"><span>عدد المنشآت</span><span>${DB.structures.length}</span></div>
  <div class="kv"><span>معطلة / جافة</span><span>${DB.structures.filter(s => s.status === 'down').length}</span></div>
  <div class="kv"><span>التبليغات المفتوحة</span><span>${DB.reports.filter(r => r.status !== 'done').length}</span></div>
  <h3>ملاحظات</h3>${a.length ? a.map(x => `<div class="alert">${esc(x.t)}</div>`).join('') : '<div class="empty">لا توجد ملاحظات</div>'}
  <br><button class="btn" onclick="window.print()">طباعة / PDF</button>`);
};

/* =====================================================
   4) WATER FARM
   ===================================================== */
// احتياجات تقريبية للموسم بالمليمتر (مدى مرجعي عام FAO، وليست قيماً مضبوطة لمنطقة بعينها)
const CROPS = { wheat: ['القمح', 450], barley: ['الشعير', 400], maize: ['الذرة', 650], potato: ['البطاطس', 600], tomato: ['الطماطم', 500], onion: ['البصل', 450], watermelon: ['البطيخ الأحمر', 500], olive: ['الزيتون', 700], citrus: ['الحوامض', 1000], almond: ['اللوز', 850], alfalfa: ['الفصة', 1100], vine: ['الكرمة', 600] };
const METHODS = { surface: ['السقي بالغمر', 0.5, 'مرة كل 7–10 أيام (تقريبي)'], sprinkler: ['السقي بالرش', 0.75, 'مرة كل 4–6 أيام (تقريبي)'], drip: ['السقي بالتنقيط', 0.9, 'يومياً أو كل يومين بكميات صغيرة (تقريبي)'] };
let farmTab = 'calc';
VIEWS.farm = function () {
  const tabs = [['calc', 'حساب الاحتياجات'], ['log', 'تتبع الاستهلاك'], ['guide', 'دليل الاقتصاد']];
  $('view').innerHTML = `<div class="page"><h2>🌾 WATER FARM</h2>
  <div class="sub">${tabs.map(t => `<span class="chip ${farmTab === t[0] ? 'on' : ''}" onclick="farmTab='${t[0]}';VIEWS.farm()">${t[1]}</span>`).join('')}</div>
  ${farmTab === 'calc' ? farmCalc() : farmTab === 'log' ? farmLog() : farmGuide()}</div>`;
  if (farmTab === 'calc') calcFarm();
};
function farmCalc() {
  return `<div class="card"><label>المحصول</label><select id="c_crop" onchange="calcFarm()">${Object.entries(CROPS).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select>
  <label>المساحة (هكتار)</label><input id="c_area" type="number" step="0.1" min="0" value="1" oninput="calcFarm()">
  <label>طريقة السقي</label><select id="c_m" onchange="calcFarm()">${Object.entries(METHODS).map(([k, v]) => `<option value="${k}" ${k === 'drip' ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div>
  <div id="c_out"></div>
  <div class="note">القيم تقريبية مبنية على مدى مرجعي عام لاحتياجات المحاصيل (بدون احتساب الأمطار). تختلف حسب المناخ والتربة والصنف، فاستشر المرشد الفلاحي بمنطقتك.</div>`;
}
window.calcFarm = () => {
  const c = CROPS[$('c_crop').value], area = parseFloat($('c_area').value) || 0, m = METHODS[$('c_m').value];
  const net = c[1] * 10 * area, gross = net / m[1], surface = net / METHODS.surface[1];
  $('c_out').innerHTML = `<div class="grid"><div class="stat"><b>${Math.round(net).toLocaleString('en')}</b><small>م³ صافي / الموسم</small></div><div class="stat"><b>${Math.round(gross).toLocaleString('en')}</b><small>م³ فعلي مع ${m[0]}</small></div><div class="stat"><b>${Math.round(surface - gross).toLocaleString('en')}</b><small>م³ توفير مقارنة بالغمر</small></div></div>
  <div class="card"><b>تنظيم أوقات السقي</b><p style="font-size:14px;margin-top:4px">${m[2]}. الأفضل السقي في الصباح الباكر أو المساء لتقليل التبخر.</p></div>`;
};
function farmLog() {
  const bySeason = {}; DB.farmLog.forEach(l => { const y = l.date.slice(0, 4); bySeason[y] = (bySeason[y] || 0) + l.m3; });
  return `<div class="card"><label>التاريخ</label><input id="fl_d" type="date" value="${today()}"><label>المحصول / القطعة</label><input id="fl_c"><label>الكمية المستهلكة (م³)</label><input id="fl_v" type="number" min="0" step="any"><br><button class="btn" onclick="addFarmLog()">إضافة</button></div>
  <h3>مقارنة الاستهلاك حسب السنة</h3>${Object.keys(bySeason).length ? `<div class="tbl"><table><tr><th>السنة</th><th>الإجمالي (م³)</th></tr>${Object.entries(bySeason).sort().map(([y, v]) => `<tr><td>${y}</td><td>${Math.round(v).toLocaleString('en')}</td></tr>`).join('')}</table></div>` : '<div class="empty">لا توجد سجلات بعد</div>'}
  <h3>السجل</h3>${DB.farmLog.slice().reverse().slice(0, 30).map(l => `<div class="kv"><span>${fmtDate(l.date)} – ${esc(l.crop)}</span><span>${l.m3} م³ <a href="#" onclick="delFarmLog('${l.id}');return false">✕</a></span></div>`).join('')}`;
}
window.addFarmLog = () => { const v = parseFloat($('fl_v').value); if (isNaN(v) || v < 0) return toast('أدخل الكمية'); DB.farmLog.push({ id: uid(), date: $('fl_d').value, crop: $('fl_c').value.trim(), m3: v }); save(); VIEWS.farm(); };
window.delFarmLog = id => { DB.farmLog = DB.farmLog.filter(l => l.id !== id); save(); VIEWS.farm(); };
function farmGuide() {
  const tips = ['اعتمد السقي بالتنقيط: يوفر غالباً 30–50% من الماء مقارنة بالغمر.', 'اسقِ في الصباح الباكر أو المساء.', 'غطّ التربة بالمهاد (paillage) لتقليل التبخر.', 'افحص القنوات والأنابيب دورياً لإصلاح التسربات.', 'اختر محاصيل وأصنافاً ملائمة لندرة المياه في منطقتك.', 'تحقق من رطوبة التربة قبل كل سقية بدل السقي بالعادة.', 'اجمع مياه الأمطار في أحواض صغيرة إن أمكن.'];
  return `<div class="card"><ul style="padding-inline-start:18px;line-height:2;font-size:14px">${tips.map(t => `<li>${t}</li>`).join('')}</ul></div>`;
}

/* =====================================================
   5) لوحة قيادة الجماعة
   ===================================================== */
let cTab = 'inv';
VIEWS.commune = function () {
  const tabs = [['inv', 'الجرد'], ['mgmt', 'التدبير'], ['maint', 'الصيانة'], ['proj', 'المشاريع'], ['stats', 'الإحصائيات'], ['rep', 'التبليغات']];
  $('view').innerHTML = `<div class="page"><h2>🏛️ لوحة قيادة الجماعة</h2>
  <div class="card"><label>اسم الجماعة</label><input id="cm_name" value="${esc(DB.commune)}" onchange="DB.commune=this.value;save()" placeholder="مثال: جماعة ..."></div>
  <div class="sub">${tabs.map(t => `<span class="chip ${cTab === t[0] ? 'on' : ''}" onclick="cTab='${t[0]}';VIEWS.commune()">${t[1]}</span>`).join('')}</div>
  ${cTab === 'inv' ? cInv() : cTab === 'mgmt' ? cMgmt() : cTab === 'maint' ? cMaint() : cTab === 'proj' ? cProj() : cTab === 'stats' ? cStats() : reportList()}</div>`;
};
function cInv() {
  return `<button class="btn" onclick="structForm(null,31.8,-7.1)">＋ تسجيل منشأة</button><br><br>` +
    (DB.structures.length ? `<div class="tbl"><table><tr><th>الاسم</th><th>النوع</th><th>الحالة</th></tr>${DB.structures.map(s => `<tr onclick="structView('${s.id}')"><td>${esc(s.name)}</td><td>${TYPES[s.type].ico} ${TYPES[s.type].ar}</td><td><span class="badge ${STATUS[s.status][1]}">${STATUS[s.status][0]}</span></td></tr>`).join('')}</table></div>` : '<div class="empty">في انتظار الجرد. أضف السقايات والخزانات والآبار.</div>') +
    `<div class="note">للمنشآت الجديدة: يمكنك تعديل الإحداثيات يدوياً، أو الأفضل إضافتها من تبويب الخريطة بالضغط على مكانها.</div>`;
}
function cMgmt() {
  if (!DB.structures.length) return '<div class="empty">لا توجد منشآت</div>';
  return DB.structures.map(s => { const l = (s.history || []).slice(-1)[0]; return `<div class="card" onclick="structView('${s.id}')"><b>${TYPES[s.type].ico} ${esc(s.name)}</b> <span class="badge ${STATUS[s.status][1]}">${STATUS[s.status][0]}</span>${l ? `<div class="bar" style="margin-top:6px"><i style="width:${l.level}%"></i></div><small>${l.level}% – ${fmtDate(l.date)}</small>` : '<br><small>لا توجد قياسات</small>'}</div>`; }).join('');
}
function cMaint() {
  const rows = []; DB.structures.forEach(s => (s.incidents || []).forEach(i => rows.push({ s, i })));
  rows.sort((a, b) => b.i.date.localeCompare(a.i.date));
  return rows.length ? `<div class="tbl"><table><tr><th>التاريخ</th><th>المنشأة</th><th>الوصف</th></tr>${rows.map(r => `<tr><td>${fmtDate(r.i.date)}</td><td>${esc(r.s.name)}</td><td>${esc(r.i.text)}</td></tr>`).join('')}</table></div>` : '<div class="empty">لا توجد أعطاب أو تدخلات مسجلة. سجلها من ملف كل منشأة.</div>';
}
function cProj() {
  const st = { plan: 'مبرمج', run: 'في الإنجاز', done: 'منجز' };
  return `<div class="card"><label>اسم المشروع</label><input id="p_n"><div class="row"><div><label>الحالة</label><select id="p_s">${Object.entries(st).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div><div><label>الغلاف المالي (درهم، اختياري)</label><input id="p_b" type="number"></div></div><label>ملاحظات</label><textarea id="p_t"></textarea><br><button class="btn" onclick="addProj()">إضافة</button></div>` +
    (DB.projects.length ? DB.projects.map(p => `<div class="card"><b>${esc(p.name)}</b> <span class="badge b-prog">${st[p.status]}</span>${p.budget ? `<br><small>${Number(p.budget).toLocaleString('en')} درهم</small>` : ''}<br><small>${esc(p.notes)}</small><br><button class="btn sm sec" onclick="cycleProj('${p.id}')">تغيير الحالة</button> <button class="btn sm red" onclick="delProj('${p.id}')">حذف</button></div>`).join('') : '<div class="empty">لا توجد مشاريع</div>');
}
window.addProj = () => { const n = $('p_n').value.trim(); if (!n) return toast('أدخل الاسم'); DB.projects.push({ id: uid(), name: n, status: $('p_s').value, budget: $('p_b').value, notes: $('p_t').value.trim() }); save(); VIEWS.commune(); };
window.cycleProj = id => { const p = DB.projects.find(x => x.id === id), o = ['plan', 'run', 'done']; p.status = o[(o.indexOf(p.status) + 1) % 3]; save(); VIEWS.commune(); };
window.delProj = id => { DB.projects = DB.projects.filter(p => p.id !== id); save(); VIEWS.commune(); };
function cStats() {
  const by = {}; DB.structures.forEach(s => by[s.type] = (by[s.type] || 0) + 1);
  const mo = {}; DB.reports.forEach(r => { const k = r.date.slice(0, 7); mo[k] = (mo[k] || 0) + 1; });
  return `<div class="grid"><div class="stat"><b>${DB.structures.length}</b><small>منشأة</small></div><div class="stat"><b>${DB.reports.length}</b><small>تبليغ</small></div><div class="stat"><b>${DB.projects.length}</b><small>مشروع</small></div></div>
  <h3>المنشآت حسب النوع</h3>${Object.keys(by).length ? Object.entries(by).map(([k, v]) => `<div class="kv"><span>${TYPES[k].ico} ${TYPES[k].ar}</span><span>${v}</span></div>`).join('') : '<div class="empty">لا توجد بيانات</div>'}
  <h3>التبليغات حسب الشهر</h3>${Object.keys(mo).length ? Object.entries(mo).sort().map(([k, v]) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`).join('') : '<div class="empty">لا توجد بيانات</div>'}
  <br><button class="btn" onclick="exportCSV()">⬇️ تصدير CSV (للإكسل)</button>`;
}
window.exportCSV = () => {
  const rows = [['الاسم', 'النوع', 'الجماعة', 'الحالة', 'خط العرض', 'خط الطول', 'آخر مستوى %', 'آخر صيانة']];
  DB.structures.forEach(s => { const l = (s.history || []).slice(-1)[0]; rows.push([s.name, TYPES[s.type].ar, s.commune || '', STATUS[s.status][0], s.lat, s.lng, l ? l.level : '', s.lastMaint || '']); });
  dl('watermap-structures.csv', '﻿' + rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n'), 'text/csv');
};
function dl(name, data, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

/* =====================================================
   6) المزيد
   ===================================================== */
VIEWS.more = function () {
  const feats = [['🔔', 'Water Alert', 'إنذارات عند الأعطاب والانقطاعات: تظهر في تبويب Water AI'], ['🧪', 'Water Quality', 'تسجيل تحاليل الجودة من ملف كل منشأة'], ['🏗️', 'Water Projects', 'قاعدة مشاريع الماء في لوحة الجماعة'], ['📜', 'Water History', 'سجل المستويات والأعطاب لكل منشأة'], ['📴', 'Offline Map', 'التطبيق والمعلومات تشتغل بدون إنترنت؛ بلاطات الخريطة التي زرتها تبقى مخزنة'], ['📊', 'Water Statistics', 'إحصائيات في لوحة الجماعة'], ['🤝', 'Water Community', 'مشاركة المواطنين عبر التبليغات (يتطلب خادماً للمشاركة الجماعية)']];
  $('view').innerHTML = `<div class="page"><h2>☰ المزيد</h2>
  <div class="grid"><div class="stat"><b>${DB.structures.length}</b><small>منشأة</small></div><div class="stat"><b>${DB.reports.length}</b><small>تبليغ</small></div></div>
  <div class="card"><b>نسخة احتياطية</b><p style="font-size:13px;color:var(--m);margin:4px 0">البيانات محفوظة في هذا الجهاز فقط. صدّر نسخة بانتظام.</p>
  <button class="btn" onclick="exportJSON()">⬇️ تصدير JSON</button> <label class="btn sec" style="display:inline-block;margin:0">⬆️ استيراد<input type="file" accept=".json" hidden onchange="importJSON(this.files[0])"></label></div>
  <h3>الخصائص</h3>${feats.map(f => `<div class="card">${f[0]} <b>${f[1]}</b><br><small>${f[2]}</small></div>`).join('')}
  <button class="btn red" onclick="resetAll()">🗑️ مسح كل البيانات</button></div>`;
};
window.exportJSON = () => dl('watermap-backup-' + today() + '.json', JSON.stringify(DB), 'application/json');
window.importJSON = f => { if (!f) return; const r = new FileReader(); r.onload = () => { try { const d = JSON.parse(r.result); if (!Array.isArray(d.structures)) throw 0; DB = Object.assign({ structures: [], reports: [], projects: [], farmLog: [], commune: '' }, d); save(); toast('تم الاستيراد'); VIEWS.more(); } catch (e) { toast('ملف غير صالح'); } }; r.readAsText(f); };
window.resetAll = () => { if (!confirm('مسح كل البيانات نهائياً؟ تأكد أنك صدّرت نسخة احتياطية.')) return; DB = { structures: [], reports: [], projects: [], farmLog: [], commune: '' }; save(); VIEWS.more(); };

/* ---------- الإقلاع ---------- */
load(); netState(); renderTabs(); VIEWS.map();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
