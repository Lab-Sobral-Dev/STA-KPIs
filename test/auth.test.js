'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { createAuth, verificarTokenDocking, criarSessao, lerSessao } = require('../src/server/auth');

const SECRET = 'segredo-de-teste';

function assinar(payload, secret = SECRET, alg = 'HS256') {
  const h = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const s = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

const valido = () => ({ sub: 'iaires', produto: 'sta-kpis', exp: Math.floor(Date.now() / 1000) + 60 });

async function servidor(opts = { dockingSecret: SECRET, cookieSecure: true }) {
  const auth = createAuth(opts);
  const app = express();
  app.use(auth.cabecalhos);
  app.get('/api/auth/sso', auth.sso);
  app.use(auth.exigirSessao);
  app.get('/api/dado', (req, res) => res.json({ ok: true }));
  app.get('/', (req, res) => res.send('painel'));
  const srv = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { base: `http://127.0.0.1:${srv.address().port}`, fechar: () => srv.close() };
}

test('token valido passa; assinatura, produto, vencimento e algoritmo errados falham', () => {
  assert.equal(verificarTokenDocking(assinar(valido()), SECRET).sub, 'iaires');
  assert.equal(verificarTokenDocking(assinar(valido(), 'outro'), SECRET), null);
  assert.equal(verificarTokenDocking(assinar({ ...valido(), produto: 'vendas-360' }), SECRET), null);
  assert.equal(verificarTokenDocking(assinar({ ...valido(), exp: 1 }), SECRET), null);
  assert.equal(verificarTokenDocking(assinar(valido(), SECRET, 'none'), SECRET), null);
  assert.equal(verificarTokenDocking(assinar({ produto: 'sta-kpis', exp: valido().exp }), SECRET), null);
  assert.equal(verificarTokenDocking('lixo', SECRET), null);
});

test('sessao: ida e volta, adulterada e vencida', () => {
  assert.equal(lerSessao(criarSessao('iaires', SECRET), SECRET).sub, 'iaires');
  assert.equal(lerSessao(criarSessao('iaires', SECRET), 'outro'), null);
  assert.equal(lerSessao(criarSessao('iaires', SECRET, Date.now() - 9 * 3600 * 1000), SECRET), null);
  assert.equal(lerSessao(`${criarSessao('iaires', SECRET)}x`, SECRET), null);
});

test('SSO: 400 sem token, 401 invalido, 503 sem segredo', async () => {
  const s = await servidor();
  try {
    assert.equal((await fetch(`${s.base}/api/auth/sso`)).status, 400);
    assert.equal((await fetch(`${s.base}/api/auth/sso?token=x`)).status, 401);
  } finally { s.fechar(); }
  const semSegredo = await servidor({ dockingSecret: undefined, cookieSecure: false });
  try {
    assert.equal((await fetch(`${semSegredo.base}/api/auth/sso?token=x`)).status, 503);
  } finally { semSegredo.fechar(); }
});

test('SSO valido: 302 relativo com cookie host-only/Secure e CSP frame-ancestors; sessao libera a API', async () => {
  const s = await servidor();
  try {
    const r = await fetch(`${s.base}/api/auth/sso?token=${assinar(valido())}`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/');
    const cookie = r.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.doesNotMatch(cookie, /Domain=/i);
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors .*gestao\.laboratoriosobral\.com\.br/);

    assert.equal((await fetch(`${s.base}/api/dado`)).status, 401);
    assert.equal((await fetch(`${s.base}/`)).status, 401);
    const ok = await fetch(`${s.base}/api/dado`, { headers: { cookie: cookie.split(';')[0] } });
    assert.equal(ok.status, 200);
  } finally { s.fechar(); }
});

test('sem DOCKING_SECRET o painel local segue aberto', async () => {
  const s = await servidor({ dockingSecret: undefined, cookieSecure: false });
  try {
    assert.equal((await fetch(`${s.base}/api/dado`)).status, 200);
  } finally { s.fechar(); }
});
