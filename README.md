# KOGNIT Router

Router OpenAI-compatible com painel para provedores OAuth, API keys e sessoes.

## Rodar localmente

```bash
npm install
npm run dev
```

Painel e API: `http://localhost:3001`

Endpoint OpenAI-compatible: `http://localhost:3001/v1`

## Migrar contas ZCode do 9Router

```bash
npm run migrate:zcode
```

O comando importa as contas do SQLite do 9Router sem imprimir tokens e mantém os outros provedores do KOGNIT.

## Docker

```bash
docker compose up --build
```

O container não abre navegador próprio para CAPTCHA. Quando a Z.ai exigir clique humano, abra o provider ZCode no painel e use a caixa "Solver CAPTCHA Z.ai" ou acesse `/zcode/captcha/browser?client=standalone-browser`.

## Render

O `render.yaml` cria um web service Docker com disco em `/var/data/kognit`. No primeiro deploy, informe o segredo `KOGNIT_ZCODE_ACCOUNTS_JSON` como um array JSON de contas:

```json
[{"name":"Conta ZCode","email":"conta@email.com","accessToken":"TOKEN"}]
```

Nunca coloque tokens diretamente no Git. O plano Starter é usado porque discos persistentes não estão disponíveis no plano gratuito.
