import { expect, test } from "bun:test"
import { decodeDesktopConfig, decodeDesktopConfigJson } from "./desktop-config"

test("decodes supported desktop config values", () => {
  expect(
    decodeDesktopConfig({
      general: {
        autoSave: false,
        releaseNotes: false,
        followup: "steer",
        showFileTree: true,
        showNavigation: true,
        showSearch: true,
        showStatus: true,
        showTerminal: true,
        showReasoningSummaries: true,
        shellToolPartsExpanded: true,
        editToolPartsExpanded: true,
        showSessionProgressBar: false,
        showCustomAgents: true,
        newLayoutDesigns: false,
      },
      permissions: {
        autoApprove: true,
      },
      sounds: {
        agentEnabled: false,
        agent: "glass",
        permissionsEnabled: true,
        permissions: "ping",
        errorsEnabled: false,
        errors: "alert",
      },
    }),
  ).toEqual({
    general: {
      autoSave: false,
      releaseNotes: false,
      followup: "steer",
      showFileTree: true,
      showNavigation: true,
      showSearch: true,
      showStatus: true,
      showTerminal: true,
      showReasoningSummaries: true,
      shellToolPartsExpanded: true,
      editToolPartsExpanded: true,
      showSessionProgressBar: false,
      showCustomAgents: true,
      newLayoutDesigns: false,
    },
    permissions: {
      autoApprove: true,
    },
    sounds: {
      agentEnabled: false,
      agent: "glass",
      permissionsEnabled: true,
      permissions: "ping",
      errorsEnabled: false,
      errors: "alert",
    },
  })
})

test("ignores unknown keys and wrong primitive types", () => {
  expect(
    decodeDesktopConfig({
      general: {
        autoSave: "no",
        releaseNotes: false,
        followup: "invalid",
        showFileTree: true,
        showSearch: 1,
        extra: true,
      },
      permissions: {
        autoApprove: "yes",
        extra: true,
      },
      sounds: {
        agentEnabled: 1,
        agent: "glass",
        permissionsEnabled: true,
        permissions: false,
        errorsEnabled: false,
        errors: "alert",
        extra: "ignored",
      },
      extra: {
        value: true,
      },
    }),
  ).toEqual({
    general: {
      releaseNotes: false,
      showFileTree: true,
    },
    permissions: {},
    sounds: {
      agent: "glass",
      permissionsEnabled: true,
      errorsEnabled: false,
      errors: "alert",
    },
  })
})

test("decodes desktop config from JSON strings", () => {
  expect(decodeDesktopConfigJson(`{"permissions":{"autoApprove":true}}`)).toEqual({
    permissions: {
      autoApprove: true,
    },
  })
})

test("rejects malformed desktop config JSON", () => {
  expect(decodeDesktopConfigJson("{")).toBeUndefined()
})
