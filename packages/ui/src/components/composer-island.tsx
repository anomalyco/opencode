import { type Component, createSignal, createEffect, on, For, Show, createMemo, Index } from "solid-js"
import { useSpring } from "@opencode-ai/ui/motion-spring"
import { useElementHeight } from "@opencode-ai/ui/hooks"
import { Button } from "./button"
import { IconButton } from "./icon-button"
import { Icon } from "./icon"
import { RadioGroup } from "./radio-group"
import { AnimatedNumber } from "./animated-number"
import { TextReveal } from "./text-reveal"
import { Checkbox } from "./checkbox"
import { TextStrikethrough } from "./text-strikethrough"

export interface TodoItem {
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
}

export interface ComposerIslandProps {
  mode?: "input" | "question"
  questionText?: string
  questionOptions?: Array<{ label: string; description?: string }>
  questionMultiple?: boolean
  placeholder?: string
  value?: string
  onValueChange?: (value: string) => void
  onSubmit?: () => void
  agentName?: string
  modelName?: string
  variant?: string
  todos?: TodoItem[]
  showTodos?: boolean
  todoCollapsed?: boolean
  onTodoCollapseChange?: (collapsed: boolean) => void
  heightSpring?: { visualDuration: number; bounce: number }
  morphSpring?: { visualDuration: number; bounce: number }
}

const COLLAPSED_HEIGHT = 78
const SUBTITLE = { duration: 600, travel: 25, edge: 17 }
const COUNT = { duration: 600, mask: 18, maskHeight: 0, widthDuration: 560 }

