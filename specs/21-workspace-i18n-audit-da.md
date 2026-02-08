## workspace i18n audit - da

Danish translation audit for workspace routes with emphasis on AI-provider, billing, and workspace-management accuracy.

---

### coverage

- Route scope: `packages/console/app/src/routes/workspace/**`
- Locale file: `packages/console/app/src/i18n/da.ts`
- Source reference: `packages/console/app/src/i18n/en.ts`
- Unique locale keys used in scope: **181**
- Flagged keys: **33** (critical: 8, major: 18, minor: 7)

---

### glossary decisions (da)

- `Zen`: keep exactly `Zen`
- `Stripe`: keep exactly `Stripe`
- `OpenCode Black`: keep exactly `OpenCode Black`
- `opencode`: keep exactly `opencode`
- `API`: keep exactly `API`
- `/models`: keep exactly `/models`
- `API key`: `API-nøgle`
- `billing`: `fakturering`
- `reload` in wallet context: `genopfyldning` (top-up), never page refresh wording

---

### required key updates

| key                                   | current da                                                                                          | replace with                                                                                         | severity | reason                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| workspace.newUser.step.login.before   | Løbe                                                                                                | Kør                                                                                                  | critical | Wrong verb for CLI instruction (`opencode auth login`).                |
| workspace.settings.defaultName        | Misligholdelse                                                                                      | Standard                                                                                             | critical | Wrong meaning for default-label UI text.                               |
| workspace.reload.title                | Automatisk genindlæsning                                                                            | Automatisk genopfyldning                                                                             | critical | `reload` here is balance top-up, not page reload.                      |
| workspace.reload.disabled.before      | Automatisk genindlæsning er                                                                         | Automatisk genopfyldning er                                                                          | critical | Same billing top-up semantic issue.                                    |
| workspace.reload.enabled.before       | Automatisk genindlæsning er                                                                         | Automatisk genopfyldning er                                                                          | critical | Same billing top-up semantic issue.                                    |
| workspace.reload.enableAutoReload     | Aktiver automatisk genindlæsning                                                                    | Aktiver automatisk genopfyldning                                                                     | critical | Same billing top-up semantic issue.                                    |
| workspace.reload.reloadAmount         | Genindlæs $                                                                                         | Genopfyld $                                                                                          | critical | Top-up amount label, not page reload action.                           |
| workspace.reload.failedAt             | Genindlæsning mislykkedes kl                                                                        | Genopfyldning mislykkedes kl                                                                         | critical | Error refers to failed recharge event.                                 |
| workspace.reload.disabled.after       | Aktiver for automatisk at genindlæse, når balancen er lav.                                          | Aktiver for automatisk at genopfylde, når saldoen er lav.                                            | major    | Must describe low-balance auto top-up behavior.                        |
| workspace.reload.enabled.middle       | Vi genindlæser                                                                                      | Vi genopfylder                                                                                       | major    | Must describe automatic recharge action.                               |
| workspace.reload.disabled.state       | handicappet                                                                                         | deaktiveret                                                                                          | major    | Wrong/off-tone toggle-state wording.                                   |
| workspace.members.save                | Spare                                                                                               | Gem                                                                                                  | major    | Current word means monetary savings, not save changes.                 |
| workspace.providers.save              | Spare                                                                                               | Gem                                                                                                  | major    | Current word means monetary savings, not save changes.                 |
| workspace.reload.save                 | Spare                                                                                               | Gem                                                                                                  | major    | Current word means monetary savings, not save changes.                 |
| workspace.settings.save               | Spare                                                                                               | Gem                                                                                                  | major    | Current word means monetary savings, not save changes.                 |
| workspace.keys.copyApiKey             | Kopiér nøglen API                                                                                   | Kopiér API-nøgle                                                                                     | major    | Incorrect technical phrase order.                                      |
| workspace.newUser.copyApiKey          | Kopiér nøglen API                                                                                   | Kopiér API-nøgle                                                                                     | major    | Incorrect technical phrase order.                                      |
| workspace.providers.placeholder       | Indtast nøglen {{provider}} API ({{prefix}}...)                                                     | Indtast {{provider}} API-nøgle ({{prefix}}...)                                                       | major    | Technical phrase is malformed; placeholders must be preserved exactly. |
| workspace.newUser.feature.tested.body | Vi har benchmarket og testet modeller specifikt til kodningsmidler for at sikre den bedste ydeevne. | Vi har benchmarket og testet modeller specifikt til kodningsagenter for at sikre den bedste ydeevne. | major    | Wrong domain noun (`kodningsmidler` != coding agents).                 |
| workspace.payments.table.receipt      | Modtagelse                                                                                          | Kvittering                                                                                           | major    | Wrong payment term for receipt column.                                 |
| workspace.payments.view               | Udsigt                                                                                              | Vis                                                                                                  | major    | Wrong CTA meaning for “View” action.                                   |
| workspace.black.waitlist.left         | Venstre                                                                                             | Forladt                                                                                              | major    | Wrong meaning (“left” direction vs status).                            |
| workspace.usage.table.output          | Produktion                                                                                          | Output                                                                                               | major    | Wrong AI metering term in token table.                                 |
| workspace.usage.breakdown.output      | Produktion                                                                                          | Output                                                                                               | major    | Wrong AI metering term in token breakdown.                             |
| workspace.usage.table.cost            | Koste                                                                                               | Omkostning                                                                                           | major    | Wrong part of speech for metric label.                                 |
| workspace.cost.title                  | Koste                                                                                               | Omkostninger                                                                                         | major    | Wrong part of speech for section heading.                              |
| workspace.members.edit                | Redigere                                                                                            | Rediger                                                                                              | minor    | Use imperative CTA form.                                               |
| workspace.providers.edit              | Redigere                                                                                            | Rediger                                                                                              | minor    | Use imperative CTA form.                                               |
| workspace.reload.edit                 | Redigere                                                                                            | Rediger                                                                                              | minor    | Use imperative CTA form.                                               |
| workspace.settings.edit               | Redigere                                                                                            | Rediger                                                                                              | minor    | Use imperative CTA form.                                               |
| workspace.billing.addAction           | Tilføje                                                                                             | Tilføj                                                                                               | minor    | Use imperative CTA form.                                               |
| workspace.billing.manage              | Styre                                                                                               | Administrer                                                                                          | minor    | Better management CTA wording in product UI.                           |
| workspace.black.waitlist.enroll       | Indskrive                                                                                           | Tilmeld                                                                                              | minor    | Better enrollment CTA for subscription/waitlist flow.                  |

