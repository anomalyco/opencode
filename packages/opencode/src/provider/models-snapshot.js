// @ts-nocheck
// Empty stub committed for the bench harness build path.
//
// Upstream opencode generates this file at build time via `script/generate.ts`
// (which fetches https://models.dev/api.json). For the nemo-gym bench harness
// we only register a single custom provider in the per-instance opencode
// config, so the snapshot is unused — but `bun build` still has to resolve
// `import("./models-snapshot.js")` from `provider/models.ts:137` at static
// analysis time. An empty snapshot satisfies that requirement; the runtime
// `try:` lambda in models.ts handles an empty snapshot gracefully.
//
// `.gitignore` excludes this file because upstream regenerates it. We
// force-add it on the bench branch (sdd/dev) so `bun build --target=bun
// packages/opencode/src/index.ts ...` succeeds without running generate.ts
// (which requires network access to models.dev). If you ever DO want real
// model metadata, run `bun run script/generate.ts` and don't commit the
// regenerated file.
export const snapshot = {}