export const ComposerIsland: Component<ComposerIslandProps> = (props) => {
  const [value, setValue] = createSignal(props.value ?? "")
  const [selectedOptions, setSelectedOptions] = createSignal<string[]>([])
  const [customAnswer, setCustomAnswer] = createSignal("")
  const [showCustom, setShowCustom] = createSignal(false)
  const [shellMode, setShellMode] = createSignal<"shell" | "normal">("normal")

  const isQuestion = () => props.mode === "question"
  const isMulti = () => props.questionMultiple ?? false

  // Measure actual content heights via hidden sizer divs
  const [inputSizerRef, setInputSizerRef] = createSignal<HTMLDivElement>()
  const [questionSizerRef, setQuestionSizerRef] = createSignal<HTMLDivElement>()
  const inputHeight = useElementHeight(inputSizerRef, 48)
  const questionHeight = useElementHeight(questionSizerRef, 280)

  // Shell padding: 8px top + 44px bottom (for absolute buttons area)
  const shellPaddingInput = 52
  // Question shell: 8px top padding + 8px bottom padding in body + some breathing room
  const shellPaddingQuestion = 16
  const targetHeight = createMemo(() =>
    isQuestion() ? questionHeight() + shellPaddingQuestion : inputHeight() + shellPaddingInput,
  )

  // Spring directly to target pixel height
  const animatedHeight = useSpring(targetHeight, () => props.heightSpring ?? { visualDuration: 0.35, bounce: 0.2 })

  // Crossfade spring 0→1
  const morphTarget = () => (isQuestion() ? 1 : 0)
  const morph = useSpring(morphTarget, () => props.morphSpring ?? { visualDuration: 0.25, bounce: 0.1 })

  // Crossfade values — overlapping so both visible simultaneously
  const inputOpacity = createMemo(() => Math.max(0, 1 - morph() * 1.5))
  const inputScale = createMemo(() => 1 + morph() * 0.15)
  const inputBlur = createMemo(() => morph() * 5)

  const questionOpacity = createMemo(() => Math.max(0, morph() * 1.5 - 0.5))
  const questionScale = createMemo(() => 0.85 + morph() * 0.15)
  const questionBlur = createMemo(() => (1 - morph()) * 5)

  const toggleOption = (label: string) => {
    if (isMulti()) {
      setSelectedOptions((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]))
    } else {
      setSelectedOptions([label])
    }
  }

  const isSelected = (label: string) => selectedOptions().includes(label)

  // Shared question content (used in both sizer and visible layer)
  const QuestionContent = () => (
    <>
      <div data-slot="question-content">
        <div data-slot="question-text">{props.questionText}</div>
        <Show
          when={isMulti()}
          fallback={<div data-slot="question-hint">Select an option</div>}
        >
          <div data-slot="question-hint">Select one or more options</div>
        </Show>
        <div data-slot="question-options">
          <For each={props.questionOptions}>
            {(opt) => {
              const picked = () => isSelected(opt.label)
              return (
                <button
                  data-slot="question-option"
                  data-picked={picked()}
                  onClick={() => toggleOption(opt.label)}
                >
                  <span data-slot="question-option-check" aria-hidden="true">
                    <span
                      data-slot="question-option-box"
                      data-type={isMulti() ? "checkbox" : "radio"}
                      data-picked={picked()}
                    >
                      <Show
                        when={isMulti()}
                        fallback={<span data-slot="question-option-radio-dot" />}
                      >
                        <Icon name="check-small" size="small" />
                      </Show>
                    </span>
                  </span>
                  <span data-slot="question-option-main">
                    <span data-slot="option-label">{opt.label}</span>
                    <Show when={opt.description}>
                      <span data-slot="option-description">{opt.description}</span>
                    </Show>
                  </span>
                </button>
              )
            }}
          </For>

          {/* Custom answer option */}
          <Show
            when={showCustom()}
            fallback={
              <button
                data-slot="question-option"
                data-custom="true"
                data-picked={false}
                onClick={() => setShowCustom(true)}
              >
                <span data-slot="question-option-check" aria-hidden="true">
                  <span
                    data-slot="question-option-box"
                    data-type={isMulti() ? "checkbox" : "radio"}
                    data-picked={false}
                  >
                    <Show
                      when={isMulti()}
                      fallback={<span data-slot="question-option-radio-dot" />}
                    >
                      <Icon name="check-small" size="small" />
                    </Show>
                  </span>
                </span>
                <span data-slot="question-option-main">
                  <span data-slot="option-label">Type your own answer...</span>
                </span>
              </button>
            }
          >
            <form
              data-slot="question-option"
              data-custom="true"
              data-picked={customAnswer().trim().length > 0}
              onMouseDown={(e) => {
                if (e.target instanceof HTMLTextAreaElement) return
                const input = e.currentTarget.querySelector('[data-slot="question-custom-input"]')
                if (input instanceof HTMLTextAreaElement) input.focus()
              }}
              onSubmit={(e) => e.preventDefault()}
            >
              <span data-slot="question-option-check" aria-hidden="true">
                <span
                  data-slot="question-option-box"
                  data-type={isMulti() ? "checkbox" : "radio"}
                  data-picked={customAnswer().trim().length > 0}
                >
                  <Show
                    when={isMulti()}
                    fallback={<span data-slot="question-option-radio-dot" />}
                  >
                    <Icon name="check-small" size="small" />
                  </Show>
                </span>
              </span>
              <span data-slot="question-option-main">
                <span data-slot="option-label">Type your own answer...</span>
                <textarea
                  data-slot="question-custom-input"
                  placeholder="Type your answer..."
                  value={customAnswer()}
                  onInput={(e) => setCustomAnswer(e.currentTarget.value)}
                  rows={1}
                  autofocus
                />
              </span>
            </form>
          </Show>
        </div>
      </div>
    </>
  )

  // Todo scroll state
  const [todoStuck, setTodoStuck] = createSignal(false)
  let todoScrollRef: HTMLDivElement | undefined

  // Todo tray state — controlled by props if provided
  const [todoCollapsed, _setTodoCollapsed] = createSignal(props.todoCollapsed ?? false)
  createEffect(on(() => props.todoCollapsed, (v) => { if (v !== undefined) _setTodoCollapsed(v) }))
  const setTodoCollapsed = (v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === "function" ? v(todoCollapsed()) : v
    _setTodoCollapsed(next)
    props.onTodoCollapseChange?.(next)
  }
  const hasTodos = () => (props.todos?.length ?? 0) > 0 && (props.showTodos ?? false) && !isQuestion()
  const todoProgress = useSpring(() => (hasTodos() ? 1 : 0), { visualDuration: 0.3, bounce: 0 })
  const todoCollapseProgress = useSpring(() => (todoCollapsed() ? 1 : 0), { visualDuration: 0.3, bounce: 0 })

  const todos = () => props.todos ?? []
  const total = createMemo(() => todos().length)
  const done = createMemo(() => todos().filter((t) => t.status === "completed").length)

  // Active todo for collapsed preview
  const active = createMemo(
    () =>
      todos().find((t) => t.status === "in_progress") ??
      todos().find((t) => t.status === "pending") ??
      todos().filter((t) => t.status === "completed").at(-1) ??
      todos()[0],
  )
  const preview = createMemo(() => active()?.content ?? "")

  // Measure todo content height — spring it so adding/removing todos animates
  const [todoContentRef, setTodoContentRef] = createSignal<HTMLDivElement>()
  const todoContentHeightRaw = useElementHeight(todoContentRef, 200)
  const todoContentHeight = useSpring(
    () => Math.max(COLLAPSED_HEIGHT, todoContentHeightRaw()),
    { visualDuration: 0.3, bounce: 0 },
  )
  const todoFullHeight = createMemo(() => todoContentHeight())
  const todoVisibleHeight = createMemo(() => {
    const full = todoFullHeight()
    const collapsed = full - todoCollapseProgress() * (full - COLLAPSED_HEIGHT)
    return collapsed * todoProgress()
  })

  // hide = max of collapse and dock-progress-out (for blur/opacity on list)
  const shut = createMemo(() => 1 - todoProgress())
  const hide = createMemo(() => Math.max(todoCollapseProgress(), shut()))

  // Shell-todo overlap (matches real margin-top: -36px * progress)
  const todoOverlap = createMemo(() => 36 * todoProgress())

  // Measure bottom tray height
  const [trayRef, setTrayRef] = createSignal<HTMLDivElement>()
  const trayHeight = useElementHeight(trayRef, 42)
  // Tray overlaps under the shell by 14px (matches DockTray attach="top" margin-top: -0.875rem)
  const trayOverlap = 14
  const totalHeight = createMemo(() =>
    todoVisibleHeight() - todoOverlap() + animatedHeight() + trayHeight() - trayOverlap,
  )

  return (
    <div
      data-component="composer-island"
      data-mode={props.mode}
      style={{
        width: "100%",
        "max-width": "720px",
        margin: "0 auto",
        position: "relative",
        height: `${totalHeight()}px`,
      }}
    >
      {/* Tray — sits behind the shell, pinned to bottom */}
      <div
        ref={setTrayRef}
        data-dock-surface="tray"
        data-dock-attach="top"
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          "z-index": 0,
          // Fixed height so absolute children don't collapse it
          // 22px top overlap + 28px button + 8px bottom padding
          height: "58px",
          // Opaque border: alpha-composite of --border-weak-base over --background-base
          "border-color": "light-dark(#dcd9d9, #3e3a3a)",
        }}
      >
        {/* Input mode tray — crossfades out */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            padding: "22px 7px 8px",
            gap: "8px",
            opacity: inputOpacity(),
            filter: `blur(${inputBlur()}px)`,
            "pointer-events": morph() > 0.5 ? "none" : "auto",
          }}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "6px", "min-width": 0, flex: 1 }}>
            <Button variant="ghost" size="normal" style={{ height: "28px" }}>
              {props.agentName ?? "Ask"}
              <Icon name="chevron-down" size="small" />
            </Button>
            <Button variant="ghost" size="normal" style={{ height: "28px" }}>
              <Icon name="brain" size="small" />
              {props.modelName ?? "GPT-4"}
              <Icon name="chevron-down" size="small" />
            </Button>
            <Button variant="ghost" size="normal" style={{ height: "28px" }}>
              {props.variant ?? "Default"}
              <Icon name="chevron-down" size="small" />
            </Button>
          </div>
          <RadioGroup
            options={["shell", "normal"] as const}
            current={shellMode()}
            onSelect={setShellMode}
            value={(mode) => mode}
            label={(mode) => (
              <Icon
                name={mode === "shell" ? "console" : "prompt"}
                class="size-[18px]"
              />
            )}
            fill
            pad="none"
            class="w-[68px] shrink-0"
          />
        </div>

        {/* Question mode tray — crossfades in */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            padding: "22px 8px 8px",
            opacity: questionOpacity(),
            filter: `blur(${questionBlur()}px)`,
            "pointer-events": morph() < 0.5 ? "none" : "auto",
          }}
        >
          <Button variant="ghost" size="normal" style={{ height: "28px" }}>
            Dismiss
          </Button>
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <Button variant="secondary" size="normal" style={{ height: "28px" }}>
              Back
            </Button>
            <Button variant="primary" size="normal" style={{ height: "28px" }}>
              Next
            </Button>
          </div>
        </div>
      </div>

      {/* Todo tray — sits above the shell */}
      <Show when={todoProgress() > 0.001}>
        <div
          data-dock-surface="tray"
          style={{
            position: "absolute",
            bottom: `${trayHeight() - trayOverlap + animatedHeight() - todoOverlap()}px`,
            left: 0,
            right: 0,
            "z-index": 5,
            "max-height": `${todoVisibleHeight()}px`,
            "overflow-x": "visible",
            "overflow-y": "hidden",
            "border-color": "light-dark(#dcd9d9, #3e3a3a)",
            "pointer-events": todoProgress() < 0.98 ? "none" : "auto",
            // Start slightly translated down behind the shell so the flat bottom border isn't visible during entry
            transform: `translateY(${(1 - todoProgress()) * 12}px)`,
          }}
        >
          <div ref={setTodoContentRef}>
            {/* Todo header — visible zone when collapsed is COLLAPSED_HEIGHT - overlap (78 - 36 = 42px) */}
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: "8px",
                padding: "8px 8px 8px 12px",
                height: `${42 - 2}px`,
                cursor: "pointer",
                overflow: "visible",
              }}
              onClick={() => setTodoCollapsed((v) => !v)}
            >
              <span
                style={{
                  "font-size": "14px",
                  color: "var(--text-strong)",
                  "white-space": "nowrap",
                  display: "inline-flex",
                  "align-items": "baseline",
                  "flex-shrink": 0,
                  overflow: "visible",
                  cursor: "default",
                  "--tool-motion-odometer-ms": `${COUNT.duration}ms`,
                  "--tool-motion-mask": `${COUNT.mask}%`,
                  "--tool-motion-mask-height": `${COUNT.maskHeight}px`,
                  "--tool-motion-spring-ms": `${COUNT.widthDuration}ms`,
                  opacity: `${1 - shut()}`,
                  filter: shut() > 0.01 ? `blur(${shut() * 2}px)` : "none",
                }}
              >
                <AnimatedNumber value={done()} />
                <span style={{ margin: "0 4px" }}>of</span>
                <AnimatedNumber value={total()} />
                <span>&nbsp;tasks completed</span>
              </span>

              {/* Collapsed preview text */}
              <div
                style={{
                  "margin-left": "4px",
                  "min-width": 0,
                  overflow: "hidden",
                  flex: "1 1 auto",
                  "max-width": "100%",
                }}
              >
                <TextReveal
                  class="text-14-regular text-text-base cursor-default"
                  text={todoCollapsed() ? preview() : undefined}
                  duration={SUBTITLE.duration}
                  travel={SUBTITLE.travel}
                  edge={SUBTITLE.edge}
                  spring="cubic-bezier(0.34, 1, 0.64, 1)"
                  springSoft="cubic-bezier(0.34, 1, 0.64, 1)"
                  growOnly
                  truncate
                />
              </div>

              <div style={{ "margin-left": "auto" }}>
                <IconButton
                  icon="chevron-down"
                  size="normal"
                  variant="ghost"
                  style={{ transform: `rotate(${todoCollapseProgress() * 180}deg)` }}
                  onMouseDown={(e: MouseEvent) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onClick={(e: MouseEvent) => {
                    e.stopPropagation()
                    setTodoCollapsed((v) => !v)
                  }}
                  aria-label={todoCollapsed() ? "Expand" : "Collapse"}
                />
              </div>
            </div>

            {/* Todo list */}
            <div
              style={{
                position: "relative",
                opacity: `${1 - hide()}`,
                filter: hide() > 0.01 ? `blur(${hide() * 2}px)` : "none",
                visibility: hide() > 0.98 ? "hidden" : "visible",
                "pointer-events": hide() > 0.1 ? "none" : "auto",
              }}
            >
              {/* Scroll clip wrapper — relative so gradients overlay the scroll viewport */}
              <div style={{ position: "relative" }}>
                <div
                  ref={(el) => { todoScrollRef = el }}
                  class="no-scrollbar"
                  style={{
                    padding: "0 12px 44px",
                    display: "flex",
                    "flex-direction": "column",
                    gap: "6px",
                    "max-height": "200px",
                    "overflow-y": "auto",
                    "overflow-anchor": "none",
                  }}
                  onScroll={(e) => setTodoStuck(e.currentTarget.scrollTop > 0)}
                >
                  <Index each={todos()}>
                    {(todo) => (
                      <Checkbox
                        readOnly
                        checked={todo().status === "completed"}
                        indeterminate={todo().status === "in_progress"}
                        data-state={todo().status}
                        style={{
                          "--checkbox-align": "flex-start",
                          "--checkbox-offset": "1px",
                          transition: "opacity 220ms cubic-bezier(0.22, 1, 0.36, 1)",
                          opacity: todo().status === "pending" ? "0.5" : "1",
                        }}
                      >
                        <TextStrikethrough
                          active={todo().status === "completed" || todo().status === "cancelled"}
                          text={todo().content}
                          class="text-14-regular min-w-0 break-words"
                          style={{
                            "line-height": "var(--line-height-normal)",
                            transition: "color 220ms cubic-bezier(0.22, 1, 0.36, 1)",
                            color:
                              todo().status === "completed" || todo().status === "cancelled"
                                ? "var(--text-weak)"
                                : "var(--text-strong)",
                          }}
                        />
                      </Checkbox>
                    )}
                  </Index>
                </div>
                {/* Top fade — appears when scrolled */}
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: "16px",
                    background: "linear-gradient(to bottom, var(--background-base), transparent)",
                    "pointer-events": "none",
                    opacity: todoStuck() ? 1 : 0,
                    transition: "opacity 150ms ease",
                    "z-index": 2,
                  }}
                />
                {/* Bottom fade — items fade before shell overlap */}
                <div
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: "56px",
                    background: "linear-gradient(to bottom, transparent, var(--background-base) 85%)",
                    "pointer-events": "none",
                    "z-index": 2,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* Shell — main content area, sits on top, pinned to bottom above tray */}
      <div
        data-dock-surface="shell"
        style={{
          position: "absolute",
          bottom: `${trayHeight() - trayOverlap}px`,
          left: 0,
          right: 0,
          "z-index": 10,
          height: `${animatedHeight()}px`,
          // Opaque border: alpha-composite of --border-base over --surface-raised-stronger-non-alpha
          "box-shadow": `0 0 0 1px light-dark(#cfcecd, #595353), 0 1px 2px -1px rgba(19,16,16,0.04), 0 1px 2px 0 rgba(19,16,16,0.06), 0 1px 3px 0 rgba(19,16,16,0.08)`,
        }}
      >
        {/* Hidden sizers for height measurement */}
        <div
          ref={setInputSizerRef}
          aria-hidden="true"
          style={{ position: "absolute", visibility: "hidden", left: 0, right: 0, padding: "8px 12px", "pointer-events": "none" }}
        >
          <div style={{ "font-size": "14px", "line-height": "1.5", "min-height": "24px" }}>
            {props.placeholder ?? "Ask anything..."}
          </div>
        </div>

        <div
          ref={setQuestionSizerRef}
          data-component="dock-prompt"
          data-kind="question"
          aria-hidden="true"
          style={{ position: "absolute", visibility: "hidden", left: 0, right: 0, "pointer-events": "none" }}
        >
          <div data-slot="question-body" style={{ padding: "8px 8px 0" }}>
          <div data-slot="question-content">
            <div data-slot="question-text">{props.questionText}</div>
            <div data-slot="question-hint">
              {isMulti() ? "Select one or more options" : "Select an option"}
            </div>
            <div data-slot="question-options" style={{ overflow: "hidden" }}>
              <For each={props.questionOptions}>
                {(opt) => (
                  <div
                    data-slot="question-option"
                    style={{ "pointer-events": "none" }}
                  >
                    <span data-slot="question-option-main">
                      <span data-slot="option-label">{opt.label}</span>
                      <Show when={opt.description}>
                        <span data-slot="option-description">{opt.description}</span>
                      </Show>
                    </span>
                  </div>
                )}
              </For>
              <div data-slot="question-option" style={{ "pointer-events": "none" }}>
                <span data-slot="question-option-main">
                  <span data-slot="option-label">Type your own answer...</span>
                </span>
              </div>
            </div>
          </div>
          </div>
        </div>

        {/* Input content layer — crossfades out */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: inputOpacity(),
            transform: `scale(${inputScale()})`,
            filter: `blur(${inputBlur()}px)`,
            "pointer-events": morph() > 0.5 ? "none" : "auto",
          }}
        >
          <div style={{ padding: "8px 12px 44px" }}>
            <textarea
              placeholder={props.placeholder ?? "Ask anything..."}
              value={value()}
              onInput={(e) => {
                setValue(e.currentTarget.value)
                props.onValueChange?.(e.currentTarget.value)
              }}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                outline: "none",
                resize: "none",
                color: "var(--text-strong)",
                "font-size": "14px",
                "line-height": "1.5",
                "min-height": "24px",
                "font-family": "inherit",
              }}
              rows={1}
            />
          </div>
          {/* Action buttons — absolute inside shell, like the real prompt input */}
          <div
            style={{
              position: "absolute",
              bottom: "8px",
              right: "8px",
              display: "flex",
              "align-items": "center",
              gap: "4px",
              "pointer-events": "auto",
            }}
          >
            <Button variant="ghost" class="size-8 p-0" aria-label="Add attachment">
              <Icon name="plus" class="size-4.5" />
            </Button>
            <IconButton
              icon={value().trim().length > 0 ? "arrow-up" : "arrow-up"}
              variant="primary"
              class="size-8"
              disabled={value().trim().length === 0}
              aria-label="Send"
            />
          </div>
          <div
            style={{
              position: "absolute",
              bottom: "8px",
              left: "8px",
              "pointer-events": "auto",
            }}
          >
            <Button variant="ghost" class="size-6" style={{ display: "flex", "align-items": "center", "justify-content": "center" }} aria-label="Auto-accept">
              <Icon name="chevron-double-right" size="small" />
            </Button>
          </div>
        </div>

        {/* Question content layer — crossfades in */}
        <div
          data-component="dock-prompt"
          data-kind="question"
          style={{
            position: "absolute",
            inset: 0,
            opacity: questionOpacity(),
            transform: `scale(${questionScale()})`,
            filter: `blur(${questionBlur()}px)`,
            "pointer-events": morph() < 0.5 ? "none" : "auto",
          }}
        >
          <div data-slot="question-body" style={{ padding: "8px 8px 0" }}>
            <QuestionContent />
          </div>
        </div>
      </div>
    </div>
  )
}
