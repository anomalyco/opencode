import { For, onMount } from "solid-js"
import { Button } from "@opencode/ui/button"
import { useDialog } from "../context/dialog"
import { DiagramPreview } from "./diagram-preview"

function DiagramStory(props: { wide: boolean; opened: boolean }) {
  const dialog = useDialog()

  const nodes = () =>
    props.wide ? ["Draft", "Validate", "Review", "Approve", "Publish", "Archive"] : ["Draft", "Publish"]

  let source!: SVGSVGElement

  const open = () => {
    const svg = source.cloneNode(true)

    if (svg instanceof SVGSVGElement) void dialog.show(() => <DiagramPreview svg={svg} />)
  }

  onMount(() => props.opened && open())

  return (
    <div class="grid w-full max-w-lg justify-items-start gap-4">
      <svg
        ref={source}
        role="img"
        aria-label="Publication workflow"
        viewBox={`0 0 ${nodes().length * 150} 80`}
        style={{ "max-width": "100%" }}
      >
        <For each={nodes()}>
          {(label, i) => (
            <g transform={`translate(${i() * 150}, 10)`}>
              <path d={i() ? "M-30 30H0" : ""} stroke="currentColor" />
              <rect
                x="1"
                y="1"
                width="118"
                height="58"
                rx="6"
                fill="var(--v2-background-bg-layer-01)"
                stroke="var(--v2-border-border-base)"
              />
              <text x="60" y="31" fill="currentColor" text-anchor="middle" dominant-baseline="middle">
                {label}
              </text>
            </g>
          )}
        </For>
      </svg>
      <Button onClick={open}>Open diagram preview</Button>
    </div>
  )
}

export default { title: "UI/DiagramPreview", id: "ui-diagram-preview" }

export const Inline = { render: () => <DiagramStory wide={false} opened={false} /> }

export const Open = { render: () => <DiagramStory wide={false} opened /> }

export const Wide = { render: () => <DiagramStory wide opened /> }
