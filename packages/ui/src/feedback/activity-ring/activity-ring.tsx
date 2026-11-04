import { type ComponentProps } from "solid-js"
import { Spinner } from "../../components/spinner"
import "./activity-ring.css"

export function ActivityRing(props: ComponentProps<typeof Spinner>) {
  return (
    <Spinner
      {...props}
      width={props.width ?? 14}
      height={props.height ?? 14}
      data-component="activity-ring"
      aria-hidden={props["aria-hidden"] ?? "true"}
    />
  )
}
