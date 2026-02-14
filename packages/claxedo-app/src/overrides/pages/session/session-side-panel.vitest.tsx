/**
 * SessionSidePanel – compact prompt visibility tests
 *
 * Verifies that the compact floating prompt renders in the DOM whenever
 * the review panel area is open, regardless of:
 *   - File tree tab ("changes" vs "all")
 *   - Whether the review tab is active in tabbed mode
 *   - Whether the file tree is open or closed
 */

import { afterEach, describe, expect, test, vi } from "vitest"
import { render, cleanup } from "@solidjs/testing-library"

// ---------------------------------------------------------------------------
// Mocks — minimal stubs for all transitive imports
// ---------------------------------------------------------------------------

vi.mock("@opencode-ai/ui/tabs", () => {
  const Tabs = (props: any) => <div data-component="tabs">{props.children}</div>
  Tabs.List = (props: any) => <div data-component="tabs-list" ref={props.ref}>{props.children}</div>
  Tabs.Trigger = (props: any) => <button data-tab-value={props.value}>{props.children}</button>
  Tabs.Content = (props: any) => <div data-tab-content={props.value}>{props.children}</div>
  return { Tabs }
})

vi.mock("@opencode-ai/ui/icon-button", () => ({
  IconButton: (props: any) => <button data-icon={props.icon} onClick={props.onClick} />,
}))

vi.mock("@opencode-ai/ui/tooltip", () => ({
  Tooltip: (props: any) => <>{props.children}</>,
  TooltipKeybind: (props: any) => <>{props.children}</>,
}))

vi.mock("@opencode-ai/ui/resize-handle", () => ({
  ResizeHandle: () => <div data-component="resize-handle" />,
}))

vi.mock("@claxedo/claxedo-ui/components/claxedo-logo", () => ({
  ClaxedoLogo: () => <div data-component="logo" />,
}))

vi.mock("@/components/file-tree", () => ({
  default: () => <div data-component="file-tree" />,
}))

vi.mock("@/components/session-context-usage", () => ({
  SessionContextUsage: () => <div data-component="context-usage" />,
}))

vi.mock("@/components/session", () => ({
  SessionContextTab: () => <div />,
  SortableTab: () => <div />,
  FileVisual: () => <div />,
}))

vi.mock("@/components/dialog-select-file", () => ({
  DialogSelectFile: () => <div />,
}))

vi.mock("@/pages/session/file-tab-scroll", () => ({
  createFileTabListSync: () => () => {},
}))

vi.mock("@/pages/session/file-tabs", () => ({
  FileTabContent: () => <div data-component="file-tab-content" />,
}))

vi.mock("@/pages/session/review-tab", () => ({
  StickyAddButton: (props: any) => <div>{props.children}</div>,
}))

vi.mock("@thisbeyond/solid-dnd", () => ({
  DragDropProvider: (props: any) => <div>{props.children}</div>,
  DragDropSensors: () => <div />,
  DragOverlay: (props: any) => <div>{props.children}</div>,
  SortableProvider: (props: any) => <>{props.children}</>,
  closestCenter: () => null,
}))

vi.mock("@/utils/solid-dnd", () => ({
  ConstrainDragYAxis: () => <div />,
}))

import { SessionSidePanel } from "./session-side-panel"

afterEach(() => {
  cleanup()
  document.body.innerHTML = ""
})

// ---------------------------------------------------------------------------
// Props factory
// ---------------------------------------------------------------------------

function defaults(overrides: Partial<Parameters<typeof SessionSidePanel>[0]> = {}) {
  return {
    open: true,
    reviewOpen: true,
    language: { t: (key: string) => key } as any,
    layout: {
      fileTree: {
        opened: () => true,
        width: () => 344,
        resize: vi.fn(),
        close: vi.fn(),
      },
    } as any,
    command: { keybind: () => undefined } as any,
    dialog: { show: vi.fn() } as any,
    file: { pathFromTab: () => undefined, tab: (p: string) => p } as any,
    comments: {} as any,
    sync: {} as any,
    hasReview: true,
    reviewCount: 3,
    reviewTab: false,
    contextOpen: () => false,
    openedTabs: () => [] as string[],
    activeTab: () => "review",
    activeFileTab: () => undefined,
    tabs: () => ({ all: () => [], close: vi.fn(), open: vi.fn() }) as any,
    openTab: vi.fn(),
    showAllFiles: vi.fn(),
    reviewPanel: () => <div data-testid="review-content">review content</div>,
    messages: () => [],
    visibleUserMessages: () => [],
    view: () => ({}) as any,
    info: () => undefined,
    handoffFiles: () => undefined,
    codeComponent: "div" as any,
    addCommentToContext: vi.fn(),
    activeDraggable: () => undefined,
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
    onDragOver: vi.fn(),
    fileTreeTab: () => "changes" as const,
    setFileTreeTabValue: vi.fn(),
    diffsReady: true,
    diffFiles: [],
    kinds: new Map(),
    focusReviewDiff: vi.fn(),
    ...overrides,
  } as Parameters<typeof SessionSidePanel>[0]
}

