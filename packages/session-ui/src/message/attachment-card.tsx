import type { JSX } from "solid-js"
import "./attachment-card.css"

/** Shared 160px two-line card used by file and comment attachments. */
export function AttachmentCard(props: {
  title: string
  active?: boolean
  clickable?: boolean
  wide?: boolean
  surface?: "base"
  /** native title attribute */
  hover?: string
  titleRef?: (element: HTMLSpanElement) => void
  onClick?: () => void
  children: JSX.Element
}) {
  return (
    <div
      data-component="attachment-card"
      data-active={props.active ? "true" : undefined}
      data-clickable={props.clickable ? "true" : undefined}
      data-wide={props.wide ? "true" : undefined}
      data-surface={props.surface}
      role={props.clickable ? "button" : undefined}
      tabIndex={props.clickable ? 0 : undefined}
      title={props.hover}
      onClick={() => props.onClick?.()}
      onKeyDown={(event) => {
        if (!props.clickable || (event.key !== "Enter" && event.key !== " ")) return
        event.preventDefault()
        props.onClick?.()
      }}
    >
      <span ref={(element) => props.titleRef?.(element)} data-slot="attachment-card-title">
        {props.title}
      </span>
      <span data-slot="attachment-card-subtitle">{props.children}</span>
    </div>
  )
}
