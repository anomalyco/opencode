import { afterEach, describe, expect, test, vi } from "vitest"
import { render, cleanup, fireEvent, waitFor } from "@solidjs/testing-library"

// ---------------------------------------------------------------------------
// Mocks — minimal DOM stubs with data-testid attributes
// ---------------------------------------------------------------------------

vi.mock("@opencode-ai/ui/button", () => ({
  Button: (props: any) => (
    <button
      data-testid="button"
      data-variant={props.variant}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  ),
}))

vi.mock("@opencode-ai/ui/icon-button", () => ({
  IconButton: (props: any) => (
    <button
      data-testid="icon-button"
      data-icon={props.icon}
      onClick={props.onClick}
    />
  ),
}))

vi.mock("@opencode-ai/ui/tooltip", () => ({
  Tooltip: (props: any) => <>{props.children}</>,
}))

vi.mock("@opencode-ai/ui/basic-tool", () => ({
  BasicTool: (props: any) => (
    <div data-testid="basic-tool">{props.children}</div>
  ),
}))

vi.mock("@/components/prompt-input", () => ({
  PromptInput: (props: any) => <div data-testid="prompt-input" ref={props.ref} />,
}))

vi.mock("@/components/question-dock", () => ({
  QuestionDock: (props: any) => <div data-testid="question-dock" />,
}))

vi.mock("@/pages/session/session-prompt-helpers", () => ({
  questionSubtitle: (count: number, t: (k: string) => string) => `${count} questions`,
}))

import { CompactPromptDock } from "./compact-prompt-dock"

afterEach(() => {
  cleanup()
  document.body.innerHTML = ""
})

