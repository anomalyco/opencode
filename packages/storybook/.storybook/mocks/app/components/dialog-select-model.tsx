import { splitProps } from "solid-js"

export function ModelSelectorPopover(props: { triggerAs: any; triggerProps?: Record<string, unknown>; children: any }) {
  const [local] = splitProps(props, ["triggerAs", "triggerProps", "children"])
  const Trigger = local.triggerAs
  return <Trigger {...(local.triggerProps ?? {})}>{local.children}</Trigger>
}
