## workspace i18n audit - de

German translation audit for workspace routes with focus on CLI onboarding clarity, AI metric terminology, and billing top-up semantics.

---

### coverage

- Route scope: `packages/console/app/src/routes/workspace/**`
- Locale file: `packages/console/app/src/i18n/de.ts`
- Source reference: `packages/console/app/src/i18n/en.ts`
- Unique keys in scope: **181**
- Flagged keys: **34** (critical: 6, major: 27, minor: 1)

---

### glossary decisions (de)

- Preserve literals exactly: `Zen`, `Stripe`, `OpenCode Black`, `opencode`, `API`, `/models`
- Preserve placeholders exactly (`{{provider}}`, `{{amount}}`, `{{plan}}`, `{{prefix}}`, etc.)
- `API key`: `API-Schlüssel`
- `usage`: `Nutzung`
- `cost`: `Kosten`; payments column `Betrag`
- `billing`: `Abrechnung`
- Billing `reload` semantics: `Aufladung` / `aufladen` (never `Neuladen`)
- AI cost metrics: keep `Input`, `Output`, `Reasoning`

---

### required key updates

| key                                   | replace with                                                                             | severity | reason                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------- |
| workspace.newUser.step.login.before   | Führe                                                                                    | critical | Wrong CLI verb in onboarding instruction.             |
| workspace.monthlyLimit.set            | Festlegen                                                                                | critical | CTA mistranslated as noun (`Satz`).                   |
| workspace.reload.title                | Automatische Aufladung                                                                   | critical | Billing top-up semantics, not page reload.            |
| workspace.reload.disabled.after       | Aktivieren Sie diese Option, damit bei niedrigem Kontostand automatisch aufgeladen wird. | critical | Uses `neu laden`; must use billing top-up phrasing.   |
| workspace.reload.enableAutoReload     | Automatische Aufladung aktivieren                                                        | critical | Primary toggle must follow billing top-up semantics.  |
| workspace.black.subscription.message  | Sie haben OpenCode Black für ${{plan}} pro Monat abonniert.                              | critical | Missing `$` before `{{plan}}`.                        |
| workspace.newUser.step.models.before  | Starte opencode und führe                                                                | major    | Unidiomatic command phrasing before `/models`.        |
| workspace.newUser.copyApiKey          | API-Schlüssel kopieren                                                                   | major    | Broken technical term word order.                     |
| workspace.keys.copyApiKey             | API-Schlüssel kopieren                                                                   | major    | Broken technical term word order.                     |
| workspace.models.table.enabled        | Aktiviert                                                                                | major    | Wrong toggle-state label.                             |
| workspace.providers.saving            | Wird gespeichert...                                                                      | major    | `Sparen...` means saving money, not save state.       |
| workspace.members.inviting            | Wird eingeladen...                                                                       | major    | Incorrect invite loading state wording.               |
| workspace.members.saving              | Wird gespeichert...                                                                      | major    | `Sparen...` means saving money, not save state.       |
| workspace.monthlyLimit.setting        | Wird gesetzt...                                                                          | major    | In-progress state should be verbal action.            |
| workspace.payments.table.amount       | Betrag                                                                                   | major    | Financial column mistranslated as quantity.           |
| workspace.payments.view               | Anzeigen                                                                                 | major    | CTA mistranslated as noun (`Sicht`).                  |
| workspace.usage.table.input           | Input                                                                                    | major    | AI billing metric should remain technical term.       |
| workspace.usage.table.output          | Output                                                                                   | major    | AI billing metric should remain technical term.       |
| workspace.usage.breakdown.input       | Input                                                                                    | major    | AI billing metric should remain technical term.       |
| workspace.usage.breakdown.output      | Output                                                                                   | major    | AI billing metric should remain technical term.       |
| workspace.usage.breakdown.reasoning   | Reasoning                                                                                | major    | AI billing metric should remain technical term.       |
| workspace.reload.disabled.before      | Automatische Aufladung ist                                                               | major    | Should use top-up semantics instead of `Nachladen`.   |
| workspace.reload.enabled.before       | Automatische Aufladung ist                                                               | major    | Should use top-up semantics instead of `Nachladen`.   |
| workspace.reload.enabled.state        | aktiviert                                                                                | major    | `ermöglicht` is wrong state adjective for toggle.     |
| workspace.reload.enabled.middle       | Wir laden auf                                                                            | major    | Should be account top-up verb (`aufladen`).           |
| workspace.reload.enabled.after        | sobald der Kontostand                                                                    | major    | `Gleichgewicht` is wrong meaning for account balance. |
| workspace.reload.reloadAmount         | Aufladebetrag $                                                                          | major    | Label should reflect top-up amount semantics.         |
| workspace.reload.whenBalanceReaches   | Wenn der Kontostand $ erreicht                                                           | major    | Use account-balance term `Kontostand`.                |
| workspace.reload.failedAt             | Aufladung fehlgeschlagen am                                                              | major    | Error copy should use top-up semantics.               |
| workspace.reload.saving               | Wird gespeichert...                                                                      | major    | `Sparen...` means saving money, not save state.       |
| workspace.black.waitlist.left         | Verlassen                                                                                | major    | `Links` is incorrect meaning.                         |
| workspace.black.waitlist.joined       | Sie stehen auf der Warteliste für den OpenCode Black Tarif für ${{plan}} pro Monat.      | major    | Product name order/phrase is broken.                  |
| workspace.black.waitlist.ready        | Wir können Sie jetzt in den OpenCode Black Tarif für ${{plan}} pro Monat aufnehmen.      | major    | Product name order/phrase is broken.                  |
| workspace.black.subscription.resetsIn | Zurückgesetzt in                                                                         | minor    | Improve pre-duration label grammar.                   |

---

### implementation batches

1. **Critical blockers first**
   - `workspace.newUser.step.login.before`, `workspace.monthlyLimit.set`, `workspace.reload.title`, `workspace.reload.disabled.after`, `workspace.reload.enableAutoReload`, `workspace.black.subscription.message`
2. **Reload semantics sweep**
   - All `workspace.reload.*` keys listed above (state labels, helper text, error text, amount labels)
3. **Onboarding + API key wording**
   - `workspace.newUser.step.models.before`, `workspace.newUser.copyApiKey`, `workspace.keys.copyApiKey`
4. **Async/CTA quality fixes**
   - `workspace.providers.saving`, `workspace.members.inviting`, `workspace.members.saving`, `workspace.monthlyLimit.setting`, `workspace.payments.view`, `workspace.reload.saving`
5. **AI usage/payments terminology**
   - usage `Input/Output/Reasoning` keys + `workspace.payments.table.amount`
6. **OpenCode Black waitlist copy**
   - `workspace.black.waitlist.left`, `workspace.black.waitlist.joined`, `workspace.black.waitlist.ready`, `workspace.black.subscription.resetsIn`

---

### acceptance checks for follow-up fix agent

- Flagged totals align with this spec: **34** (`critical` 6, `major` 27, `minor` 1).
- `workspace.nav.zen` remains exactly `Zen`.
- Literals remain exact where present: `Stripe`, `OpenCode Black`, `opencode`, `API`, `/models`.
- Billing top-up copy consistently uses `Aufladung` / `aufladen` (not `Neuladen`/`Nachladen`).
- Usage metrics remain technical terms: `Input`, `Output`, `Reasoning`.
- Placeholders remain unchanged in all updated strings.
