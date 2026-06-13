import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { DTOC } from "../session/dtoc"
import DESCRIPTION from "./manage_context.txt"

export const Parameters = Schema.Struct({
  enable: Schema.mutable(Schema.Array(Schema.String)).annotate({
    description: "List of tool_key values to re-enable (restore full content in context)",
  }),
  disable: Schema.mutable(Schema.Array(Schema.String)).annotate({
    description: "List of tool_key values to disable (replace with compact placeholder)",
  }),
})

type Metadata = {
  enabled: string[]
  disabled: string[]
  totalVisible: number
  totalHidden: number
}

export const ManageContextTool = Tool.define<typeof Parameters, Metadata, DTOC.Service>(
  "manage_context",
  Effect.gen(function* () {
    const dtoc = yield* DTOC.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const enabled = dtoc.setVisibility(ctx.sessionID, params.enable, true)
          const disabled = dtoc.setVisibility(ctx.sessionID, params.disable, false)

          const entries = dtoc.listEntries(ctx.sessionID)
          const totalVisible = entries.filter((e) => e.visible).length
          const totalHidden = entries.filter((e) => !e.visible).length

          const lines: string[] = []
          if (enabled.length > 0) lines.push(`Re-enabled: ${enabled.join(", ")}`)
          if (disabled.length > 0) lines.push(`Disabled: ${disabled.join(", ")}`)
          lines.push(`Status: ${totalVisible} visible, ${totalHidden} hidden tool outputs`)
          lines.push(`Tokens saved (cumulative): ${dtoc.getTokensSaved(ctx.sessionID)}`)

          const notFound = [
            ...params.enable.filter((k) => !enabled.includes(k) && dtoc.getEntry(ctx.sessionID, k) === undefined),
            ...params.disable.filter((k) => !disabled.includes(k) && dtoc.getEntry(ctx.sessionID, k) === undefined),
          ]
          if (notFound.length > 0) lines.push(`Not found: ${notFound.join(", ")}`)

          return {
            title: `${disabled.length} disabled, ${enabled.length} enabled`,
            output: lines.join("\n"),
            metadata: { enabled, disabled, totalVisible, totalHidden },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
