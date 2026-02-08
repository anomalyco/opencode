/**
 * WorkspaceBar UI Mocks
 *
 * Different approaches for showing workspaces with project context.
 * This file demonstrates various UI patterns for comparison.
 *
 * To view: Import and render <WorkspaceBarMocks /> in a test page.
 */

import { For, Show, type JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"

// Mock data for all demos
const MOCK_PROJECTS = [
  { id: "p1", name: "opencode", color: "#3b82f6" }, // blue
  { id: "p2", name: "claxedo-app", color: "#22c55e" }, // green
  { id: "p3", name: "sdk", color: "#f59e0b" }, // amber
]

const MOCK_WORKSPACES = [
  { id: "w1", name: "main", projectId: "p1" },
  { id: "w2", name: "feature-auth", projectId: "p1" },
  { id: "w3", name: "hotfix-123", projectId: "p1" },
  { id: "w4", name: "main", projectId: "p2" },
  { id: "w5", name: "refactor", projectId: "p2" },
]

const getProject = (projectId: string) => MOCK_PROJECTS.find((p) => p.id === projectId)!
const getProjectWorkspaces = (projectId: string) => MOCK_WORKSPACES.filter((w) => w.projectId === projectId)

// Common wrapper for each mock
function MockSection(props: { title: string; description: string; children: any }) {
  return (
    <div class="mb-8">
      <h3 class="text-sm font-semibold text-text-strong mb-1">{props.title}</h3>
      <p class="text-xs text-text-weak mb-3">{props.description}</p>
      <div class="border border-border-base rounded-lg overflow-hidden bg-background-base">
        {props.children}
      </div>
    </div>
  )
}

// ============================================================================
// MOCK 1: Project Dropdown + Workspace Pills
// ============================================================================
function Mock1_ProjectDropdownWithPills() {
  const currentProject = () => MOCK_PROJECTS[0]
  const workspaces = () => getProjectWorkspaces(currentProject().id)

  return (
    <div class="h-7 flex items-center px-3 gap-2 bg-background-base border-b border-border-weak-base/50">
      {/* Project dropdown */}
      <DropdownMenu>
        <DropdownMenu.Trigger class="flex items-center gap-1.5 px-2 py-0.5 text-[11px] rounded hover:bg-surface-base-hover transition-colors cursor-pointer border-none bg-transparent text-text-base">
          <span
            class="w-2 h-2 rounded-full shrink-0"
            style={{ "background-color": currentProject().color }}
          />
          <span class="font-medium">{currentProject().name}</span>
          <Icon name="chevron-down" size="small" class="text-icon-weak" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="z-[200]">
            <For each={MOCK_PROJECTS}>
              {(project) => (
                <DropdownMenu.Item>
                  <span
                    class="w-2 h-2 rounded-full shrink-0 mr-2"
                    style={{ "background-color": project.color }}
                  />
                  {project.name}
                </DropdownMenu.Item>
              )}
            </For>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>

      {/* Separator */}
      <span class="text-icon-weak/40">/</span>

      {/* Workspace pills */}
      <div class="flex items-center gap-1 min-w-0 overflow-x-auto no-scrollbar">
        <For each={workspaces()}>
          {(workspace, index) => (
            <>
              <Show when={index() > 0}>
                <span class="text-[11px] text-icon-weak/40">/</span>
              </Show>
              <button
                type="button"
                class={`px-2 py-0.5 text-[11px] rounded transition-colors whitespace-nowrap ${
                  index() === 0
                    ? "text-text-base bg-surface-base-hover"
                    : "text-text-weak hover:text-text-base hover:bg-surface-base-hover/50"
                }`}
              >
                {workspace.name}
              </button>
            </>
          )}
        </For>
      </div>

      {/* Add button */}
      <button
        type="button"
        class="flex items-center justify-center size-5 rounded text-icon-weak hover:text-icon-base hover:bg-surface-base-hover transition-colors ml-1 shrink-0"
      >
        <Icon name="plus-small" size="small" />
      </button>
    </div>
  )
}

// ============================================================================
// MOCK 2: Color-Coded Workspaces with Project Badge
// ============================================================================
function Mock2_ColorCodedWithBadge() {
  const currentProject = () => MOCK_PROJECTS[0]
  const workspaces = () => getProjectWorkspaces(currentProject().id)

  return (
    <div class="h-7 flex items-center px-3 gap-2 bg-background-base border-b border-border-weak-base/50">
      {/* Project badge */}
      <div
        class="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium text-white shrink-0"
        style={{ "background-color": currentProject().color }}
      >
        {currentProject().name}
      </div>

      {/* Workspaces - color-coded left border */}
      <div class="flex items-center gap-1.5 min-w-0 overflow-x-auto no-scrollbar">
        <For each={workspaces()}>
          {(workspace, index) => (
            <button
              type="button"
              class={`px-2 py-0.5 text-[11px] rounded transition-colors whitespace-nowrap border-l-2 ${
                index() === 0
                  ? "text-text-base bg-surface-base-hover"
                  : "text-text-weak hover:text-text-base hover:bg-surface-base-hover/50"
              }`}
              style={{ "border-left-color": currentProject().color }}
            >
              {workspace.name}
            </button>
          )}
        </For>
      </div>

      {/* Add button */}
      <button
        type="button"
        class="flex items-center justify-center size-5 rounded text-icon-weak hover:text-icon-base hover:bg-surface-base-hover transition-colors ml-auto shrink-0"
      >
        <Icon name="plus-small" size="small" />
      </button>
    </div>
  )
}

// ============================================================================
// MOCK 3: Breadcrumb Style (Project > Workspace)
// ============================================================================
function Mock3_BreadcrumbStyle() {
  const currentProject = () => MOCK_PROJECTS[0]
  const currentWorkspace = () => MOCK_WORKSPACES[0]
  const workspaces = () => getProjectWorkspaces(currentProject().id)

  return (
    <div class="h-7 flex items-center px-3 gap-1 bg-background-base border-b border-border-weak-base/50">
      {/* Project selector */}
      <DropdownMenu>
        <DropdownMenu.Trigger class="flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded hover:bg-surface-base-hover transition-colors cursor-pointer border-none bg-transparent text-text-weak hover:text-text-base">
          <Icon name="folder" size="small" />
          <span>{currentProject().name}</span>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="z-[200]">
            <For each={MOCK_PROJECTS}>
              {(project) => (
                <DropdownMenu.Item>
                  <Icon name="folder" size="small" class="mr-2" />
                  {project.name}
                </DropdownMenu.Item>
              )}
            </For>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>

      <Icon name="chevron-right" size="small" class="text-icon-weak/50" />

      {/* Workspace selector */}
      <DropdownMenu>
        <DropdownMenu.Trigger class="flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded hover:bg-surface-base-hover transition-colors cursor-pointer border-none bg-transparent text-text-base font-medium">
          <span>{currentWorkspace().name}</span>
          <Icon name="chevron-down" size="small" class="text-icon-weak" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="z-[200]">
            <For each={workspaces()}>
              {(workspace) => (
                <DropdownMenu.Item>
                  {workspace.name}
                </DropdownMenu.Item>
              )}
            </For>
            <DropdownMenu.Separator />
            <DropdownMenu.Item>
              <Icon name="plus-small" size="small" class="mr-2" />
              New Workspace
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>

      {/* Spacer */}
      <div class="flex-1" />

      {/* Quick workspace pills (optional) */}
      <div class="flex items-center gap-1">
        <For each={workspaces().slice(0, 3)}>
          {(workspace, index) => (
            <button
              type="button"
              class={`w-6 h-4 text-[9px] rounded transition-colors ${
                index() === 0
                  ? "bg-surface-base-hover text-text-base"
                  : "text-text-weak hover:bg-surface-base-hover/50"
              }`}
              title={workspace.name}
            >
              {workspace.name.slice(0, 2)}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

// ============================================================================
// MOCK 4: Segmented Control Style
// ============================================================================
function Mock4_SegmentedControl() {
  const currentProject = () => MOCK_PROJECTS[0]
  const workspaces = () => getProjectWorkspaces(currentProject().id)

  return (
    <div class="h-8 flex items-center px-3 gap-3 bg-background-base border-b border-border-weak-base/50">
      {/* Project indicator */}
      <div class="flex items-center gap-1.5 text-[11px] text-text-weak shrink-0">
        <span
          class="w-2 h-2 rounded-full"
          style={{ "background-color": currentProject().color }}
        />
        <span>{currentProject().name}</span>
      </div>

      {/* Segmented control for workspaces */}
      <div class="flex items-center bg-surface-base-hover/50 rounded-md p-0.5">
        <For each={workspaces()}>
          {(workspace, index) => (
            <button
              type="button"
              class={`px-3 py-1 text-[11px] rounded transition-all whitespace-nowrap ${
                index() === 0
                  ? "bg-background-base text-text-base shadow-sm"
                  : "text-text-weak hover:text-text-base"
              }`}
            >
              {workspace.name}
            </button>
          )}
        </For>
        <button
          type="button"
          class="px-2 py-1 text-text-weak hover:text-text-base transition-colors"
        >
          <Icon name="plus-small" size="small" />
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// MOCK 5: Tabs with Project Color Underline
// ============================================================================
function Mock5_TabsWithColorUnderline() {
  const currentProject = () => MOCK_PROJECTS[0]
  const workspaces = () => getProjectWorkspaces(currentProject().id)

  return (
    <div class="h-8 flex items-center px-3 bg-background-base border-b border-border-weak-base/50">
      {/* Project dropdown on left */}
      <DropdownMenu>
        <DropdownMenu.Trigger class="flex items-center gap-1.5 px-2 py-1 text-[11px] rounded hover:bg-surface-base-hover transition-colors cursor-pointer border-none bg-transparent text-text-weak mr-2">
          <span
            class="w-2 h-2 rounded-full"
            style={{ "background-color": currentProject().color }}
          />
          <Icon name="chevron-down" size="small" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="z-[200]">
            <For each={MOCK_PROJECTS}>
              {(project) => (
                <DropdownMenu.Item>
                  <span
                    class="w-2 h-2 rounded-full mr-2"
                    style={{ "background-color": project.color }}
                  />
                  {project.name}
                </DropdownMenu.Item>
              )}
            </For>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>

      {/* Workspace tabs with underline */}
      <div class="flex items-center gap-0 h-full">
        <For each={workspaces()}>
          {(workspace, index) => (
            <button
              type="button"
              class={`relative px-3 h-full text-[11px] transition-colors ${
                index() === 0 ? "text-text-base" : "text-text-weak hover:text-text-base"
              }`}
            >
              {workspace.name}
              <Show when={index() === 0}>
                <div
                  class="absolute bottom-0 left-0 right-0 h-0.5"
                  style={{ "background-color": currentProject().color }}
                />
              </Show>
            </button>
          )}
        </For>
      </div>

      {/* Add button */}
      <button
        type="button"
        class="flex items-center justify-center size-5 rounded text-icon-weak hover:text-icon-base hover:bg-surface-base-hover transition-colors ml-1"
      >
        <Icon name="plus-small" size="small" />
      </button>
    </div>
  )
}

// ============================================================================
// MOCK 6: Minimal with Hover Expansion (DEPRECATED - see Mock7)
// ============================================================================
function Mock6_MinimalWithHover() {
  const currentProject = () => MOCK_PROJECTS[0]
  const currentWorkspace = () => MOCK_WORKSPACES[0]
  const workspaces = () => getProjectWorkspaces(currentProject().id)

  return (
    <div class="group/bar h-6 flex items-center px-3 bg-background-base border-b border-border-weak-base/50 transition-all hover:h-7">
      {/* Minimal view - always visible */}
      <div class="flex items-center gap-1.5 text-[10px] text-text-weak">
        <span
          class="w-1.5 h-1.5 rounded-full"
          style={{ "background-color": currentProject().color }}
        />
        <span class="opacity-60 group-hover/bar:opacity-100 transition-opacity">
          {currentProject().name}
        </span>
        <span class="opacity-40">/</span>
        <span class="text-text-base">{currentWorkspace().name}</span>
      </div>

      {/* Expanded view - shows on hover */}
      <div class="flex items-center gap-1 ml-3 opacity-0 group-hover/bar:opacity-100 transition-opacity">
        <For each={workspaces().slice(1)}>
          {(workspace) => (
            <button
              type="button"
              class="px-1.5 py-0.5 text-[10px] text-text-weak hover:text-text-base rounded hover:bg-surface-base-hover/50 transition-colors"
            >
              {workspace.name}
            </button>
          )}
        </For>
        <button
          type="button"
          class="flex items-center justify-center size-4 rounded text-icon-weak hover:text-icon-base hover:bg-surface-base-hover transition-colors"
        >
          <Icon name="plus-small" size="small" />
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// MOCK 7: Multi-Project Cards with Notifications
// ============================================================================

// Extended mock data with notifications
const MOCK_PROJECTS_WITH_NOTIFICATIONS = [
  { id: "p1", name: "opencode", color: "#3b82f6" },
  { id: "p2", name: "claxedo-app", color: "#22c55e" },
  { id: "p3", name: "sdk", color: "#f59e0b" },
]

const MOCK_WORKSPACES_WITH_NOTIFICATIONS = [
  { id: "w1", name: "main", projectId: "p1", active: true, notification: false },
  { id: "w2", name: "feature-auth", projectId: "p1", active: false, notification: true },
  { id: "w3", name: "hotfix-123", projectId: "p1", active: false, notification: false },
  { id: "w4", name: "main", projectId: "p2", active: false, notification: false },
  { id: "w5", name: "refactor", projectId: "p2", active: false, notification: true },
  { id: "w6", name: "ui-fixes", projectId: "p2", active: false, notification: true },
  { id: "w7", name: "main", projectId: "p3", active: false, notification: false },
]

// Notification dot component (green)
function NotificationDot() {
  return (
    <span class="relative flex" style={{ width: "8px", height: "8px" }}>
      <span
        class="animate-ping absolute inline-flex rounded-full"
        style={{
          width: "8px",
          height: "8px",
          "background-color": "#22c55e",
          opacity: 0.75,
        }}
      />
      <span
        class="relative inline-flex rounded-full"
        style={{
          width: "8px",
          height: "8px",
          "background-color": "#22c55e",
        }}
      />
    </span>
  )
}

// Project group component - shows project name and its workspaces
// Hover shows subtle background for the whole group
function ProjectGroup(props: {
  name: string
  workspaces: { name: string; active?: boolean; notification?: boolean }[]
  isActiveProject?: boolean
}) {
  return (
    <div class="group/project flex items-center gap-0 rounded px-1 -mx-1 hover:bg-surface-base-hover/30 transition-colors">
      {/* Project name */}
      <span class={`text-[11px] font-medium ${props.isActiveProject ? "text-text-base" : "text-text-weak"}`}>
        {props.name}
      </span>

      {/* Workspaces */}
      <For each={props.workspaces}>
        {(ws) => (
          <button
            type="button"
            class={`flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded hover:bg-surface-base-hover/50 transition-colors ${
              ws.active ? "text-text-base" : "text-text-weak"
            }`}
          >
            <span class="text-text-weak/50">/</span>
            <span>{ws.name}</span>
            <Show when={ws.notification}>
              <NotificationDot />
            </Show>
          </button>
        )}
      </For>
    </div>
  )
}

// State 1: No notifications - show one workspace per project
function Mock7_State1_NoNotifications() {
  return (
    <div class="h-7 flex items-center px-3 gap-0 bg-background-base border-b border-border-weak-base/50">
      {/* Project 1 - opencode (active) */}
      <ProjectGroup
        name="opencode"
        workspaces={[{ name: "main", active: true }]}
        isActiveProject={true}
      />

      {/* Divider */}
      <div class="w-px h-4 bg-border-weak-base mx-2" />

      {/* Project 2 - claxedo-app */}
      <ProjectGroup
        name="claxedo-app"
        workspaces={[{ name: "main" }]}
      />

      {/* Divider */}
      <div class="w-px h-4 bg-border-weak-base mx-2" />

      {/* Project 3 - sdk */}
      <ProjectGroup
        name="sdk"
        workspaces={[{ name: "main" }]}
      />

      {/* Add button */}
      <button
        type="button"
        class="flex items-center justify-center size-5 rounded text-icon-weak hover:text-icon-base hover:bg-surface-base-hover transition-colors ml-auto shrink-0"
      >
        <Icon name="plus-small" size="small" />
      </button>
    </div>
  )
}

// State 2: One project has one notification - show that workspace directly
function Mock7_State2_SingleNotification() {
  return (
    <div class="h-7 flex items-center px-3 gap-0 bg-background-base border-b border-border-weak-base/50">
      {/* Project 1 - opencode (active, has notification on feature-auth) */}
      <ProjectGroup
        name="opencode"
        workspaces={[
          { name: "main", active: true },
          { name: "feature-auth", notification: true },
        ]}
        isActiveProject={true}
      />

      {/* Divider */}
      <div class="w-px h-4 bg-border-weak-base mx-2" />

      {/* Project 2 - claxedo-app (no notifications) */}
      <ProjectGroup
        name="claxedo-app"
        workspaces={[{ name: "main" }]}
      />

      {/* Divider */}
      <div class="w-px h-4 bg-border-weak-base mx-2" />

      {/* Project 3 - sdk (no notifications) */}
      <ProjectGroup
        name="sdk"
        workspaces={[{ name: "main" }]}
      />

      {/* Add button */}
      <button
        type="button"
        class="flex items-center justify-center size-5 rounded text-icon-weak hover:text-icon-base hover:bg-surface-base-hover transition-colors ml-auto shrink-0"
      >
        <Icon name="plus-small" size="small" />
      </button>
    </div>
  )
}

// State 3: One project has multiple notifications - show all notifying workspaces
function Mock7_State3_MultipleNotifications() {
  return (
    <div class="h-7 flex items-center px-3 gap-0 bg-background-base border-b border-border-weak-base/50">
      {/* Project 1 - opencode (active) */}
      <ProjectGroup
        name="opencode"
        workspaces={[{ name: "main", active: true }]}
        isActiveProject={true}
      />

      {/* Divider */}
      <div class="w-px h-4 bg-border-weak-base mx-2" />

      {/* Project 2 - claxedo-app (has 2 notifications - show all) */}
      <ProjectGroup
        name="claxedo-app"
        workspaces={[
          { name: "main" },
          { name: "refactor", notification: true },
          { name: "ui-fixes", notification: true },
        ]}
      />

      {/* Divider */}
      <div class="w-px h-4 bg-border-weak-base mx-2" />

      {/* Project 3 - sdk (no notifications) */}
      <ProjectGroup
        name="sdk"
        workspaces={[{ name: "main" }]}
      />

      {/* Add button */}
      <button
        type="button"
        class="flex items-center justify-center size-5 rounded text-icon-weak hover:text-icon-base hover:bg-surface-base-hover transition-colors ml-auto shrink-0"
      >
        <Icon name="plus-small" size="small" />
      </button>
    </div>
  )
}

// State 4: Multiple projects have notifications
function Mock7_State4_MultiProjectNotifications() {
  return (
    <div class="h-7 flex items-center px-3 gap-0 bg-background-base border-b border-border-weak-base/50">
      {/* Project 1 - opencode (active, has 1 notification) */}
      <ProjectGroup
        name="opencode"
        workspaces={[
          { name: "main", active: true },
          { name: "feature-auth", notification: true },
        ]}
        isActiveProject={true}
      />

      {/* Divider */}
      <div class="w-px h-4 bg-border-weak-base mx-2" />

      {/* Project 2 - claxedo-app (has 2 notifications) */}
      <ProjectGroup
        name="claxedo-app"
        workspaces={[
          { name: "main" },
          { name: "refactor", notification: true },
          { name: "ui-fixes", notification: true },
        ]}
      />

      {/* Divider */}
      <div class="w-px h-4 bg-border-weak-base mx-2" />

      {/* Project 3 - sdk (no notifications) */}
      <ProjectGroup
        name="sdk"
        workspaces={[{ name: "main" }]}
      />

      {/* Add button */}
      <button
        type="button"
        class="flex items-center justify-center size-5 rounded text-icon-weak hover:text-icon-base hover:bg-surface-base-hover transition-colors ml-auto shrink-0"
      >
        <Icon name="plus-small" size="small" />
      </button>
    </div>
  )
}

// Combined Mock 7 showing all states
function Mock7_MultiProjectCards() {
  return (
    <div class="flex flex-col">
      <div class="text-[9px] text-text-weak px-2 py-0.5 bg-surface-base-hover/20">State 1: No notifications</div>
      <Mock7_State1_NoNotifications />
      <div class="text-[9px] text-text-weak px-2 py-0.5 bg-surface-base-hover/20">State 2: One workspace has notification</div>
      <Mock7_State2_SingleNotification />
      <div class="text-[9px] text-text-weak px-2 py-0.5 bg-surface-base-hover/20">State 3: Multiple workspaces in one project have notifications</div>
      <Mock7_State3_MultipleNotifications />
      <div class="text-[9px] text-text-weak px-2 py-0.5 bg-surface-base-hover/20">State 4: Multiple projects have notifications</div>
      <Mock7_State4_MultiProjectNotifications />
    </div>
  )
}

// ============================================================================
// Main Export: All Mocks Together
// ============================================================================
export function WorkspaceBarMocks() {
  return (
    <div class="p-6 max-w-3xl mx-auto">
      <h2 class="text-lg font-bold text-text-strong mb-6">WorkspaceBar UI Approaches</h2>

      <MockSection
        title="1. Project Dropdown + Workspace Pills"
        description="Project name in a dropdown, workspaces as clickable pills. Clear hierarchy, easy switching."
      >
        <Mock1_ProjectDropdownWithPills />
      </MockSection>

      <MockSection
        title="2. Color-Coded with Project Badge"
        description="Prominent project badge with color, workspaces have matching left border."
      >
        <Mock2_ColorCodedWithBadge />
      </MockSection>

      <MockSection
        title="3. Breadcrumb Style"
        description="Project > Workspace path with dropdowns. Familiar file-system metaphor."
      >
        <Mock3_BreadcrumbStyle />
      </MockSection>

      <MockSection
        title="4. Segmented Control"
        description="iOS-style segmented control for workspaces. Clean and modern."
      >
        <Mock4_SegmentedControl />
      </MockSection>

      <MockSection
        title="5. Tabs with Color Underline"
        description="Tab-style with project color as active indicator underline."
      >
        <Mock5_TabsWithColorUnderline />
      </MockSection>

      <MockSection
        title="6. Minimal with Hover Expansion"
        description="Ultra-compact by default, expands on hover to show other workspaces."
      >
        <Mock6_MinimalWithHover />
      </MockSection>
    </div>
  )
}

// Export individual mocks for selective use
export {
  Mock1_ProjectDropdownWithPills,
  Mock2_ColorCodedWithBadge,
  Mock3_BreadcrumbStyle,
  Mock4_SegmentedControl,
  Mock5_TabsWithColorUnderline,
  Mock6_MinimalWithHover,
  Mock7_MultiProjectCards,
  Mock7_State1_NoNotifications,
  Mock7_State2_SingleNotification,
  Mock7_State3_MultipleNotifications,
  Mock7_State4_MultiProjectNotifications,
}