// ---------------------------------------------------------------------------
// Compact prompt visibility
// ---------------------------------------------------------------------------

describe("compact prompt visibility", () => {
  const COMPACT_PROMPT = <div data-testid="compact-prompt">floating prompt</div>

  test("renders compact prompt when file tree is open on 'changes' tab", () => {
    const { container } = render(() => (
      <SessionSidePanel
        {...defaults({
          reviewOpen: true,
          layout: { fileTree: { opened: () => true, width: () => 344, resize: vi.fn(), close: vi.fn() } } as any,
          fileTreeTab: () => "changes",
          compactPrompt: COMPACT_PROMPT,
        })}
      />
    ))

    expect(container.querySelector("[data-testid='compact-prompt']")).not.toBeNull()
  })

  test("renders compact prompt when file tree is open on 'all' tab", () => {
    const { container } = render(() => (
      <SessionSidePanel
        {...defaults({
          reviewOpen: true,
          layout: { fileTree: { opened: () => true, width: () => 344, resize: vi.fn(), close: vi.fn() } } as any,
          fileTreeTab: () => "all",
          compactPrompt: COMPACT_PROMPT,
        })}
      />
    ))

    expect(container.querySelector("[data-testid='compact-prompt']")).not.toBeNull()
  })

  test("renders compact prompt when file tree is closed", () => {
    const { container } = render(() => (
      <SessionSidePanel
        {...defaults({
          reviewOpen: true,
          layout: { fileTree: { opened: () => false, width: () => 344, resize: vi.fn(), close: vi.fn() } } as any,
          fileTreeTab: () => "changes",
          compactPrompt: COMPACT_PROMPT,
        })}
      />
    ))

    expect(container.querySelector("[data-testid='compact-prompt']")).not.toBeNull()
  })

  test("renders compact prompt when active tab is a file tab (not review)", () => {
    const { container } = render(() => (
      <SessionSidePanel
        {...defaults({
          reviewOpen: true,
          reviewTab: true,
          activeTab: () => "file://src/index.ts",
          layout: { fileTree: { opened: () => false, width: () => 344, resize: vi.fn(), close: vi.fn() } } as any,
          compactPrompt: COMPACT_PROMPT,
        })}
      />
    ))

    expect(container.querySelector("[data-testid='compact-prompt']")).not.toBeNull()
  })

  test("does not render compact prompt when review panel is closed", () => {
    const { container } = render(() => (
      <SessionSidePanel
        {...defaults({
          reviewOpen: false,
          compactPrompt: COMPACT_PROMPT,
        })}
      />
    ))

    // The compact prompt's parent div has `hidden` when reviewOpen is false
    // It should not be visually accessible
    const prompt = container.querySelector("[data-testid='compact-prompt']")
    if (prompt) {
      // Element exists in DOM but parent must be hidden
      const parent = prompt.closest(".hidden")
      expect(parent).not.toBeNull()
    }
  })

  test("does not render compact prompt when compactPrompt prop is undefined", () => {
    const { container } = render(() => (
      <SessionSidePanel
        {...defaults({
          reviewOpen: true,
          compactPrompt: undefined,
        })}
      />
    ))

    expect(container.querySelector("[data-testid='compact-prompt']")).toBeNull()
  })

  test("does not render compact prompt when panel is not open", () => {
    const { container } = render(() => (
      <SessionSidePanel
        {...defaults({
          open: false,
          reviewOpen: true,
          compactPrompt: COMPACT_PROMPT,
        })}
      />
    ))

    expect(container.querySelector("[data-testid='compact-prompt']")).toBeNull()
  })
})
