// public/app.js
let token = localStorage.getItem('token') || null;
let currentUser = null;
let ws = null;
const DEFAULT_TARIFF = 8.0;
const API = (path, opts={}) => fetch(path, Object.assign({ headers: token ? { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' } }, opts));

/* elements */
const headerRight = document.getElementById('headerRight');
const btnLogin = document.getElementById('btn-login');
const authModal = document.getElementById('authModal');
const authName = document.getElementById('authName');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authLoginBtn = document.getElementById('authLoginBtn');
const authSignupBtn = document.getElementById('authSignupBtn');
const authCloseBtn = document.getElementById('authCloseBtn');
const profileFile = document.getElementById('profileFile');
const uploadPhoto = document.getElementById('uploadPhoto');

const profileModal = document.getElementById('profileModal');
const profilePic = document.getElementById('profilePic');
const profileName = document.getElementById('profileName');
const profilePhone = document.getElementById('profilePhone');
const profileEB = document.getElementById('profileEB');
const profileUpi = document.getElementById('profileUpi');
const profileAddress = document.getElementById('profileAddress');
const profileSave = document.getElementById('profileSave');
const profileClose = document.getElementById('profileClose');

const btnSaveTariff = document.getElementById('btn-save-tariff');
const tariffInput = document.getElementById('tariff');
const btnExport = document.getElementById('btn-export');
const btnAdmin = document.getElementById('btn-admin');
const btnGenerateBill = document.getElementById('btn-generate-bill');

const voltageEl = document.getElementById('voltage');
const currentEl = document.getElementById('current');
const powerEl = document.getElementById('power');
const energyEl = document.getElementById('energy');
const costEl = document.getElementById('cost');

const deviceListEl = document.getElementById('device-list');
const btnAddDevice = document.getElementById('btn-add-device');

const btnRefreshHistory = document.getElementById('btn-refresh-history');

const adminPanel = document.getElementById('adminPanel');
const adminUsersTable = document.querySelector('#adminUsersTable tbody');
const adminClose = document.getElementById('adminClose');

const billModal = document.getElementById('billModal');
const billInfo = document.getElementById('billInfo');
const payMethod = document.getElementById('payMethod');
const paymentArea = document.getElementById('paymentArea');
const payStart = document.getElementById('payStart');
const payClose = document.getElementById('payClose');
let currentBillId = null;

/* auth UI wiring */
btnLogin && btnLogin.addEventListener('click', () => { authModal.classList.remove('hidden'); authName.style.display='block'; });
authCloseBtn && authCloseBtn.addEventListener('click', () => authModal.classList.add('hidden'));
authSignupBtn && authSignupBtn.addEventListener('click', async () => {
  const name = authName.value || prompt('Full name'); const email = authEmail.value, password = authPassword.value;
  if (!name || !email || !password) return alert('Enter name, email, password');
  const r = await API('/api/signup', { method:'POST', body: JSON.stringify({ name, email, password }) }); const j = await r.json();
  if (!r.ok) return alert(j.error||'Signup failed'); token = j.token; localStorage.setItem('token', token); authModal.classList.add('hidden'); await initApp();
});
authLoginBtn && authLoginBtn.addEventListener('click', async () => {
  const email = authEmail.value, password = authPassword.value; if (!email || !password) return alert('Enter email & password');
  const r = await API('/api/login', { method:'POST', body: JSON.stringify({ email, password }) }); const j = await r.json();
  if (!r.ok) return alert(j.error || 'Login failed'); token = j.token; localStorage.setItem('token', token); authModal.classList.add('hidden'); await initApp();
});

// upload photo
uploadPhoto && uploadPhoto.addEventListener('click', () => {
  const f = profileFile.files && profileFile.files[0]; if (!f) return alert('Choose file');
  const reader = new FileReader(); reader.onload = async () => {
    const dataUrl = reader.result;
    const r = await API('/api/users/me/photo', { method:'POST', body: JSON.stringify({ dataUrl }) }); const j = await r.json(); if (!r.ok) return alert(j.error || 'Upload failed');
    alert('Uploaded'); initHeader();
  }; reader.readAsDataURL(f);
});

// profile modal
async function openProfile() {
  if (!currentUser) return;
  profileModal.classList.remove('hidden');
  const r = await API('/api/users/me'); if (!r.ok) return;
  const j = await r.json();
  profileName.value = j.name || ''; profilePhone.value = j.phone || ''; profileEB.value = j.ebNumber || ''; profileUpi.value = j.upiId || ''; profileAddress.value = j.address || '';
  profilePic.src = j.profileUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(j.name)}&background=1976d2&color=fff&size=128`;
}
profileClose && profileClose.addEventListener('click', () => profileModal.classList.add('hidden'));
profileSave && profileSave.addEventListener('click', async () => {
  const payload = { name: profileName.value, phone: profilePhone.value, address: profileAddress.value, upiId: profileUpi.value };
  const r = await API('/api/users/me', { method:'PUT', body: JSON.stringify(payload) }); const j = await r.json(); if (!r.ok) return alert(j.error||'Save failed');
  alert('Saved'); profileModal.classList.add('hidden'); initHeader();
});

// header & login state
async function initHeader() {
  headerRight.innerHTML = '';
  if (!token) { headerRight.innerHTML = '<button id="btn-login">Login</button>'; document.getElementById('btn-login').addEventListener('click', () => authModal.classList.remove('hidden')); return; }
  const r = await API('/api/users/me'); if (!r.ok) { token=null; localStorage.removeItem('token'); return initHeader(); }
  const me = await r.json(); currentUser = me;
  const imgUrl = me.profileUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(me.name)}&background=1976d2&color=fff&size=128`;
  headerRight.innerHTML = `<div style="display:flex;align-items:center;gap:8px">
    <div style="text-align:right"><div style="font-weight:600">${me.name}</div><div style="font-size:0.85rem;color:#666">${me.id}</div></div>
    <img id="profileImg" src="${imgUrl}" style="width:40px;height:40px;border-radius:50%;cursor:pointer"/>
    <button id="btn-logout" class="secondary">Logout</button></div>`;
  document.getElementById('profileImg').addEventListener('click', openProfile);
  document.getElementById('btn-logout').addEventListener('click', () => { localStorage.removeItem('token'); token=null; currentUser=null; location.reload(); });
  if (me.isAdmin) { btnAdmin.style.display='inline-block'; btnAdmin.addEventListener('click', showAdminPanel); } else btnAdmin.style.display='none';
}

// charts
function makeChart(ctx) { return new Chart(ctx, { type:'line', data:{ labels:[], datasets:[] }, options:{ animation:false, scales:{ y:{ beginAtZero:true } } } }); }
const voltageChart = makeChart(document.getElementById('voltageChart').getContext('2d'));
const currentChart = makeChart(document.getElementById('currentChart').getContext('2d'));
const powerChart = makeChart(document.getElementById('powerChart').getContext('2d'));
const energyChart = makeChart(document.getElementById('energyChart').getContext('2d'));
const historyChart = new Chart(document.getElementById('historyChart').getContext('2d'), { type:'line', data:{ labels:[], datasets:[{ label:'Power (W)', data:[] }] }, options:{ animation:false, scales:{ y:{ beginAtZero:true } } } });

function ensureDataset(chart, device) {
  let ds = chart.data.datasets.find(d => d.deviceId === device.id);
  if (!ds) { ds = { label: device.name, deviceId: device.id, data: [], borderColor: device.color || randomColor(), tension:0.2, fill:false }; chart.data.datasets.push(ds); }
  return ds;
}
function randomColor(){ return '#'+Math.floor(Math.random()*16777215).toString(16); }

// WebSocket connect (after login)
function connectWS() {
  if (!token) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}`);
  ws.onopen = () => console.log('ws open');
  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'init') renderDevices(msg.devices || []);
      if (msg.type === 'metrics') {
        const d = msg.device; refreshMetrics();
        const t = new Date(msg.point.ts).toLocaleTimeString();
        [voltageChart, currentChart, powerChart, energyChart].forEach(chart => {
          const ds = ensureDataset(chart, d);
          if (chart.data.labels.length > 60) chart.data.labels.shift();
          chart.data.labels.push(t);
          const val = chart === voltageChart ? d.lastVoltage : chart === currentChart ? d.lastCurrent : chart === powerChart ? d.lastPower : d.lastEnergyWh;
          if (ds.data.length > 60) ds.data.shift();
          ds.data.push(val);
          chart.update();
        });
      }
      if (msg.type === 'device-created' || msg.type === 'device-update' || msg.type === 'device-deleted') loadDevices();
      if (msg.type === 'bill-created') alert('New bill for you: ' + msg.bill.id);
      if (msg.type === 'bill-paid') alert('Bill paid: ' + msg.bill.id);
    } catch(e){ console.warn('ws message parse', e); }
  };
  ws.onclose = () => { console.log('ws closed; reconnect in 2s'); setTimeout(connectWS,2000); };
}

// devices UI
async function loadDevices() { if (!token) return; const r = await API('/api/devices'); if (!r.ok) return; const list = await r.json(); renderDevices(list); }
function renderDevices(list) {
  deviceListEl.innerHTML = '';
  list.forEach(d => {
    const div = document.createElement('div'); div.className = 'device';
    div.innerHTML = `<div><div style="font-weight:600">${d.name}</div><div style="font-size:0.9rem;color:#666">Status: <span class="status">${d.status}</span></div></div>
      <div>
        <button class="toggle">${d.status==='ON'?'Turn OFF':'Turn ON'}</button>
        <button class="edit small">Edit</button>
        <button class="delete small secondary">Delete</button>
      </div>`;
    div.querySelector('.toggle').addEventListener('click', async () => {
      const action = d.status === 'ON' ? 'OFF' : 'ON'; const resp = await API('/api/control', { method:'POST', body: JSON.stringify({ deviceId: d.id, action }) });
      if (!resp.ok) { const j = await resp.json(); return alert(j.error || 'Failed'); } loadDevices();
    });
    div.querySelector('.delete').addEventListener('click', async () => {
      if (!confirm('Delete device?')) return;
      const resp = await API('/api/devices/' + d.id, { method:'DELETE' }); const j = await resp.json(); if (!resp.ok) return alert(j.error || 'Delete failed'); loadDevices();
    });
    div.querySelector('.edit').addEventListener('click', async () => {
      const newName = prompt('New name', d.name); if (!newName) return;
      // simple approach: delete + create with new name
      const rdel = await API('/api/devices/' + d.id, { method:'DELETE' }); if (!rdel.ok) { const e = await rdel.json(); return alert(e.error || 'Delete failed'); }
      await API('/api/devices', { method:'POST', body: JSON.stringify({ name: newName }) }); loadDevices();
    });
    deviceListEl.appendChild(div);
  });
}
btnAddDevice && btnAddDevice.addEventListener('click', async () => {
  const name = prompt('Device name'); if (!name) return; const r = await API('/api/devices', { method:'POST', body: JSON.stringify({ name }) }); const j = await r.json(); if (!r.ok) return alert(j.error||'Failed'); loadDevices();
});

// metrics
async function refreshMetrics() {
  if (!token) return;
  const r = await API('/api/metrics'); if (!r.ok) return;
  const j = await r.json(); const devs = j.devices || [];
  let totalPower=0, totalEnergy=0, totalVoltage=0, totalCurrent=0;
  devs.forEach(d => { totalPower += (d.lastPower||0); totalEnergy += (d.lastEnergyWh||0); totalVoltage += (d.lastVoltage||0); totalCurrent += (d.lastCurrent||0); });
  voltageEl.textContent = devs.length ? (totalVoltage/devs.length).toFixed(2) : '0.00';
  currentEl.textContent = devs.length ? (totalCurrent/devs.length).toFixed(2) : '0.00';
  powerEl.textContent = totalPower.toFixed(2);
  energyEl.textContent = totalEnergy.toFixed(2);
  const tariff = Number(tariffInput.value) || DEFAULT_TARIFF;
  costEl.textContent = ((totalEnergy/1000)*tariff).toFixed(2);
}

// history export & refresh
btnRefreshHistory && btnRefreshHistory.addEventListener('click', async () => {
  const r = await API('/api/history'); if (!r.ok) return alert('History fetch failed');
  const j = await r.json(); const labels = j.points.map(p => new Date(p.ts).toLocaleTimeString()); const data = j.points.map(p => p.power);
  historyChart.data.labels = labels; historyChart.data.datasets[0].data = data; historyChart.update();
});
btnExport && btnExport.addEventListener('click', async () => {
  const r = await API('/api/export'); if (!r.ok) { const j = await r.json(); return alert(j.error||'Export failed'); }
  const blob = await r.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'history.csv'; a.click(); URL.revokeObjectURL(url);
});

// admin
async function showAdminPanel() {
  adminPanel.classList.remove('hidden'); adminUsersTable.innerHTML = '';
  const r = await API('/api/users'); if (!r.ok) { const j = await r.json(); return alert(j.error || 'Failed'); }
  const list = await r.json();
  list.forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${u.name}</td><td>${u.email}</td><td>${u.ebNumber||''}</td><td>${u.phone||''}</td><td>${u.lastPower}</td>
      <td><button class="btn-gen-bill" data-user="${u.id}">Create Bill</button><button class="btn-view-bills" data-user="${u.id}">View Bills</button></td>`;
    adminUsersTable.appendChild(tr);
  });
  document.querySelectorAll('.btn-gen-bill').forEach(btn => btn.addEventListener('click', async (e) => {
    const uid = e.target.dataset.user; const r = await API('/api/bills/generate', { method:'POST', body: JSON.stringify({ userId: uid }) }); const j = await r.json();
    if (!r.ok) return alert(j.error||'Failed'); alert('Bill created: ' + j.id);
  }));
  document.querySelectorAll('.btn-view-bills').forEach(btn => btn.addEventListener('click', async (e) => {
    const uid = e.target.dataset.user; const r = await API('/api/bills?userId=' + uid); const list = await r.json();
    const html = list.map(x => `<div style="padding:8px;border-bottom:1px solid #eee">Bill ${x.id}: ₹${x.amount} - ${x.status} <button class="pay" data-id="${x.id}">Pay</button></div>`).join('');
    const wrapper = document.createElement('div'); wrapper.innerHTML = html; document.body.appendChild(wrapper);
    wrapper.querySelectorAll('.pay').forEach(p => p.addEventListener('click', () => openBillModal(p.dataset.id)));
  }));
}
adminClose && adminClose.addEventListener('click', () => adminPanel.classList.add('hidden'));

