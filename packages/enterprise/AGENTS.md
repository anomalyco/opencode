# ENTERPRISE KNOWLEDGE BASE

## OVERVIEW

Enterprise-facing Solid/Vite app with API routes and Cloudflare-target build variant.

## WHERE TO LOOK

- App routes/pages: `packages/enterprise/src/routes`
- Core logic/services: `packages/enterprise/src/core`
- Build targets: `packages/enterprise/package.json`
- Vite/runtime config: `packages/enterprise/vite.config.ts`

## CONVENTIONS

- Default build is `vite build`; Cloudflare build uses `OPENCODE_DEPLOYMENT_TARGET=cloudflare`.
- Typecheck uses `tsgo --noEmit`.
- Depends on shared `@opencode-ai/ui` and `@opencode-ai/util`.

## ANTI-PATTERNS

- Don’t treat enterprise routes as identical to `packages/app` routes.
- Don’t bypass target env flag when building for Cloudflare.
- Don’t duplicate shared ui/util code locally.
