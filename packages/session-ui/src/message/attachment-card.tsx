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
      title={props.hover}
      onClick={() => props.onClick?.()}
    >
      <span ref={(element) => props.titleRef?.(element)} data-slot="attachment-card-title">
        {props.title}
      </span>
      <span data-slot="attachment-card-subtitle">{props.children}</span>
    </div>
  )
}
