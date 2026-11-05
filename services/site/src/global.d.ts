/// <reference types="@solidjs/start/env" />

// Where the client build put each locale's translation slices (script/i18n-plugin.ts); null in development.
declare module "virtual:i18n-preload" {
  const preloads: Record<
    import("~/lib/language").Locale,
    { table?: string; shell: string | null; routes: Record<string, string | null> }
  > | null
  export default preloads
}
