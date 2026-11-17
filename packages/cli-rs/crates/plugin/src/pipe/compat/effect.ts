// The `effect` package the JS host serves a plugin that imports it (CT-13), as TS's runtime serves its own: bundled by
// `script/gen/js-host.ts` into `effect.js`, which the JS host loads only once a plugin imports `effect`.
export * from "effect"
