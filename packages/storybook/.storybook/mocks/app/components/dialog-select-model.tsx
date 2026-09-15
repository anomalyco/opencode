import { splitProps, type JSX } from "solid-js"

export function ModelSelectorPopover(props: { trigger: (props: Record<string, unknown>) => JSX.Element }) {
  const [local] = splitProps(props, ["trigger"])
  return <>{local.trigger({})}</>
}

export const ModelSelectorPopoverV2 = ModelSelectorPopover
