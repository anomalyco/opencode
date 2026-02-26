// @ts-nocheck
import { preloadMultiFileDiff } from "@pierre/diffs/ssr"
import { createResource, Show } from "solid-js"
import * as mod from "./diff-ssr"
import { createDefaultOptions } from "../pierre"
import { WorkerPoolProvider } from "../context/worker-pool"
import { getWorkerPools } from "../pierre/worker"
import { diff } from "../storybook/fixtures"

const docs = `### Overview
Server-rendered diff hydration component for preloaded Pierre diff output.

Use alongside server routes that preload diffs.
Pair with \`DiffChanges\` for summaries.

### API
- Required: \`before\`, \`after\`, and \`preloadedDiff\` from \`preloadMultiFileDiff\`.
- Optional: \`diffStyle\`, \`annotations\`, \`selectedLines\`, \`commentedLines\`.

### Variants and states
- Unified/split styles (preloaded must match the style used during preload).

### Behavior
- Hydrates pre-rendered diff HTML into a live diff instance.
- Requires a worker pool provider for syntax highlighting.

### Accessibility
- TODO: confirm keyboard behavior from the Pierre diff engine.

### Theming/tokens
- Uses \`data-component="diff"\` with Pierre CSS variables and theme tokens.

`

const load = async () => {
  return preloadMultiFileDiff({
    oldFile: diff.before,
    newFile: diff.after,
    options: createDefaultOptions("unified"),
  })
}

const loadSplit = async () => {
  return preloadMultiFileDiff({
    oldFile: diff.before,
    newFile: diff.after,
    options: createDefaultOptions("split"),
  })
}

export default {
  title: "UI/DiffSSR",
  id: "components-diff-ssr",
  component: mod.Diff,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = {
  render: () => {
    const [data] = createResource(load)
    return (
      <WorkerPoolProvider pools={getWorkerPools()}>
        <Show when={data()} fallback={<div>Loading pre-rendered diff...</div>}>
          {(preloaded) => (
            <div style={{ "max-width": "960px" }}>
              <mod.Diff before={diff.before} after={diff.after} diffStyle="unified" preloadedDiff={preloaded()} />
            </div>
          )}
        </Show>
      </WorkerPoolProvider>
    )
  },
}

export const Split = {
  render: () => {
    const [data] = createResource(loadSplit)
    return (
      <WorkerPoolProvider pools={getWorkerPools()}>
        <Show when={data()} fallback={<div>Loading pre-rendered diff...</div>}>
          {(preloaded) => (
            <div style={{ "max-width": "960px" }}>
              <mod.Diff before={diff.before} after={diff.after} diffStyle="split" preloadedDiff={preloaded()} />
            </div>
          )}
        </Show>
      </WorkerPoolProvider>
    )
  },
}
