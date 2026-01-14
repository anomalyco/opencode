import "./flow-arrow.css"

export interface FlowArrowProps {
  status: "pending" | "running" | "complete" | "failed"
  direction?: "horizontal" | "vertical"
  class?: string
}

export function FlowArrow(props: FlowArrowProps) {
  const direction = () => props.direction ?? "horizontal"

  return (
    <div
      data-component="flow-arrow"
      data-status={props.status}
      data-direction={direction()}
      class={props.class}
    >
      <div data-slot="line" />
      <div data-slot="head">
        <svg viewBox="0 0 12 12" fill="none">
          <path d="M2 2L10 6L2 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
    </div>
  )
}
