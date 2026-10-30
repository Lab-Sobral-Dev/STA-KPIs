'use strict';

// Acoplamento ao Gestão SBR (Protocolo de Acoplamento, secoes 3, 5 e 6).
// O Gestão emite um JWT HS256 de 60 s; este modulo o troca por um cookie de sessao
// proprio, host-only. Sem lib externa: a verificacao e um HMAC.

const crypto = require('node:crypto');

const PRODUTO = 'sta-kpis';
const COOKIE = 'sta_session';
const SESSAO_SEGUNDOS = 8 * 60 * 60;
const FRAME_ANCESTORS = "'self' http://gestao.labsobralnet.ind https://gestao.laboratoriosobral.com.br";

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function hmac(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest();
}

function iguais(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Devolve o payload do token ou null. Rejeita assinatura errada, algoritmo diferente de HS256,
// token vencido, `produto` diferente de sta-kpis e `sub` ausente.
function verificarTokenDocking(token, secret, agora = Date.now()) {
  const partes = String(token || '').split('.');
  if (partes.length !== 3) return null;
  const [h, p, s] = partes;
  if (!iguais(b64url(hmac(secret, `${h}.${p}`)), s)) return null;
  try {
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (header.alg !== 'HS256') return null;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= agora) return null;
    if (payload.produto !== PRODUTO || typeof payload.sub !== 'string' || !payload.sub) return null;
    return payload;
  } catch {
    return null;
  }
}

// A chave da sessao deriva do DOCKING_SECRET: nao exige segredo extra e a rotacao do
// DOCKING_SECRET invalida as sessoes abertas.
function chaveSessao(secret) {
  return hmac(secret, 'sta-kpis-sessao-v1');
}

function criarSessao(login, secret, agora = Date.now()) {
  const corpo = b64url(JSON.stringify({ sub: login, exp: Math.floor(agora / 1000) + SESSAO_SEGUNDOS }));
  return `${corpo}.${b64url(hmac(chaveSessao(secret), corpo))}`;
}

function lerSessao(valor, secret, agora = Date.now()) {
  const [corpo, assinatura] = String(valor || '').split('.');
  if (!corpo || !assinatura) return null;
  if (!iguais(b64url(hmac(chaveSessao(secret), corpo)), assinatura)) return null;
  try {
    const payload = JSON.parse(Buffer.from(corpo, 'base64url').toString());
    return payload.exp * 1000 > agora ? payload : null;
  } catch {
    return null;
  }
}

function lerCookie(req, nome) {
  for (const par of String(req.headers.cookie || '').split(';')) {
    const i = par.indexOf('=');
    if (i > 0 && par.slice(0, i).trim() === nome) return par.slice(i + 1).trim();
  }
  return null;
}

function createAuth({ dockingSecret, cookieSecure }) {
  const sso = (req, res) => {
    if (!dockingSecret) return res.status(503).json({ erro: 'DOCKING_SECRET nao configurado.' });
    if (!req.query.token) return res.status(400).json({ erro: 'token ausente.' });
    const payload = verificarTokenDocking(req.query.token, dockingSecret);
    if (!payload) return res.status(401).json({ erro: 'token invalido ou expirado.' });
    // Cookie host-only (sem Domain), HttpOnly e Secure em producao (SESSION_COOKIE_SECURE=true).
    const atributos = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSAO_SEGUNDOS}`];
    if (cookieSecure) atributos.push('Secure');
    res.setHeader('Set-Cookie', `${COOKIE}=${criarSessao(payload.sub, dockingSecret)}; ${atributos.join('; ')}`);
    // Location relativo: a borda (nginx) nao precisa reescrever o host.
    return res.redirect(302, '/');
  };

  // Sem DOCKING_SECRET o painel segue como antes (so local, ver server.js). Com ele, tudo exige sessao.
  const exigirSessao = (req, res, next) => {
    if (!dockingSecret || req.path === '/api/auth/sso') return next();
    if (lerSessao(lerCookie(req, COOKIE), dockingSecret)) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ erro: 'sessao ausente. Abra o painel pelo Gestao SBR.' });
    return res.status(401).type('text/plain; charset=utf-8').send('Acesso pelo Gestao SBR (menu Excelencia Operacional).');
  };

  const cabecalhos = (req, res, next) => {
    res.setHeader('Content-Security-Policy', `frame-ancestors ${FRAME_ANCESTORS}`);
    next();
  };

  return { sso, exigirSessao, cabecalhos };
}

module.exports = { createAuth, verificarTokenDocking, criarSessao, lerSessao, PRODUTO, COOKIE };
