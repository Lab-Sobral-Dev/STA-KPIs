'use strict';

const crypto = require('node:crypto');
const express = require('express');

/**
 * Acoplamento ao Gestao SBR (Protocolo de Acoplamento).
 * O Gestao autentica o usuario no AD e embute este painel num iframe, entregando um
 * token JWT HS256 de 60s em GET /api/auth/sso?token=... . Aqui o token vira uma sessao
 * em cookie, e tudo (paginas e /api) passa a exigir essa sessao.
 *
 * Sem DOCKING_SECRET (uso local, sem Gestao) o painel continua aberto como antes.
 */

const PRODUTO = 'sta-kpis';
const COOKIE = 'sta_sessao';
const VIDA_SESSAO_S = 12 * 3600;
// O contrato fixa 60 s de vida para o token: um exp muito adiante e bug ou segredo vazado do emissor.
const TETO_EXP_TOKEN_MS = 5 * 60 * 1000;
const SEGREDO_MINIMO = 32;
const LOOPBACK = ['127.0.0.1', '::1', 'localhost'];
const FRAME_ANCESTORS_PADRAO =
  "'self' http://gestao.labsobralnet.ind https://gestao.laboratoriosobral.com.br";

function configDoAmbiente(env = process.env) {
  return {
    dockingSecret: env.DOCKING_SECRET || undefined,
    sessionSecret: env.SESSION_SECRET || undefined,
    frameAncestors: env.FRAME_ANCESTORS || FRAME_ANCESTORS_PADRAO,
  };
}

const b64u = (dado) => Buffer.from(dado).toString('base64url');
const hmac = (chave, dado) => crypto.createHmac('sha256', chave).update(dado).digest();
const iguais = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

function chaveSessao(cfg) {
  return cfg.sessionSecret || hmac(cfg.dockingSecret || '', 'sessao').toString('hex');
}

/** Valida o JWT HS256 do Gestao. Devolve o login AD (`sub`) ou null. */
function verificarToken(token, cfg, agora = Date.now()) {
  if (!cfg.dockingSecret) return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const [h, p, s] = partes;
  try {
    const cab = JSON.parse(Buffer.from(h, 'base64url').toString());
    if (cab.alg !== 'HS256') return null;
    if (!iguais(hmac(cfg.dockingSecret, `${h}.${p}`), Buffer.from(s, 'base64url'))) return null;
    const corpo = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (corpo.produto !== PRODUTO) return null;
    if (typeof corpo.sub !== 'string' || !corpo.sub) return null;
    if (typeof corpo.exp !== 'number' || corpo.exp * 1000 <= agora) return null;
    if (corpo.exp * 1000 > agora + TETO_EXP_TOKEN_MS) return null;
    return corpo.sub;
  } catch {
    return null;
  }
}

function assinarSessao(login, cfg, agora = Date.now()) {
  const corpo = b64u(JSON.stringify({ sub: login, exp: Math.floor(agora / 1000) + VIDA_SESSAO_S }));
  return `${corpo}.${b64u(hmac(chaveSessao(cfg), corpo))}`;
}

function lerSessao(cookieHeader, cfg, agora = Date.now()) {
  const bruto = (cookieHeader || '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!bruto) return null;
  const partes = bruto.split('.');
  if (partes.length !== 2) return null;
  const [corpo, assinatura] = partes;
  if (!corpo || !assinatura) return null;
  if (!iguais(hmac(chaveSessao(cfg), corpo), Buffer.from(assinatura, 'base64url'))) return null;
  try {
    const { sub, exp } = JSON.parse(Buffer.from(corpo, 'base64url').toString());
    return typeof sub === 'string' && sub && exp * 1000 > agora ? sub : null;
  } catch {
    return null;
  }
}

/** `next` so e aceito como caminho interno (evita open redirect). */
function destinoSeguro(next) {
  return typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : '/';
}

function cabecalhoFrame(cfg) {
  return (req, res, next) => {
    res.setHeader('Content-Security-Policy', `frame-ancestors ${cfg.frameAncestors}`);
    next();
  };
}

function authRouter(cfg) {
  const router = express.Router();
  router.get('/sso', (req, res) => {
    if (!cfg.dockingSecret) return res.status(503).json({ erro: 'Acoplamento nao configurado' });
    const token = req.query.token;
    if (typeof token !== 'string' || !token) return res.status(400).json({ erro: 'Token ausente' });
    const login = verificarToken(token, cfg);
    if (!login) return res.status(401).json({ erro: 'Token invalido ou expirado' });
    // Cookie host-only (sem Domain), Secure (HTTPS publico). Gestao e o painel sao do mesmo site
    // (laboratoriosobral.com.br), entao SameSite=Lax chega no iframe.
    const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure', `Max-Age=${VIDA_SESSAO_S}`];
    res.setHeader('Set-Cookie', `${COOKIE}=${assinarSessao(login, cfg)}; ${attrs.join('; ')}`);
    return res.redirect(302, destinoSeguro(req.query.next));
  });
  return router;
}

/** Exige sessao do SSO em tudo que passa por aqui. No-op sem DOCKING_SECRET. */
function exigirSessao(cfg) {
  return (req, res, next) => {
    if (!cfg.dockingSecret) return next();
    if (lerSessao(req.headers.cookie, cfg)) return next();
    return res.status(401).json({ erro: 'Sessao ausente. Abra o painel pelo Gestao SBR.' });
  };
}

/**
 * Falha cedo em configuracao insegura. Sem DOCKING_SECRET o painel fica aberto, entao so e aceito em
 * loopback (uso local); em qualquer outro HOST (como o 0.0.0.0 do container) o servidor nao sobe.
 */
function validarConfig(cfg, host) {
  if (!cfg.dockingSecret && !LOOPBACK.includes(host)) {
    throw new Error(`HOST=${host} exige DOCKING_SECRET: o painel nao pode ficar aberto na rede sem autenticacao.`);
  }
  if (cfg.dockingSecret && cfg.dockingSecret.length < SEGREDO_MINIMO) {
    throw new Error(`DOCKING_SECRET precisa ter ao menos ${SEGREDO_MINIMO} caracteres (openssl rand -hex 32).`);
  }
}

/** Unica rota publica alem do SSO: serve o HEALTHCHECK do container. Montar antes do exigirSessao. */
function healthz(req, res) {
  res.type('text/plain').send('ok');
}

module.exports = {
  PRODUTO, configDoAmbiente, verificarToken, assinarSessao, lerSessao,
  cabecalhoFrame, authRouter, exigirSessao, validarConfig, healthz,
};
