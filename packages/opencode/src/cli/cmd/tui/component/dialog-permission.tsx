import { createMemo, For, Show, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { TextAttributes, TextareaRenderable } from "@opentui/core"
import { useSDK } from "@tui/context/sdk"
import type { PermissionNext } from "@/permission/next"

type TabType = "file" | "execute" | "network" | "external" | "other"

const TABS: { id: TabType; label: string; permissions: string[] }[] = [
  { id: "file", label: "File", permissions: ["read", "edit", "glob", "grep", "list"] },
  { id: "execute", label: "Execute", permissions: ["bash", "task"] },
  { id: "network", label: "Network", permissions: ["webfetch", "websearch", "codesearch"] },
  { id: "external", label: "External", permissions: ["external_directory"] },
  {
    id: "other",
    label: "Other",
    permissions: ["todowrite", "todoread", "question", "lsp", "doom_loop"],
  },
]

const ACTION_ICONS: Record<PermissionNext.Action, string> = {
  allow: "✓",
  deny: "✗",
  ask: "?",
}

export function DialogPermission() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sdk = useSDK()
  const [store, setStore] = createStore({
    tab: 0 as number,
    loading: true,
    rules: [] as PermissionNext.Rule[],
    selected: 0 as number,
    editing: null as null | {
      rule: PermissionNext.Rule | null
      pattern: string
      action: PermissionNext.Action
      permission?: string
    },
  })

  let createInput: TextareaRenderable | undefined
  let editInput: TextareaRenderable | undefined

  onMount(() => {
    dialog.setSize("large")
  })

  // Fetch permissions on mount
  onMount(async () => {
    try {
      const result = await sdk.client.permission.approved()
      setStore("rules", Array.isArray(result.data) ? result.data : [])
    } catch (error) {
      setStore("rules", [])
    } finally {
      setStore("loading", false)
    }
  })

  const currentTab = createMemo(() => TABS[store.tab])

  // Group rules by permission type for current tab
  const groupedRules = createMemo(() => {
    const permissionTypes = currentTab().permissions
    const rulesByPermission = new Map<string, PermissionNext.Rule[]>()

    for (const permission of permissionTypes) {
      rulesByPermission.set(permission, [])
    }

    for (const rule of store.rules) {
      if (permissionTypes.includes(rule.permission)) {
        rulesByPermission.get(rule.permission)!.push(rule)
      }
    }

    return rulesByPermission
  })

  // Flatten rules for navigation
  const flatRules = createMemo(() => {
    const permissionTypes = currentTab().permissions
    return store.rules.filter((rule) => permissionTypes.includes(rule.permission))
  })

  function move(delta: number) {
    const max = flatRules().length - 1
    if (max < 0) return
    let next = store.selected + delta
    if (next < 0) next = 0
    if (next > max) next = max
    setStore("selected", next)
  }

  async function deleteSelected() {
    const rule = flatRules()[store.selected]
    if (!rule) return
    try {
      await sdk.client.permission.delete({ permissionRule: rule })
      // Remove from local state using deep comparison
      setStore(
        "rules",
        store.rules.filter(
          (r) => !(r.permission === rule.permission && r.pattern === rule.pattern && r.action === rule.action),
        ),
      )
      // Adjust selection if needed
      const newLength = flatRules().length
      if (store.selected >= newLength && newLength > 0) {
        setStore("selected", newLength - 1)
      } else if (newLength === 0) {
        setStore("selected", 0)
      }
    } catch (error) {
      // Silently handle error
    }
  }

  function startEditing() {
    const rule = flatRules()[store.selected]
    if (!rule) return
    setStore("editing", { rule, pattern: rule.pattern, action: rule.action })
  }

  function startCreating() {
    // Get the first permission type from the current tab
    const permissionType = currentTab().permissions[0]
    if (!permissionType) return
    setStore("editing", { rule: null, pattern: "", action: "allow", permission: permissionType })
  }

  function cycleAction(direction: "forward" | "backward" = "forward") {
    if (!store.editing) return
    const actions: PermissionNext.Action[] = ["allow", "deny", "ask"]
    const currentIndex = actions.indexOf(store.editing.action)
    const delta = direction === "forward" ? 1 : -1
    const nextIndex = (currentIndex + delta + actions.length) % actions.length
    setStore("editing", "action", actions[nextIndex])
  }

  function cyclePermission() {
    if (!store.editing || store.editing.rule) return // Only when creating new
    const permissions = currentTab().permissions
    const currentIndex = permissions.indexOf(store.editing.permission || permissions[0])
    const nextIndex = (currentIndex + 1) % permissions.length
    setStore("editing", "permission", permissions[nextIndex])
  }

  async function saveEdit() {
    if (!store.editing) return
    const oldRule = store.editing.rule

    // Creating new rule
    if (!oldRule) {
      const permissionType = store.editing.permission || currentTab().permissions[0]
      if (!permissionType) return
      const newRule: PermissionNext.Rule = {
        permission: permissionType,
        pattern: store.editing.pattern,
        action: store.editing.action,
      }
      try {
        await sdk.client.permission.add({ permissionRule: newRule })
        setStore("rules", [...store.rules, newRule])
        setStore("editing", null)
      } catch (error) {
        // Silently handle error
      }
      return
    }

    // Updating existing rule
    const newRule: PermissionNext.Rule = {
      permission: oldRule.permission,
      pattern: store.editing.pattern,
      action: store.editing.action,
    }
    try {
      await sdk.client.permission.update({ oldRule, newRule })
      // Update local state
      setStore(
        "rules",
        store.rules.map((r) =>
          r.permission === oldRule.permission && r.pattern === oldRule.pattern && r.action === oldRule.action
            ? newRule
            : r,
        ),
      )
      setStore("editing", null)
    } catch (error) {
      // Silently handle error
    }
  }

  function cancelEdit() {
    setStore("editing", null)
  }

  function placeholderForPermission(permission: string): string {
    switch (permission) {
      case "read":
      case "edit":
      case "list":
        return "Pattern (e.g. *, *.env, src/**/*)"
      case "glob":
      case "grep":
        return "Pattern (e.g. *, **/*.ts, src/**)"
      case "bash":
        return "Pattern (e.g. *, npm, git)"
      case "task":
        return "Pattern (e.g. *)"
      case "webfetch":
      case "websearch":
      case "codesearch":
        return "Pattern (e.g. *, https://*)"
      case "external_directory":
        return "Pattern (e.g. *, /home/*, /tmp/*)"
      default:
        return "Pattern (e.g. *)"
    }
  }

  function selectTab(index: number) {
    setStore("tab", index)
  }

  const dimensions = useTerminalDimensions()
  const height = createMemo(() => Math.floor(dimensions().height / 2) - 6)

  useKeyboard((evt) => {
    // Editing mode
    if (store.editing) {
      if (evt.name === "return") {
        evt.preventDefault()
        evt.stopPropagation()
        saveEdit()
        return
      }
      if (evt.name === "escape") {
        evt.preventDefault()
        evt.stopPropagation()
        cancelEdit()
        return
      }
      if (evt.name === "up") {
        evt.preventDefault()
        evt.stopPropagation()
        cycleAction("backward")
        return
      }
      if (evt.name === "down") {
        evt.preventDefault()
        evt.stopPropagation()
        cycleAction("forward")
        return
      }
      if (evt.name === "tab" && !store.editing.rule) {
        evt.preventDefault()
        evt.stopPropagation()
        cyclePermission()
        return
      }
      return
    }

    // Navigation mode
    if (evt.name === "left" || evt.name === "h") {
      evt.preventDefault()
      selectTab((store.tab - 1 + TABS.length) % TABS.length)
      setStore("selected", 0)
    }
    if (evt.name === "right" || evt.name === "l") {
      evt.preventDefault()
      selectTab((store.tab + 1) % TABS.length)
      setStore("selected", 0)
    }
    if (evt.name === "tab") {
      evt.preventDefault()
      if (evt.shift) {
        selectTab((store.tab - 1 + TABS.length) % TABS.length)
      } else {
        selectTab((store.tab + 1) % TABS.length)
      }
      setStore("selected", 0)
    }
    if (evt.name === "up" || evt.name === "k") {
      evt.preventDefault()
      move(-1)
    }
    if (evt.name === "down" || evt.name === "j") {
      evt.preventDefault()
      move(1)
    }
    if (evt.name === "e") {
      evt.preventDefault()
      startEditing()
    }
    if (evt.name === "n" || evt.name === "a") {
      evt.preventDefault()
      startCreating()
    }
    if (evt.name === "d" || evt.name === "x" || evt.name === "delete") {
      evt.preventDefault()
      deleteSelected()
    }
    if (evt.name === "escape") {
      evt.preventDefault()
      dialog.clear()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1}>
      {/* Title */}
      <box paddingBottom={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Permissions
        </text>
      </box>

      {/* Tabs */}
      <box flexDirection="row" gap={1} paddingBottom={1}>
        <For each={TABS}>
          {(tab, index) => {
            const isActive = () => index() === store.tab
            return (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={isActive() ? theme.accent : theme.backgroundElement}
                onMouseUp={() => selectTab(index())}
              >
                <text fg={isActive() ? theme.selectedListItemText : theme.textMuted}>{tab.label}</text>
              </box>
            )
          }}
        </For>
      </box>

      {/* Content */}
      <Show when={!store.loading} fallback={<text fg={theme.textMuted}>Loading...</text>}>
        <scrollbox height={height()}>
          <box gap={1}>
            {/* Create mode - show at top */}
            <Show when={store.editing && !store.editing.rule}>
              <box gap={0}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  ● New permission for {store.editing!.permission || currentTab().permissions[0]}
                </text>
                <box paddingLeft={2} flexDirection="row" gap={1} backgroundColor={theme.backgroundElement}>
                  <Show when={store.editing}>
                    {(editing) => {
                      const editActionColor = () => {
                        switch (editing().action) {
                          case "allow":
                            return theme.success
                          case "deny":
                            return theme.error
                          case "ask":
                            return theme.warning
                        }
                      }
                      return (
                        <>
                          <text fg={editActionColor()}>{ACTION_ICONS[editing().action]}</text>
                          <text fg={theme.textMuted}>{editing().action}</text>
                        </>
                      )
                    }}
                  </Show>
                  <textarea
                    ref={(r) => {
                      createInput = r
                      setTimeout(() => r?.focus(), 1)
                      // Handle escape directly on the textarea to prevent it from bubbling to dialog
                      if (r) {
                        const originalHandleKeyPress = r.handleKeyPress.bind(r)
                        r.handleKeyPress = (evt) => {
                          if (evt.name === "escape") {
                            cancelEdit()
                            return true
                          }
                          return originalHandleKeyPress(evt)
                        }
                      }
                    }}
                    height={1}
                    initialValue={store.editing!.pattern}
                    onContentChange={() => {
                      setStore("editing", "pattern", createInput?.plainText ?? "")
                    }}
                    keyBindings={[{ name: "return", action: "submit" }]}
                    onSubmit={() => saveEdit()}
                    textColor={theme.text}
                    focusedTextColor={theme.text}
                    cursorColor={theme.primary}
                    placeholder={placeholderForPermission(store.editing!.permission || currentTab().permissions[0])}
                  />
                </box>
              </box>
            </Show>

            <For each={Array.from(groupedRules().entries())}>
              {([permission, rules]) => (
                <Show when={rules.length > 0}>
                  <box gap={0}>
                    {/* Permission type header */}
                    <text fg={theme.text} attributes={TextAttributes.BOLD}>
                      ● {permission} ({rules.length} {rules.length === 1 ? "rule" : "rules"})
                    </text>

                    {/* Rules list */}
                    <box paddingLeft={2}>
                      <For each={rules}>
                        {(rule) => {
                          const ruleIndex = () => flatRules().indexOf(rule)
                          const isSelected = () => ruleIndex() === store.selected
                          const actionColor = () => {
                            switch (rule.action) {
                              case "allow":
                                return theme.success
                              case "deny":
                                return theme.error
                              case "ask":
                                return theme.warning
                            }
                          }

                          const isEditing = () =>
                            store.editing &&
                            store.editing.rule &&
                            store.editing.rule.permission === rule.permission &&
                            store.editing.rule.pattern === rule.pattern &&
                            store.editing.rule.action === rule.action

                          return (
                            <Show
                              when={isEditing()}
                              fallback={
                                <box
                                  flexDirection="row"
                                  gap={1}
                                  backgroundColor={isSelected() ? theme.backgroundElement : undefined}
                                >
                                  <text fg={actionColor()}>{ACTION_ICONS[rule.action]}</text>
                                  <text fg={theme.textMuted}>{rule.action}</text>
                                  <text fg={theme.text}>{rule.pattern}</text>
                                </box>
                              }
                            >
                              <box flexDirection="row" gap={1} backgroundColor={theme.backgroundElement}>
                                <Show when={store.editing}>
                                  {(editing) => {
                                    const editActionColor = () => {
                                      switch (editing().action) {
                                        case "allow":
                                          return theme.success
                                        case "deny":
                                          return theme.error
                                        case "ask":
                                          return theme.warning
                                      }
                                    }
                                    return (
                                      <>
                                        <text fg={editActionColor()}>{ACTION_ICONS[editing().action]}</text>
                                        <text fg={theme.textMuted}>{editing().action}</text>
                                      </>
                                    )
                                  }}
                                </Show>
                                <textarea
                                  ref={(r) => {
                                    editInput = r
                                    setTimeout(() => r?.focus(), 1)
                                    // Handle escape directly on the textarea to prevent it from bubbling to dialog
                                    if (r) {
                                      const originalHandleKeyPress = r.handleKeyPress.bind(r)
                                      r.handleKeyPress = (evt) => {
                                        if (evt.name === "escape") {
                                          cancelEdit()
                                          return true
                                        }
                                        return originalHandleKeyPress(evt)
                                      }
                                    }
                                  }}
                                  height={1}
                                  initialValue={store.editing!.pattern}
                                  onContentChange={() => {
                                    setStore("editing", "pattern", editInput?.plainText ?? "")
                                  }}
                                  keyBindings={[{ name: "return", action: "submit" }]}
                                  onSubmit={() => saveEdit()}
                                  textColor={theme.text}
                                  focusedTextColor={theme.text}
                                  cursorColor={theme.primary}
                                  placeholder="Pattern"
                                />
                              </box>
                            </Show>
                          )
                        }}
                      </For>
                    </box>
                  </box>
                </Show>
              )}
            </For>

            {/* Empty state */}
            <Show when={Array.from(groupedRules().values()).every((rules) => rules.length === 0)}>
              <box paddingTop={2}>
                <text fg={theme.textMuted}>No rules configured for this category</text>
              </box>
            </Show>
          </box>
        </scrollbox>
      </Show>

      {/* Help text */}
      <Show when={!store.editing}>
        <box paddingTop={1} paddingBottom={0}>
          <Show when={currentTab().id === "execute"}>
            <text fg={theme.textMuted}>
              Tip: "git status" matches only exactly that. Use "git *" to match all git commands (e.g. git status, git
              commit, etc.)
            </text>
          </Show>
          <Show when={currentTab().id === "file"}>
            <text fg={theme.textMuted}>Tip: Use glob patterns like *.env, src/**/*, or * for all files</text>
          </Show>
        </box>
      </Show>

      {/* Footer hints */}
      <box flexDirection="row" gap={2} paddingTop={1}>
        <Show
          when={store.editing}
          fallback={
            <>
              <box flexDirection="row" gap={1}>
                <text fg={theme.textMuted}>{"←→"}</text>
                <text fg={theme.text}>switch tabs</text>
              </box>
              <box flexDirection="row" gap={1}>
                <text fg={theme.textMuted}>{"↑↓"}</text>
                <text fg={theme.text}>select</text>
              </box>
              <box flexDirection="row" gap={1}>
                <text fg={theme.textMuted}>e</text>
                <text fg={theme.text}>edit</text>
              </box>
              <box flexDirection="row" gap={1}>
                <text fg={theme.textMuted}>n</text>
                <text fg={theme.text}>new</text>
              </box>
              <box flexDirection="row" gap={1}>
                <text fg={theme.textMuted}>d</text>
                <text fg={theme.text}>delete</text>
              </box>
              <box flexDirection="row" gap={1}>
                <text fg={theme.textMuted}>esc</text>
                <text fg={theme.text}>close</text>
              </box>
            </>
          }
        >
          <Show when={!store.editing?.rule}>
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>tab</text>
              <text fg={theme.text}>cycle permission</text>
            </box>
          </Show>
          <box flexDirection="row" gap={1}>
            <text fg={theme.textMuted}>{"↑↓"}</text>
            <text fg={theme.text}>cycle action</text>
          </box>
          <box flexDirection="row" gap={1}>
            <text fg={theme.textMuted}>enter</text>
            <text fg={theme.text}>save</text>
          </box>
          <box flexDirection="row" gap={1}>
            <text fg={theme.textMuted}>esc</text>
            <text fg={theme.text}>cancel</text>
          </box>
        </Show>
      </box>
    </box>
  )
}
