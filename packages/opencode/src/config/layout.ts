import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

export const Layout = Schema.Literals(["auto", "stretch"])
  .annotate({ identifier: "LayoutConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Layout = Schema.Schema.Type<typeof Layout>

export * as ConfigLayout from "./layout"
