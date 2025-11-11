import type { Component } from "solid-js"
import { For, createMemo } from "solid-js"
import { GridText } from "./GridText"

interface GridTextWrapProps {
  col: number
  row: number
  text: string
  maxWidth: number
  fg?: string
  bg?: string
  bold?: boolean
  onClick?: () => void
}

/**
 * Wraps text across multiple rows to fit within maxWidth
 * Returns a component that renders multiple GridText elements
 */
export const GridTextWrap: Component<GridTextWrapProps> = (props) => {
  const wrapText = (text: string, maxWidth: number): string[] => {
    if (text.length <= maxWidth) return [text]

    const lines: string[] = []
    let remainingText = text

    while (remainingText.length > 0) {
      if (remainingText.length <= maxWidth) {
        lines.push(remainingText)
        break
      }

      // Try to break at a space
      let breakPoint = maxWidth
      const segment = remainingText.slice(0, maxWidth)
      const lastSpace = segment.lastIndexOf(" ")

      if (lastSpace > maxWidth * 0.6) {
        // If there's a space in the last 40% of the segment, break there
        breakPoint = lastSpace
      }

      lines.push(remainingText.slice(0, breakPoint).trim())
      remainingText = remainingText.slice(breakPoint).trim()
    }

    return lines
  }

  // Memoize the wrapped lines to prevent recalculation on every render
  const lines = createMemo(() => wrapText(props.text, props.maxWidth))

  return (
    <>
      <For each={lines()}>
        {(line, idx) => (
          <GridText
            col={props.col}
            row={props.row + idx()}
            text={line}
            fg={props.fg}
            bg={props.bg}
            bold={props.bold}
            onClick={idx() === 0 ? props.onClick : undefined}
          />
        )}
      </For>
    </>
  )
}

/**
 * Utility function to calculate how many rows a wrapped text will occupy
 */
export const calculateWrappedRows = (text: string, maxWidth: number): number => {
  if (text.length <= maxWidth) return 1

  let lines = 0
  let remainingText = text

  while (remainingText.length > 0) {
    if (remainingText.length <= maxWidth) {
      lines++
      break
    }

    let breakPoint = maxWidth
    const segment = remainingText.slice(0, maxWidth)
    const lastSpace = segment.lastIndexOf(" ")

    if (lastSpace > maxWidth * 0.6) {
      breakPoint = lastSpace
    }

    lines++
    remainingText = remainingText.slice(breakPoint).trim()
  }

  return lines
}
