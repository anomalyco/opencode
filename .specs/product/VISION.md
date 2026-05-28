# VISION — Opencode

Documento gerado automaticamente no bootstrap para reduzir o tempo até a primeira contribuição útil no repositório.

## Problema

Opencode ainda depende de descoberta manual para entender contexto, comandos e áreas principais do código. Isso aumenta o tempo de onboarding e faz cada agente ou desenvolvedor reconstruir o mapa do projeto do zero.

## Quem usa

- **Persona primária:** desenvolvedor ou agente responsável por executar mudanças com segurança.
- **Persona secundária:** revisor técnico que precisa validar impacto, comandos e evidências rapidamente.
- **Quem não é o público:** usuários finais fora do fluxo de manutenção do repositório.

## Diferencial

- Mapeamento inicial automático logo após aplicar o starter.
- Documentação operacional gerada a partir do manifesto e dos arquivos reais do projeto.
- Stack detectada automaticamente: undefined.
- Entidades e áreas principais resumidas sem depender de prompts manuais.

## Métricas de sucesso

| Métrica | Baseline | Meta inicial | Como medimos |
|---|---|---|---|
| Tempo para entender o projeto | desconhecido | < 30 min | leitura dos docs gerados + comandos válidos |
| Tempo para primeira task | desconhecido | < 1 dia | task criada e validada localmente |
| Cobertura do mapa inicial | manual | comandos, entidades e integrações registrados | revisão dos arquivos gerados |

## Não-objetivos

- Não reescrever código de produto.
- Não inferir regras de negócio inexistentes no repositório.
- Não substituir revisão humana para decisões arquiteturais sensíveis.

## Tese de longo prazo

Opencode deve permitir que qualquer mantenedor entenda rapidamente Developer Tools e comece a trabalhar com contexto suficiente já no primeiro contato com o repositório.

## Sinais detectados no bootstrap

- Stack: undefined
- Domínio inferido: Developer Tools
- Entidades observadas: Session, Workspace, Message
- Integrações observadas: GitHub, Stripe, OpenAI, Playwright, Sentry, PostgreSQL

## Histórico

| Data | Versão | Mudança | Quem |
|---|---|---|---|
| 2026-05-28 | 0.1 | Initial automatic mapping generated during bootstrap | wesleysimplicio-team |
