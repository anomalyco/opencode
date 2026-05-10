export * as ConfigBrowser from "./browser"

import { Schema } from "effect"
import { zod } from "@opencode-ai/core/effect-zod"
import { withStatics } from "@opencode-ai/core/schema"

export const Info = Schema.Struct({
  integratedTools: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean).annotate({
        description:
          "Expose OpenCode Desktop integrated browser operations as agent tools automatically (default: true)",
      }),
    }),
  ).annotate({ description: "Integrated browser agent tool settings" }),
})
  .annotate({ identifier: "BrowserConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))

export type Info = Schema.Schema.Type<typeof Info>

export function withDefaults(browser: Info | undefined): Info {
  return {
    ...browser,
    integratedTools: {
      ...browser?.integratedTools,
      enabled: browser?.integratedTools?.enabled ?? true,
    },
  }
}
