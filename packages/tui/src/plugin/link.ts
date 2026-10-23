import type { LinkOpen, LinkOpenHook } from "@opencode/plugin/tui/context"

export function createLinkResolver(sources: () => ReadonlyArray<Readonly<Record<string, LinkOpenHook>>>) {
  return async (input: LinkOpen) => {
    const event = { ...input }
    for (const hook of sources().flatMap((source) => Object.values(source))) await hook(event)
    return event.url
  }
}
