import { createEffect, createMemo, createSignal } from "solid-js"
import { useElementHeight } from "@opencode-ai/ui/hooks"
import { useSpring } from "@opencode-ai/ui/motion-spring"

const EDITOR_PADDING = 16
const MAX_EDITOR_CONTENT = 200 - EDITOR_PADDING
const BUTTON_ROW_HEIGHT = 40
const IMAGE_BAR_HEIGHT = 80
const CONTEXT_BAR_HEIGHT = 64
const SHELL_PADDING_INPUT = EDITOR_PADDING + BUTTON_ROW_HEIGHT
const SHELL_PADDING_DOCK = 16

interface Props {
  isQuestion: () => boolean
  isPermission: () => boolean
  imageCount: () => number
  contextCount: () => number
  heightSpring?: { visualDuration: number; bounce: number }
  morphSpring?: { visualDuration: number; bounce: number }
}

export function useLayout(props: Props) {
  const [editorHeight, setEditorHeight] = createSignal(24)
  const [questionRef, setQuestionRef] = createSignal<HTMLDivElement>()
  const [permissionRef, setPermissionRef] = createSignal<HTMLDivElement>()

  const questionHeight = useElementHeight(questionRef, 280)
  const permissionHeight = useElementHeight(permissionRef, 200)

  const imageBarHeight = createMemo(() => (props.imageCount() > 0 ? IMAGE_BAR_HEIGHT : 0))
  const contextBarHeight = createMemo(() => (props.contextCount() > 0 ? CONTEXT_BAR_HEIGHT : 0))

  const target = createMemo(() => {
    if (props.isPermission()) return permissionHeight() + SHELL_PADDING_DOCK
    if (props.isQuestion()) return questionHeight() + SHELL_PADDING_DOCK
    return editorHeight() + SHELL_PADDING_INPUT + imageBarHeight() + contextBarHeight()
  })

  const morphTarget = () => (props.isQuestion() || props.isPermission() ? 1 : 0)
  const morph = useSpring(morphTarget, () => props.morphSpring ?? { visualDuration: 0.25, bounce: 0.1 })

  const spring = useSpring(target, () => props.heightSpring ?? { visualDuration: 0.35, bounce: 0.2 })

  const inputOpacity = createMemo(() => Math.max(0, 1 - morph() * 1.5))
  const inputScale = createMemo(() => 1 + morph() * 0.15)
  const inputBlur = createMemo(() => morph() * 5)
  const questionOpacity = createMemo(() => Math.max(0, morph() * 1.5 - 0.5))
  const questionScale = createMemo(() => 0.85 + morph() * 0.15)
  const questionBlur = createMemo(() => (1 - morph()) * 5)

  // Keep overlay content mounted until both morph and height springs settle
  const [overlay, setOverlay] = createSignal<"question" | "permission" | null>(null)
  createEffect(() => {
    if (props.isQuestion()) setOverlay("question")
    else if (props.isPermission()) setOverlay("permission")
    else if (morph() < 0.01 && Math.abs(spring() - target()) < 2) setOverlay(null)
  })
  const showQuestion = () => overlay() === "question"
  const showPermission = () => overlay() === "permission"

  const height = () => spring()

  const measure = (el: HTMLDivElement | undefined) => {
    if (!el) return
    const raw = Math.ceil(el.scrollHeight - EDITOR_PADDING)
    const next = Math.min(MAX_EDITOR_CONTENT, Math.max(24, raw))
    const curr = editorHeight()
    if (Math.abs(next - curr) <= 2) return
    setEditorHeight(next)
  }

  return {
    measure,
    setQuestionRef,
    setPermissionRef,
    height,
    morph,
    inputOpacity,
    inputScale,
    inputBlur,
    questionOpacity,
    questionScale,
    questionBlur,
    showQuestion,
    showPermission,
  }
}
