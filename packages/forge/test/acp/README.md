# ACP Tests Quick Reference

- **Unit tests (fixtures only, no API)**  
  Run: `bun run test:acp`

- **Integration tests (live claude-code-acp, needs network + ANTHROPIC_API_KEY)**  
  Run: `ANTHROPIC_API_KEY=... bun run test:acp:integration`

- **Fixture generation (captures real ACP notifications, needs ANTHROPIC_API_KEY)**  
  Run: `ANTHROPIC_API_KEY=... bun run test:acp:fixtures`  
  Notes: uses `npx @zed-industries/claude-code-acp`; includes an “ultrathink” prompt to force thought chunks.

What lives here:
- `translation/` – fixture-based unit tests for text/tool translation.
- `orchestrator.test.ts`, `translator.test.ts` – integration coverage with the live agent.
- `fixtures/` – generator script + committed JSON fixtures consumed by the unit tests.