// generate bill for current user
btnGenerateBill && btnGenerateBill.addEventListener('click', async () => {
  if (!confirm('Generate bill based on usage since last bill?')) return;
  const r = await API('/api/bills/generate', { method:'POST' }); const j = await r.json();
  if (!r.ok) return alert(j.error || 'Generate failed'); alert(`Bill ID ${j.id} generated. Amount ₹${j.amount}`);
});

// payment modal
function openBillModal(bid) { currentBillId = bid; billModal.classList.remove('hidden'); loadBillInfo(bid); }
payClose && payClose.addEventListener('click', () => billModal.classList.add('hidden'));
payStart && payStart.addEventListener('click', async () => {
  if (!currentBillId) return alert('No bill'); const method = payMethod.value;
  const r = await API(`/api/bills/${currentBillId}/pay`, { method:'POST', body: JSON.stringify({ method }) }); const j = await r.json();
  if (!r.ok) return alert(j.error || 'Start payment failed');
  paymentArea.innerHTML = '';
  if (j.qrDataUrl) {
    const img = document.createElement('img'); img.src = j.qrDataUrl; img.style.maxWidth='240px'; paymentArea.appendChild(img);
    const btn = document.createElement('button'); btn.textContent='I have paid (Confirm)'; btn.addEventListener('click', async () => {
      const r2 = await API(`/api/bills/${currentBillId}/pay/confirm`, { method:'POST' }); const j2 = await r2.json(); if (!r2.ok) return alert(j2.error || 'Confirm failed'); alert('Payment successful'); billModal.classList.add('hidden');
    }); paymentArea.appendChild(btn);
  } else if (j.redirectUrl) {
    const a = document.createElement('a'); a.href = j.redirectUrl; a.textContent='Open bank payment (demo)'; a.target='_blank'; paymentArea.appendChild(a);
    const btn = document.createElement('button'); btn.textContent='Confirm Payment'; btn.addEventListener('click', async () => {
      const r2 = await API(`/api/bills/${currentBillId}/pay/confirm`, { method:'POST' }); const j2 = await r2.json(); if (!r2.ok) return alert(j2.error || 'Confirm failed'); alert('Payment successful'); billModal.classList.add('hidden');
    }); paymentArea.appendChild(btn);
  } else if (j.ok) { alert('Paid'); billModal.classList.add('hidden'); }
});
async function loadBillInfo(bid) { const r = await API(`/api/bills/${bid}`); if (!r.ok) { const j = await r.json(); return alert(j.error); } const j = await r.json(); billInfo.innerHTML = `<div>Bill ID: ${j.id}</div><div>Amount: ₹${j.amount}</div><div>Status: ${j.status}</div>`; }

// init app
async function initApp() {
  await initHeader();
  await loadDevices();
  connectWS();
  setTimeout(refreshMetrics, 500);
}
initApp();
