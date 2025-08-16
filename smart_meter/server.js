// server.js
const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const { Parser } = require('json2csv');

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_jwt_secret';
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const BILLS_FILE = path.join(DATA_DIR, 'bills.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
for (const f of [USERS_FILE, DEVICES_FILE, HISTORY_FILE, BILLS_FILE]) {
  if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify([]));
}
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

const readJSON = f => { try { return JSON.parse(fs.readFileSync(f)); } catch { return []; } };
const writeJSON = (f,d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

let users = readJSON(USERS_FILE);
let devices = readJSON(DEVICES_FILE);
let history = readJSON(HISTORY_FILE);
let bills = readJSON(BILLS_FILE);

// create default admin
if (!users.find(u => u.isAdmin)) {
  const admin = {
    id: uuidv4(),
    name: 'Admin',
    email: 'admin@example.com',
    passwordHash: bcrypt.hashSync('Admin123', 10),
    ebNumber: 'ADMIN-EB',
    phone: '',
    address: '',
    upiId: '',
    profileUrl: '',
    isAdmin: true,
    createdAt: new Date().toISOString()
  };
  users.push(admin);
  writeJSON(USERS_FILE, users);
  console.log('Created default admin: admin@example.com / Admin123');
}

// helpers
function createToken(user) {
  return jwt.sign({ id: user.id, email: user.email, isAdmin: !!user.isAdmin }, JWT_SECRET, { expiresIn: '8h' });
}
function authMiddleware(req,res,next){
  const h = req.headers.authorization; if (!h) return res.status(401).json({ error: 'No token' });
  const token = h.split(' ')[1];
  try { req.user = jwt.verify(token, JWT_SECRET); next(); } catch(e) { return res.status(401).json({ error: 'Invalid token' }); }
}
function randomColor(){ return '#'+Math.floor(Math.random()*16777215).toString(16); }

// ---- AUTH ----
app.post('/api/signup', (req,res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'name,email,password required' });
  if (users.find(u=>u.email===email)) return res.status(400).json({ error: 'User exists' });
  const u = { id: uuidv4(), name, email, passwordHash: bcrypt.hashSync(password,10), ebNumber:'', phone:'', address:'', upiId:'', profileUrl:'', isAdmin:false, createdAt: new Date().toISOString() };
  users.push(u); writeJSON(USERS_FILE, users);
  const token = createToken(u);
  res.json({ token, user: { id:u.id, name:u.name, email:u.email } });
});

app.post('/api/login', (req,res) => {
  const { email, password } = req.body || {};
  const u = users.find(x => x.email === email);
  if (!u) return res.status(401).json({ error: 'Invalid credentials' });
  if (!bcrypt.compareSync(password, u.passwordHash)) return res.status(401).json({ error: 'Invalid credentials' });
  const token = createToken(u);
  res.json({ token, user: { id:u.id, name:u.name, email:u.email, isAdmin: !!u.isAdmin } });
});

