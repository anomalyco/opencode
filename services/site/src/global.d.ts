/// <reference types="@solidjs/start/env" />

// Where the client build put each locale's translation slices (script/i18n-plugin.ts); null in development.
declare module "virtual:i18n-preload" {
  const preloads: Record<
    import("~/lib/language").Locale,
    { table?: string; routes: Record<string, string | null>; boundaries: Record<string, string | null> }
  > | null
  export default preloads
}

// The static pages' script, from its own build (script/static-client.ts); null in development.
declare module "virtual:static-client" {
  const script: string | null
  export default script
}
