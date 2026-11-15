import type { JSX } from "solid-js"
import "./document-surface.css"

export function DocumentSurface(props: JSX.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} data-component="document-surface" />
}
