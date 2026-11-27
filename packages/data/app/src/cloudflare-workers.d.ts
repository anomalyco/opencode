// The part of the Workers runtime module the site uses (lib/resource.cloudflare.ts). The full
// @cloudflare/workers-types would replace the DOM types the pages are written against.
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>
  export function waitUntil(promise: Promise<unknown>): void
}
