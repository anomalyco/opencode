import { checksum } from "@opencode-ai/util/encode"
import { FileDiff } from "@pierre/diffs"
import { createMediaQuery } from "@solid-primitives/media"
import { createEffect, createMemo, onCleanup, splitProps } from "solid-js"
import { createDefaultOptions, type DiffProps, styleVariables } from "../pierre"
import { getWorkerPool } from "../pierre/worker"

export function Diff<T>(props: DiffProps<T>) {
  let container!: HTMLDivElement
  let observer: MutationObserver | undefined
  let renderToken = 0

  const [local, others] = splitProps(props, ["before", "after", "class", "classList", "annotations", "onRendered"])

  const mobile = createMediaQuery("(max-width: 640px)")

  const options = createMemo(() => {
    const opts = {
      ...createDefaultOptions(props.diffStyle),
      ...others,
    }
    if (!mobile()) return opts
    return {
      ...opts,
      disableLineNumbers: true,
    }
  })

  let instance: FileDiff<T> | undefined

  const getRoot = () => {
    const host = container.querySelector("diffs-container")
    if (!(host instanceof HTMLElement)) return

    const root = host.shadowRoot
    if (!root) return

    return root
  }

  const notifyRendered = () => {
    if (!local.onRendered) return

    observer?.disconnect()
    observer = undefined
    renderToken++

    const token = renderToken
    let settle = 0

    const isReady = (root: ShadowRoot) => root.querySelector("[data-line]") != null

    const notify = () => {
      if (token !== renderToken) return

      observer?.disconnect()
      observer = undefined
      requestAnimationFrame(() => {
        if (token !== renderToken) return
        local.onRendered?.()
      })
    }

    const schedule = () => {
      settle++
      const current = settle

      requestAnimationFrame(() => {
        if (token !== renderToken) return
        if (current !== settle) return

        requestAnimationFrame(() => {
          if (token !== renderToken) return
          if (current !== settle) return

          notify()
        })
      })
    }

    const observeRoot = (root: ShadowRoot) => {
      observer?.disconnect()
      observer = new MutationObserver(() => {
        if (token !== renderToken) return
        if (!isReady(root)) return

        schedule()
      })

      observer.observe(root, { childList: true, subtree: true })

      if (!isReady(root)) return
      schedule()
    }

    const root = getRoot()
    if (typeof MutationObserver === "undefined") {
      if (!root || !isReady(root)) return
      local.onRendered()
      return
    }

    if (root) {
      observeRoot(root)
      return
    }

    observer = new MutationObserver(() => {
      if (token !== renderToken) return

      const root = getRoot()
      if (!root) return

      observeRoot(root)
    })

    observer.observe(container, { childList: true, subtree: true })
  }

  createEffect(() => {
    const opts = options()
    const workerPool = getWorkerPool(props.diffStyle)
    const annotations = local.annotations
    const beforeContents = typeof local.before?.contents === "string" ? local.before.contents : ""
    const afterContents = typeof local.after?.contents === "string" ? local.after.contents : ""

    instance?.cleanUp()
    instance = new FileDiff<T>(opts, workerPool)

    container.innerHTML = ""
    instance.render({
      oldFile: {
        ...local.before,
        contents: beforeContents,
        cacheKey: checksum(beforeContents),
      },
      newFile: {
        ...local.after,
        contents: afterContents,
        cacheKey: checksum(afterContents),
      },
      lineAnnotations: annotations,
      containerWrapper: container,
    })

    notifyRendered()
  })

  onCleanup(() => {
    observer?.disconnect()
    instance?.cleanUp()
  })

  return <div data-component="diff" style={styleVariables} ref={container} />
}
