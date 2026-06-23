# KOGNIT Router

Router OpenAI-compatible com painel para provedores OAuth, API keys e sessoes.

## Rodar localmente

```bash
npm install
npm run dev
```

Painel e API: `http://localhost:3001`

Endpoint OpenAI-compatible: `http://localhost:3001/v1`

## Docker

```bash
docker compose up --build
```

O container não abre navegador próprio para CAPTCHA. Quando a Z.ai exigir clique humano, abra o provider ZCode no painel e use a caixa "Solver CAPTCHA Z.ai" ou acesse `/zcode/captcha/browser?client=standalone-browser`.