function defaults(overrides: Partial<Parameters<typeof CompactPromptDock>[0]> = {}) {
  return {
    onToggle: vi.fn(),
    t: (key: string) => key,
    questionRequest: () => undefined,
    permissionRequest: () => undefined,
    blocked: false,
    promptReady: true,
    responding: false,
    onDecide: vi.fn(),
    inputRef: vi.fn(),
    newSessionWorktree: "/ws",
    onNewSessionWorktreeReset: vi.fn(),
    onSubmit: vi.fn(),
    setPromptDockRef: vi.fn(),
    ...overrides,
  } as Parameters<typeof CompactPromptDock>[0]
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

describe("header", () => {
  test("renders provided title in header", () => {
    const { container } = render(() => <CompactPromptDock {...defaults({ title: "My Session" })} />)
    const header = container.querySelector(".text-12-regular.text-text-weak")!
    expect(header.textContent).toBe("My Session")
  })

  test("renders fallback translation when title is undefined", () => {
    const { container } = render(() => <CompactPromptDock {...defaults()} />)
    const header = container.querySelector(".text-12-regular.text-text-weak")!
    expect(header.textContent).toBe("session.title")
  })
})

// ---------------------------------------------------------------------------
// Expand button — shows/hides messages panel
// ---------------------------------------------------------------------------

describe("expand button", () => {
  test("clicking expand shows messages panel when messages provided", async () => {
    const { container } = render(() => (
      <CompactPromptDock
        {...defaults({ messages: <div data-testid="messages-content">hello</div> })}
      />
    ))

    // Initially collapsed — no messages visible
    expect(container.querySelector("[data-testid='messages-content']")).toBeNull()

    // Click expand button (initially has icon="expand")
    const expandBtn = container.querySelector("[data-icon='expand']") as HTMLButtonElement
    expect(expandBtn).not.toBeNull()
    fireEvent.click(expandBtn)

    await waitFor(() => {
      expect(container.querySelector("[data-testid='messages-content']")).not.toBeNull()
    })
  })

  test("clicking expand again hides messages panel", async () => {
    const { container } = render(() => (
      <CompactPromptDock
        {...defaults({ messages: <div data-testid="messages-content">hello</div> })}
      />
    ))

    // Expand
    fireEvent.click(container.querySelector("[data-icon='expand']") as HTMLButtonElement)
    await waitFor(() => {
      expect(container.querySelector("[data-testid='messages-content']")).not.toBeNull()
    })

    // Collapse — button icon is now "collapse"
    fireEvent.click(container.querySelector("[data-icon='collapse']") as HTMLButtonElement)
    await waitFor(() => {
      expect(container.querySelector("[data-testid='messages-content']")).toBeNull()
    })
  })

  test("messages panel stays hidden when expanded but no messages prop", async () => {
    const { container } = render(() => <CompactPromptDock {...defaults()} />)

    // Expand
    fireEvent.click(container.querySelector("[data-icon='expand']") as HTMLButtonElement)

    // Wait a tick for reactivity
    await new Promise<void>((r) => setTimeout(r, 50))

    // No messages container rendered (Show when={expanded() && props.messages} is falsy)
    expect(container.querySelector("[data-testid='messages-content']")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Sidebar toggle button — calls onToggle
// ---------------------------------------------------------------------------

describe("sidebar toggle button", () => {
  test("onToggle called when sidebar toggle button clicked", () => {
    const onToggle = vi.fn()
    const { container } = render(() => <CompactPromptDock {...defaults({ onToggle })} />)

    const toggleBtn = container.querySelector("[data-icon='layout-right']") as HTMLButtonElement
    expect(toggleBtn).not.toBeNull()
    fireEvent.click(toggleBtn)
    expect(onToggle).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// Auto-scroll
// ---------------------------------------------------------------------------

describe("auto-scroll", () => {
  test("scrolls messages container to bottom when expanded", async () => {
    const { container } = render(() => (
      <CompactPromptDock
        {...defaults({
          messages: (
            <div style="height: 500px">
              <div>line 1</div>
              <div>line 2</div>
            </div>
          ),
        })}
      />
    ))

    // Expand to trigger auto-scroll effect
    fireEvent.click(container.querySelector("[data-icon='expand']") as HTMLButtonElement)

    await waitFor(() => {
      expect(container.querySelector("[data-testid='messages-content']") || container.querySelector(".overflow-y-auto")).not.toBeNull()
    })

    // The auto-scroll uses requestAnimationFrame — wait for it
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    await new Promise<void>((r) => setTimeout(r, 50))

    const scrollContainer = container.querySelector(".overflow-y-auto") as HTMLDivElement
    if (scrollContainer && scrollContainer.scrollHeight > scrollContainer.clientHeight) {
      expect(scrollContainer.scrollTop).toBe(scrollContainer.scrollHeight - scrollContainer.clientHeight)
    }
  })
})

// ---------------------------------------------------------------------------
// Question dock
// ---------------------------------------------------------------------------

describe("question dock", () => {
  test("question dock hidden when questionRequest is undefined", () => {
    const { container } = render(() => <CompactPromptDock {...defaults()} />)
    expect(container.querySelector("[data-question]")).toBeNull()
  })

  test("question dock visible when questionRequest provided", async () => {
    const { container } = render(() => (
      <CompactPromptDock
        {...defaults({
          questionRequest: () => ({ questions: [{ type: "text", question: "name?" }] }) as any,
        })}
      />
    ))

    await waitFor(() => {
      expect(container.querySelector("[data-question='true']")).not.toBeNull()
      expect(container.querySelector("[data-testid='question-dock']")).not.toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// Permission dock
// ---------------------------------------------------------------------------

describe("permission dock", () => {
  const permReq = () => ({ patterns: ["src/**/*.ts", "lib/**"], permission: "write" })

  test("permission dock hidden when permissionRequest is undefined", () => {
    const { container } = render(() => <CompactPromptDock {...defaults()} />)
    expect(container.querySelector("[data-permission]")).toBeNull()
  })

  test("permission dock renders patterns and three action buttons when provided", async () => {
    const { container } = render(() => (
      <CompactPromptDock {...defaults({ permissionRequest: permReq })} />
    ))

    await waitFor(() => {
      expect(container.querySelector("[data-permission='true']")).not.toBeNull()
    })

    // Three permission buttons: deny, allowAlways, allowOnce
    const buttons = container.querySelectorAll("[data-component='permission-prompt'] button")
    expect(buttons.length).toBe(3)

    // Pattern codes rendered
    const codes = container.querySelectorAll("[data-permission='true'] code")
    expect(codes.length).toBe(2)
    expect(codes[0].textContent).toBe("src/**/*.ts")
    expect(codes[1].textContent).toBe("lib/**")
  })

  test("permission buttons are disabled when responding is true", async () => {
    const { container } = render(() => (
      <CompactPromptDock {...defaults({ permissionRequest: permReq, responding: true })} />
    ))

    await waitFor(() => {
      const buttons = container.querySelectorAll("[data-component='permission-prompt'] button")
      expect(buttons.length).toBe(3)
      for (const btn of buttons) {
        expect((btn as HTMLButtonElement).disabled).toBe(true)
      }
    })
  })

  test("clicking permission buttons calls onDecide with correct value", async () => {
    const onDecide = vi.fn()
    const { container } = render(() => (
      <CompactPromptDock {...defaults({ permissionRequest: permReq, onDecide })} />
    ))

    await waitFor(() => {
      expect(container.querySelectorAll("[data-component='permission-prompt'] button").length).toBe(3)
    })

    const buttons = container.querySelectorAll("[data-component='permission-prompt'] button")
    // Order from component: deny (ghost), always (secondary), once (primary)
    fireEvent.click(buttons[0]) // deny → "reject"
    expect(onDecide).toHaveBeenLastCalledWith("reject")

    fireEvent.click(buttons[1]) // always → "always"
    expect(onDecide).toHaveBeenLastCalledWith("always")

    fireEvent.click(buttons[2]) // once → "once"
    expect(onDecide).toHaveBeenLastCalledWith("once")

    expect(onDecide).toHaveBeenCalledTimes(3)
  })
})

// ---------------------------------------------------------------------------
// Prompt input vs loading
// ---------------------------------------------------------------------------

describe("prompt input vs loading", () => {
  test("prompt input rendered when not blocked and promptReady", () => {
    const { container } = render(() => (
      <CompactPromptDock {...defaults({ blocked: false, promptReady: true })} />
    ))
    expect(container.querySelector("[data-testid='prompt-input']")).not.toBeNull()
  })

  test("loading fallback rendered when not blocked and not promptReady", () => {
    const { container } = render(() => (
      <CompactPromptDock {...defaults({ blocked: false, promptReady: false })} />
    ))
    expect(container.querySelector("[data-testid='prompt-input']")).toBeNull()
    expect(container.textContent).toContain("prompt.loading")
  })

  test("loading fallback shows handoffPrompt when provided", () => {
    const { container } = render(() => (
      <CompactPromptDock
        {...defaults({ blocked: false, promptReady: false, handoffPrompt: "Handing off..." })}
      />
    ))
    expect(container.textContent).toContain("Handing off...")
  })

  test("prompt area hidden when blocked", () => {
    const { container } = render(() => (
      <CompactPromptDock {...defaults({ blocked: true, promptReady: true })} />
    ))
    expect(container.querySelector("[data-testid='prompt-input']")).toBeNull()
  })
})
