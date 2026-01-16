import { createMemo, For, Show, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { TextAttributes, TextareaRenderable } from "@opentui/core"
import { useSDK } from "@tui/context/sdk"
import { useLocal } from "@tui/context/local"
import type { PermissionNext } from "@/permission/next"

type TabType = "file" | "execute" | "network" | "external"

const TABS: { id: TabType; label: string; permissions: string[] }[] = [
  { id: "file", label: "File", permissions: ["read", "edit", "glob", "grep", "list"] },
  { id: "execute", label: "Execute", permissions: ["bash", "task"] },
  { id: "network", label: "Network", permissions: ["webfetch", "websearch", "codesearch"] },
  { id: "external", label: "External", permissions: ["external_directory"] },
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
  const local = useLocal()
  const [store, setStore] = createStore({
    tab: 0 as number,
    loading: true,
    rules: [] as PermissionNext.RuleWithSource[],
    selected: 0 as number,
    editing: null as null | {
      rule: PermissionNext.RuleWithSource | null
      pattern: string
      action: PermissionNext.Action
      permission?: string
      source: "session" | "project" | "global"
    },
    confirmingDelete: false,
    confirmingSave: false,
  })

  let createInput: TextareaRenderable | undefined
  let editInput: TextareaRenderable | undefined

  onMount(() => {
    dialog.setSize("large")
  })

  // Fetch permissions on mount
  onMount(async () => {
    try {
      const agent = local.agent.current().name
      const result = await sdk.client.permission.all({ agent })
      // Filter out internal permissions that aren't interesting to users
      const hiddenPermissions = new Set([
        "question",
        "doom_loop",
        "plan_enter",
        "plan_exit",
        "todowrite",
        "todoread",
        "lsp",
      ])
      const filtered = Array.isArray(result.data)
        ? result.data.filter((rule) => !hiddenPermissions.has(rule.permission))
        : []
      setStore("rules", filtered)
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
    const rulesByPermission = new Map<string, PermissionNext.RuleWithSource[]>()

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
    setStore("confirmingDelete", false)
  }

  async function deleteSelected() {
    const rule = flatRules()[store.selected]
    // Only allow deleting session, project, and global permissions
    if (!rule || (rule.source !== "session" && rule.source !== "project" && rule.source !== "global")) return

    // For project and global permissions, require double confirmation
    if ((rule.source === "project" || rule.source === "global") && !store.confirmingDelete) {
      setStore("confirmingDelete", true)
      return
    }

    setStore("confirmingDelete", false)

    try {
      if (rule.source === "project") {
        // Delete from project config file
        await sdk.client.permission.deleteProject({ permission: rule.permission, pattern: rule.pattern })
      } else if (rule.source === "global") {
        // Delete from global config file
        await sdk.client.permission.deleteGlobal({ permission: rule.permission, pattern: rule.pattern })
      } else {
        // Delete from session (in-memory)
        await sdk.client.permission.delete({ permissionRule: rule })
      }

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
    // Only allow editing session, project, and global permissions (not default)
    if (!rule || (rule.source !== "session" && rule.source !== "project" && rule.source !== "global")) return
    // For binary permissions at project/global level, force pattern to "*"
    const pattern =
      (rule.source === "project" || rule.source === "global") && isBinaryPermission(rule.permission)
        ? "*"
        : rule.pattern
    setStore("editing", { rule, pattern, action: rule.action, source: rule.source })
  }

  function startCreating() {
    // Get the first permission type from the current tab
    const permissionType = currentTab().permissions[0]
    if (!permissionType) return
    // For binary permissions at project/global level, start with "*" pattern
    const pattern = ""
    setStore("editing", { rule: null, pattern, action: "allow", permission: permissionType, source: "session" })
  }

  function toggleSource() {
    if (!store.editing || store.editing.rule) return // Only when creating new
    const sources: ("session" | "project" | "global")[] = ["session", "project", "global"]
    const currentIndex = sources.indexOf(store.editing.source)
    const nextIndex = (currentIndex + 1) % sources.length
    setStore("editing", "source", sources[nextIndex])
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
      // For binary permissions at project/global level, force pattern to "*"
      const pattern =
        (store.editing.source === "project" || store.editing.source === "global") && isBinaryPermission(permissionType)
          ? "*"
          : store.editing.pattern
      const newRule: PermissionNext.Rule = {
        permission: permissionType,
        pattern,
        action: store.editing.action,
      }

      // Confirm project/global permission creation
      if ((store.editing.source === "project" || store.editing.source === "global") && !store.confirmingSave) {
        setStore("confirmingSave", true)
        return
      }

      setStore("confirmingSave", false)

      try {
        if (store.editing.source === "project") {
          await sdk.client.permission.updateProject({ permissionRule: newRule })
          const newRuleWithSource: PermissionNext.RuleWithSource = {
            ...newRule,
            source: "project",
            readonly: true,
          }
          setStore("rules", [...store.rules, newRuleWithSource])
        } else if (store.editing.source === "global") {
          await sdk.client.permission.updateGlobal({ permissionRule: newRule })
          const newRuleWithSource: PermissionNext.RuleWithSource = {
            ...newRule,
            source: "global",
            readonly: true,
          }
          setStore("rules", [...store.rules, newRuleWithSource])
        } else {
          await sdk.client.permission.add({ permissionRule: newRule })
          const newRuleWithSource: PermissionNext.RuleWithSource = {
            ...newRule,
            source: "session",
            readonly: false,
          }
          setStore("rules", [...store.rules, newRuleWithSource])
        }
        setStore("editing", null)
      } catch (error) {
        // Silently handle error
      }
      return
    }

    // Confirm project/global permission update
    if ((oldRule.source === "project" || oldRule.source === "global") && !store.confirmingSave) {
      setStore("confirmingSave", true)
      return
    }

    setStore("confirmingSave", false)

    // Updating existing rule
    // For binary permissions at project/global level, force pattern to "*"
    const pattern =
      (oldRule.source === "project" || oldRule.source === "global") && isBinaryPermission(oldRule.permission)
        ? "*"
        : store.editing.pattern
    const newRule: PermissionNext.Rule = {
      permission: oldRule.permission,
      pattern,
      action: store.editing.action,
    }
    try {
      if (oldRule.source === "project") {
        // Update project config file
        // First delete the old pattern, then add the new one
        if (oldRule.pattern !== store.editing.pattern) {
          await sdk.client.permission.deleteProject({ permission: oldRule.permission, pattern: oldRule.pattern })
        }
        await sdk.client.permission.updateProject({ permissionRule: newRule })
        // Update local state
        setStore(
          "rules",
          store.rules.map((r) =>
            r.permission === oldRule.permission && r.pattern === oldRule.pattern && r.action === oldRule.action
              ? { ...newRule, source: "project", readonly: true }
              : r,
          ),
        )
      } else if (oldRule.source === "global") {
        // Update global config file
        // First delete the old pattern, then add the new one
        if (oldRule.pattern !== store.editing.pattern) {
          await sdk.client.permission.deleteGlobal({ permission: oldRule.permission, pattern: oldRule.pattern })
        }
        await sdk.client.permission.updateGlobal({ permissionRule: newRule })
        // Update local state
        setStore(
          "rules",
          store.rules.map((r) =>
            r.permission === oldRule.permission && r.pattern === oldRule.pattern && r.action === oldRule.action
              ? { ...newRule, source: "global", readonly: true }
              : r,
          ),
        )
      } else {
        // Update session (in-memory)
        await sdk.client.permission.update({ oldRule, newRule })
        // Update local state
        setStore(
          "rules",
          store.rules.map((r) =>
            r.permission === oldRule.permission && r.pattern === oldRule.pattern && r.action === oldRule.action
              ? { ...newRule, source: "session", readonly: false }
              : r,
          ),
        )
      }
      setStore("editing", null)
    } catch (error) {
      // Silently handle error
    }
  }

  function cancelEdit() {
    if (store.confirmingSave) {
      setStore("confirmingSave", false)
      return
    }
    setStore("editing", null)
  }

  function isBinaryPermission(permission: string): boolean {
    // Binary permissions at project/global level can only have "*" pattern
    return ["glob", "grep", "webfetch", "websearch", "codesearch", "task"].includes(permission)
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

  function sourceLabel(source: PermissionNext.Source): string {
    switch (source) {
      case "default":
        return "default"
      case "global":
        return "global"
      case "project":
        return "project"
      case "session":
        return ""
    }
  }

  function selectTab(index: number) {
    setStore("tab", index)
    setStore("confirmingDelete", false)
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
      if (evt.ctrl && evt.name === "p" && !store.editing.rule) {
        evt.preventDefault()
        evt.stopPropagation()
        toggleSource()
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
                  ● New {store.editing!.source} permission for{" "}
                  {store.editing!.permission || currentTab().permissions[0]}
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
                      const isBinary = () =>
                        (editing().source === "project" || editing().source === "global") &&
                        isBinaryPermission(editing().permission || currentTab().permissions[0])
                      return (
                        <>
                          <text fg={editActionColor()}>{ACTION_ICONS[editing().action]}</text>
                          <text fg={theme.textMuted}>{editing().action}</text>
                          <Show when={isBinary()}>
                            <text fg={theme.text}>*</text>
                          </Show>
                        </>
                      )
                    }}
                  </Show>
                  <Show
                    when={
                      !(
                        (store.editing!.source === "project" || store.editing!.source === "global") &&
                        isBinaryPermission(store.editing!.permission || currentTab().permissions[0])
                      )
                    }
                  >
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
                  </Show>
                </box>
                <Show
                  when={
                    store.confirmingSave && (store.editing!.source === "project" || store.editing!.source === "global")
                  }
                >
                  <box paddingLeft={2}>
                    <text fg={theme.warning}>
                      {store.editing!.source === "global"
                        ? "This will update ~/.config/opencode/opencode.json (affects ALL projects). Press enter again to confirm."
                        : "This will update opencode.json. Press enter again to confirm."}
                    </text>
                  </box>
                </Show>
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
                                  <text fg={rule.readonly ? theme.textMuted : theme.textMuted}>{rule.action}</text>
                                  <text fg={rule.readonly ? theme.textMuted : theme.text}>{rule.pattern}</text>
                                  <Show when={sourceLabel(rule.source)}>
                                    <text fg={theme.textMuted}>[{sourceLabel(rule.source)}]</text>
                                  </Show>
                                  <Show
                                    when={
                                      isSelected() &&
                                      store.confirmingDelete &&
                                      (rule.source === "project" || rule.source === "global")
                                    }
                                  >
                                    <text fg={theme.error}>
                                      {rule.source === "global"
                                        ? " - Press 'd' again to delete (affects ALL projects)"
                                        : " - Press 'd' again to delete"}
                                    </text>
                                  </Show>
                                </box>
                              }
                            >
                              <box gap={0}>
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
                                      const isBinary = () =>
                                        (editing().rule?.source === "project" || editing().rule?.source === "global") &&
                                        isBinaryPermission(editing().rule?.permission || "")
                                      return (
                                        <>
                                          <text fg={editActionColor()}>{ACTION_ICONS[editing().action]}</text>
                                          <text fg={theme.textMuted}>{editing().action}</text>
                                          <Show when={isBinary()}>
                                            <text fg={theme.text}>*</text>
                                          </Show>
                                        </>
                                      )
                                    }}
                                  </Show>
                                  <Show
                                    when={
                                      !(
                                        (store.editing!.rule?.source === "project" ||
                                          store.editing!.rule?.source === "global") &&
                                        isBinaryPermission(store.editing!.rule?.permission || "")
                                      )
                                    }
                                  >
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
                                  </Show>
                                </box>
                                <Show
                                  when={
                                    store.confirmingSave &&
                                    (store.editing!.rule?.source === "project" ||
                                      store.editing!.rule?.source === "global")
                                  }
                                >
                                  <box paddingLeft={2}>
                                    <text fg={theme.warning}>
                                      {store.editing!.rule?.source === "global"
                                        ? "This will update ~/.config/opencode/opencode.json (affects ALL projects). Press enter again to confirm."
                                        : "This will update opencode.json. Press enter again to confirm."}
                                    </text>
                                  </box>
                                </Show>
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
              <Show
                when={
                  flatRules()[store.selected]?.source === "session" ||
                  flatRules()[store.selected]?.source === "project" ||
                  flatRules()[store.selected]?.source === "global"
                }
              >
                <box flexDirection="row" gap={1}>
                  <text fg={theme.textMuted}>e</text>
                  <text fg={theme.text}>edit</text>
                </box>
              </Show>
              <box flexDirection="row" gap={1}>
                <text fg={theme.textMuted}>n</text>
                <text fg={theme.text}>new</text>
              </box>
              <Show
                when={
                  flatRules()[store.selected]?.source === "session" ||
                  flatRules()[store.selected]?.source === "project" ||
                  flatRules()[store.selected]?.source === "global"
                }
              >
                <box flexDirection="row" gap={1}>
                  <text fg={theme.textMuted}>d</text>
                  <text fg={theme.text}>
                    {store.confirmingDelete &&
                    (flatRules()[store.selected]?.source === "project" ||
                      flatRules()[store.selected]?.source === "global")
                      ? "press again to confirm"
                      : "delete"}
                  </text>
                </box>
              </Show>
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
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>ctrl+p</text>
              <text fg={theme.text}>toggle source</text>
            </box>
          </Show>
          <box flexDirection="row" gap={1}>
            <text fg={theme.textMuted}>{"↑↓"}</text>
            <text fg={theme.text}>cycle action</text>
          </box>
          <box flexDirection="row" gap={1}>
            <text fg={theme.textMuted}>enter</text>
            <text fg={theme.text}>{store.confirmingSave ? "confirm" : "save"}</text>
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
