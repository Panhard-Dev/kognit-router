# Política de Segurança (Security Policy)

## Reportando uma Vulnerabilidade

Se você encontrou uma vulnerabilidade de segurança no KOGNIT Router (ex: vazamento de tokens, bypass de auth, execução remota de código, injeção), **NÃO abra uma issue pública**.

## Como reportar

Reporte **em privado** por uma destas formas:

- **Discord:** entre no servidor https://discord.gg/kcNdRpx8ct e mande uma **DM (mensagem direta)** para `@Panhard-Dev`, ou use um canal privado de reporte se houver.

> ⚠️ Não poste detalhes da vulnerabilidade em canais públicos do Discord. Mantenha o reporte privado até que a correção seja lançada.

## O que incluir no reporte

Para agilizar a correção, inclua:

- Descrição clara da vulnerabilidade
- Passos para reproduzir (passo a passo)
- Impacto possível (o que um atacante conseguiria fazer)
- Versão afetada (ou commit do repo)
- Sugestão de correção, se tiver

## Tempo de resposta

- **Confirmação do recebimento:** em até 72 horas.
- **Avaliação inicial:** em até 7 dias.
- **Correção:** depende da gravidade, mas buscarei corrigir o mais rápido possível.

## Escopo

Esta política se aplica apenas à versão mais recente do KOGNIT Router no branch `main`. Vulnerabilidades em versões antigas não têm suporte.

## Fora do escopo

- Bugs que não afetam segurança (use issues públicas normais para esses)
- Ataques de força bruta / DoS em larga escala
- Vulnerabilidades em dependências de terceiros já corrigidas em versões recentes (atualize suas deps)
- Engenharia social / phishing

## Recompensas

Este é um projeto pessoal mantido por uma única pessoa. Não há recompensa financeira (bug bounty), mas todo reporte válido recebe crédito público na release de correção (se você quiser).

## Uso responsável

Pedimos que quem encontrar uma vulnerabilidade:
- Não explore a falha além do necessário para demonstrá-la
- Não divulbe publicamente antes da correção ser lançada
- Dê tempo razoável para a correção antes de qualquer divulgação (90 dias)
