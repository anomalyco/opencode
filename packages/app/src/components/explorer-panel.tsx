import { createEffect, createMemo, createSignal, createResource, For, Show, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import { useParams } from "@solidjs/router"
import { base64Decode } from "@opencode-ai/util/encode"
import { Icon } from "@opencode-ai/ui/icon"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"

export type FileExplorerItem = {
  name: string
  path: string
  isDirectory: boolean
  expanded: boolean
  children: FileExplorerItem[]
}

type ClipboardState = {
  path: string
  operation: "copy" | "cut"
} | null

export function ExplorerPanel(props: { onFileOpen: (path: string) => void; class?: string; projectDir?: string }) {
  const params = useParams()
  const platform = usePlatform()
  const language = useLanguage()
  const [tree, setTree] = createSignal<FileExplorerItem[]>([])
  const [clipboard, setClipboard] = createSignal<ClipboardState>(null)
  const [renamingPath, setRenamingPath] = createSignal<string | null>(null)
  const [renameValue, setRenameValue] = createSignal("")
  const [contextMenuPosition, setContextMenuPosition] = createSignal<{ x: number; y: number } | null>(null)
  const [contextMenuItem, setContextMenuItem] = createSignal<FileExplorerItem | null>(null)
  const [showNewFileInput, setShowNewFileInput] = createSignal<{ parentPath: string; afterItemPath?: string; type: "file" | "directory" } | null>(null)
  const [newItemName, setNewItemName] = createSignal("")
  const [deleteConfirm, setDeleteConfirm] = createSignal<FileExplorerItem | null>(null)
  let scrollContainerRef: HTMLDivElement | undefined
  let newFileInputRef: HTMLInputElement | undefined
  let renameInputRef: HTMLInputElement | undefined

  // Helper to update tree while preserving scroll position
  function updateTreeWithScroll(updater: (prev: FileExplorerItem[]) => FileExplorerItem[]) {
    const scrollTop = scrollContainerRef?.scrollTop ?? 0
    setTree(updater)
    requestAnimationFrame(() => {
      if (scrollContainerRef) {
        scrollContainerRef.scrollTop = scrollTop
      }
    })
  }



  const projectRoot = createMemo(() => {
    const dir = props.projectDir || params.dir
    if (!dir) return null
    return props.projectDir || base64Decode(dir)
  })

  const [treeResource, { refetch }] = createResource(
    () => {
      const dir = projectRoot()
      return dir && platform.readDirectory ? { dir, platform: platform } : null
    },
    async ({ dir, platform }) => {
      if (!platform.readDirectory) {
        return []
      }
      try {
        const entries = await platform.readDirectory(dir)

        const items: FileExplorerItem[] = entries
          .sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1
            if (!a.isDirectory && b.isDirectory) return 1
            return a.name.localeCompare(b.name)
          })
          .map((entry) => ({
            ...entry,
            expanded: false,
            children: [],
          }))

        return items
      } catch (err) {
        console.error("Failed to load directory:", err)
        return []
      }
    },
  )

  createEffect(() => {
    const data = treeResource()
    if (data) {
      // Preserve scroll when tree data updates from resource
      const scrollTop = scrollContainerRef?.scrollTop ?? 0
      setTree(data)
      requestAnimationFrame(() => {
        if (scrollContainerRef) {
          scrollContainerRef.scrollTop = scrollTop
        }
      })
    }
  })

  // Helper to get all expanded paths from tree
  function getExpandedPaths(nodes: FileExplorerItem[]): Set<string> {
    const paths = new Set<string>()
    const traverse = (items: FileExplorerItem[]) => {
      for (const item of items) {
        if (item.expanded) {
          paths.add(item.path)
          traverse(item.children)
        }
      }
    }
    traverse(nodes)
    return paths
  }

  // Recursively build tree with expanded folders already loaded
  async function buildTreeWithExpandedState(dir: string, expandedPaths: Set<string>): Promise<FileExplorerItem[]> {
    if (!platform.readDirectory) return []
    
    try {
      const entries = await platform.readDirectory(dir)
      const items: FileExplorerItem[] = entries
        .sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1
          if (!a.isDirectory && b.isDirectory) return 1
          return a.name.localeCompare(b.name)
        })
        .map((entry) => ({
          ...entry,
          expanded: false,
          children: [],
        }))

      // Load children for expanded folders
      for (const item of items) {
        if (item.isDirectory && expandedPaths.has(item.path)) {
          item.expanded = true
          item.children = await buildTreeWithExpandedState(item.path, expandedPaths)
        }
      }

      return items
    } catch (err) {
      console.error("Failed to load directory:", err)
      return []
    }
  }

  // Refresh tree while preserving expanded folder state (no flash)
  async function refreshTreePreservingState() {
    const root = projectRoot()
    if (!root) return
    
    const expandedPaths = getExpandedPaths(tree())
    const newTree = await buildTreeWithExpandedState(root, expandedPaths)
    
    // Single update - no flash
    updateTreeWithScroll(() => newTree)
  }

  // Watch the project folder for changes (debounced to prevent spam)
  createEffect(() => {
    const root = projectRoot()
    if (!root || !platform.watchFile) return

    let unwatch: (() => void) | null = null
    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    platform.watchFile(root, async (event) => {
      // Debounce rapid file changes
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        refreshTreePreservingState()
      }, 300)
    }).then((unwatchFn) => {
      unwatch = unwatchFn
    }).catch((err) => {
      console.error("Failed to watch project folder:", err)
    })

    onCleanup(() => {
      if (debounceTimer) clearTimeout(debounceTimer)
      if (unwatch) {
        unwatch()
      }
    })
  })

  async function toggleExpand(item: FileExplorerItem) {
    if (!item.isDirectory) return

    if (item.expanded) {
      // Collapse: just update the expanded state
      updateTreeWithScroll((prev) => {
        const updateNode = (nodes: FileExplorerItem[]): FileExplorerItem[] => {
          return nodes.map((node) => {
            if (node.path === item.path) {
              return { ...node, expanded: false, children: [] }
            }
            if (node.children.length > 0) {
              return { ...node, children: updateNode(node.children) }
            }
            return node
          })
        }
        return updateNode(prev)
      })
    } else {
      // Expand: load children
      await loadChildren(item.path)
    }
  }

  async function loadChildren(path: string) {
    if (platform.readDirectory) {
      try {
        const entries = await platform.readDirectory(path)
        const children: FileExplorerItem[] = entries
          .sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1
            if (!a.isDirectory && b.isDirectory) return 1
            return a.name.localeCompare(b.name)
          })
          .map((entry) => ({
            ...entry,
            expanded: false,
            children: [],
          }))

        updateTreeWithScroll((prev) => {
          const updateNode = (nodes: FileExplorerItem[]): FileExplorerItem[] => {
            return nodes.map((node) => {
              if (node.path === path) {
                return { ...node, expanded: true, children }
              }
              if (node.children.length > 0) {
                return { ...node, children: updateNode(node.children) }
              }
              return node
            })
          }
          return updateNode(prev)
        })
      } catch (err) {
        console.error("Failed to load directory:", err)
      }
    }
  }

  function handleItemClick(item: FileExplorerItem) {
    if (item.isDirectory) {
      toggleExpand(item)
    }
    // Files are opened on double-click, not single click
  }

  function handleItemDoubleClick(item: FileExplorerItem) {
    if (!item.isDirectory) {
      props.onFileOpen(item.path)
    }
  }

  function handleContextMenu(e: MouseEvent, item: FileExplorerItem) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenuItem(item)
    setContextMenuPosition({ x: e.clientX, y: e.clientY })
  }

  function closeContextMenu() {
    setContextMenuPosition(null)
    setContextMenuItem(null)
  }

  function getParentPath(path: string): string {
    const separator = path.includes("\\") ? "\\" : "/"
    const parts = path.split(separator)
    parts.pop()
    return parts.join(separator)
  }

  function getFileName(path: string): string {
    const separator = path.includes("\\") ? "\\" : "/"
    return path.split(separator).pop() || ""
  }

  function joinPath(base: string, name: string): string {
    const separator = base.includes("\\") ? "\\" : "/"
    return `${base}${separator}${name}`
  }

  async function handleRename(item: FileExplorerItem) {
    closeContextMenu()
    setRenamingPath(item.path)
    setRenameValue(item.name)
    // Focus the input after it renders
    requestAnimationFrame(() => {
      renameInputRef?.focus()
      renameInputRef?.select()
    })
  }

  async function submitRename(item: FileExplorerItem) {
    const newName = renameValue().trim()
    if (!newName || newName === item.name) {
      setRenamingPath(null)
      return
    }

    if (!platform.renamePath) return

    const parentPath = getParentPath(item.path)
    const newPath = joinPath(parentPath, newName)

    try {
      await platform.renamePath(item.path, newPath)
      await refreshTreePreservingState()
    } catch (err) {
      console.error("Failed to rename:", err)
    }

    setRenamingPath(null)
  }

  function handleDelete(item: FileExplorerItem) {
    closeContextMenu()
    if (!platform.deletePath) return
    // Show confirmation dialog
    setDeleteConfirm(item)
  }

  async function confirmDelete() {
    const item = deleteConfirm()
    if (!item || !platform.deletePath) return

    try {
      await platform.deletePath(item.path)
      await refreshTreePreservingState()
    } catch (err) {
      console.error("Failed to delete:", err)
    }
    setDeleteConfirm(null)
  }

  async function handleCopy(item: FileExplorerItem) {
    closeContextMenu()
    setClipboard({ path: item.path, operation: "copy" })
  }

  async function handleCut(item: FileExplorerItem) {
    closeContextMenu()
    setClipboard({ path: item.path, operation: "cut" })
  }

  async function handlePaste(targetDir: string) {
    closeContextMenu()
    const clip = clipboard()
    if (!clip || !platform.copyPath || !platform.renamePath) return

    const fileName = getFileName(clip.path)
    const destPath = joinPath(targetDir, fileName)

    try {
      if (clip.operation === "copy") {
        await platform.copyPath(clip.path, destPath)
      } else {
        await platform.renamePath(clip.path, destPath)
        setClipboard(null)
      }
      await refreshTreePreservingState()
    } catch (err) {
      console.error("Failed to paste:", err)
    }
  }

  async function handleNewFile(parentPath: string, afterItemPath?: string) {
    closeContextMenu()
    // Make sure parent folder is expanded so input shows
    await expandFolder(parentPath)
    setShowNewFileInput({ parentPath, afterItemPath, type: "file" })
    setNewItemName("")
    // Focus the input after it renders
    requestAnimationFrame(() => {
      newFileInputRef?.focus()
    })
  }

  async function handleNewFolder(parentPath: string, afterItemPath?: string) {
    closeContextMenu()
    // Make sure parent folder is expanded so input shows
    await expandFolder(parentPath)
    setShowNewFileInput({ parentPath, afterItemPath, type: "directory" })
    setNewItemName("")
    // Focus the input after it renders
    requestAnimationFrame(() => {
      newFileInputRef?.focus()
    })
  }

  async function expandFolder(path: string) {
    // Check if it's already expanded in the tree
    const findAndExpand = async (nodes: FileExplorerItem[]): Promise<boolean> => {
      for (const node of nodes) {
        if (node.path === path) {
          if (!node.expanded) {
            await loadChildren(path)
          }
          return true
        }
        if (node.children.length > 0 && await findAndExpand(node.children)) {
          return true
        }
      }
      return false
    }
    
    // If path is project root, it's not in tree - just load children
    if (path === projectRoot()) {
      return
    }
    
    await findAndExpand(tree())
  }

  async function submitNewItem() {
    const input = showNewFileInput()
    if (!input) return

    const name = newItemName().trim()
    if (!name) {
      setShowNewFileInput(null)
      return
    }

    const newPath = joinPath(input.parentPath, name)

    try {
      if (input.type === "file" && platform.createFile) {
        await platform.createFile(newPath)
      } else if (input.type === "directory" && platform.createDirectory) {
        await platform.createDirectory(newPath)
      }
      await refreshTreePreservingState()
    } catch (err) {
      console.error("Failed to create:", err)
    }

    setShowNewFileInput(null)
  }

  function TreeNode(nodeProps: {
    item: FileExplorerItem
    level: number
    onToggle: (item: FileExplorerItem) => void
    onClick: (item: FileExplorerItem) => void
    onDoubleClick: (item: FileExplorerItem) => void
    onContextMenu: (e: MouseEvent, item: FileExplorerItem) => void
  }) {
    const paddingLeft = () => `${nodeProps.level * 12 + 8}px`
    const isRenaming = () => renamingPath() === nodeProps.item.path
    const isCut = () => clipboard()?.path === nodeProps.item.path && clipboard()?.operation === "cut"

    return (
      <div class="w-full">
        <div
          data-tree-item
          classList={{
            "flex items-center py-0.5 px-2 cursor-pointer hover:bg-surface-weak rounded-sm text-13-regular": true,
            "opacity-50": isCut(),
          }}
          style={{ "padding-left": paddingLeft() }}
          onClick={() => nodeProps.onClick(nodeProps.item)}
          onDblClick={() => nodeProps.onDoubleClick(nodeProps.item)}
          onContextMenu={(e) => nodeProps.onContextMenu(e, nodeProps.item)}
        >
          <Show when={nodeProps.item.isDirectory}>
            <Icon
              name={nodeProps.item.expanded ? "chevron-down" : "chevron-right"}
              size="small"
              class="mr-1 text-text-weak flex-shrink-0"
            />
          </Show>
          <Show when={!nodeProps.item.isDirectory}>
            <div class="w-4 h-4 mr-1 flex-shrink-0" />
          </Show>
          <FileIcon
            node={{
              path: nodeProps.item.path,
              type: nodeProps.item.isDirectory ? "directory" : "file",
            }}
            expanded={nodeProps.item.expanded}
            class="w-4 h-4 mr-2 flex-shrink-0"
          />
          <Show
            when={!isRenaming()}
            fallback={
              <input
                ref={renameInputRef}
                type="text"
                value={renameValue()}
                onInput={(e) => setRenameValue(e.currentTarget.value)}
                onBlur={() => submitRename(nodeProps.item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    submitRename(nodeProps.item)
                  } else if (e.key === "Escape") {
                    setRenamingPath(null)
                  }
                }}
                class="flex-1 min-w-0 bg-surface-base border border-border-base rounded px-1 text-13-regular text-text-strong outline-none"
                onClick={(e) => e.stopPropagation()}
                onDblClick={(e) => e.stopPropagation()}
              />
            }
          >
            <span class="text-text-strong truncate flex-1">{nodeProps.item.name}</span>
          </Show>
        </div>
        <Show when={nodeProps.item.expanded && nodeProps.item.children.length > 0}>
          <For each={nodeProps.item.children}>
            {(child) => (
              <TreeNode
                item={child}
                level={nodeProps.level + 1}
                onToggle={nodeProps.onToggle}
                onClick={nodeProps.onClick}
                onDoubleClick={nodeProps.onDoubleClick}
                onContextMenu={nodeProps.onContextMenu}
              />
            )}
          </For>
        </Show>
        {/* New file/folder input - show after this specific file */}
        <Show when={showNewFileInput()?.afterItemPath === nodeProps.item.path}>
          <div
            class="flex items-center py-0.5 px-2"
            style={{ "padding-left": `${nodeProps.level * 12 + 8}px` }}
          >
            <div class="w-4 h-4 mr-1 flex-shrink-0" />
            <Icon
              name="folder"
              size="small"
              class="w-4 h-4 mr-2 flex-shrink-0 text-text-weak"
            />
            <input
              ref={newFileInputRef}
              type="text"
              value={newItemName()}
              onInput={(e) => setNewItemName(e.currentTarget.value)}
              onBlur={() => submitNewItem()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  submitNewItem()
                } else if (e.key === "Escape") {
                  setShowNewFileInput(null)
                }
              }}
              placeholder={showNewFileInput()?.type === "directory" ? "New folder" : "New file"}
              class="flex-1 min-w-0 bg-surface-base border border-border-base rounded px-1 text-13-regular text-text-strong outline-none"
            />
          </div>
        </Show>
        {/* New file/folder input - show inside this folder if it's a directory and no afterItemPath */}
        <Show when={nodeProps.item.isDirectory && showNewFileInput()?.parentPath === nodeProps.item.path && !showNewFileInput()?.afterItemPath}>
          <div
            class="flex items-center py-0.5 px-2"
            style={{ "padding-left": `${(nodeProps.level + 1) * 12 + 8}px` }}
          >
            <div class="w-4 h-4 mr-1 flex-shrink-0" />
            <Icon
              name="folder"
              size="small"
              class="w-4 h-4 mr-2 flex-shrink-0 text-text-weak"
            />
            <input
              ref={newFileInputRef}
              type="text"
              value={newItemName()}
              onInput={(e) => setNewItemName(e.currentTarget.value)}
              onBlur={() => submitNewItem()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  submitNewItem()
                } else if (e.key === "Escape") {
                  setShowNewFileInput(null)
                }
              }}
              placeholder={showNewFileInput()?.type === "directory" ? "New folder" : "New file"}
              class="flex-1 min-w-0 bg-surface-base border border-border-base rounded px-1 text-13-regular text-text-strong outline-none"
            />
          </div>
        </Show>
      </div>
    )
  }

  // Context menu component - use Show for reactivity
  function ContextMenu() {
    return (
      <Show when={contextMenuPosition() && contextMenuItem()}>
        {(_) => {
          const item = contextMenuItem()!
          const pos = contextMenuPosition()!
          
          const canPaste = () => {
            const clip = clipboard()
            return clip && item.isDirectory
          }

          return (
            <>
              {/* Backdrop to close menu when clicking outside */}
              <div
                class="fixed inset-0 z-[9998]"
                onClick={() => closeContextMenu()}
                onContextMenu={(e) => {
                  e.preventDefault()
                  closeContextMenu()
                }}
              />
              <div
                data-context-menu
                class="fixed z-[9999]"
                style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
                onClick={(e) => e.stopPropagation()}
              >
                <div 
                  class="border border-border-base rounded-md shadow-lg py-1 min-w-[160px]" 
                  style={{ "background-color": "#1e1e1e" }}
                >
                  {/* New File / New Folder */}
                  <button
                    class="w-full px-3 py-1.5 text-left text-13-regular text-text-base hover:bg-surface-weak"
                    onClick={() => {
                      // For folders: create inside. For files: create as sibling
                      const targetDir = item.isDirectory ? item.path : getParentPath(item.path)
                      const afterItem = item.isDirectory ? undefined : item.path
                      handleNewFile(targetDir, afterItem)
                    }}
                  >
                    New File
                  </button>
                  <button
                    class="w-full px-3 py-1.5 text-left text-13-regular text-text-base hover:bg-surface-weak"
                    onClick={() => {
                      // For folders: create inside. For files: create as sibling
                      const targetDir = item.isDirectory ? item.path : getParentPath(item.path)
                      const afterItem = item.isDirectory ? undefined : item.path
                      handleNewFolder(targetDir, afterItem)
                    }}
                  >
                    New Folder
                  </button>
                  <div class="h-px bg-border-base my-1" />
                  {/* Open - only for files */}
                  <Show when={!item.isDirectory}>
                    <button
                      class="w-full px-3 py-1.5 text-left text-13-regular text-text-base hover:bg-surface-weak"
                      onClick={() => {
                        closeContextMenu()
                        props.onFileOpen(item.path)
                      }}
                    >
                      Open
                    </button>
                  </Show>
                  {/* Copy/Cut - only for non-root items */}
                  <Show when={item.name !== ""}>
                    <button
                      class="w-full px-3 py-1.5 text-left text-13-regular text-text-base hover:bg-surface-weak"
                      onClick={() => handleCopy(item)}
                    >
                      Copy
                    </button>
                    <button
                      class="w-full px-3 py-1.5 text-left text-13-regular text-text-base hover:bg-surface-weak"
                      onClick={() => handleCut(item)}
                    >
                      Cut
                    </button>
                  </Show>
                  {/* Paste - only for directories */}
                  <Show when={canPaste()}>
                    <button
                      class="w-full px-3 py-1.5 text-left text-13-regular text-text-base hover:bg-surface-weak"
                      onClick={() => handlePaste(item.path)}
                    >
                      Paste
                    </button>
                  </Show>
                  {/* Rename/Delete - only for non-root items */}
                  <Show when={item.name !== ""}>
                    <div class="h-px bg-border-base my-1" />
                    <button
                      class="w-full px-3 py-1.5 text-left text-13-regular text-text-base hover:bg-surface-weak"
                      onClick={() => handleRename(item)}
                    >
                      Rename
                    </button>
                    <button
                      class="w-full px-3 py-1.5 text-left text-13-regular text-text-critical hover:bg-surface-weak"
                      onClick={() => handleDelete(item)}
                    >
                      Delete
                    </button>
                  </Show>
                </div>
            </div>
            </>
          )
        }}
      </Show>
    )
  }

  // Close context menu when clicking outside
  function handleDocumentClick(e: MouseEvent) {
    // Don't close if clicking inside the context menu
    const target = e.target as HTMLElement
    if (target.closest('[data-context-menu]')) {
      return
    }
    
    if (contextMenuPosition()) {
      closeContextMenu()
    }
  }

  // Root context menu (for creating files/folders at root level)
  function handleRootContextMenu(e: MouseEvent) {
    // Don't show root context menu if right-clicking on a tree item
    const target = e.target as HTMLElement
    if (target.closest('[data-tree-item]')) return
    
    const root = projectRoot()
    if (!root) return
    
    e.preventDefault()
    // Create a fake item for the root directory
    setContextMenuItem({
      name: "",
      path: root,
      isDirectory: true,
      expanded: true,
      children: [],
    })
    setContextMenuPosition({ x: e.clientX, y: e.clientY })
  }

  return (
    <>
      <div
        class={`flex flex-col h-full min-h-0 ${props.class ?? ""}`}
        onClick={handleDocumentClick}
        onContextMenu={handleRootContextMenu}
      >
        <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden" ref={scrollContainerRef}>
          <Show
            when={treeResource.loading}
            fallback={
              <Show
                when={tree().length === 0}
                fallback={
                  <div class="py-1">
                    {/* New file/folder input at root level - only if no afterItemPath (meaning clicked on root/empty space) */}
                    <Show when={showNewFileInput()?.parentPath === projectRoot() && !showNewFileInput()?.afterItemPath}>
                      <div
                        class="flex items-center py-0.5 px-2"
                        style={{ "padding-left": "8px" }}
                      >
                        <div class="w-4 h-4 mr-1 flex-shrink-0" />
                        <Icon
                          name="folder"
                          size="small"
                          class="w-4 h-4 mr-2 flex-shrink-0 text-text-weak"
                        />
                        <input
                          ref={newFileInputRef}
                          type="text"
                          value={newItemName()}
                          onInput={(e) => setNewItemName(e.currentTarget.value)}
                          onBlur={() => submitNewItem()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault()
                              submitNewItem()
                            } else if (e.key === "Escape") {
                              setShowNewFileInput(null)
                            }
                          }}
                          placeholder={showNewFileInput()?.type === "directory" ? "New folder" : "New file"}
                          class="flex-1 min-w-0 bg-surface-base border border-border-base rounded px-1 text-13-regular text-text-strong outline-none"
                        />
                      </div>
                    </Show>
                    <For each={tree()}>
                      {(item) => (
                        <TreeNode
                          item={item}
                          level={0}
                          onToggle={toggleExpand}
                          onClick={handleItemClick}
                          onDoubleClick={handleItemDoubleClick}
                          onContextMenu={handleContextMenu}
                        />
                      )}
                    </For>
                  </div>
                }
              >
                <div class="p-4 text-13-regular text-text-weak">No files found</div>
              </Show>
            }
          >
            <div class="p-4 text-13-regular text-text-weak">Loading...</div>
          </Show>
        </div>
      </div>
      {/* Render context menu in a portal to escape overflow containers */}
      <Portal>
        <ContextMenu />
      </Portal>
      {/* Delete confirmation dialog */}
      <Portal>
        <Show when={deleteConfirm()}>
          {(item) => (
            <>
              <div 
                class="fixed inset-0 z-[9998] bg-black/50"
                onClick={() => setDeleteConfirm(null)}
              />
              <div 
                class="fixed z-[9999] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg p-4 min-w-[300px] border border-border-base shadow-lg"
                style={{ "background-color": "#1e1e1e" }}
              >
                <h3 class="text-14-medium text-text-strong mb-2">Delete {item().isDirectory ? "folder" : "file"}?</h3>
                <p class="text-13-regular text-text-base mb-4">
                  Are you sure you want to delete "<span class="text-text-strong">{item().name}</span>"?
                  {item().isDirectory && " This will delete all contents."}
                </p>
                <div class="flex justify-end gap-2">
                  <button
                    class="px-3 py-1.5 text-13-regular text-text-base hover:bg-surface-weak rounded"
                    onClick={() => setDeleteConfirm(null)}
                  >
                    Cancel
                  </button>
                  <button
                    class="px-3 py-1.5 text-13-regular text-white bg-red-600 hover:bg-red-700 rounded"
                    onClick={() => confirmDelete()}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </>
          )}
        </Show>
      </Portal>
    </>
  )
}
