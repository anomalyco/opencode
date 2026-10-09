import type { Component, JSX } from "solid-js"
import type { ArtifactKind } from "@opencode/util/artifact"
import type { ChangeKind } from "../review/contract"
import { Contract, Registry, type MountedSession, type SessionScreen } from "../sdk"

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

export interface FileViewerProps {
  /**
   * The file's bytes, which this view owns: it may move their buffer elsewhere, such as to a worker, instead of copying
   * it. A new array is a reloaded file.
   */
  readonly bytes: Uint8Array
  /** Shows facts about the file, such as "3 sheets", in the toolbar before its size. */
  onDetails(details: readonly string[]): void
  /** The file could not be opened; the file view shows its binary placeholder instead, with `reason` when given. */
  onError(reason?: string): void
}

/** A viewer for a kind of file the file view does not render itself, such as an Office document. */
export interface FileViewer {
  /** The kinds it renders. A file the first matching viewer cannot open, or no viewer lists, shows as binary. */
  readonly kinds: readonly ArtifactKind[]
  /**
   * Why these bytes cannot be shown, checked before `View` or its engine loads, such as a file that is not in the
   * format its name says. Returns undefined for bytes `View` should open.
   */
  problem?(bytes: Uint8Array): string | undefined
  /** Renders one file in the file view's stage. Bind it with `bindExtension` in setup. A thrown error shows as binary. */
  readonly View: Component<FileViewerProps>
}

export const FileViewer = Registry.define<FileViewer>("file.viewer")
