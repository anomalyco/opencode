import { splitProps, type JSX } from "solid-js"

export function ModelSelectorPopover(props: {
  trigger: JSX.Element | ((props: Record<string, unknown>) => JSX.Element)
}) {
  const [local] = splitProps(props, ["trigger"])
  return <>{typeof local.trigger === "function" ? local.trigger({}) : local.trigger}</>
}

export const ModelSelectorPopoverV2 = ModelSelectorPopover
