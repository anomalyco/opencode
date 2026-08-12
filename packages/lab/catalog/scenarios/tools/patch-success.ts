import { Effect } from "effect"
import * as Llm from "opencode-drive/llm"
import { defineExecutableFlow } from "../../catalog/flow"
import { taxonomies } from "../../catalog/authored/taxonomies"

export const patchSuccessFlow = defineExecutableFlow(
  taxonomies,
  {
    id: "patch-success-lifecycle",
    title: "Patch succeeds",
    group: { id: "tool-use", label: "Tool use" },
    description: "Watch a patch stream its input, request permission, and complete successfully.",
  },
  ({ state, program }) => {
    const inputStreaming = state("patch-input-streaming", {
      screen: {
        title: "Patch input streaming",
        category: "session",
        screenLabels: ["tool-execution"],
        uiElements: ["transcript", "tool-card", "status-indicator"],
        surfaces: "inline",
        patterns: "status",
        features: ["tool", "patch"],
        states: "streaming",
      },
      step: { title: "Input streams" },
    })
    const permissionPrompt = state("permission-prompt", {
      screen: {
        title: "Permission prompt",
        category: "session",
        screenLabels: ["tool-execution"],
        uiElements: [
          "inline-prompt",
          "approval-actions",
          "button-group",
          "keyboard-hints",
          "confirmation",
          "destructive-action",
        ],
        surfaces: "inline",
        patterns: "approval",
        features: ["permission", "tool", "patch"],
        states: "confirmation",
      },
      step: { title: "Permission is requested" },
    })
    const alwaysSelected = state("permission-always-selected", {
      screen: {
        title: "Permission prompt (always selected)",
        category: "session",
        screenLabels: ["tool-execution"],
        uiElements: ["inline-prompt", "approval-actions", "button-group", "keyboard-hints", "confirmation"],
        surfaces: "inline",
        patterns: "approval",
        features: ["permission", "tool", "patch"],
        states: "selected",
      },
      step: { title: "Persistent permission is selected", trigger: "Choose Allow always" },
    })
    const alwaysConfirmation = state("permission-always-confirmation", {
      screen: {
        title: "Always allow confirmation",
        category: "session",
        screenLabels: ["tool-execution"],
        uiElements: ["inline-prompt", "approval-actions", "button-group", "keyboard-hints", "confirmation"],
        surfaces: "inline",
        patterns: "approval",
        features: ["permission", "tool", "patch"],
        states: "confirmation",
      },
      step: { title: "Persistent permission is confirmed", trigger: "Confirm Allow always" },
    })
    const rejectSelected = state("permission-reject-selected", {
      screen: {
        title: "Permission prompt (reject selected)",
        category: "session",
        screenLabels: ["tool-execution"],
        uiElements: ["inline-prompt", "approval-actions", "button-group", "keyboard-hints", "destructive-action"],
        surfaces: "inline",
        patterns: "approval",
        features: ["permission", "tool", "patch"],
        states: "selected",
      },
      step: { title: "Rejection is selected", trigger: "Select Reject" },
    })
    const permissionFullscreen = state("permission-fullscreen", {
      screen: {
        title: "Permission prompt (fullscreen)",
        category: "session",
        screenLabels: ["tool-execution"],
        uiElements: [
          "inline-prompt",
          "approval-actions",
          "button-group",
          "keyboard-hints",
          "confirmation",
          "full-screen-view",
        ],
        surfaces: "full-screen",
        patterns: "approval",
        features: ["permission", "tool", "patch"],
        states: "expanded",
      },
      step: { title: "Permission is inspected fullscreen", trigger: "Toggle fullscreen" },
    })
    const success = state("patch-success", {
      screen: {
        title: "Patch succeeded",
        category: "session",
        screenLabels: ["tool-execution"],
        uiElements: ["transcript", "tool-card", "confirmation"],
        surfaces: "inline",
        patterns: "status",
        features: ["tool", "patch"],
        states: "success",
      },
      step: { title: "Patch succeeds" },
    })

    return program(
      [
        inputStreaming,
        permissionPrompt,
        alwaysSelected,
        alwaysConfirmation,
        rejectSelected,
        permissionFullscreen,
        success,
      ],
      ({ driver, checkpoint }) => Effect.gen(function* () {
        yield* driver.llm.queue(
          Llm.toolCall(
            {
              index: 0,
              id: "call_patch_success",
              name: "patch",
              input: {
                patchText: [
                  "*** Begin Patch",
                  "*** Update File: fixture.txt",
                  "@@",
                  "-before",
                  "+after",
                  "*** End Patch",
                ].join("\n"),
              },
            },
            { delay: 90, chunkSize: 8 },
          ),
          Llm.finish("tool-calls"),
        )
        yield* driver.ui.submit("Change fixture.txt from before to after.")
        yield* Effect.sleep(450)
        yield* checkpoint(inputStreaming)
        yield* driver.ui.waitFor("Permission required", { timeout: 15_000 })
        yield* checkpoint(permissionPrompt)
        yield* driver.ui.arrow("right")
        yield* checkpoint(alwaysSelected)
        yield* driver.ui.enter()
        yield* driver.ui.waitFor("Always allow")
        yield* checkpoint(alwaysConfirmation)
        yield* driver.ui.press("escape")
        yield* driver.ui.waitFor("Permission required")
        yield* driver.ui.arrow("right")
        yield* driver.ui.arrow("right")
        yield* checkpoint(rejectSelected)
        yield* driver.ui.press("f", { ctrl: true })
        yield* Effect.sleep(150)
        yield* checkpoint(permissionFullscreen)
        yield* driver.ui.press("f", { ctrl: true })
        yield* Effect.sleep(150)
        yield* driver.llm.queue(Llm.text("The fixture was updated."))
        yield* driver.ui.getNode("session.permission.action.once").pipe(Effect.flatMap(driver.ui.click))
        yield* driver.ui.waitFor("The fixture was updated.", { timeout: 15_000 })
        yield* checkpoint(success)
      }),
    )
  },
)
