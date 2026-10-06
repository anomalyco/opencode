import type { JSX } from "solid-js"
import type { ChangeKind } from "../review/contract"
import { Contract, type MountedSession, type SessionScreen } from "../sdk"

export interface FileTreeProps {
  /** The session screen that owns the rendered files. */
  readonly screen: SessionScreen
  readonly session: MountedSession
  /** The files to show, as a tree of only these paths. */
  readonly allowed: readonly string[]
  readonly kinds?: ReadonlyMap<string, ChangeKind>
  readonly active?: string
  onFileClick(path: string): void
}

export interface FileListProps {
  /** The session screen that owns the rendered files. */
  readonly screen: SessionScreen
  readonly session: MountedSession
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

export const FileTree = Contract.define<FileTree, "file.tree">("file.tree")

export interface OpenInAppProps {
  /** The session screen whose workspace opens. */
  readonly screen: SessionScreen
  readonly session: MountedSession
}

/** The desktop "Open in" button, for a panel header that shows it in place of the tab strip's. */
export interface OpenInApp {
  /** Renders nothing on the web or for a remote server. While it is mounted, the tab strip leaves out its own. */
  Button(props: OpenInAppProps): JSX.Element
}

export const OpenInApp = Contract.define<OpenInApp, "file.openInApp">("file.openInApp")
