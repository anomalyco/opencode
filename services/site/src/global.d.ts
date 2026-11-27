/// <reference types="@solidjs/start/env" />

// The static pages' script, from its own build (script/static-client.ts); null in development.
declare module "virtual:static-client" {
  const script: string | null
  export default script
}
