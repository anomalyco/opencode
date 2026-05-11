import { Schema } from "effect"
import { zod } from "@opencode-ai/core/effect-zod"
import { withStatics } from "@opencode-ai/core/schema"

export const Layout = Schema.Literals(["auto", "stretch"])
  .annotate({ identifier: "LayoutConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Layout = Schema.Schema.Type<typeof Layout>

export * as ConfigLayout from "./layout"
