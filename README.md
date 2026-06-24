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

## Licença

Copyright (c) 2026 **Panhard-Dev**. Todos os direitos reservados.

Este projeto usa a **PolyForm Noncommercial License 1.0.0**.

| Pode? | Como |
|---|---|
| ✅ Usar, estudar e modificar | Para fins pessoais, pesquisa, estudo, hobby e divulgação não-comercial |
| ✅ Redistribuir | Desde que mantenha este aviso de copyright |
| ❌ Uso comercial / venda | **Proibido** sem licença comercial por escrito do autor |
| ❌ Remover o nome do criador | Você deve manter "Copyright (c) 2026 Panhard-Dev" em todas as cópias |

**Uso comercial** (vender, integrar em produto/serviço pago, usar dentro de uma empresa) exige licença separada por escrito com o autor.

Veja o arquivo [`LICENSE`](./LICENSE) para o texto legal completo (em inglês).
