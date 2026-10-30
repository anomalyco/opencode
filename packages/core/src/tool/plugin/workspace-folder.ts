export * as WorkspaceFolderTool from "./workspace-folder.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { MultiFolderWorkspace } from "../../workspace-manager/multi-folder.js"
import { Location } from "../../location.js"

export const name = "workspace_folder"

export const Input = Schema.Struct({
  action: Schema.Literals(["list", "tree"]).annotate({
    description: "Action to perform: 'list' (list attached directories) or 'tree' (get unified multi-folder tree).",
  }),
})

export const Output = Schema.Struct({
  success: Schema.Boolean,
  message: Schema.String,
  data: Schema.optional(Schema.Unknown),
})

export const description = [
  "Inspect attached folders in this multi-folder workspace.",
  "Projects can have multiple root directories attached across different locations and drives.",
  "Use action 'list' to see all primary and secondary directories attached to the project.",
  "Use action 'tree' to get a unified view of directory contents across all attached roots.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.workspace_folder",
  effect: Effect.fn("WorkspaceFolderTool.Plugin")(function* (ctx: Context) {
    const location = yield* Location.Service
    const mfw = yield* MultiFolderWorkspace.Service

    yield* ctx.tool.transform((editor) =>
      editor.add({
        name,
        options: { codemode: false },
        description,
        input: Input,
        output: Output,
        execute: (input) =>
          Effect.gen(function* () {
            const projectID = location.project.id

            if (input.action === "list") {
              const folders = yield* mfw.listFolders(projectID)
              const out = {
                success: true,
                message: `Project has ${folders.length} workspace folders attached.`,
                data: folders,
              }
              return {
                output: out,
                content: `${out.message}\n` + folders.map((f) => `- ${f.name} (${f.isPrimary ? "Primary" : "Secondary"}): ${f.path}`).join("\n"),
              }
            }

            if (input.action === "tree") {
              const tree = yield* mfw.getUnifiedTree(projectID)
              const out = {
                success: true,
                message: `Generated unified tree for ${tree.length} workspace roots.`,
                data: tree,
              }
              return {
                output: out,
                content: `${out.message}\nRoots:\n` + tree.map((r) => `- Root: ${r.name} (${r.path})`).join("\n"),
              }
            }

            const out = {
              success: false,
              message: `Unknown action: ${input.action}`,
            }
            return { output: out, content: out.message }
          }),
      }),
    )
  }),
}
