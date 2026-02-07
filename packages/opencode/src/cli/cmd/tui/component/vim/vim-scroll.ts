import type { VimEvent } from "./vim-handler"

export type VimScroll = "line-down" | "line-up" | "half-down" | "half-up" | "page-down" | "page-up"

export function vimScroll(event: VimEvent): VimScroll | undefined {
  if (!event.ctrl || event.meta || event.super) return
  const key = event.name ?? ""
  if (key === "e") return "line-down"
  if (key === "y") return "line-up"
  if (key === "d") return "half-down"
  if (key === "u") return "half-up"
  if (key === "f") return "page-down"
  if (key === "b") return "page-up"
  return undefined
}
