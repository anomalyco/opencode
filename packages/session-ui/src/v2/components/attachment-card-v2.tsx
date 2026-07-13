import type { JSX } from "solid-js"
import "./attachment-card-v2.css"

/** Shared 160px two-line card used by v2 file and comment attachments in the composer and timeline. */
export function AttachmentCardV2(props: {
  title: string
  active?: boolean
  clickable?: boolean
  /** native title attribute */
  hover?: string
  onClick?: () => void
  children: JSX.Element
}) {
  return (
    <div
      data-component="attachment-card-v2"
      data-active={props.active ? "true" : undefined}
      data-clickable={props.clickable ? "true" : undefined}
      title={props.hover}
      onClick={() => props.onClick?.()}
    >
      <span data-slot="attachment-card-v2-title">{props.title}</span>
      <span data-slot="attachment-card-v2-subtitle">{props.children}</span>
    </div>
  )
}