// profile endpoints
app.get('/api/users/me', authMiddleware, (req,res) => {
  const u = users.find(x => x.id === req.user.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.json({ id:u.id, name:u.name, email:u.email, ebNumber:u.ebNumber, phone:u.phone, address:u.address, upiId:u.upiId, profileUrl:u.profileUrl, isAdmin:!!u.isAdmin });
});
app.put('/api/users/me', authMiddleware, (req,res) => {
  const u = users.find(x => x.id === req.user.id); if (!u) return res.status(404).json({ error:'User not found' });
  const { name, phone, address, upiId } = req.body || {};
  if (name) u.name = name; if (phone) u.phone = phone; if (address) u.address = address; if (upiId) u.upiId = upiId;
  writeJSON(USERS_FILE, users); res.json({ ok:true });
});
app.post('/api/users/me/photo', authMiddleware, (req,res) => {
  const { dataUrl } = req.body || {};
  if (!dataUrl) return res.status(400).json({ error: 'No dataUrl' });
  const m = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) return res.status(400).json({ error: 'Invalid dataUrl' });
  const ext = m[1].split('/')[1]; const buf = Buffer.from(m[2], 'base64'); const fn = `${req.user.id}_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, fn), buf);
  const u = users.find(x=>x.id===req.user.id); if (!u) return res.status(404).json({ error:'User not found' });
  u.profileUrl = `/uploads/${fn}`; writeJSON(USERS_FILE, users); res.json({ ok:true, profileUrl: u.profileUrl });
});

// admin: list users
app.get('/api/users', authMiddleware, (req,res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Admins only' });
  const list = users.map(u => {
    const devs = devices.filter(d => d.userId === u.id);
    const lastPower = devs.reduce((acc,d) => acc + (d.lastPower||0), 0);
    return { id:u.id, name:u.name, email:u.email, ebNumber:u.ebNumber, phone:u.phone, lastPower: Number(lastPower.toFixed(2)), createdAt:u.createdAt };
  });
  res.json(list);
});

// ---- DEVICES ----
app.get('/api/devices', authMiddleware, (req,res) => {
  if (req.query.all && req.user.isAdmin) return res.json(devices);
  res.json(devices.filter(d => d.userId === req.user.id));
});
app.post('/api/devices', authMiddleware, (req,res) => {
  const { name='New Device' } = req.body || {};
  const d = { id: uuidv4(), userId: req.user.id, name, type:'general', status:'OFF', color: randomColor(), createdAt: new Date().toISOString(), lastPower:0, lastVoltage:0, lastCurrent:0, lastEnergyWh:0 };
  devices.push(d); writeJSON(DEVICES_FILE, devices); sendToUser(d.userId, { type:'device-created', device:d }); res.json(d);
});
app.delete('/api/devices/:id', authMiddleware, (req,res) => {
  const id = req.params.id; const idx = devices.findIndex(d=>d.id===id); if (idx === -1) return res.status(404).json({ error: 'Device not found' });
  const dev = devices[idx]; if (dev.userId !== req.user.id && !req.user.isAdmin) return res.status(403).json({ error:'Forbidden' });
  devices.splice(idx,1); writeJSON(DEVICES_FILE, devices); sendToUser(dev.userId, { type:'device-deleted', deviceId:id }); res.json({ ok:true });
});
app.post('/api/control', authMiddleware, (req,res) => {
  const { deviceId, action } = req.body || {}; const dev = devices.find(d=>d.id===deviceId); if (!dev) return res.status(404).json({ error:'Device not found' });
  if (dev.userId !== req.user.id && !req.user.isAdmin) return res.status(403).json({ error:'Forbidden' });
  if (!['ON','OFF'].includes(action)) return res.status(400).json({ error:'Action must be ON/OFF' });
  dev.status = action; writeJSON(DEVICES_FILE, devices); sendToUser(dev.userId, { type:'device-update', device:dev }); res.json({ ok:true, device:dev });
});

// ---- INGEST (IoT) ----
app.post('/api/ingest', (req,res) => {
  const { userId, deviceId, name } = req.body || {};
  if (!userId) return res.status(400).json({ error:'userId required' });
  const user = users.find(u => u.id === userId); if (!user) return res.status(404).json({ error:'User not found' });
  let dev = deviceId ? devices.find(d => d.id === deviceId) : null;
  if (!dev) {
    dev = { id: deviceId || uuidv4(), userId, name: name || 'Auto Device', type:'auto', status:'ON', color: randomColor(), createdAt: new Date().toISOString(), lastPower:0, lastVoltage:0, lastCurrent:0, lastEnergyWh:0 };
    devices.push(dev);
  }
  const voltage = typeof req.body.voltage === 'number' ? req.body.voltage : +(220 + Math.random()*8).toFixed(2);
  const current = typeof req.body.current === 'number' ? req.body.current : +(0.2 + Math.random()*2.5).toFixed(3);
  const power = typeof req.body.power === 'number' ? req.body.power : +(voltage * current * (0.85 + Math.random()*0.15)).toFixed(2);
  const now = new Date().toISOString();
  const energyInc = +(power / 3600).toFixed(4);
  dev.lastVoltage = voltage; dev.lastCurrent = current; dev.lastPower = power; dev.lastEnergyWh = +( (dev.lastEnergyWh||0) + energyInc ).toFixed(4);
  history.push({ ts: now, userId, deviceId: dev.id, voltage, current, power, energyWh: dev.lastEnergyWh });
  writeJSON(DEVICES_FILE, devices); writeJSON(HISTORY_FILE, history);
  sendToUser(userId, { type:'metrics', device:dev, point:{ ts: now, voltage, current, power, energyWh: dev.lastEnergyWh }});
  res.json({ ok:true, device:dev });
});

// ---- METRICS & HISTORY ----
app.get('/api/metrics', authMiddleware, (req,res) => {
  const devs = devices.filter(d => d.userId === req.user.id).map(d => ({ id:d.id, name:d.name, status:d.status, lastVoltage:d.lastVoltage||0, lastCurrent:d.lastCurrent||0, lastPower:d.lastPower||0, lastEnergyWh:d.lastEnergyWh||0, color:d.color }));
  const totals = devs.reduce((acc,d) => { acc.power += d.lastPower; acc.energy += d.lastEnergyWh; acc.voltage += d.lastVoltage; acc.current += d.lastCurrent; return acc; }, { power:0, energy:0, voltage:0, current:0 });
  const avgVoltage = devs.length ? totals.voltage/devs.length : 0;
  const avgCurrent = devs.length ? totals.current/devs.length : 0;
  const costPerKWh = Number(process.env.DEFAULT_TARIFF || 8.0);
  const costINR = ((totals.energy/1000) * costPerKWh);
  res.json({ devices: devs, totals: { power: totals.power, energy: totals.energy, voltage: avgVoltage, current: avgCurrent, costINR: Number(costINR.toFixed(2)), costPerKWh } });
});
app.get('/api/history', authMiddleware, (req,res) => {
  const deviceId = req.query.deviceId; const pts = history.filter(h => h.userId === req.user.id && (!deviceId || h.deviceId === deviceId));
  res.json({ points: pts });
});

// ---- BILLS (auto generate + pay demo) ----
const DEFAULT_TARIFF = Number(process.env.DEFAULT_TARIFF || 8.0);
app.post('/api/bills/generate', authMiddleware, (req,res) => {
  const targetUserId = req.body.userId || req.user.id;
  if (targetUserId !== req.user.id && !req.user.isAdmin) return res.status(403).json({ error:'Forbidden' });
  const userBills = bills.filter(b => b.userId === targetUserId).sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
  const lastBillTime = (userBills[0] && userBills[0].createdAt) ? userBills[0].createdAt : '1970-01-01T00:00:00.000Z';
  const now = new Date().toISOString();
  const userDevices = devices.filter(d => d.userId === targetUserId);
  let totalWh = 0;
  for (const d of userDevices) {
    const pts = history.filter(h => h.deviceId === d.id && h.userId === targetUserId && h.ts >= lastBillTime && h.ts <= now).sort((a,b)=>a.ts.localeCompare(b.ts));
    if (pts.length >= 2) totalWh += Math.max(0, (pts[pts.length-1].energyWh||0) - (pts[0].energyWh||0));
  }
  const totalKwh = totalWh/1000.0;
  const tariff = typeof req.body.tariff === 'number' ? req.body.tariff : DEFAULT_TARIFF;
  const amount = Number((totalKwh * tariff).toFixed(2));
  const newBill = { id: uuidv4(), userId: targetUserId, amount, energyWh: Number(totalWh.toFixed(4)), kWh: Number(totalKwh.toFixed(4)), tariff, status: amount===0 ? 'PAID' : 'UNPAID', createdAt: now, paidAt: null };
  bills.push(newBill); writeJSON(BILLS_FILE, bills);
  sendToUser(targetUserId, { type:'bill-created', bill: newBill });
  res.json(newBill);
});

app.get('/api/bills', authMiddleware, (req,res) => {
  const qUser = req.query.userId; if (qUser && qUser !== req.user.id && !req.user.isAdmin) return res.status(403).json({ error:'Forbidden' });
  res.json(bills.filter(b => (qUser ? b.userId === qUser : b.userId === req.user.id)));
});
app.get('/api/bills/:id', authMiddleware, (req,res) => {
  const b = bills.find(x=>x.id===req.params.id); if (!b) return res.status(404).json({ error:'Bill not found' });
  if (!req.user.isAdmin && b.userId !== req.user.id) return res.status(403).json({ error:'Forbidden' }); res.json(b);
});
app.post('/api/bills/:id/pay', authMiddleware, async (req,res) => {
  const b = bills.find(x=>x.id===req.params.id); if (!b) return res.status(404).json({ error:'Bill not found' });
  const { method } = req.body || {}; if (!method) return res.status(400).json({ error:'method required' });
  if (method === 'upi') {
    const payeeUpi = process.env.DEMO_UPI || 'demo@upi';
    const upiStr = `upi://pay?pa=${encodeURIComponent(payeeUpi)}&pn=${encodeURIComponent('SmartEnergy')}&am=${encodeURIComponent(String(b.amount))}&cu=INR&tn=${encodeURIComponent(b.id)}`;
    const dataUrl = await QRCode.toDataURL(upiStr);
    b.pendingPayment = { method:'upi', qrDataUrl:dataUrl, startedAt:new Date().toISOString(), byUserId:req.user.id }; writeJSON(BILLS_FILE, bills); return res.json({ qrDataUrl: dataUrl });
  } else if (method === 'netbanking') {
    const url = `https://demo-bank.example.com/pay?bill=${b.id}&amount=${b.amount}`;
    b.pendingPayment = { method:'netbanking', url, startedAt:new Date().toISOString(), byUserId:req.user.id }; writeJSON(BILLS_FILE, bills); return res.json({ redirectUrl: url });
  } else if (method === 'wallet') {
    b.status='PAID'; b.paidAt=new Date().toISOString(); b.paidBy=req.user.id; b.paymentMethod='wallet'; writeJSON(BILLS_FILE, bills); sendToUser(b.userId, { type:'bill-paid', bill:b }); return res.json({ ok:true, bill:b });
  } else return res.status(400).json({ error:'Unknown method' });
});
app.post('/api/bills/:id/pay/confirm', authMiddleware, (req,res) => {
  const b = bills.find(x=>x.id===req.params.id); if (!b) return res.status(404).json({ error:'Bill not found' });
  b.status='PAID'; b.paidAt=new Date().toISOString(); b.paidBy=req.user.id; if (b.pendingPayment) b.paymentMethod = b.pendingPayment.method; delete b.pendingPayment; writeJSON(BILLS_FILE, bills); sendToUser(b.userId, { type:'bill-paid', bill:b }); res.json({ ok:true, bill:b });
});

