import { checksum } from "@opencode-ai/util/encode"
import { FileDiff } from "@pierre/diffs"
import { createEffect, createMemo, onCleanup, splitProps } from "solid-js"
import { createDefaultOptions, type DiffProps, styleVariables } from "../pierre"
import { getWorkerPool } from "../pierre/worker"

export function Diff<T>(props: DiffProps<T>) {
  let container!: HTMLDivElement
  const [local, others] = splitProps(props, ["before", "after", "class", "classList", "annotations"])

  const options = createMemo(() => ({
    ...createDefaultOptions(props.diffStyle),
    ...others,
  }))

  let instance: FileDiff<T> | undefined

  createEffect(() => {
    const opts = options()
    const workerPool = getWorkerPool(props.diffStyle)
    const annotations = local.annotations

    instance?.cleanUp()
    instance = new FileDiff<T>(opts, workerPool)

    container.innerHTML = ""
    instance.render({
      oldFile: {
        ...local.before,
        cacheKey: checksum(local.before.contents),
      },
      newFile: {
        ...local.after,
        cacheKey: checksum(local.after.contents),
      },
      lineAnnotations: annotations,
      containerWrapper: container,
    })
  })

  onCleanup(() => {
    instance?.cleanUp()
  })

  return <div data-component="diff" style={styleVariables} ref={container} />
}
