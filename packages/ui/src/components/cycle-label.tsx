import "./cycle-label.css"
import { createEffect, createSignal, JSX, on } from "solid-js"

export interface CycleLabelProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  value: string
  onValueChange?: (value: string) => void
  duration?: number | ((value: string) => number)
  stagger?: number
  opacity?: [number, number]
  blur?: [number, number]
  skewX?: number
  onAnimationStart?: () => void
  onAnimationEnd?: () => void
}

const segmenter =
  typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null

const getChars = (text: string): string[] =>
  segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : text.split("")

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function CycleLabel(props: CycleLabelProps) {
  const getDuration = (text: string) => {
    const d =
      props.duration ??
      Number(getComputedStyle(document.documentElement).getPropertyValue("--transition-duration")) ??
      200
    return typeof d === "function" ? d(text) : d
  }
  const stagger = () => props?.stagger ?? 30
  const opacity = () => props?.opacity ?? [0, 1]
  const blur = () => props?.blur ?? [0, 0]
  const skewX = () => props?.skewX ?? 10

  let containerRef: HTMLSpanElement | undefined
  let isAnimating = false
  const [currentText, setCurrentText] = createSignal(props.value)

  const setChars = (el: HTMLElement, text: string, state: "enter" | "exit" | "pre" = "enter") => {
    el.innerHTML = ""
    const chars = getChars(text)
    chars.forEach((char, i) => {
      const span = document.createElement("span")
      span.textContent = char === " " ? "\u00A0" : char
      span.className = `cycle-char ${state}`
      span.style.setProperty("--i", String(i))
      el.appendChild(span)
    })
  }

  const animateToText = async (newText: string) => {
    if (!containerRef || isAnimating) return
    if (newText === currentText()) return

    isAnimating = true
    props.onAnimationStart?.()

    const dur = getDuration(newText)
    const stag = stagger()

    containerRef.style.width = containerRef.offsetWidth + "px"

    const oldChars = containerRef.querySelectorAll(".cycle-char")
    oldChars.forEach((c) => c.classList.replace("enter", "exit"))

    const clone = containerRef.cloneNode(false) as HTMLElement
    Object.assign(clone.style, {
      position: "absolute",
      visibility: "hidden",
      width: "auto",
      transition: "none",
    })
    setChars(clone, newText)
    document.body.appendChild(clone)
    const nextWidth = clone.offsetWidth
    clone.remove()

    const exitTime = oldChars.length * stag + dur
    await wait(exitTime * 0.3)

    containerRef.style.width = nextWidth + "px"

    const widthDur = 200
    await wait(widthDur * 0.3)

    setChars(containerRef, newText, "pre")
    containerRef.offsetWidth

    Array.from(containerRef.children).forEach((c) => (c.className = "cycle-char enter"))
    setCurrentText(newText)
    props.onValueChange?.(newText)

    const enterTime = getChars(newText).length * stag + dur
    await wait(enterTime)

    containerRef.style.width = ""
    isAnimating = false
    props.onAnimationEnd?.()
  }

  createEffect(
    on(
      () => props.value,
      (newValue) => {
        if (newValue !== currentText()) {
          animateToText(newValue)
        }
      },
    ),
  )

  const initRef = (el: HTMLSpanElement) => {
    containerRef = el
    setChars(el, props.value)
  }

  return (
    <span
      ref={initRef}
      class={`cycle-label ${props.class ?? ""}`}
      style={{
        "--c-duration": `${getDuration(currentText())}ms`,
        "--c-stagger": `${stagger()}ms`,
        "--c-opacity-start": opacity()[0],
        "--c-opacity-end": opacity()[1],
        "--c-blur-start": `${blur()[0]}px`,
        "--c-blur-end": `${blur()[1]}px`,
        "--c-skew": `${skewX()}deg`,
        ...(typeof props.style === "object" ? props.style : {}),
      }}
    />
  )
}
