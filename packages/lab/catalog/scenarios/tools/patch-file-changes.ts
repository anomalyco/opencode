import { Effect } from "effect"
import * as Llm from "opencode-drive/llm"
import { defineExecutableFlow } from "../../catalog/flow"
import { taxonomies } from "../../catalog/authored/taxonomies"

const patch = (...lines: ReadonlyArray<string>) => ["*** Begin Patch", ...lines, "*** End Patch"].join("\n")
const screen = (title: string, states: "success" | "error") => ({
  title,
  category: "session" as const,
  screenLabels: states === "error" ? (["tool-execution", "error-recovery"] as const) : (["tool-execution"] as const),
  uiElements:
    states === "error"
      ? (["transcript", "tool-card", "error-report"] as const)
      : (["transcript", "tool-card", "confirmation"] as const),
  surfaces: "inline" as const,
  patterns: states === "error" ? ("error-report" as const) : ("status" as const),
  features: ["tool", "patch"] as const,
  states,
})

export const patchFileChangesFlow = defineExecutableFlow(
  taxonomies,
  {
    id: "patch-file-changes",
    title: "Patch file changes",
    group: { id: "tool-use", label: "Tool use" },
    description: "Apply real patches that create, update, and delete files, then show verification failure.",
  },
  ({ state, program }) => {
    const created = state("patch-created", {
      screen: screen("Patch created file", "success"),
      step: { title: "Patch creates a file" },
    })
    const updated = state("patch-updated", {
      screen: screen("Patch updated file", "success"),
      step: { title: "Patch updates a file" },
    })
    const deleted = state("patch-deleted", {
      screen: screen("Patch deleted file", "success"),
      step: { title: "Patch deletes a file" },
    })
    const failed = state("patch-failed", {
      screen: screen("Patch failed", "error"),
      step: { title: "Patch fails verification" },
    })

    return program([created, updated, deleted, failed], ({ driver, checkpoint }) =>
      Effect.gen(function* () {
        yield* driver.llm.queue(
          Llm.toolCall({
            index: 0,
            id: "call_patch_create",
            name: "patch",
            input: { patchText: patch("*** Add File: patched.txt", "+created by patch") },
          }),
          Llm.finish("tool-calls"),
        )
        yield* driver.llm.queue(
          Llm.pause(800),
          Llm.toolCall({
            index: 0,
            id: "call_patch_update",
            name: "patch",
            input: { patchText: patch("*** Update File: fixture.txt", "@@", "-before", "+updated by patch") },
          }),
          Llm.finish("tool-calls"),
        )
        yield* driver.llm.queue(
          Llm.pause(800),
          Llm.toolCall({
            index: 0,
            id: "call_patch_delete",
            name: "patch",
            input: { patchText: patch("*** Delete File: patched.txt") },
          }),
          Llm.finish("tool-calls"),
        )
        yield* driver.llm.queue(
          Llm.pause(800),
          Llm.toolCall({
            index: 0,
            id: "call_patch_failure",
            name: "patch",
            input: { patchText: patch("*** Update File: missing-patch.txt", "@@", "-missing", "+still missing") },
          }),
          Llm.finish("tool-calls"),
        )
        yield* driver.llm.queue(Llm.text("The patch file-change lifecycle is complete."))

        yield* driver.ui.submit(
          "Create a file, update the fixture, delete the created file, then attempt an invalid patch.",
        )
        yield* driver.ui.getNode("session.permission.action.once").pipe(Effect.flatMap(driver.ui.click))
        yield* Effect.sleep(300)
        yield* checkpoint(created)
        yield* driver.ui.getNode("session.permission.action.once").pipe(Effect.flatMap(driver.ui.click))
        yield* Effect.sleep(300)
        yield* checkpoint(updated)
        yield* driver.ui.getNode("session.permission.action.once").pipe(Effect.flatMap(driver.ui.click))
        yield* Effect.sleep(300)
        yield* checkpoint(deleted)
        yield* driver.ui.waitFor("The patch file-change lifecycle is complete.", { timeout: 15_000 })
        yield* checkpoint(failed)
      }),
    )
  },
)
