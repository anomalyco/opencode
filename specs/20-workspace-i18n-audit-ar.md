## workspace i18n audit - ar

Arabic translation audit for workspace routes with focus on Zen/AI/billing terminology accuracy.

---

### coverage

- Route scope: `packages/console/app/src/routes/workspace/**`
- Locale file: `packages/console/app/src/i18n/ar.ts`
- Source reference: `packages/console/app/src/i18n/en.ts`
- Unique keys in scope: **181**
- Flagged keys: **31** (critical: 4, major: 23, minor: 4)

---

### glossary decisions (ar)

- `Zen`: keep exactly `Zen`
- `OpenCode Black`: keep exactly `OpenCode Black`
- `Stripe`: keep exactly `Stripe`
- `opencode`: keep exactly `opencode`
- `API`: keep exactly `API`
- `/models`: keep exactly `/models`
- `model`: `نموذج` / `نماذج`
- `provider`: `مزوّد`
- `API key`: `مفتاح API`
- `Bring Your Own Key`: `استخدم مفتاحك الخاص`
- `usage`: `الاستخدام`
- `cost`: `التكلفة`
- `billing`: `الفوترة`
- `monthly spending limit`: `حد الإنفاق الشهري`
- `auto reload` (billing context): `إعادة الشحن التلقائي`
- Keep placeholders exactly as-is: `{{provider}}`, `{{prefix}}`, `{{plan}}`, `{{amount}}`.

---

### required key updates

| key                                    | replace with                                                       | severity | reason                                               |
| -------------------------------------- | ------------------------------------------------------------------ | -------- | ---------------------------------------------------- |
| workspace.nav.zen                      | Zen                                                                | critical | Product literal must not be translated.              |
| workspace.billing.linkedToStripe       | مرتبط بـ Stripe                                                    | critical | Keep payment brand literal `Stripe`.                 |
| workspace.black.waitlist.joined        | أنت على قائمة الانتظار لخطة OpenCode Black بقيمة ${{plan}} شهريًا. | critical | Preserve exact literal `OpenCode Black`.             |
| workspace.black.waitlist.ready         | نحن مستعدون لتسجيلك في خطة OpenCode Black بقيمة ${{plan}} شهريًا.  | critical | Preserve exact literal `OpenCode Black`.             |
| workspace.nav.apiKeys                  | مفاتيح API                                                         | major    | Correct `API` key word order.                        |
| workspace.keys.title                   | مفاتيح API                                                         | major    | Correct `API` key word order.                        |
| workspace.providers.table.apiKey       | مفتاح API                                                          | major    | Correct `API` key word order.                        |
| workspace.cost.title                   | التكلفة                                                            | major    | `Cost` mistranslated as verb.                        |
| workspace.usage.table.cost             | التكلفة                                                            | major    | `Cost` mistranslated as verb.                        |
| workspace.cost.allModels               | جميع النماذج                                                       | major    | Prefer standard AI term `نماذج`.                     |
| workspace.cost.subscriptionShort       | اشتراك                                                             | major    | Current value is semantically wrong.                 |
| workspace.payments.table.amount        | المبلغ                                                             | major    | Financial amount mistranslated as quantity.          |
| workspace.payments.view                | عرض                                                                | major    | CTA mistranslated as noun “scenery”.                 |
| workspace.monthlyLimit.setting         | جارٍ التعيين...                                                    | major    | Progress state mistranslated.                        |
| workspace.settings.defaultName         | الافتراضي                                                          | major    | Default label mistranslated.                         |
| workspace.newUser.step.login.before    | شغّل                                                               | major    | CLI imperative “Run” mistranslated.                  |
| workspace.members.role.admin           | مسؤول                                                              | major    | Spelling error.                                      |
| workspace.reload.title                 | إعادة الشحن التلقائي                                               | major    | Billing `reload` means top-up/recharge, not refresh. |
| workspace.reload.enableAutoReload      | تفعيل إعادة الشحن التلقائي                                         | major    | Must reflect top-up semantics.                       |
| workspace.reload.reloadAmount          | مبلغ إعادة الشحن $                                                 | major    | Must reflect recharge amount.                        |
| workspace.reload.failedAt              | فشلت إعادة الشحن في                                                | major    | Must reflect recharge failure.                       |
| workspace.reload.disabled.state        | معطّل                                                              | major    | Incorrect toggle state term.                         |
| workspace.reload.enabled.after         | عندما يصل الرصيد إلى                                               | major    | `balance` mistranslated as “equilibrium”.            |
| workspace.reload.enable                | تفعيل                                                              | major    | CTA form mistranslated.                              |
| workspace.reload.disabled.before       | إعادة الشحن التلقائي                                               | major    | Align phrase with recharge semantics.                |
| workspace.reload.enabled.before        | إعادة الشحن التلقائي                                               | major    | Align phrase with recharge semantics.                |
| workspace.reload.enabled.middle        | سنعيد شحن رصيدك بمبلغ                                              | major    | Must explicitly mean topping up balance.             |
| workspace.billing.addAction            | إضافة                                                              | minor    | CTA grammatical form fix.                            |
| workspace.billing.manage               | إدارة                                                              | minor    | CTA grammatical form fix.                            |
| workspace.keys.empty                   | أنشئ مفتاح API لبوابة opencode                                     | minor    | Improve technical clarity and ordering.              |
| workspace.newUser.feature.lockin.title | بدون احتجاز بمزوّد واحد                                            | minor    | Better conveys “No Lock-in”.                         |

---

### implementation batches

1. **Brand literals first (critical)**
   - `workspace.nav.zen`, `workspace.billing.linkedToStripe`, `workspace.black.waitlist.joined`, `workspace.black.waitlist.ready`
2. **Reload/recharge semantics**
   - `workspace.reload.*` flagged keys to ensure top-up meaning (not page refresh)
3. **Billing/payment terminology**
   - `workspace.cost.title`, `workspace.usage.table.cost`, `workspace.payments.table.amount`, `workspace.payments.view`, `workspace.monthlyLimit.setting`
4. **API/workspace wording fixes**
   - API-key ordering keys, `workspace.settings.defaultName`, `workspace.members.role.admin`, `workspace.newUser.step.login.before`
5. **Minor CTA/clarity polish**
   - `workspace.billing.addAction`, `workspace.billing.manage`, `workspace.keys.empty`, `workspace.newUser.feature.lockin.title`

---

### acceptance checks for follow-up fix agent

- `workspace.nav.zen` value is exactly `Zen`.
- `workspace.billing.linkedToStripe` contains `Stripe` literal.
- `workspace.black.waitlist.joined` and `workspace.black.waitlist.ready` keep `OpenCode Black` exactly.
- No `workspace.reload.*` string implies page refresh; all imply balance top-up/recharge.
- API key labels use `مفتاح API` / `مفاتيح API` ordering.
- Preserve literals exactly: `Zen`, `Stripe`, `OpenCode Black`, `opencode`, `API`, `/models`.
- All placeholders remain unchanged (`{{provider}}`, `{{prefix}}`, `{{plan}}`, `{{amount}}`).
