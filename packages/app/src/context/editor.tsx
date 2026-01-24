import { createSignal, createMemo, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"

export type EditorTab = {
  path: string
  isDirty: boolean
  hasExternalChanges: boolean
}

export type EditorState = {
  // Tabs management
  tabs: EditorTab[]
  activeTab: Accessor<string | undefined>
  openFile: (path: string) => void
  closeTab: (path: string) => void
  closeOtherTabs: (path: string) => void
  closeAllTabs: () => void
  setActiveTab: (path: string) => void
  setTabDirty: (path: string, isDirty: boolean) => void
  setTabExternalChanges: (path: string, hasChanges: boolean) => void
  getTab: (path: string) => EditorTab | undefined
  // Legacy single-file API (for compatibility)
  filePath: Accessor<string | undefined>
  isOpen: Accessor<boolean>
  close: () => void
  // Panel visibility
  panelVisible: Accessor<boolean>
  toggle: () => void
  show: () => void
  hide: () => void
}

export const { use: useEditor, provider: EditorProvider } = createSimpleContext({
  name: "Editor",
  init: (): EditorState => {
    const [tabs, setTabs] = createStore<EditorTab[]>([])
    const [activeTabPath, setActiveTabPath] = createSignal<string | undefined>()
    const [panelVisible, setPanelVisible] = createSignal(true)

    const activeTab = createMemo(() => activeTabPath())
    const filePath = createMemo(() => activeTabPath())
    const isOpen = createMemo(() => panelVisible() && !!activeTabPath())

    const openFile = (path: string) => {
      // Check if tab already exists
      const existingIndex = tabs.findIndex((t) => t.path === path)
      if (existingIndex >= 0) {
        // Tab exists, just activate it
        setActiveTabPath(path)
      } else {
        // Add new tab
        setTabs([...tabs, { path, isDirty: false, hasExternalChanges: false }])
        setActiveTabPath(path)
      }
      setPanelVisible(true)
    }

    const closeTab = (path: string) => {
      const index = tabs.findIndex((t) => t.path === path)
      if (index < 0) return

      const newTabs = tabs.filter((t) => t.path !== path)
      setTabs(newTabs)

      // If closing the active tab, activate another one
      if (activeTabPath() === path) {
        if (newTabs.length > 0) {
          // Activate the tab at the same index, or the last one
          const newIndex = Math.min(index, newTabs.length - 1)
          setActiveTabPath(newTabs[newIndex].path)
        } else {
          setActiveTabPath(undefined)
        }
      }
    }

    const closeOtherTabs = (path: string) => {
      const tab = tabs.find((t) => t.path === path)
      if (tab) {
        setTabs([tab])
        setActiveTabPath(path)
      }
    }

    const closeAllTabs = () => {
      setTabs([])
      setActiveTabPath(undefined)
    }

    const setActiveTab = (path: string) => {
      if (tabs.some((t) => t.path === path)) {
        setActiveTabPath(path)
      }
    }

    const setTabDirty = (path: string, isDirty: boolean) => {
      const index = tabs.findIndex((t) => t.path === path)
      if (index >= 0) {
        setTabs(index, "isDirty", isDirty)
      }
    }

    const setTabExternalChanges = (path: string, hasChanges: boolean) => {
      const index = tabs.findIndex((t) => t.path === path)
      if (index >= 0) {
        setTabs(index, "hasExternalChanges", hasChanges)
      }
    }

    const getTab = (path: string) => tabs.find((t) => t.path === path)

    const close = () => {
      const path = activeTabPath()
      if (path) closeTab(path)
    }

    const toggle = () => setPanelVisible((v) => !v)
    const show = () => setPanelVisible(true)
    const hide = () => setPanelVisible(false)

    return {
      get tabs() {
        return tabs
      },
      activeTab,
      openFile,
      closeTab,
      closeOtherTabs,
      closeAllTabs,
      setActiveTab,
      setTabDirty,
      setTabExternalChanges,
      getTab,
      filePath,
      isOpen,
      close,
      panelVisible,
      toggle,
      show,
      hide,
    }
  },
})