---

### implementation batches

1. **Critical blockers: onboarding + default + reload semantics**
   - `workspace.newUser.step.login.before`
   - `workspace.settings.defaultName`
   - `workspace.reload.title`
   - `workspace.reload.disabled.before`
   - `workspace.reload.enabled.before`
   - `workspace.reload.enableAutoReload`
   - `workspace.reload.reloadAmount`
   - `workspace.reload.failedAt`
2. **Billing top-up and save-action correctness**
   - Remaining `workspace.reload.*` in table
   - `workspace.members.save`, `workspace.providers.save`, `workspace.reload.save`, `workspace.settings.save`
3. **API and provider terminology cleanup**
   - `workspace.keys.copyApiKey`, `workspace.newUser.copyApiKey`, `workspace.providers.placeholder`
4. **Usage/payments/workspace label fixes**
   - `workspace.newUser.feature.tested.body`
   - `workspace.payments.table.receipt`, `workspace.payments.view`
   - `workspace.black.waitlist.left`
   - `workspace.usage.table.output`, `workspace.usage.breakdown.output`, `workspace.usage.table.cost`, `workspace.cost.title`
5. **CTA polish (minor imperative consistency)**
   - all `*.edit`, `workspace.billing.addAction`, `workspace.billing.manage`, `workspace.black.waitlist.enroll`

---

### acceptance checks for follow-up fix agent

- Preserve literals exactly: `Zen`, `Stripe`, `OpenCode Black`, `opencode`, `API`, `/models`.
- Preserve placeholders exactly (eg `{{provider}}`, `{{prefix}}`, `{{plan}}`, `{{amount}}`).
- All `workspace.reload.*` labels must mean balance top-up/recharge (`genopfyld*`), never page refresh (`genindlæs*`).
- Save CTAs must reflect saving changes (`Gem` / `Gemmer...`), not savings-money wording.
- AI metering labels in usage tables remain technically correct (`Input`, `Output`, cost nouns).
