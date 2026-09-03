export * as ConfigWatch from "./watch.js"

import path from "path"
import { FSUtil } from "@opencode-ai/util/fs-util"
import type { Watcher } from "../filesystem/watcher.js"
import type { ConfigDiscovery } from "./discovery.js"

/** Pure watch planning; parsing documents and owning subscriptions happen elsewhere. */
export function plan(sources: ConfigDiscovery.Sources) {
  const directories = [
    ...(sources.global ? [sources.global] : []),
    ...sources.project.filter((root) => root.present).map((root) => root.path),
  ]
  const files = [
    ...sources.direct,
    ...sources.project.map((root) => root.path),
    ...(sources.explicit ? [sources.explicit] : []),
  ]
  const parents = new Map<string, Set<string>>()
  for (const file of files) {
    // A root still needs its parent sentinel even when recursively watched.
    if (directories.some((directory) => file !== directory && FSUtil.contains(directory, file))) continue
    const parent = path.dirname(file)
    const names = parents.get(parent) ?? new Set<string>()
    names.add(path.basename(file))
    parents.set(parent, names)
  }
  return new Map(
    [
      ...directories.map((path) => ({
        path,
        type: "directory" as const,
        ignore: ["node_modules", ".git", "**/{node_modules,.git}/**"],
      })),
      ...Array.from(parents, ([path, names]) => ({ path, type: "entries" as const, names: [...names].toSorted() })),
    ].map((target) => [JSON.stringify(target), target satisfies Watcher.WatchInput]),
  )
}
