/**
 * GroupLayoutProvider
 *
 * Wraps each split group panel to provide per-group layout overrides.
 * Intercepts `useLayout()` so that file tree, session panel, and review panel
 * state are scoped to each group instead of being shared globally.
 */

import { type Accessor, type ParentProps } from "solid-js"
import { useLayout, LayoutContext } from "@/context/layout"
import { useClaxedoLayout } from "../context/claxedo-layout"

export function GroupLayoutProvider(props: ParentProps<{ groupId: string }>) {
  const parentLayout = useLayout()
  const claxedo = useClaxedoLayout()
  const gl = claxedo.groupLayout(props.groupId)

  // Create a layout value that delegates everything to the parent
  // except fileTree, session, and reviewPanel, which use per-group state.
  const modifiedLayout = {
    ...parentLayout,
    fileTree: {
      opened: gl.fileTree.opened,
      width: gl.fileTree.width,
      tab: gl.fileTree.tab,
      setTab: gl.fileTree.setTab,
      open() { gl.fileTree.setOpened(true) },
      close() { gl.fileTree.setOpened(false) },
      toggle() { gl.fileTree.setOpened(!gl.fileTree.opened()) },
      resize(width: number) { gl.fileTree.setWidth(width) },
    },
    session: {
      width: gl.session.width,
      collapsed: gl.session.collapsed,
      panelMode: gl.session.panelMode,
      resize(width: number) { gl.session.setWidth(width) },
      collapse() { gl.session.setCollapsed(true) },
      expand() { gl.session.setCollapsed(false) },
      toggle() { gl.session.setCollapsed(!gl.session.collapsed()) },
      setPanelMode(mode: number) { gl.session.setPanelMode(mode) },
    },
    // Override view() to use per-group reviewPanel state
    view(sessionKey: string | Accessor<string>) {
      const parentView = parentLayout.view(sessionKey)
      return {
        ...parentView,
        reviewPanel: {
          opened: gl.reviewPanel.opened,
          open() { gl.reviewPanel.setOpened(true) },
          close() { gl.reviewPanel.setOpened(false) },
          toggle() { gl.reviewPanel.setOpened(!gl.reviewPanel.opened()) },
        },
      }
    },
  }

  return (
    <LayoutContext.Provider value={modifiedLayout as ReturnType<typeof useLayout>}>
      {props.children}
    </LayoutContext.Provider>
  )
}
