---
name: playwright-e2e
description: escrever ou atualizar testes end-to-end com Playwright neste projeto, garantindo trace, screenshot, vídeo e asserções consistentes
---

# Skill: `playwright-e2e`

Padrão para criar e atualizar testes E2E com Playwright. Garante que toda mudança que afeta UI ou fluxo crítico tenha cobertura, evidência salva e asserções determinísticas — sem `sleep` arbitrário, sem mock pra fazer passar.

---

## Trigger

- **OBRIGATÓRIO em TODA task técnica** (feature, fix, refactor, doc com build) — Playwright roda antes do commit. Smoke test mínimo se task não tem UI.
- Fluxo de usuário ponta a ponta (login, checkout, onboarding, etc.).
- Feature web nova sem cobertura E2E.
- Bug que se manifesta na UI e exige teste de regressão.
- Pedido explícito: "escreve teste e2e", "playwright", "smoke test web".
- Antes de fechar QUALQUER PR (toca rota, página, interação ou não — smoke garante que app sobe).

---

## Hard rule — evidência em TODA task

Regra dura, sem exceção: nenhum PR fecha sem **trace + screenshot + video** salvos em `playwright-report/` + `test-results/`. Sem evidência = sem merge. CI bloqueia via `.github/workflows/dod.yml`.

- Task de UI → cenários: happy path, erro, auth states, viewports 375/1280, edge case.
- Task de backend puro → smoke spec: app sobe, endpoint principal responde 2xx, fluxo crítico passa.
- Task de doc/config → smoke: build não quebra + serve responde.
- Task de migration → roda app + valida fluxo afetado pela migration.

---

## Steps

1. **Identifique o cenário**. Liste o caminho feliz e os principais erros (input inválido, sessão expirada, 404/500, viewport mobile/desktop). Cada cenário vira um `test(...)`.
2. **Crie o arquivo** em `tests/e2e/<feature>.spec.ts`. Nome em `kebab-case` casando com a feature (ex.: `tests/e2e/login.spec.ts`).
3. **Importe fixtures padrão** do Playwright (`test`, `expect`) e qualquer fixture customizada do projeto (`tests/e2e/fixtures/`).
4. **Configure o `test.describe`** com nome legível (ex.: `Login flow`). Agrupe cenários relacionados.
5. **Use Page Object** quando o mesmo seletor aparecer em 3+ testes. Caso contrário, seletores inline são aceitáveis.
6. **Asserte estado final** com `await expect(...)`. Asserte URL, DOM visível e textos esperados — não asserte só ausência de erro.
7. **Confirme evidência**. `playwright.config.ts` já liga `trace: 'on'`, `screenshot: 'only-on-failure'` e `video: 'on-first-retry'`. Não desligue isso por teste.
8. **Rode local** com `npx playwright test tests/e2e/<feature>.spec.ts --reporter=list`. Verifique HTML report em `playwright-report/`.
9. **Commit**. Inclua o arquivo `.spec.ts`. Não commite `test-results/` nem `playwright-report/` (estão no `.gitignore`).
10. **No PR**, anexe screenshot do estado final do caminho feliz e descreva os cenários cobertos.

---

## Padrões

- **Naming**: `<feature>.spec.ts`, `<feature>.<sub>.spec.ts` para sub-fluxos longos.
- **Localização**: sempre `tests/e2e/`. Page Objects em `tests/e2e/pages/<Page>.ts`.
- **Seletores**: prefira `getByRole`, `getByLabel`, `getByTestId`. Evite `locator('div.classe123')` — frágil.
- **Espera**: nunca `await page.waitForTimeout(ms)`. Use `await expect(locator).toBeVisible()`, `toHaveURL`, `toHaveText`.
- **Asserções**: prefira `await expect(...).toBeVisible()` em vez de `if (locator.isVisible())`. Auto-retry built-in.
- **Setup/Teardown**: use `test.beforeEach` para login/seed; `test.afterEach` só se realmente precisar limpar.
- **Dados**: gere dados únicos por teste (`crypto.randomUUID()`) para evitar colisão entre runs paralelos.
- **Viewports**: cubra mobile (`375x667`), tablet (`768x1024`) e desktop (`1280x800`) quando o layout muda.
- **i18n**: se o app é multi-locale, parametrize `locale` no `test.use({ locale: 'pt-BR' })` ou rode como projeto.
- **Sem `console.log`** deixado nos specs. Use `test.info().annotations` se precisar anotar.

---

## Definition of Done

- [ ] Spec roda local sem erro: `npx playwright test tests/e2e/<feature>.spec.ts`.
- [ ] Cenários documentados: caminho feliz + ao menos 1 erro + 1 viewport alternativo (quando aplicável).
- [ ] **Evidência completa salva** — `playwright-report/index.html` + `test-results/<spec>/trace.zip` + screenshot por cenário + video. Hard rule: sem evidência, sem merge.
- [ ] HTML report gerado em `playwright-report/` e validado visualmente.
- [ ] PR anexa screenshot do estado final, link do report e lista cenários cobertos.
- [ ] Nenhum `waitForTimeout` ou `sleep` arbitrário no código.
- [ ] Seletores resistentes (role/label/testid), não classes CSS voláteis.
- [ ] CI (`.github/workflows/ci.yml` + `dod.yml`) verde para o job `playwright`.

---

## Exemplo

```typescript
import { test, expect } from '@playwright/test';

test.describe('Login flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('user logs in with valid credentials', async ({ page }) => {
    await page.getByLabel('Email').fill('user@example.com');
    await page.getByLabel('Password').fill('correct-horse-battery');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
  });

  test('shows error on invalid password', async ({ page }) => {
    await page.getByLabel('Email').fill('user@example.com');
    await page.getByLabel('Password').fill('wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert')).toContainText(/invalid credentials/i);
    await expect(page).toHaveURL(/\/login$/);
  });
});
```

---

## Notas

- Configuração canônica em `playwright.config.ts` (raiz do projeto). Não duplique opções no spec.
- Testes flaky são bug. Se um teste falha intermitente, abra issue e marque com `test.fixme(...)` até resolver — não use `test.skip` silenciosamente.
- Para debugar local: `npx playwright test --ui` abre o time-travel debugger.
- Trace viewer: `npx playwright show-trace test-results/<trace>.zip`.
