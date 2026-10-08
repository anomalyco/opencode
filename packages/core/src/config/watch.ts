export * as ConfigWatch from "./watch.js"

import path from "path"
import { Effect } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import type { Watcher } from "../filesystem/watcher.js"
import { ConfigDiscovery } from "./discovery.js"

export const plan = Effect.fn("ConfigWatch.plan")(function* (sources: ConfigDiscovery.Sources) {
  const fs = yield* FSUtil.Service
  const directories = [
    ...(sources.global ? [sources.global] : []),
    ...sources.project.filter((root) => root.present).map((root) => root.path),
  ]
  // Directory watches do not follow file symlinks outside their roots. Keep
  // both spellings so target edits and changes to the link are observable.
  const linked = yield* Effect.forEach(
    [
      ...directories.flatMap((directory) => ConfigDiscovery.names.map((name) => path.join(directory, name))),
      ...sources.direct,
      ...(sources.explicit ? [sources.explicit] : []),
    ],
    (file) =>
      fs.readLink(file).pipe(
        Effect.flatMap((link) => fs.resolve(path.resolve(path.dirname(file), link))),
        Effect.orElseSucceed(() => undefined),
      ),
  )
  const files = [
    ...linked.filter((file) => file !== undefined),
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
        ignore: ["node_modules", ".git", "**/{node_modules,.git}/**"],
      })),
      ...Array.from(parents, ([parent, files]) => ({
        path: parent,
        type: "entries" as const,
        names: [...new Set(files.map((file) => path.basename(file)))].toSorted(),
      })),
    ].map((target) => [JSON.stringify(target), target satisfies Watcher.WatchInput]),
  )
})
