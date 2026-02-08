import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { usePaneManager, type RenderNode, type RenderTree } from "../context/pane-manager"

type Props<Meta> = {
  containerId: string
  renderLeaf: (node: RenderNode<Meta>) => JSX.Element
  renderTitle?: (node: RenderNode<Meta>) => JSX.Element
  renderSplitHandle?: (node: RenderNode<Meta>) => JSX.Element
  renderEmpty?: () => JSX.Element
}

const style = (r: { x: number; y: number; width: number; height: number }) => ({
  position: "absolute" as const,
  left: `${r.x}%`,
  top: `${r.y}%`,
  width: `${r.width}%`,
  height: `${r.height}%`,
})

const collect = <Meta,>(root: RenderNode<Meta> | undefined) => {
  const out = { leaves: [] as RenderNode<Meta>[], splits: [] as RenderNode<Meta>[] }
  if (!root) return out
  const rec = (n: RenderNode<Meta>) => {
    if (n.type === "leaf") out.leaves.push(n)
    if (n.type === "split") out.splits.push(n)
    n.children?.forEach(rec)
  }
  rec(root)
  return out
}

export const PaneRenderer = <Meta,>(props: Props<Meta>) => {
  const pane = usePaneManager<Meta>()
  const [tree, setTree] = createSignal<RenderTree<Meta>>({ containerId: props.containerId })

  createEffect(() => {
    setTree({ containerId: props.containerId })
    const unsub = pane.onLayoutChange(props.containerId, setTree)
    onCleanup(unsub)
  })

  const nodes = () => collect(tree().root)

  return (
    <div style={{ position: "relative" as const, width: "100%", height: "100%" }} data-pane-container={props.containerId}>
      <Show when={tree().root} fallback={props.renderEmpty?.()}>
        <For each={nodes().leaves}>
          {(node) => (
            <div style={style(node.rect)} data-pane-node={node.id} data-pane-type="leaf" data-pane-path={node.path}>
              {props.renderTitle?.(node)}
              {props.renderLeaf(node)}
            </div>
          )}
        </For>
        <Show when={props.renderSplitHandle}>
          <For each={nodes().splits}>
            {(node) => (
              <div
                style={
                  node.splitDirection === "v"
                    ? {
                        position: "absolute" as const,
                        left: `calc(${node.splitPosition ?? 0}% - 2px)`,
                        top: `${node.rect.y}%`,
                        width: "4px",
                        height: `${node.rect.height}%`,
                      }
                    : {
                        position: "absolute" as const,
                        left: `${node.rect.x}%`,
                        top: `calc(${node.splitPosition ?? 0}% - 2px)`,
                        width: `${node.rect.width}%`,
                        height: "4px",
                      }
                }
                data-pane-node={node.id}
                data-pane-type="split"
                data-pane-path={node.path}
              >
                {props.renderSplitHandle?.(node)}
              </div>
            )}
          </For>
        </Show>
      </Show>
    </div>
  )
}
