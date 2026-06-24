<div align="center">

# 🧠 KOGNIT Router

**Router OpenAI-compatible com painel web para provedores OAuth, API keys e sessões.**

Una vários provedores de IA numa única API compatível com OpenAI — com painel de gerenciamento, solver de CAPTCHA, túnel público e analytics de uso.

[![License: PolyForm Noncommercial](https://img.shields.io/badge/License-PolyForm%20NC-orange.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/Node-22-339933?logo=node.js&logoColor=white)](#rodar-localmente)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](#rodar-localmente)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](#docker)
[![Discord](https://img.shields.io/badge/Discord-kognit-5865F2?logo=discord&logoColor=white)](https://discord.gg/kcNdRpx8ct)

</div>

---

## ✨ O que é

O KOGNIT Router é um **proxy/gateway** que expõe uma API compatível com OpenAI (`/v1/chat/completions`, `/v1/messages`, `/v1/models`) e roteia as requisições para os provedores que você configurar — sejam eles via OAuth, API key ou sessão.

Ele vem com um **painel web** (React) onde você conecta provedores, acompanha uso, resolve CAPTCHAs e abre um túnel público pro seu ambiente local.

## 🚀 Recursos

- 🔌 **Multi-provedor** — conecte vários provedores e use todos pela mesma API
- 🌐 **API compatível com OpenAI** — funciona com qualquer cliente que fale OpenAI/Anthropic
- 🪟 **Painel web** — gerencie conexões, chaves e models num único lugar
- 🔐 **OAuth, API key e sessão** — suporta os três tipos de autenticação
- 🤖 **Solver de CAPTCHA** — para provedores que exigem validação humana (Z.ai)
- 📊 **Analytics de uso** — acompanhe consumo por conexão e por rota
- 🌍 **Túnel público** — exponha sua instância local via Cloudflare
- 🐳 **Pronto pra deploy** — Docker, Docker Compose e Render

## 🤝 Provedores suportados

| Provedor | Tipo | Auth |
|---|---|---|
| **Z.ai / ZCode** | Chat | OAuth + sessão + CAPTCHA |
| **Claude** (Anthropic) | Chat | OAuth / API key |
| **Gemini** (Google) | Chat | OAuth / API key |
| **Copilot** (GitHub) | Chat | OAuth |
| **Kiro** | Chat | OAuth |
| **DeepSeek** | Chat | API key |
| **OpenAI / Codex** | Chat | API key |
| **Custom** | OpenAI-compatible | API key |

> Os models disponíveis (ex: Claude Sonnet 4.6, Gemini 3.5 Flash, DeepSeek V4) são resolvidos automaticamente a partir do provedor conectado.

## 📦 Rodar localmente

> Requer **Node 22+**.

```bash
npm install
npm run dev
```

| Serviço | URL |
|---|---|
| Painel + API | `http://localhost:3001` |
| Endpoint OpenAI-compatible | `http://localhost:3001/v1` |

## 🐳 Docker

```bash
docker compose up --build
```

O painel fica disponível em `http://localhost:3001`.

> ℹ️ O container não abre navegador próprio para CAPTCHA. Quando a Z.ai exigir clique humano, abra o provider **ZCode** no painel e use a caixa **"Solver CAPTCHA Z.ai"** ou acesse `/zcode/captcha/browser?client=standalone-browser`.

## ☁️ Deploy

O projeto já vem configurado para:

- **Render** — via [`render.yaml`](./render.yaml) (Docker, health check e disco inclusos)
- **Docker / Compose** — via [`Dockerfile`](./Dockerfile) e [`compose.yaml`](./compose.yaml)

### Variáveis de ambiente principais

| Variável | Descrição | Padrão |
|---|---|---|
| `PORT` | Porta do servidor | `10000` (prod) / `3001` (dev) |
| `KOGNIT_DATA_FILE` | Arquivo de dados | `/var/data/kognit/data.json` |
| `KOGNIT_PUBLIC_ORIGIN` | Origem pública (túnel) | — |
| `KOGNIT_ZCODE_ACCOUNTS_JSON` | Contas Z.ai (JSON) | — |
| `ZCODE_CAPTCHA_HEADLESS` | CAPTCHA headless | `false` |
| `ZCODE_CAPTCHA_CLIENT_PREFERENCE` | Cliente CAPTCHA | `standalone-browser` |

## 🔗 API

```bash
# Listar models disponíveis
curl http://localhost:3001/v1/models \
  -H "Authorization: Bearer SUA_KEY"

# Chat (compatível com OpenAI)
curl http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer SUA_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4.6","messages":[{"role":"user","content":"oi"}]}'
```

Crie e gerencie suas API keys direto pelo painel (`http://localhost:3001`).

## 📄 Licença

Copyright (c) 2026 **Panhard-Dev**. Todos os direitos reservados.

Este projeto usa a **[PolyForm Noncommercial License 1.0.0](./LICENSE)**.

| Pode? | Como |
|---|---|
| ✅ Usar, estudar e modificar | Para fins pessoais, pesquisa, estudo, hobby e divulgação não-comercial |
| ✅ Redistribuir | Desde que mantenha o aviso de copyright |
| ❌ Uso comercial / venda | **Proibido** sem licença comercial por escrito do autor |

**Uso comercial** exige licença separada por escrito com o autor.

## 🔒 Segurança

Encontrou uma vulnerabilidade? Veja a **[Política de Segurança](./SECURITY.md)** — reporte em privado via Discord, **não** abra issue pública.

## 💬 Comunidade

Tem dúvida ou quer contribuir? Entra no nosso **[Discord](https://discord.gg/kcNdRpx8ct)**.

---

<div align="center">

Feito com 🧠 por **Panhard-Dev**

</div>
