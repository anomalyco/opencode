import { Resource } from "@opencode/console-resource"

/**
 * An SST-linked secret's value, or undefined when it isn't linked (SST's Resource throws then).
 * Its own module so lib/github-api.ts can import it lazily: a lazy import of the resource package
 * itself makes the bundler build its module namespace, whose `waitUntil` re-export from
 * cloudflare:workers it then drops, and every server render fails with "waitUntil is not defined".
 */
export function linkedSecret(name: string) {
  try {
    const value: unknown = (Resource as Record<string, { value?: unknown } | undefined>)[name]?.value
    return typeof value === "string" && value ? value : undefined
  } catch {
    return
  }
}
