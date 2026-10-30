'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const acoplamento = require('../src/server/acoplamento');

const SEGREDO = 'segredo-de-teste';
const cfg = { dockingSecret: SEGREDO, sessionSecret: undefined, frameAncestors: "'self'" };

function token(payload, segredo = SEGREDO, alg = 'HS256') {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b64({ alg, typ: 'JWT' });
  const p = b64(payload);
  const s = crypto.createHmac('sha256', segredo).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
const valido = () => ({ sub: 'iaires', produto: 'sta-kpis', exp: Math.floor(Date.now() / 1000) + 60 });

async function subir() {
  const app = express();
  app.use(acoplamento.cabecalhoFrame(cfg));
  app.use('/api/auth', acoplamento.authRouter(cfg));
  app.use(acoplamento.exigirSessao(cfg));
  app.get('/api/x', (req, res) => res.json({ ok: true }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('verificarToken aceita token valido e devolve o login', () => {
  assert.equal(acoplamento.verificarToken(token(valido()), cfg), 'iaires');
});

test('verificarToken rejeita segredo errado, produto errado, expirado e alg diferente', () => {
  assert.equal(acoplamento.verificarToken(token(valido(), 'outro'), cfg), null);
  assert.equal(acoplamento.verificarToken(token({ ...valido(), produto: 'vendas-360' }), cfg), null);
  assert.equal(acoplamento.verificarToken(token({ ...valido(), exp: 1 }), cfg), null);
  assert.equal(acoplamento.verificarToken(token(valido(), SEGREDO, 'none'), cfg), null);
  assert.equal(acoplamento.verificarToken('lixo', cfg), null);
});

test('SSO: token invalido 401, sem token 400, valido 302 com cookie Secure host-only', async () => {
  const { server, base } = await subir();
  try {
    assert.equal((await fetch(`${base}/api/auth/sso?token=x`)).status, 401);
    assert.equal((await fetch(`${base}/api/auth/sso`)).status, 400);
    const ok = await fetch(`${base}/api/auth/sso?token=${token(valido())}&next=//evil.com`, { redirect: 'manual' });
    assert.equal(ok.status, 302);
    assert.equal(ok.headers.get('location'), '/');
    const cookie = ok.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.doesNotMatch(cookie, /Domain=/);
  } finally { server.close(); }
});

test('API: sem cookie 401, com cookie do SSO 200, e frame-ancestors presente', async () => {
  const { server, base } = await subir();
  try {
    const semSessao = await fetch(`${base}/api/x`);
    assert.equal(semSessao.status, 401);
    assert.match(semSessao.headers.get('content-security-policy'), /frame-ancestors/);
    const sso = await fetch(`${base}/api/auth/sso?token=${token(valido())}`, { redirect: 'manual' });
    const cookie = sso.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${base}/api/x`, { headers: { cookie } })).status, 200);
    assert.equal((await fetch(`${base}/api/x`, { headers: { cookie: `${cookie}x` } })).status, 401);
  } finally { server.close(); }
});

test('sem DOCKING_SECRET: uso local aberto e SSO responde 503', async () => {
  const aberto = { dockingSecret: undefined, frameAncestors: "'self'" };
  const app = express();
  app.use('/api/auth', acoplamento.authRouter(aberto));
  app.use(acoplamento.exigirSessao(aberto));
  app.get('/api/x', (req, res) => res.json({ ok: true }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/api/x`)).status, 200);
    assert.equal((await fetch(`${base}/api/auth/sso?token=x`)).status, 503);
  } finally { server.close(); }
});
