import { Root } from "@kobalte/core/button"
import type { ComponentProps } from "solid-js"
import "../styles/file-tree.css"

/** Interactive row for the shared file-tree and file-search presentation. */
export function FileTreeItem(props: ComponentProps<typeof Root>) {
  return <Root {...props} data-slot="file-tree-v2-row" />
}
