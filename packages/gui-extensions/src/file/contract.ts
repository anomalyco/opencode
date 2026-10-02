import type { JSX } from "solid-js"
import type { ChangeKind } from "../review/contract"
import { Service, type SessionView } from "../sdk"

export interface FileTreeProps {
  readonly session: SessionView
  /** The files to show, as a tree of only these paths. */
  readonly allowed: readonly string[]
  readonly kinds?: ReadonlyMap<string, ChangeKind>
  readonly active?: string
  onFileClick(path: string): void
}

export interface FileListProps {
  readonly session: SessionView
  readonly files: readonly string[]
  readonly kinds?: ReadonlyMap<string, ChangeKind>
  readonly active?: string
  /** Keyboard highlight of search results; takes over the selected row while set. */
  readonly highlighted?: string
  onFileClick(path: string): void
}

/** The file browser's virtualized tree and flat list, for other panels that list workspace files. */
export interface FileTree {
  Tree(props: FileTreeProps): JSX.Element
  List(props: FileListProps): JSX.Element
}

export const FileTree = Service.define<FileTree>("file.tree")
