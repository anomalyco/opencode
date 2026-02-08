## workspace i18n audit - it

Italian translation audit for workspace routes with focus on Zen brand integrity and AI/billing term precision.

---

### coverage

- Route scope: `packages/console/app/src/routes/workspace/**`
- Locale file: `packages/console/app/src/i18n/it.ts`
- Source reference: `packages/console/app/src/i18n/en.ts`
- Unique keys in scope: **181** (`177` `workspace.*` + `4` `common.*`)
- Flagged keys: **25** (critical: 2, major: 18, minor: 5)

---

### glossary decisions (it)

- `Zen`: keep exactly `Zen`
- `Stripe`: keep exactly `Stripe`
- `OpenCode Black`: keep exactly `OpenCode Black`
- `opencode`: keep exactly `opencode`
- `API`: keep exactly `API`
- `/models`: keep exactly `/models`
- `API key`: `chiave API` / `chiavi API`
- `billing`: `fatturazione`
- `auto reload` (billing): `ricarica automatica`
- `reload` in billing context: top-up/recharge semantics (never page refresh)

---

### required key updates

| key                                    | current_it                                                          | replace with                                                            | severity | reason                                                    |
| -------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------- | --------------------------------------------------------- |
| workspace.nav.zen                      | zen                                                                 | Zen                                                                     | critical | Brand literal must match exactly.                         |
| workspace.black.waitlist.left          | Sinistra                                                            | Uscito dalla lista d'attesa                                             | critical | `Left` is waitlist status, not direction.                 |
| workspace.billing.manage               | Maneggio                                                            | Gestisci                                                                | major    | Wrong lexical meaning for CTA.                            |
| workspace.billing.subtitle.beforeLink  | Gestire i metodi di pagamento.                                      | Gestisci i metodi di pagamento.                                         | major    | UI copy should be imperative, not infinitive.             |
| workspace.black.waitlist.joined        | Sei in lista d'attesa per il piano nero ${{plan}} al mese OpenCode. | Sei in lista d'attesa per il piano OpenCode Black da ${{plan}} al mese. | major    | Preserve exact product naming and natural billing phrase. |
| workspace.black.waitlist.leaving       | In partenza...                                                      | Uscita in corso...                                                      | major    | Wrong async action meaning for waitlist exit.             |
| workspace.black.subscription.resetsIn  | Si reimposta                                                        | Si reimposta tra                                                        | major    | Missing connector for duration composition.               |
| workspace.members.inviting             | Invitante...                                                        | Invito in corso...                                                      | major    | Incorrect grammar for in-progress invite state.           |
| workspace.members.role.admin           | Ammin                                                               | Admin                                                                   | major    | Role label typo / non-standard abbreviation.              |
| workspace.members.saving               | Risparmio...                                                        | Salvataggio in corso...                                                 | major    | Persistence action mistranslated as money saving.         |
| workspace.providers.saving             | Risparmio...                                                        | Salvataggio in corso...                                                 | major    | Persistence action mistranslated as money saving.         |
| workspace.reload.saving                | Risparmio...                                                        | Salvataggio in corso...                                                 | major    | Persistence action mistranslated as money saving.         |
| workspace.monthlyLimit.setting         | Collocamento...                                                     | Impostazione in corso...                                                | major    | Wrong lexical meaning for `Setting...`.                   |
| workspace.newUser.step.login.before    | Correre                                                             | Esegui                                                                  | major    | CLI instruction must convey `Run`.                        |
| workspace.payments.table.amount        | Quantità                                                            | Importo                                                                 | major    | Financial amount requires `Importo`.                      |
| workspace.keys.title                   | API Chiavi                                                          | Chiavi API                                                              | major    | Technical term order is incorrect.                        |
| workspace.nav.apiKeys                  | API Chiavi                                                          | Chiavi API                                                              | major    | Technical term order is incorrect.                        |
| workspace.providers.table.apiKey       | API Chiave                                                          | Chiave API                                                              | major    | Technical term order is incorrect.                        |
| workspace.providers.title              | Porta la tua chiave                                                 | Bring Your Own Key (BYOK)                                               | major    | Preserve BYOK concept explicitly in AI-provider context.  |
| workspace.reload.enabled.after         | quando l'equilibrio raggiunge                                       | quando il saldo raggiunge                                               | major    | Billing semantic error (`saldo`, not physical balance).   |
| workspace.billing.addAction            | Aggiungere                                                          | Aggiungi                                                                | minor    | CTA should be imperative form.                            |
| workspace.payments.view                | Visualizzazione                                                     | Visualizza                                                              | minor    | CTA should be verb, not noun.                             |
| workspace.reload.disabled.before       | La ricarica automatica lo è                                         | La ricarica automatica è                                                | minor    | Remove incorrect pronoun for grammatical sentence.        |
| workspace.reload.enabled.before        | La ricarica automatica lo è                                         | La ricarica automatica è                                                | minor    | Remove incorrect pronoun for grammatical sentence.        |
| workspace.newUser.feature.lockin.title | Nessun blocco                                                       | Nessun lock-in                                                          | minor    | Prefer established product/industry term.                 |

---

### implementation batches

1. **Critical brand/status fixes**
   - `workspace.nav.zen`, `workspace.black.waitlist.left`
2. **Billing and waitlist semantics**
   - `workspace.billing.manage`, `workspace.billing.subtitle.beforeLink`, `workspace.black.waitlist.joined`, `workspace.black.waitlist.leaving`, `workspace.black.subscription.resetsIn`, `workspace.reload.enabled.after`, `workspace.payments.table.amount`
3. **Async/action grammar correctness**
   - `workspace.members.inviting`, all `*.saving` keys, `workspace.monthlyLimit.setting`, `workspace.newUser.step.login.before`
4. **AI/API terminology consistency**
   - `workspace.keys.title`, `workspace.nav.apiKeys`, `workspace.providers.table.apiKey`, `workspace.providers.title`
5. **Minor CTA/style normalizations**
   - `workspace.billing.addAction`, `workspace.payments.view`, `workspace.reload.disabled.before`, `workspace.reload.enabled.before`, `workspace.newUser.feature.lockin.title`

---

### acceptance checks for follow-up fix agent

- `workspace.nav.zen` is exactly `Zen`.
- Waitlist status strings use state semantics (`joined`, `leaving`, `left`) and preserve `OpenCode Black`.
- Billing `reload` copy clearly means balance top-up/recharge.
- `Chiave API` / `Chiavi API` ordering is consistent across workspace UI.
- BYOK meaning remains explicit in provider setup title.
- All placeholders are preserved exactly (`{{plan}}`, `{{provider}}`, `{{prefix}}`, `{{amount}}`, etc.).
