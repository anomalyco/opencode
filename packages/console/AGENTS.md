# CONSOLE KNOWLEDGE BASE

## OVERVIEW

`packages/console` is the SaaS domain split into `app`, `core`, `function`, `mail`, `resource`.

## WHERE TO LOOK

- UI routes/pages: `packages/console/app/src/routes`
- Billing/data logic: `packages/console/core/src`
- Worker handlers: `packages/console/function/src`
- Email templates: `packages/console/mail/emails`
- Env/resource wiring: `packages/console/resource`

## CONVENTIONS

- `console/app` build chains `generate-sitemap.ts`, `vite build`, then `../../opencode/script/schema.ts`.
- `console/core` uses `sst shell` scripts for db/model promotion flows.
- `console/resource` has target-specific entries (`resource.node.ts`, `resource.cloudflare.ts`).
- Typecheck uses `tsgo --noEmit` in console packages.

## ANTI-PATTERNS

- Don’t treat `console` as one app; each subpackage has distinct runtime/deploy needs.
- Don’t bypass `sst shell` for core db/model scripts.
- Don’t place business logic inside email/template files.
