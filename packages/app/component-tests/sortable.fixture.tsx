import { createMemo, createSignal, For } from "solid-js"
import { render } from "solid-js/web"
import { arrayMove, createSortable } from "@opencode/ui/sortable"

export function mountSortable() {
  const host = document.createElement("main")
  host.dataset.testid = "sortable-fixture"
  host.style.cssText = "position:fixed;top:24px;left:24px;width:200px;z-index:1000;background:white"
  document.body.appendChild(host)
  const [order, setOrder] = createSignal(["a", "b", "c"])
  const [tick, setTick] = createSignal(0)

  render(() => {
    let list!: HTMLDivElement

    // Like the queue panel's `live`, every recompute returns a new array, even with the same IDs.
    const ids = createMemo(() => {
      tick()

      return [...order()]
    })

    const sortable = createSortable({
      axis: () => "y",
      ids,
      container: () => list,
      onReorder: (from, to) => setOrder(arrayMove(order(), from, to)),
    })

    return (
      <div ref={list} class="flex flex-col">
        <For each={ids()}>
          {(id) => {
            const item = sortable.item(() => id)

            return (
              <div ref={item.ref} data-id={id} style={{ height: "32px" }}>
                {id}
              </div>
            )
          }}
        </For>
      </div>
    )
  }, host)

  return { recompute: () => setTick((value) => value + 1) }
}
