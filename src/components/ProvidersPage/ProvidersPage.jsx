import { useEffect, useMemo, useState } from 'react'
import './ProvidersPage.css'

const API = '/api'

const simpleIconUrl = (slug) =>
  `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/${slug}.svg`

const faviconUrl = (domain) =>
  `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(domain)}`

const sections = [
  {
    title: 'OAuth Providers',
    description: 'Login via conta oficial do app ou CLI.',
    category: 'oauth',
    providers: [
      { id: 'antigravity', name: 'Antigravity', domain: 'https://antigravity.google', logo: true, color: '#4285f4', connectionMode: 'oauth' },
      { id: 'claude-code', name: 'Claude Code', domain: 'https://www.anthropic.com', icon: 'claude', color: '#d97757', connectionMode: 'oauth' },
      { id: 'openai-codex', name: 'OpenAI Codex', domain: 'https://openai.com', icon: 'openai', color: '#10a37f', connectionMode: 'oauth' },
      { id: 'github-copilot', name: 'GitHub Copilot', domain: 'https://github.com/features/copilot', icon: 'githubcopilot', color: '#79f2c0', connectionMode: 'oauth' },
      { id: 'cursor-ide', name: 'Cursor IDE', domain: 'https://cursor.com', icon: 'cursor', color: '#8b8cff', connectionMode: 'oauth' },
      { id: 'kilo-code', name: 'Kilo Code', domain: 'https://kilocode.ai', color: '#8b5cf6', connectionMode: 'oauth' },
      { id: 'cline', name: 'Cline', domain: 'https://cline.bot', icon: 'cline', color: '#52a8ff', connectionMode: 'oauth' },
      { id: 'zcode-ai', name: 'ZCode / Z.ai', domain: 'https://zcode.z.ai', logo: '/providers/zcode.png', color: '#2563EB', connectionMode: 'oauth' },
    ],
  },
  {
    title: 'Free Tier Providers',
    description: 'Servicos com camada gratuita, creditos ou uso local/free.',
    category: 'free-tier',
    providers: [
      { id: 'kiro-ai', name: 'Kiro AI', domain: 'https://kiro.dev', logo: true, color: '#8b5cf6', connectionMode: 'oauth' },
      { id: 'gemini-cli', name: 'Gemini CLI', domain: 'https://ai.google.dev/gemini-api/docs/cli', icon: 'googlegemini', color: '#8ab4f8', connectionMode: 'oauth' },
      { id: 'opencode-free', name: 'OpenCode Free', domain: 'https://opencode.ai', logo: 'https://opencode.ai/favicon.svg', color: '#ffffff', connectionMode: 'public', defaultBaseUrl: 'https://opencode.ai/zen/v1' },
      { id: 'openrouter-free', name: 'OpenRouter', domain: 'https://openrouter.ai', icon: 'openrouter', color: '#7c8cff', connectionMode: 'api-key', defaultBaseUrl: 'https://openrouter.ai/api/v1' },
      { id: 'nvidia-nim', name: 'NVIDIA NIM', domain: 'https://build.nvidia.com', icon: 'nvidia', color: '#76b900', connectionMode: 'api-key', defaultBaseUrl: 'https://integrate.api.nvidia.com/v1' },
      { id: 'ollama-cloud', name: 'Ollama Cloud', domain: 'https://ollama.com', icon: 'ollama', color: '#a3e635', connectionMode: 'api-key', defaultBaseUrl: 'https://ollama.com/api' },
      { id: 'vertex', name: 'Vertex', domain: 'https://cloud.google.com/vertex-ai', icon: 'googlecloud', color: '#4285f4', connectionMode: 'api-key', defaultBaseUrl: 'https://aiplatform.googleapis.com/v1' },
      { id: 'gemini', name: 'Gemini', domain: 'https://gemini.google.com', icon: 'googlegemini', color: '#8ab4f8', connectionMode: 'api-key', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
      { id: 'cloudflare', name: 'Cloudflare', domain: 'https://cloudflare.com', icon: 'cloudflare', color: '#f38020', connectionMode: 'api-key', defaultBaseUrl: 'https://api.cloudflare.com/client/v4' },
      { id: 'byteplus-modelark', name: 'BytePlus ModelArk', domain: 'https://www.byteplus.com', logo: true, color: '#1664ff', connectionMode: 'api-key', defaultBaseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3' },
    ],
  },
  {
    title: 'API Key Providers',
    description: 'Provedores que entram com Base URL e API key.',
    category: 'api-key',
    providers: [
      { id: 'openai', name: 'OpenAI', domain: 'https://openai.com', icon: 'openai', color: '#10a37f', connectionMode: 'api-key', defaultBaseUrl: 'https://api.openai.com/v1' },
      { id: 'anthropic', name: 'Anthropic', domain: 'https://www.anthropic.com', icon: 'anthropic', color: '#d97757', connectionMode: 'api-key', defaultBaseUrl: 'https://api.anthropic.com/v1' },
      { id: 'google-ai-studio', name: 'Google AI Studio', domain: 'https://aistudio.google.com', icon: 'google', color: '#4285f4', connectionMode: 'api-key', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
      { id: 'openrouter', name: 'OpenRouter', domain: 'https://openrouter.ai', icon: 'openrouter', color: '#7c8cff', connectionMode: 'api-key', defaultBaseUrl: 'https://openrouter.ai/api/v1' },
      { id: 'groq', name: 'Groq', domain: 'https://groq.com', color: '#ff6b35', connectionMode: 'api-key', defaultBaseUrl: 'https://api.groq.com/openai/v1' },
      { id: 'mistral-ai', name: 'Mistral AI', domain: 'https://mistral.ai', icon: 'mistralai', color: '#ff7000', connectionMode: 'api-key', defaultBaseUrl: 'https://api.mistral.ai/v1' },
      { id: 'deepseek', name: 'DeepSeek', domain: 'https://deepseek.com', icon: 'deepseek', color: '#4d6bfe', connectionMode: 'api-key', defaultBaseUrl: 'https://api.deepseek.com/v1' },
      { id: 'xai', name: 'xAI', domain: 'https://x.ai', icon: 'x', color: '#f5f5f5', connectionMode: 'api-key', defaultBaseUrl: 'https://api.x.ai/v1' },
      { id: 'cohere', name: 'Cohere', domain: 'https://cohere.com', color: '#39a275', connectionMode: 'api-key', defaultBaseUrl: 'https://api.cohere.com/v2' },
      { id: 'together-ai', name: 'Together AI', domain: 'https://together.ai', color: '#ff4d8d', connectionMode: 'api-key', defaultBaseUrl: 'https://api.together.xyz/v1' },
      { id: 'perplexity', name: 'Perplexity', domain: 'https://perplexity.ai', icon: 'perplexity', color: '#20b8cd', connectionMode: 'api-key', defaultBaseUrl: 'https://api.perplexity.ai' },
      { id: 'fireworks-ai', name: 'Fireworks AI', domain: 'https://fireworks.ai', color: '#ff4f2e', connectionMode: 'api-key', defaultBaseUrl: 'https://api.fireworks.ai/inference/v1' },
      { id: 'cerebras', name: 'Cerebras', domain: 'https://cerebras.ai', color: '#f5b700', connectionMode: 'api-key', defaultBaseUrl: 'https://api.cerebras.ai/v1' },
      { id: 'replicate', name: 'Replicate', domain: 'https://replicate.com', icon: 'replicate', color: '#a78bfa', connectionMode: 'api-key', defaultBaseUrl: 'https://api.replicate.com/v1' },
      { id: 'hugging-face', name: 'Hugging Face', domain: 'https://huggingface.co', icon: 'huggingface', color: '#ffcc4d', connectionMode: 'api-key', defaultBaseUrl: 'https://api-inference.huggingface.co' },
      { id: 'azure-openai', name: 'Azure OpenAI', domain: 'https://azure.microsoft.com/products/ai-services/openai-service', icon: 'microsoft', color: '#0078d4', connectionMode: 'api-key' },
      { id: 'aws-bedrock', name: 'AWS Bedrock', domain: 'https://aws.amazon.com/bedrock', icon: 'amazon', color: '#ff9900', connectionMode: 'api-key' },
      { id: 'nvidia-nim-api', name: 'NVIDIA NIM', domain: 'https://build.nvidia.com', icon: 'nvidia', color: '#76b900', connectionMode: 'api-key', defaultBaseUrl: 'https://integrate.api.nvidia.com/v1' },
      { id: 'cloudflare-workers-ai', name: 'Cloudflare Workers AI', domain: 'https://developers.cloudflare.com/workers-ai', icon: 'cloudflare', color: '#f38020', connectionMode: 'api-key', defaultBaseUrl: 'https://api.cloudflare.com/client/v4' },
      { id: 'byteplus-modelark-api', name: 'BytePlus ModelArk', domain: 'https://www.byteplus.com/en/product/modelark', logo: true, color: '#1664ff', connectionMode: 'api-key', defaultBaseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3' },
    ],
  },
  {
    title: 'Browser Session Providers',
    description: 'Provedores usados por sessao de navegador autenticada.',
    category: 'browser-session',
    providers: [
      { id: 'chatgpt', name: 'ChatGPT', domain: 'https://chatgpt.com', icon: 'openai', color: '#10a37f', connectionMode: 'browser-session' },
      { id: 'claude-web', name: 'Claude', domain: 'https://claude.ai', icon: 'claude', color: '#d97757', connectionMode: 'browser-session' },
      { id: 'gemini-web', name: 'Gemini Web', domain: 'https://gemini.google.com', icon: 'googlegemini', color: '#8ab4f8', connectionMode: 'browser-session' },
      { id: 'qwen-chat', name: 'Qwen Chat', domain: 'https://chat.qwen.ai', logo: true, color: '#615ced', connectionMode: 'browser-session' },
      { id: 'kimi', name: 'Kimi', domain: 'https://kimi.moonshot.cn', logo: true, color: '#2dd4bf', connectionMode: 'browser-session' },
      { id: 'deepseek-chat', name: 'DeepSeek Chat', domain: 'https://chat.deepseek.com', icon: 'deepseek', color: '#4d6bfe', connectionMode: 'browser-session' },
      { id: 'z-ai', name: 'Z.ai', domain: 'https://z.ai', logo: true, color: '#9ca3ff', connectionMode: 'browser-session' },
      { id: 'grok', name: 'Grok', domain: 'https://grok.com', icon: 'x', color: '#f5f5f5', connectionMode: 'browser-session' },
      { id: 'perplexity-web', name: 'Perplexity', domain: 'https://perplexity.ai', icon: 'perplexity', color: '#20b8cd', connectionMode: 'browser-session' },
      { id: 'poe', name: 'Poe', domain: 'https://poe.com', logo: true, color: '#6b7280', connectionMode: 'browser-session' },
    ],
  },
]

const modelCatalog = {
  'antigravity': ['antigravity/auto', 'antigravity/coder', 'antigravity/planner'],
  'claude-code': ['claude-opus-4.7', 'claude-opus-4.7-thinking', 'claude-sonnet-4.6', 'claude-sonnet-4.6-thinking', 'claude-haiku-4.5'],
  'openai-codex': ['gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2', 'o4-mini', 'gpt-4.1'],
  'github-copilot': ['copilot/auto', 'copilot/gpt-5', 'copilot/claude-sonnet', 'copilot/gemini-pro'],
  'cursor-ide': ['cursor/auto', 'cursor/fast', 'cursor/reasoning', 'cursor/coding'],
  'kilo-code': ['kilo/auto', 'kilo/code', 'kilo/reasoning'],
  'cline': ['cline/auto', 'cline/sonnet', 'cline/gemini', 'cline/local'],
  'kiro-ai': ['kiro/auto', 'kiro/spec', 'kiro/agent'],
  'gemini-cli': ['gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview', 'gemini-3-flash-preview', 'gemini-2.0-flash-lite'],
  'opencode-free': ['oc/mimo-v2.5-free', 'oc/deepseek-v4-flash-free', 'oc/minimax-m3-free', 'oc/minimax-m2.5-free', 'oc/qwen3.6-plus-free', 'oc/nemotron-3-super-free'],
  'openrouter-free': ['openrouter/auto', 'anthropic/claude-sonnet-4.6', 'anthropic/claude-opus-4.6', 'openai/gpt-5.4', 'google/gemini-3.1-pro-preview', 'deepseek/deepseek-chat', 'qwen/qwen3-coder'],
  'nvidia-nim': ['minimaxai/minimax-m2.7', 'z-ai/glm4.7', 'nvidia/llama-3.3-nemotron-super-49b-v1.5', 'nvidia/llama-3.1-nemotron-ultra-253b-v1', 'nvidia/nemotron-3-super', 'nvidia/qwen3-next'],
  'ollama-cloud': ['gpt-oss:120b', 'kimi-k2.5', 'glm-5', 'minimax-m2.5', 'glm-4.7-flash', 'qwen3.5'],
  'vertex': ['gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'],
  'gemini': ['gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemma-4-31b-it'],
  'cloudflare': ['@cf/meta/llama-3.2-1b-instruct', '@cf/meta/llama-3.2-3b-instruct', '@cf/meta/llama-3.1-8b-instruct-fp8-fast', '@cf/meta/llama-3.1-70b-instruct-fp8-fast', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/qwen/qwen2.5-coder-32b-instruct', '@cf/qwen/qwq-32b', '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', '@cf/mistral/mistral-small-3.1-24b-instruct', '@cf/moonshotai/kimi-k2.5', '@cf/moonshotai/kimi-k2.6', '@cf/zai-org/glm-4.7-flash'],
  'byteplus-modelark': ['Doubao-Seed-2.0-Code', 'Doubao-Seed-2.0-pro', 'Doubao-Seed-2.0-lite', 'Doubao-Seed-Code', 'GLM-5.1', 'MiniMax-M2.7', 'Kimi-K2.6', 'MiniMax-M2.5', 'Kimi-K2.5', 'GLM-4.7', 'DeepSeek-V3.2', 'modelark/seed-1.6', 'modelark/deepseek-r1'],
  'openai': ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.3-codex', 'gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o3', 'o3-mini', 'o3-pro', 'o4-mini', 'o1', 'o1-mini'],
  'anthropic': ['claude-opus-4.7', 'claude-opus-4.7-thinking', 'claude-sonnet-4.6', 'claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-haiku-4.5', 'claude-3-5-sonnet-20241022'],
  'google-ai-studio': ['gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemma-4-31b-it'],
  'openrouter': ['openrouter/auto', 'anthropic/claude-sonnet-4.6', 'anthropic/claude-opus-4.6', 'openai/gpt-5.4', 'google/gemini-3.1-pro-preview', 'deepseek/deepseek-chat', 'qwen/qwen3-coder', 'openai/text-embedding-3-large', 'openai/text-embedding-3-small'],
  'groq': ['groq/llama-3.3-70b-versatile', 'groq/openai/gpt-oss-120b', 'groq/qwen/qwen3-32b', 'groq/deepseek-r1-distill-llama-70b'],
  'mistral-ai': ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'codestral-latest', 'ministral-8b-latest', 'mistral-embed'],
  'deepseek': ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'],
  'xai': ['grok-4', 'grok-4-fast', 'grok-code-fast-1', 'grok-3-mini'],
  'cohere': ['command-a-03-2025', 'command-r-plus-08-2024', 'command-r-08-2024', 'command-a', 'command-r-plus', 'command-r', 'command-light'],
  'together-ai': ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen3-235B-A22B', 'Qwen/Qwen3-Coder-480B-A35B-Instruct', 'mistralai/Mixtral-8x22B-Instruct-v0.1'],
  'perplexity': ['sonar', 'sonar-pro', 'sonar-reasoning', 'sonar-reasoning-pro'],
  'fireworks-ai': ['accounts/fireworks/models/deepseek-v3p1', 'accounts/fireworks/models/llama-v3p3-70b-instruct', 'accounts/fireworks/models/qwen3-235b-a22b', 'accounts/fireworks/models/llama-v3p1-405b-instruct', 'accounts/fireworks/models/deepseek-r1', 'accounts/fireworks/models/qwen3-coder', 'accounts/fireworks/models/kimi-k2-instruct'],
  'cerebras': ['gpt-oss-120b', 'zai-glm-4.7', 'llama-3.3-70b', 'llama-4-scout-17b-16e-instruct', 'qwen-3-235b-a22b-instruct-2507', 'qwen-3-32b', 'llama3.1-8b'],
  'replicate': ['replicate/meta/llama-3.3-70b-instruct', 'replicate/black-forest-labs/flux-schnell', 'replicate/deepseek-ai/deepseek-r1'],
  'hugging-face': ['huggingface/auto', 'Qwen/Qwen3-Coder', 'deepseek-ai/DeepSeek-R1', 'meta-llama/Llama-3.3-70B-Instruct'],
  'azure-openai': ['azure/gpt-5.4', 'azure/gpt-5.2', 'azure/gpt-4.1', 'azure/o4-mini'],
  'aws-bedrock': ['anthropic.claude-opus-4-7', 'anthropic.claude-sonnet-4-6', 'amazon.nova-pro', 'meta.llama3-3-70b-instruct', 'mistral.mistral-large'],
  'nvidia-nim-api': ['minimaxai/minimax-m2.7', 'z-ai/glm4.7', 'nvidia/llama-3.3-nemotron-super-49b-v1.5', 'nvidia/llama-3.1-nemotron-ultra-253b-v1', 'nvidia/nemotron-3-super', 'nvidia/qwen3-next'],
  'cloudflare-workers-ai': ['@cf/meta/llama-3.2-1b-instruct', '@cf/meta/llama-3.2-3b-instruct', '@cf/meta/llama-3.1-8b-instruct-fp8-fast', '@cf/meta/llama-3.1-70b-instruct-fp8-fast', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/qwen/qwen2.5-coder-32b-instruct', '@cf/qwen/qwq-32b', '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', '@cf/mistral/mistral-small-3.1-24b-instruct', '@cf/moonshotai/kimi-k2.5', '@cf/moonshotai/kimi-k2.6', '@cf/zai-org/glm-4.7-flash'],
  'byteplus-modelark-api': ['Doubao-Seed-2.0-Code', 'Doubao-Seed-2.0-pro', 'Doubao-Seed-2.0-lite', 'Doubao-Seed-Code', 'GLM-5.1', 'MiniMax-M2.7', 'Kimi-K2.6', 'MiniMax-M2.5', 'Kimi-K2.5', 'GLM-4.7', 'DeepSeek-V3.2', 'modelark/seed-1.6', 'modelark/deepseek-r1'],
  'chatgpt': ['chatgpt/auto', 'gpt-5.4', 'gpt-5.2', 'gpt-4.1'],
  'claude-web': ['claude-opus-4.7', 'claude-sonnet-4.6', 'claude-haiku-4.5'],
  'gemini-web': ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro'],
  'qwen-chat': ['qwen3-coder-plus', 'qwen3-max', 'qwen3-plus', 'qwen3-flash'],
  'kimi': ['kimi-k2.6', 'kimi-k2.5', 'kimi-k2.5-thinking', 'kimi-latest', 'kimi-k2-turbo-preview', 'moonshot-v1-128k'],
  'deepseek-chat': ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'],
  'z-ai': ['glm-5', 'glm-4.7-flash', 'glm-z1'],
  'grok': ['grok-3', 'grok-3-mini', 'grok-3-thinking', 'grok-4', 'grok-4-mini', 'grok-4-thinking', 'grok-4-heavy', 'grok-4.1-mini', 'grok-4.1-fast', 'grok-4.1-expert', 'grok-4.1-thinking', 'grok-4.2', 'grok-4-fast', 'grok-code-fast-1'],
  'perplexity-web': ['pplx-auto', 'pplx-sonar', 'pplx-gpt', 'pplx-gemini', 'pplx-sonnet', 'pplx-opus', 'pplx-nemotron', 'sonar', 'sonar-pro', 'sonar-reasoning', 'sonar-reasoning-pro'],
  'poe': ['poe/auto', 'poe/claude', 'poe/gpt', 'poe/gemini'],
}

const routerModelCatalog = {
  'antigravity': [
    { id: 'ag/gemini-3-flash-agent', name: 'Gemini 3.5 Flash High', upstreamId: 'gemini-3-flash-agent' },
    { id: 'ag/gemini-3.5-flash-low', name: 'Gemini 3.5 Flash Medium', upstreamId: 'gemini-3.5-flash-low' },
    { id: 'ag/gemini-pro-agent', name: 'Gemini 3.1 Pro High', upstreamId: 'gemini-pro-agent' },
    { id: 'ag/gemini-3.1-pro-low', name: 'Gemini 3.1 Pro Low', upstreamId: 'gemini-3.1-pro-low' },
    { id: 'ag/claude-sonnet-4-6', name: 'Claude Sonnet 4.6 Thinking', upstreamId: 'claude-sonnet-4-6' },
    { id: 'ag/claude-opus-4-6-thinking', name: 'Claude Opus 4.6 Thinking', upstreamId: 'claude-opus-4-6-thinking' },
    { id: 'ag/gpt-oss-120b-medium', name: 'GPT OSS 120B Medium', upstreamId: 'gpt-oss-120b-medium' },
    { id: 'ag/gemini-3-flash', name: 'Gemini 3 Flash', upstreamId: 'gemini-3-flash' },
  ],
  'claude-code': [
    { id: 'cc/claude-opus-4-7', name: 'Claude Opus 4.7' },
    { id: 'cc/claude-opus-4-6', name: 'Claude Opus 4.6' },
    { id: 'cc/claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
    { id: 'cc/claude-opus-4-5-20251101', name: 'Claude 4.5 Opus' },
    { id: 'cc/claude-sonnet-4-5-20250929', name: 'Claude 4.5 Sonnet' },
    { id: 'cc/claude-haiku-4-5-20251001', name: 'Claude 4.5 Haiku' },
  ],
  'openai-codex': [
    { id: 'cx/gpt-5.5', name: 'GPT 5.5' },
    { id: 'cx/gpt-5.4', name: 'GPT 5.4' },
    { id: 'cx/gpt-5.3-codex', name: 'GPT 5.3 Codex' },
    { id: 'cx/gpt-5.3-codex-xhigh', name: 'GPT 5.3 Codex xHigh' },
    { id: 'cx/gpt-5.3-codex-high', name: 'GPT 5.3 Codex High' },
    { id: 'cx/gpt-5.3-codex-low', name: 'GPT 5.3 Codex Low' },
    { id: 'cx/gpt-5.3-codex-none', name: 'GPT 5.3 Codex None' },
    { id: 'cx/gpt-5.3-codex-spark', name: 'GPT 5.3 Codex Spark' },
    { id: 'cx/gpt-5.1-codex-mini', name: 'GPT 5.1 Codex Mini' },
    { id: 'cx/gpt-5.1-codex-mini-high', name: 'GPT 5.1 Codex Mini High' },
    { id: 'cx/gpt-5.2-codex', name: 'GPT 5.2 Codex' },
    { id: 'cx/gpt-5.2', name: 'GPT 5.2' },
    { id: 'cx/gpt-5.1-codex-max', name: 'GPT 5.1 Codex Max' },
    { id: 'cx/gpt-5.1-codex', name: 'GPT 5.1 Codex' },
    { id: 'cx/gpt-5.1', name: 'GPT 5.1' },
    { id: 'cx/gpt-5-codex', name: 'GPT 5 Codex' },
    { id: 'cx/gpt-5-codex-mini', name: 'GPT 5 Codex Mini' },
  ],
  'github-copilot': [
    { id: 'gh/gpt-3.5-turbo', name: 'GPT 3.5 Turbo' },
    { id: 'gh/gpt-4', name: 'GPT 4' },
    { id: 'gh/gpt-4o', name: 'GPT 4o' },
    { id: 'gh/gpt-4o-mini', name: 'GPT 4o Mini' },
    { id: 'gh/gpt-4.1', name: 'GPT 4.1' },
    { id: 'gh/gpt-5-mini', name: 'GPT 5 Mini' },
    { id: 'gh/gpt-5.4', name: 'GPT 5.4' },
    { id: 'gh/gpt-5.4-mini', name: 'GPT 5.4 Mini' },
    { id: 'gh/gpt-5.3-codex', name: 'GPT 5.3 Codex' },
    { id: 'gh/gpt-5.2-codex', name: 'GPT 5.2 Codex' },
    { id: 'gh/gpt-5.2', name: 'GPT 5.2' },
    { id: 'gh/claude-haiku-4.5', name: 'Claude Haiku 4.5' },
    { id: 'gh/claude-opus-4.5', name: 'Claude Opus 4.5' },
    { id: 'gh/claude-sonnet-4', name: 'Claude Sonnet 4' },
    { id: 'gh/claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
    { id: 'gh/claude-opus-4.7', name: 'Claude Opus 4.7' },
    { id: 'gh/claude-opus-4.6', name: 'Claude Opus 4.6' },
    { id: 'gh/claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
    { id: 'gh/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    { id: 'gh/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro' },
    { id: 'gh/gemini-3-flash-preview', name: 'Gemini 3 Flash' },
    { id: 'gh/grok-code-fast-1', name: 'Grok Code Fast 1' },
    { id: 'gh/oswe-vscode-prime', name: 'Raptor Mini' },
    { id: 'gh/goldeneye-free-auto', name: 'GoldenEye' },
  ],
  'cursor-ide': [
    { id: 'cu/default', name: 'Auto Server Picks' },
    { id: 'cu/claude-4.5-opus-high-thinking', name: 'Claude 4.5 Opus High Thinking' },
    { id: 'cu/claude-4.5-opus-high', name: 'Claude 4.5 Opus High' },
    { id: 'cu/claude-4.5-sonnet-thinking', name: 'Claude 4.5 Sonnet Thinking' },
    { id: 'cu/claude-4.5-sonnet', name: 'Claude 4.5 Sonnet' },
    { id: 'cu/claude-4.5-haiku', name: 'Claude 4.5 Haiku' },
    { id: 'cu/claude-4.5-opus', name: 'Claude 4.5 Opus' },
    { id: 'cu/gpt-5.2-codex', name: 'GPT 5.2 Codex' },
    { id: 'cu/claude-4.6-opus-max', name: 'Claude 4.6 Opus Max' },
    { id: 'cu/claude-4.6-sonnet-medium-thinking', name: 'Claude 4.6 Sonnet Medium Thinking' },
    { id: 'cu/kimi-k2.5', name: 'Kimi K2.5' },
    { id: 'cu/gpt-5.3-codex', name: 'GPT 5.3 Codex' },
    { id: 'cu/gemini-3-flash-preview', name: 'Gemini 3 Flash Preview' },
    { id: 'cu/gpt-5.2', name: 'GPT 5.2' },
  ],
  'kilo-code': [
    { id: 'kc/anthropic/claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
    { id: 'kc/anthropic/claude-opus-4-20250514', name: 'Claude Opus 4' },
    { id: 'kc/google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    { id: 'kc/google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'kc/openai/gpt-4.1', name: 'GPT-4.1' },
    { id: 'kc/openai/o3', name: 'o3' },
    { id: 'kc/deepseek/deepseek-chat', name: 'DeepSeek Chat' },
    { id: 'kc/deepseek/deepseek-reasoner', name: 'DeepSeek Reasoner' },
  ],
  'cline': [
    { id: 'cl/anthropic/claude-opus-4.7', name: 'Claude Opus 4.7' },
    { id: 'cl/anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
    { id: 'cl/anthropic/claude-opus-4.6', name: 'Claude Opus 4.6' },
    { id: 'cl/openai/gpt-5.3-codex', name: 'GPT-5.3 Codex' },
    { id: 'cl/openai/gpt-5.4', name: 'GPT-5.4' },
    { id: 'cl/google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview' },
    { id: 'cl/google/gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite Preview' },
    { id: 'cl/kwaipilot/kat-coder-pro', name: 'KAT Coder Pro' },
  ],
  'kiro-ai': [
    { id: 'kr/claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
    { id: 'kr/claude-haiku-4.5', name: 'Claude Haiku 4.5' },
    { id: 'kr/deepseek-3.2', name: 'DeepSeek 3.2' },
    { id: 'kr/qwen3-coder-next', name: 'Qwen3 Coder Next' },
    { id: 'kr/glm-5', name: 'GLM 5' },
    { id: 'kr/MiniMax-M2.5', name: 'MiniMax M2.5' },
    { id: 'kr/claude-sonnet-4.5-thinking', name: 'Claude Sonnet 4.5 Thinking' },
    { id: 'kr/claude-haiku-4.5-thinking', name: 'Claude Haiku 4.5 Thinking' },
    { id: 'kr/claude-sonnet-4.5-agentic', name: 'Claude Sonnet 4.5 Agentic' },
    { id: 'kr/claude-haiku-4.5-agentic', name: 'Claude Haiku 4.5 Agentic' },
    { id: 'kr/claude-sonnet-4.5-thinking-agentic', name: 'Claude Sonnet 4.5 Thinking Agentic' },
    { id: 'kr/claude-haiku-4.5-thinking-agentic', name: 'Claude Haiku 4.5 Thinking Agentic' },
  ],
  'gemini-cli': [
    { id: 'gc/gemini-3-flash-preview', name: 'Gemini 3 Flash Preview' },
    { id: 'gc/gemini-3-pro-preview', name: 'Gemini 3 Pro Preview' },
  ],
  'zcode-ai': [
    { id: 'zc/GLM-5.2', name: 'GLM-5.2', upstreamId: 'GLM-5.2' },
    { id: 'zc/GLM-5-Turbo', name: 'GLM-5-Turbo', upstreamId: 'GLM-5-Turbo' },
  ],
}

const modeLabels = {
  'oauth': 'OAuth / CLI token',
  'api-key': 'API key',
  'public': 'Public free',
  'browser-session': 'Browser session',
}

const browserOAuthProviders = new Set(['antigravity', 'claude-code', 'openai-codex', 'gemini-cli', 'cline', 'zcode-ai'])
const deviceOAuthProviders = new Set(['github-copilot', 'kiro-ai', 'kilo-code'])
const importOAuthProviders = new Set(['cursor-ide'])

function getConnectionFlow(provider) {
  if (browserOAuthProviders.has(provider.id)) return 'browser'
  if (deviceOAuthProviders.has(provider.id)) return 'device'
  if (importOAuthProviders.has(provider.id)) return 'import'
  return provider.connectionMode
}

const flowLabels = {
  browser: 'Login via browser',
  device: 'Device-code login',
  import: 'Import token',
  'api-key': 'API key',
  public: 'Public free',
  'browser-session': 'Browser session',
}

function getProviderModels(provider) {
  const models = routerModelCatalog[provider.id] || modelCatalog[provider.id] || [`${provider.id}/auto`, `${provider.id}/chat`, `${provider.id}/code`]
  return models.map(normalizeModelEntry)
}

function normalizeModelEntry(model) {
  if (typeof model === 'string') {
    return { id: model, name: readableModelName(model) }
  }
  return {
    id: model.id,
    name: model.name || readableModelName(model.id),
    upstreamId: model.upstreamId || model.id,
    type: model.type || 'llm',
  }
}

function readableModelName(modelId) {
  return String(modelId)
    .split('/')
    .pop()
    .replace(/[-_:]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

function getAuthType(provider) {
  if (provider.connectionMode === 'oauth') return 'oauth'
  if (provider.connectionMode === 'browser-session') return 'browser_session'
  if (provider.connectionMode === 'public') return 'public'
  return 'apikey'
}

function groupConnections(connections) {
  return connections.reduce((grouped, connection) => {
    const current = grouped[connection.providerId] || []
    return { ...grouped, [connection.providerId]: [...current, connection] }
  }, {})
}

function formatDate(value) {
  if (!value) return 'never'
  return new Date(value).toLocaleString('pt-BR')
}

function ProviderCard({ provider, connectedCount, onSelect }) {
  const providerColor = provider.color || '#8b5cf6'
  const logo = provider.logo === true ? faviconUrl(provider.domain) : provider.logo
  const iconStyle = provider.icon
    ? {
        WebkitMaskImage: `url(${simpleIconUrl(provider.icon)})`,
        maskImage: `url(${simpleIconUrl(provider.icon)})`,
        backgroundColor: providerColor,
      }
    : null

  return (
    <button className="provider-card" type="button" style={{ '--provider-color': providerColor }} onClick={() => onSelect(provider)}>
      <span className={`provider-card__logo ${provider.icon ? 'provider-card__logo--icon' : ''}`} aria-hidden="true">
        <span className="provider-card__fallback" />
        {provider.icon ? (
          <span className="provider-card__mark" style={iconStyle} />
        ) : logo ? (
          <img
            className="provider-card__image"
            src={logo}
            alt=""
            loading="lazy"
            onError={(event) => {
              event.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <span className="provider-card__spark" />
        )}
      </span>
      <span className="provider-card__content">
        <span className="provider-card__name">{provider.name}</span>
        <span className="provider-card__mode">{flowLabels[getConnectionFlow(provider)] || modeLabels[provider.connectionMode]}</span>
      </span>
      {connectedCount > 0 && <span className="provider-card__count">{connectedCount}</span>}
    </button>
  )
}

function ProviderLogo({ provider, size = 'normal' }) {
  const providerColor = provider.color || '#8b5cf6'
  const logo = provider.logo === true ? faviconUrl(provider.domain) : provider.logo
  const iconStyle = provider.icon
    ? {
        WebkitMaskImage: `url(${simpleIconUrl(provider.icon)})`,
        maskImage: `url(${simpleIconUrl(provider.icon)})`,
        backgroundColor: providerColor,
      }
    : null

  return (
    <span className={`provider-card__logo provider-card__logo--${size} ${provider.icon ? 'provider-card__logo--icon' : ''}`} style={{ '--provider-color': providerColor }} aria-hidden="true">
      <span className="provider-card__fallback" />
      {provider.icon ? (
        <span className="provider-card__mark" style={iconStyle} />
      ) : logo ? (
        <img
          className="provider-card__image"
          src={logo}
          alt=""
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
      ) : (
        <span className="provider-card__spark" />
      )}
    </span>
  )
}

function ProviderDetail({
  provider,
  onBack,
  connections,
  settings,
  onOpenAdd,
  onToggleRoundRobin,
  onToggleConnection,
  onDeleteConnection,
  onTestConnection,
  onTestModel,
  busyConnectionId,
  busyModelKey,
  modelTests,
}) {
  const models = getProviderModels(provider)
  const activeConnections = connections.filter(connection => connection.enabled)
  const zcodeCaptchaNeeded = provider.id === 'zcode-ai' && Object.entries(modelTests).some(([key, test]) =>
    key.startsWith('zcode-ai:') && test && !test.ok && /captcha/i.test(String(test.error || ''))
  )
  const [captchaOpen, setCaptchaOpen] = useState(provider.id === 'zcode-ai')
  const captchaVisible = provider.id === 'zcode-ai' && (captchaOpen || zcodeCaptchaNeeded)

  return (
    <>
      <header className="providers__top providers__top--detail">
        <button className="providers__back" type="button" onClick={onBack} aria-label="Voltar para Providers">
          &lt;-
        </button>
        <ProviderLogo provider={provider} size="large" />
        <div>
          <h1>{provider.name}</h1>
          <p>{modeLabels[provider.connectionMode]} / {provider.domain}</p>
        </div>
      </header>

      <div className="providers__sections">
        <section className="providers__box">
          <div className="providers__box-header">
            <div>
              <h2>Connections</h2>
              <p>Contas, API keys e tokens salvos para este provider.</p>
            </div>
            <div className="providers__box-actions">
              {provider.id === 'zcode-ai' && (
                <button
                  className="providers__captcha"
                  type="button"
                  onClick={() => setCaptchaOpen(open => !open)}
                >
                  {captchaVisible ? 'Ocultar CAPTCHA' : 'Resolver CAPTCHA'}
                </button>
              )}
              <button className="providers__add" type="button" onClick={() => onOpenAdd(provider)}>
                Add
              </button>
            </div>
          </div>

          <div className="connections__toolbar">
            <div>
              <strong>Round Robin</strong>
              <span>{activeConnections.length} conexao(oes) ativa(s). Distribui chamadas entre elas.</span>
            </div>
            <label className="providers__switch">
              <input type="checkbox" checked={!!settings.roundRobin} onChange={() => onToggleRoundRobin(provider)} />
              <span />
            </label>
          </div>

          {connections.length === 0 ? (
            <div className="connections__empty">
              Nenhuma conexao cadastrada. Clique em Add para conectar {provider.name}.
            </div>
          ) : (
            <div className="connections__list">
              {connections.map(connection => (
                <div className={`connection-card ${!connection.enabled ? 'connection-card--disabled' : ''}`} key={connection.id}>
                  <div className="connection-card__main">
                    <strong>{connection.name}</strong>
                    <span>{connection.email || connection.baseUrl || connection.defaultModel || modeLabels[connection.connectionMode]}</span>
                    <code>{connection.secretPreview || connection.refreshPreview || 'sem secret exposto'}</code>
                  </div>
                  <div className="connection-card__meta">
                    <em className={`connection-card__status connection-card__status--${connection.testStatus || 'untested'}`}>
                      {connection.enabled ? (connection.testStatus || 'active') : 'disabled'}
                    </em>
                    <span>last test: {formatDate(connection.lastTested)}</span>
                  </div>
                  <div className="connection-card__actions">
                    <button type="button" disabled={busyConnectionId === connection.id} onClick={() => onTestConnection(connection)}>
                      Test
                    </button>
                    <button type="button" disabled={busyConnectionId === connection.id} onClick={() => onToggleConnection(connection)}>
                      {connection.enabled ? 'Off' : 'On'}
                    </button>
                    <button type="button" disabled={busyConnectionId === connection.id} onClick={() => onDeleteConnection(connection)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {provider.id === 'zcode-ai' && captchaVisible && (
          <section className={`providers__box providers__captcha-panel ${zcodeCaptchaNeeded ? 'providers__captcha-panel--needed' : ''}`}>
            <div className="providers__box-header">
              <div>
                <h2>Solver CAPTCHA Z.ai</h2>
                <p>
                  Deixe esta caixinha aberta. Se a Z.ai pedir verificacao humana, o desafio aparece aqui;
                  depois clique em Test de novo no modelo.
                </p>
              </div>
              <button
                className="providers__captcha"
                type="button"
                onClick={() => window.open('/zcode/captcha/browser?client=standalone-browser', '_blank')}
              >
                Nova aba
              </button>
            </div>
            <iframe
              className="providers__captcha-frame"
              title="ZCode CAPTCHA Solver"
              src="/zcode/captcha/browser?client=standalone-browser"
            />
          </section>
        )}

        <section className="providers__box">
          <div className="providers__box-header">
            <div>
              <h2>Available Models</h2>
              <p>Catalogo inicial para {provider.name}. Pode escolher outro modelo ao adicionar conexao.</p>
            </div>
            <span>{models.length}</span>
          </div>

          <div className="models__grid">
            {models.map(model => {
              const modelKey = `${provider.id}:${model.id}`
              const test = modelTests[modelKey]
              const isTesting = busyModelKey === modelKey

              return (
              <div className={`model-card ${test?.ok ? 'model-card--ok' : ''} ${test && !test.ok ? 'model-card--error' : ''} ${isTesting ? 'model-card--testing' : ''}`} key={model.id}>
                <div className="model-card__main">
                  <code>{model.id}</code>
                  <span>{model.name}</span>
                </div>
                <button
                  className="model-card__test"
                  type="button"
                  title="Testar modelo"
                  disabled={isTesting}
                  onClick={() => onTestModel(provider, model)}
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                    <circle cx="11" cy="11" r="6" />
                    <path d="M16 16l4 4" />
                  </svg>
                </button>
                {test && (
                  <div className="model-card__result">
                    {test.ok ? 'modelo funcionando' : test.error}
                  </div>
                )}
              </div>
              )
            })}
          </div>
        </section>
      </div>
    </>
  )
}

function OAuthBrowserModal({ provider, onClose, onSaved }) {
  const models = getProviderModels(provider)
  const [session, setSession] = useState(null)
  const [manualCallback, setManualCallback] = useState('')
  const [manualCode, setManualCode] = useState('')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!session?.sessionId || status !== 'waiting') return undefined

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/oauth-connections/session/${session.sessionId}`)
        const data = await res.json()
        if (data.status === 'done' && data.result?.connection) {
          onSaved(data.result.connection)
        }
        if (data.status === 'error' || data.error) {
          setError(data.error || 'OAuth failed')
          setStatus('error')
        }
      } catch {
        setError('Falha consultando sessao OAuth')
        setStatus('error')
      }
    }, 1600)

    return () => clearInterval(interval)
  }, [onSaved, session, status])

  async function startBrowserLogin() {
    setError(null)
    setStatus('starting')
    const popup = window.open('about:blank', '_blank')

    try {
      const res = await fetch(`${API}/oauth-connections/${provider.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultModel: models[0]?.id || '' }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Falha iniciando OAuth')
      setSession(data)
      setStatus('waiting')
      if (popup) {
        popup.location.href = data.authUrl
      } else {
        window.open(data.authUrl, '_blank')
      }
    } catch (err) {
      if (popup) popup.close()
      setError(err.message)
      setStatus('error')
    }
  }

  async function submitManual(event) {
    event.preventDefault()
    setError(null)
    if (!session?.sessionId) {
      setError('Inicie o login primeiro para criar a sessao OAuth.')
      return
    }

    try {
      const body = manualCallback.trim()
        ? { callbackUrl: manualCallback.trim() }
        : { sessionId: session.sessionId, code: manualCode.trim() }
      const res = await fetch(`${API}/oauth-connections/${provider.id}/manual-callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Falha no callback manual')
      onSaved(data.connection)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="provider-modal" role="dialog" aria-modal="true">
      <button className="provider-modal__backdrop" type="button" onClick={onClose} aria-label="Fechar" />
      <form className="provider-modal__panel" onSubmit={submitManual}>
        <div className="provider-modal__header">
          <div>
            <span>Login via browser</span>
            <h2>Connect {provider.name}</h2>
          </div>
          <button type="button" onClick={onClose}>x</button>
        </div>

        <div className="provider-modal__hint">
          Esse fluxo abre o login oficial em outra janela, recebe o callback no backend e salva a conta automaticamente.
        </div>

        <div className="oauth-flow">
          <button className="oauth-flow__primary" type="button" onClick={startBrowserLogin} disabled={status === 'starting' || status === 'waiting'}>
            {status === 'starting' ? 'Starting...' : status === 'waiting' ? 'Waiting authorization...' : 'Open browser login'}
          </button>
          {session?.authUrl && (
            <button className="oauth-flow__secondary" type="button" onClick={() => navigator.clipboard.writeText(session.authUrl)}>
              Copy auth URL
            </button>
          )}
        </div>

        {session && (
          <div className="oauth-session">
            <span>Callback URL</span>
            <code>{session.redirectUri}</code>
            {session.fixedPort && <p>Usando porta fixa {session.fixedPort}, igual ao CLI oficial.</p>}
          </div>
        )}

        <div className="provider-modal__splitter">Manual fallback</div>

        <label>
          <span>Paste full callback URL</span>
          <input value={manualCallback} onChange={(event) => setManualCallback(event.target.value)} placeholder="http://localhost:3001/api/oauth-connections/callback/...?...code=..." />
        </label>

        <label>
          <span>Or paste authorization code</span>
          <input value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="code=..." />
        </label>

        {error && <div className="provider-modal__error">{error}</div>}

        <div className="provider-modal__actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={!session || (!manualCallback.trim() && !manualCode.trim())}>Save manual callback</button>
        </div>
      </form>
    </div>
  )
}

function OAuthDeviceModal({ provider, onClose, onSaved }) {
  const [device, setDevice] = useState(null)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!device?.sessionId || status !== 'waiting') return undefined
    const intervalMs = Math.max(Number(device.interval) || 5, 2) * 1000

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/oauth-connections/session/${device.sessionId}/poll`, { method: 'POST' })
        const data = await res.json()
        if (data.success && data.connection) {
          onSaved(data.connection)
          return
        }
        if (!data.pending && data.error) {
          setError(data.errorDescription || data.error)
          setStatus('error')
        }
      } catch {
        setError('Falha consultando device-code')
        setStatus('error')
      }
    }, intervalMs)

    return () => clearInterval(interval)
  }, [device, onSaved, status])

  async function startDeviceLogin() {
    setError(null)
    setStatus('starting')

    try {
      const res = await fetch(`${API}/oauth-connections/${provider.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Falha iniciando device-code')
      setDevice(data)
      setStatus('waiting')
      window.open(data.verificationUriComplete || data.verificationUri, '_blank')
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  return (
    <div className="provider-modal" role="dialog" aria-modal="true">
      <button className="provider-modal__backdrop" type="button" onClick={onClose} aria-label="Fechar" />
      <div className="provider-modal__panel">
        <div className="provider-modal__header">
          <div>
            <span>Device-code login</span>
            <h2>Connect {provider.name}</h2>
          </div>
          <button type="button" onClick={onClose}>x</button>
        </div>

        <div className="provider-modal__hint">
          Esse provider usa codigo de dispositivo. O Kognit pede o codigo, abre a pagina oficial e fica fazendo polling ate a conta autorizar.
        </div>

        <div className="oauth-flow">
          <button className="oauth-flow__primary" type="button" onClick={startDeviceLogin} disabled={status === 'starting' || status === 'waiting'}>
            {status === 'starting' ? 'Starting...' : status === 'waiting' ? 'Waiting approval...' : 'Start device login'}
          </button>
        </div>

        {device && (
          <div className="device-code">
            <span>User code</span>
            <strong>{device.userCode}</strong>
            <code>{device.verificationUriComplete || device.verificationUri}</code>
            <div className="oauth-flow">
              <button className="oauth-flow__secondary" type="button" onClick={() => navigator.clipboard.writeText(device.userCode || '')}>Copy code</button>
              <button className="oauth-flow__secondary" type="button" onClick={() => navigator.clipboard.writeText(device.verificationUriComplete || device.verificationUri)}>Copy URL</button>
              <button className="oauth-flow__secondary" type="button" onClick={() => window.open(device.verificationUriComplete || device.verificationUri, '_blank')}>Open again</button>
            </div>
          </div>
        )}

        {error && <div className="provider-modal__error">{error}</div>}

        <div className="provider-modal__actions">
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function OAuthImportModal({ provider, onClose, onSaved }) {
  const [accessToken, setAccessToken] = useState('')
  const [machineId, setMachineId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const res = await fetch(`${API}/oauth-connections/${provider.id}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken, machineId }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Falha importando token')
      onSaved(data.connection)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="provider-modal" role="dialog" aria-modal="true">
      <button className="provider-modal__backdrop" type="button" onClick={onClose} aria-label="Fechar" />
      <form className="provider-modal__panel" onSubmit={submit}>
        <div className="provider-modal__header">
          <div>
            <span>Import token</span>
            <h2>Connect {provider.name}</h2>
          </div>
          <button type="button" onClick={onClose}>x</button>
        </div>

        <div className="provider-modal__hint">
          Cursor nao usa login OAuth publico no 9router. Ele importa token local do Cursor IDE: `cursorAuth/accessToken` e `storage.serviceMachineId` do `state.vscdb`.
        </div>

        <label>
          <span>Access token</span>
          <textarea value={accessToken} onChange={(event) => setAccessToken(event.target.value)} rows="4" placeholder="cursorAuth/accessToken" />
        </label>

        <label>
          <span>Machine ID</span>
          <input value={machineId} onChange={(event) => setMachineId(event.target.value)} placeholder="storage.serviceMachineId" />
        </label>

        {error && <div className="provider-modal__error">{error}</div>}

        <div className="provider-modal__actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Import token'}</button>
        </div>
      </form>
    </div>
  )
}

function ManualConnectionModal({ provider, onClose, onSaved }) {
  const models = getProviderModels(provider)
  const [form, setForm] = useState({
    name: `${provider.name} connection`,
    email: '',
    baseUrl: provider.defaultBaseUrl || '',
    apiKey: '',
    sessionToken: '',
    defaultModel: models[0]?.id || '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const mode = provider.connectionMode
  const showBaseUrl = mode === 'api-key' || mode === 'browser-session' || !!provider.defaultBaseUrl

  function updateField(field, value) {
    setForm(current => ({ ...current, [field]: value }))
  }

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)

    const payload = {
      providerId: provider.id,
      providerName: provider.name,
      category: provider.category,
      connectionMode: provider.connectionMode,
      authType: getAuthType(provider),
      ...form,
    }

    try {
      const res = await fetch(`${API}/provider-connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Falha ao salvar conexao')
      onSaved(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="provider-modal" role="dialog" aria-modal="true">
      <button className="provider-modal__backdrop" type="button" onClick={onClose} aria-label="Fechar" />
      <form className="provider-modal__panel" onSubmit={submit}>
        <div className="provider-modal__header">
          <div>
            <span>{flowLabels[getConnectionFlow(provider)] || modeLabels[mode]}</span>
            <h2>Connect {provider.name}</h2>
          </div>
          <button type="button" onClick={onClose}>x</button>
        </div>

        <div className="provider-modal__hint">
          {mode === 'api-key' && 'Use uma API key do provider e ajuste Base URL/modelo se precisar.'}
          {mode === 'browser-session' && 'Cole o cookie ou session token exportado de uma sessao autenticada do navegador.'}
          {mode === 'public' && 'Este provider usa uma conexao publica/free. Nao precisa API key.'}
        </div>

        <label>
          <span>Connection name</span>
          <input value={form.name} onChange={(event) => updateField('name', event.target.value)} placeholder={`${provider.name} main`} />
        </label>

        {mode === 'browser-session' && (
          <label>
            <span>Email / account</span>
            <input value={form.email} onChange={(event) => updateField('email', event.target.value)} placeholder="conta@email.com" />
          </label>
        )}

        {showBaseUrl && (
          <label>
            <span>Base URL</span>
            <input value={form.baseUrl} onChange={(event) => updateField('baseUrl', event.target.value)} placeholder="https://api.provider.com/v1" />
          </label>
        )}

        {mode === 'api-key' && (
          <label>
            <span>API key</span>
            <input value={form.apiKey} onChange={(event) => updateField('apiKey', event.target.value)} placeholder="API key" type="password" />
          </label>
        )}

        {mode === 'browser-session' && (
          <label>
            <span>Session token / cookie</span>
            <textarea value={form.sessionToken} onChange={(event) => updateField('sessionToken', event.target.value)} placeholder="cookie ou token da sessao" rows="4" />
          </label>
        )}

        <label>
          <span>Default model</span>
          <input value={form.defaultModel} onChange={(event) => updateField('defaultModel', event.target.value)} list={`models-${provider.id}`} placeholder={models[0]?.id} />
          <datalist id={`models-${provider.id}`}>
            {models.map(model => <option value={model.id} key={model.id}>{model.name}</option>)}
          </datalist>
        </label>

        <label>
          <span>Notes</span>
          <input value={form.notes} onChange={(event) => updateField('notes', event.target.value)} placeholder="ex: conta principal, limite alto, free tier" />
        </label>

        {error && <div className="provider-modal__error">{error}</div>}

        <div className="provider-modal__actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save connection'}</button>
        </div>
      </form>
    </div>
  )
}

function ConnectionModal({ provider, onClose, onSaved }) {
  const flow = getConnectionFlow(provider)
  if (flow === 'browser') return <OAuthBrowserModal provider={provider} onClose={onClose} onSaved={onSaved} />
  if (flow === 'device') return <OAuthDeviceModal provider={provider} onClose={onClose} onSaved={onSaved} />
  if (flow === 'import') return <OAuthImportModal provider={provider} onClose={onClose} onSaved={onSaved} />
  return <ManualConnectionModal provider={provider} onClose={onClose} onSaved={onSaved} />
}

export default function ProvidersPage() {
  const [selectedProvider, setSelectedProvider] = useState(null)
  const [connectionsByProvider, setConnectionsByProvider] = useState({})
  const [settingsByProvider, setSettingsByProvider] = useState({})
  const [modalProvider, setModalProvider] = useState(null)
  const [busyConnectionId, setBusyConnectionId] = useState(null)
  const [busyModelKey, setBusyModelKey] = useState(null)
  const [modelTests, setModelTests] = useState({})
  const [loadError, setLoadError] = useState(null)

  const connectionCounts = useMemo(() => {
    return Object.fromEntries(
      Object.entries(connectionsByProvider).map(([providerId, connections]) => [providerId, connections.length])
    )
  }, [connectionsByProvider])

  useEffect(() => {
    async function loadConnections() {
      try {
        const [connectionsRes, settingsRes] = await Promise.all([
          fetch(`${API}/provider-connections`),
          fetch(`${API}/provider-settings`),
        ])
        const connections = await connectionsRes.json()
        const settings = await settingsRes.json()
        setConnectionsByProvider(groupConnections(Array.isArray(connections) ? connections : []))
        setSettingsByProvider(settings && typeof settings === 'object' ? settings : {})
      } catch {
        setLoadError('Backend nao acessivel. Rode: node server/index.js')
      }
    }

    loadConnections()
  }, [])

  function upsertConnection(connection) {
    setConnectionsByProvider(current => {
      const providerConnections = current[connection.providerId] || []
      const exists = providerConnections.some(item => item.id === connection.id)
      const nextConnections = exists
        ? providerConnections.map(item => item.id === connection.id ? connection : item)
        : [...providerConnections, connection]

      return { ...current, [connection.providerId]: nextConnections }
    })
  }

  function removeConnection(connection) {
    setConnectionsByProvider(current => ({
      ...current,
      [connection.providerId]: (current[connection.providerId] || []).filter(item => item.id !== connection.id),
    }))
  }

  function savedConnection(connection) {
    upsertConnection(connection)
    setModalProvider(null)
  }

  async function toggleRoundRobin(provider) {
    const current = settingsByProvider[provider.id] || { roundRobin: false, cursor: 0 }
    const nextRoundRobin = !current.roundRobin

    setSettingsByProvider(settings => ({
      ...settings,
      [provider.id]: { ...current, roundRobin: nextRoundRobin },
    }))

    try {
      const res = await fetch(`${API}/provider-settings/${provider.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundRobin: nextRoundRobin }),
      })
      if (!res.ok) {
        setSettingsByProvider(settings => ({ ...settings, [provider.id]: current }))
        return
      }
      const saved = await res.json()
      setSettingsByProvider(settings => ({ ...settings, [provider.id]: saved }))
    } catch {
      setSettingsByProvider(settings => ({ ...settings, [provider.id]: current }))
    }
  }

  async function toggleConnection(connection) {
    setBusyConnectionId(connection.id)
    try {
      const res = await fetch(`${API}/provider-connections/${connection.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !connection.enabled }),
      })
      if (!res.ok) return
      const updated = await res.json()
      upsertConnection(updated)
    } catch { /* ignore */ }
    setBusyConnectionId(null)
  }

  async function testConnection(connection) {
    setBusyConnectionId(connection.id)
    try {
      const res = await fetch(`${API}/provider-connections/${connection.id}/test`, { method: 'POST' })
      if (!res.ok) return
      const updated = await res.json()
      upsertConnection(updated)
    } catch { /* ignore */ }
    setBusyConnectionId(null)
  }

  async function testModel(provider, model) {
    const modelKey = `${provider.id}:${model.id}`
    setBusyModelKey(modelKey)
    setModelTests(current => ({
      ...current,
      [modelKey]: { ok: null, error: 'testando modelo...' },
    }))

    try {
      const res = await fetch(`${API}/provider-models/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: provider.id,
          providerName: provider.name,
          modelId: model.id,
          upstreamId: model.upstreamId || model.id,
        }),
      })
      const data = await res.json()
      setModelTests(current => ({
        ...current,
        [modelKey]: {
          ok: !!data.ok,
          error: data.error || data.message || (data.ok ? '' : 'Erro desconhecido'),
        },
      }))
    } catch (err) {
      setModelTests(current => ({
        ...current,
        [modelKey]: { ok: false, error: err.message || 'Falha no teste' },
      }))
    } finally {
      setBusyModelKey(null)
    }
  }

  async function deleteConnection(connection) {
    if (!confirm(`Delete ${connection.name}?`)) return
    setBusyConnectionId(connection.id)
    try {
      const res = await fetch(`${API}/provider-connections/${connection.id}`, { method: 'DELETE' })
      if (res.ok) removeConnection(connection)
    } catch { /* ignore */ }
    setBusyConnectionId(null)
  }

  return (
    <div className="providers">
      {selectedProvider ? (
        <ProviderDetail
          provider={selectedProvider}
          onBack={() => setSelectedProvider(null)}
          connections={connectionsByProvider[selectedProvider.id] || []}
          settings={settingsByProvider[selectedProvider.id] || { roundRobin: false, cursor: 0 }}
          onOpenAdd={setModalProvider}
          onToggleRoundRobin={toggleRoundRobin}
          onToggleConnection={toggleConnection}
          onDeleteConnection={deleteConnection}
          onTestConnection={testConnection}
          onTestModel={testModel}
          busyConnectionId={busyConnectionId}
          busyModelKey={busyModelKey}
          modelTests={modelTests}
        />
      ) : (
        <>
          <header className="providers__top">
            <h1>Providers</h1>
          </header>

          {loadError && <div className="providers__error">{loadError}</div>}

          <div className="providers__sections">
            {sections.map(section => (
              <section className="providers__box" key={section.title}>
                <div className="providers__box-header">
                  <div>
                    <h2>{section.title}</h2>
                    <p>{section.description}</p>
                  </div>
                  <span>{section.providers.length}</span>
                </div>

                <div className="providers__grid">
                  {section.providers.map(provider => (
                    <ProviderCard
                      provider={{ ...provider, category: section.category }}
                      connectedCount={connectionCounts[provider.id] || 0}
                      onSelect={(item) => setSelectedProvider({ ...item, category: section.category })}
                      key={`${section.title}-${provider.id}`}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {modalProvider && (
        <ConnectionModal
          provider={modalProvider}
          onClose={() => setModalProvider(null)}
          onSaved={savedConnection}
        />
      )}
    </div>
  )
}
