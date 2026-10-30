# STA-KPIs

Painel de indicadores financeiros e operacionais do centro de custo STA.

## Acoplamento ao Gestão SBR

O painel é aberto pelo Gestão (módulo Excelência Operacional) num iframe. O Gestão
entrega um token JWT HS256 de 60 s em `GET /api/auth/sso?token=...`; o painel troca por um
cookie de sessão (`sta_sessao`, host-only, `Secure`, `HttpOnly`) e passa a exigir a sessão em
tudo (páginas e `/api`). Sem `DOCKING_SECRET` o painel segue aberto, para uso local.

| Variável | Para quê |
|---|---|
| `DOCKING_SECRET` | Segredo compartilhado com o Gestão (gerado no servidor, nunca em commit) |
| `FRAME_ANCESTORS` | Opcional; o padrão libera o Gestão |
| `HANA_API_URL`, `HANA_API_KEY`, `HANA_SCHEMA` | Como antes |

Docker: `docker build -t sta-kpis .` e
`docker run --env-file .env -v sta-data:/data -p 127.0.0.1:3000:3000 sta-kpis`.
O volume `/data` guarda os lançamentos do Monitoramento (não apagar). Os dados operacionais
(`data/operacional/*.csv`, versionados no repositório) entram na imagem: atualizar os CSVs e fazer o commit
basta, o deploy seguinte já os leva. Testes: `npm test`.
