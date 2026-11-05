export * as ConfigWatch from "./watch.js"

import path from "path"
import { FSUtil } from "@opencode/util/fs-util"
import type { Watcher } from "../filesystem/watcher.js"
import { ConfigDiscovery } from "./discovery.js"

/** Paths whose content or presence feeds the loaded config; other writes under watched roots do not. */
export function inputs(sources: ConfigDiscovery.Sources) {
  const roots = [
    ...(sources.system ? [sources.system.path] : []),
    ...(sources.global ? [sources.global] : []),
    ...sources.project.map((root) => root.path),
  ]
  return new Set<string>([
    ...roots,
    ...roots.flatMap((root) => ConfigDiscovery.names.map((name) => path.join(root, name))),
    ...sources.direct,
    ...sources.claude,
    ...sources.agents,
    ...(sources.explicit ? [sources.explicit] : []),
  ])
}

export function plan(sources: ConfigDiscovery.Sources) {
  const directories = [
    ...(sources.system?.present ? [sources.system.path] : []),
    ...(sources.global ? [sources.global] : []),
    ...sources.project.filter((root) => root.present).map((root) => root.path),
  ]
  const files = [
    ...(sources.system ? [sources.system.path] : []),
    ...sources.direct,
    ...sources.project.map((root) => root.path),
    ...sources.claude,
    ...sources.agents,
    ...(sources.explicit ? [sources.explicit] : []),
  ]
  // Keep a parent watch for each root so deletion/recreation is observable.
  const parents = Map.groupBy(
    files.filter((file) => !directories.some((directory) => file !== directory && FSUtil.contains(directory, file))),
    (file) => path.dirname(file),
  )
  return new Map(
    [
      ...directories.map((path) => ({
        path,
        type: "directory" as const,
        ignore: FSUtil.ignoreGlobs,
      })),
      ...Array.from(parents, ([parent, files]) => ({
        path: parent,
        type: "entries" as const,
        names: [...new Set(files.map((file) => path.basename(file)))].toSorted(),
      })),
    ].map((target) => [JSON.stringify(target), target satisfies Watcher.WatchInput]),
  )
}
