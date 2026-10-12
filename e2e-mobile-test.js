require('dotenv').config();
const { spawn } = require('child_process');
const srv = spawn('node', ['server/index.js'], { cwd: __dirname });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await wait(5000);
  const base = 'http://127.0.0.1:3000';
  const j = async (m, p, body, token) => {
    const r = await fetch(base + p, {
      method: m,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, data };
  };
  const login = await j('POST', '/api/auth/login', { employee_id: 'APPTEST001', password: 'Test@123', portal: 'employee' });
  console.log('login:', login.status, 'has_token:', Boolean(login.data.token), 'has_refresh:', Boolean(login.data.refresh_token));
  const refresh = await j('POST', '/api/auth/refresh', { refresh_token: login.data.refresh_token });
  console.log('refresh:', refresh.status, 'new_token:', Boolean(refresh.data.token));
  const cfg = await j('GET', '/api/mobile/app-config');
  console.log('app-config:', cfg.status, JSON.stringify(cfg.data));
  const dev = await j('POST', '/api/mobile/register-device', { fcm_token: 'fake-fcm-token-1234567890', platform: 'android', app_version: '1.0.0' }, login.data.token);
  console.log('register-device:', dev.status, JSON.stringify(dev.data));
  srv.kill();
  process.exit(0);
})().catch((e) => { console.error('E2E_FAIL', e.message); srv.kill(); process.exit(1); });
