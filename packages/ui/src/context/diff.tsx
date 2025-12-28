import type { ValidComponent } from "solid-js"
import { createSimpleContext } from "./helper"

const ctx = createSimpleContext<ValidComponent, { component: ValidComponent }>({
  name: "DiffComponent",
  init: (props) => props.component,
})

export const DiffComponentProvider = ctx.provider
export const useDiffComponent = ctx.use