// export
app.get('/api/export', authMiddleware, (req,res) => {
  const pts = history.filter(h => h.userId === req.user.id);
  const fields = ['ts','deviceId','voltage','current','power','energyWh']; const parser = new Parser({ fields }); const csv = parser.parse(pts);
  res.header('Content-Type','text/csv'); res.attachment('history.csv'); res.send(csv);
});

// ---- WebSocket server ----
const server = app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
const wss = new WebSocket.Server({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  try {
    const url = req.url || ''; const token = new URL('http://x'+url).searchParams.get('token'); if (!token) { ws.send(JSON.stringify({ type:'error', message:'No token' })); ws.close(); return; }
    const payload = jwt.verify(token, JWT_SECRET); ws.userId = payload.id; ws.isAdmin = !!payload.isAdmin;
    const myDevices = devices.filter(d => ws.isAdmin ? true : d.userId === ws.userId);
    ws.send(JSON.stringify({ type:'init', devices: myDevices }));
  } catch(e) { ws.send(JSON.stringify({ type:'error', message:'Invalid token' })); ws.close(); }
});
function sendToUser(userId, obj) { wss.clients.forEach(c => { if (c.readyState !== WebSocket.OPEN) return; try { if (c.isAdmin) c.send(JSON.stringify(obj)); else if (c.userId === userId) c.send(JSON.stringify(obj)); } catch(e){} }); }

// simulation: update ON devices every 2s
setInterval(() => {
  const ts = new Date().toISOString(); let changed = false;
  for (const d of devices) {
    if (d.status === 'ON') {
      const voltage = +(220 + Math.random()*8).toFixed(2);
      const current = +(0.2 + Math.random()*2.5).toFixed(3);
      const power = +(voltage * current * (0.85 + Math.random()*0.15)).toFixed(2);
      const energyInc = +(power / 3600).toFixed(4);
      d.lastVoltage = voltage; d.lastCurrent = current; d.lastPower = power; d.lastEnergyWh = +( (d.lastEnergyWh||0) + energyInc ).toFixed(4);
      history.push({ ts, userId: d.userId, deviceId: d.id, voltage, current, power, energyWh: d.lastEnergyWh });
      sendToUser(d.userId, { type:'metrics', device: d, point:{ ts, voltage, current, power, energyWh: d.lastEnergyWh }});
      changed = true;
    }
  }
  if (changed) { writeJSON(DEVICES_FILE, devices); writeJSON(HISTORY_FILE, history); }
}, 2000);
