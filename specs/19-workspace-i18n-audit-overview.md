## workspace i18n audit overview (zen workspace routes)

Audit objective: verify translation accuracy for customer-facing workspace management pages used to manage Zen (AI inference provider) usage, with strict terminology and brand integrity.

---

### scope

- Routes audited: `packages/console/app/src/routes/workspace/**` (all workspace TSX routes, including billing/keys/members/settings)
- Locale files audited: `packages/console/app/src/i18n/ar.ts`, `packages/console/app/src/i18n/da.ts`, `packages/console/app/src/i18n/de.ts`, `packages/console/app/src/i18n/it.ts`
- Source-of-truth copy: `packages/console/app/src/i18n/en.ts`
- Total unique translation keys used by workspace routes: **181**

---

### deliverables

- Arabic audit and fix spec: `specs/20-workspace-i18n-audit-ar.md`
- Danish audit and fix spec: `specs/21-workspace-i18n-audit-da.md`
- German audit and fix spec: `specs/22-workspace-i18n-audit-de.md`
- Italian audit and fix spec: `specs/23-workspace-i18n-audit-it.md`

These files are intentionally execution-ready so follow-up agents can apply string fixes without re-auditing.

---

### non-negotiable terminology contract

1. Product names and brands:
   - `Zen` must remain exactly `Zen` (never translated, never lowercased).
   - `Stripe`, `OpenCode Black`, `opencode`, `API`, `/models` remain literal.
2. AI domain terms must preserve technical meaning:
   - `model` = AI model, not fashion/product model.
   - `provider` = AI provider/vendor.
   - `Bring Your Own Key` = BYOK concept (user-provided API credential).
3. Billing/top-up language must stay financial:
   - `reload` in billing pages means balance top-up/recharge, not page refresh.
   - `amount`, `cost`, `usage`, `monthly spending limit` must map to metering/billing context.
4. Placeholder and interpolation safety:
   - Keep placeholders unchanged (`{{provider}}`, `{{prefix}}`, `{{amount}}`, etc).
   - Keep currency symbols and key ordering intact.

---

### cross-locale risk summary

- Critical risk focus across locales: billing `reload` text must consistently mean balance top-up/recharge (not page refresh), while product literals and CLI command verbs remain exact.
- `ar` (Arabic): **31** flagged keys (critical: 4, major: 23, minor: 4), with critical literals broken for `Zen`, `Stripe`, and `OpenCode Black` waitlist strings.
- `da` (Danish): **33** flagged keys (critical: 8, major: 18, minor: 7), concentrated in reload/top-up semantics plus onboarding/default-label blockers.
- `de` (German): **34** flagged keys (critical: 6, major: 27, minor: 1), centered on reload/top-up semantics, onboarding command phrasing, and usage metric wording.
- `it` (Italian): **25** flagged keys (critical: 2, major: 18, minor: 5), led by `Zen` casing and waitlist status semantics with broader API/billing wording drift.

---

### remediation workflow for follow-up agents

1. Pick one locale spec (`20`/`21`/`22`/`23`) and apply only mapped key updates in that locale file.
2. Do not add/remove keys; only edit string values.
3. Preserve placeholders and punctuation contracts.
4. Run app typecheck:
   - `bun run typecheck` in `packages/console/app`
5. Run post-fix terminology sanity checks:
   - Literal checks in locale files: `Zen`, `Stripe`, `OpenCode Black`, `opencode`, `API`, `/models`.
   - `workspace.reload.*` language matches top-up/recharge semantics.
   - `API key` labels are ordered naturally in target language.
   - Placeholders remain unchanged (`{{provider}}`, `{{prefix}}`, `{{plan}}`, `{{amount}}`, etc).

---

### acceptance criteria

- All mapped critical and major issues in locale specs are fixed.
- `workspace.nav.zen` is exactly `Zen` in all locales.
- `workspace.billing.linkedToStripe` preserves `Stripe` literal in all locales.
- Workspace billing and usage terminology is technically accurate for AI inference workflows.
- No placeholder regressions.
