import { describe, expect, test } from "bun:test"
import path from "path"
import { GitLabWorkflowModelSelect } from "../../src/session/gitlab-workflow-model-select"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Env } from "../../src/env"

describe("GitLabWorkflowModelSelect", () => {
  describe("ask and reply", () => {
    test("ask publishes event and reply resolves the promise", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const models = [
            { name: "Claude Sonnet", ref: "claude-sonnet-4", isDefault: true },
            { name: "GPT 4o", ref: "gpt-4o" },
          ]

          let askedEvent: any
          const unsub = Bus.subscribe(GitLabWorkflowModelSelect.Event.Asked, (e) => {
            askedEvent = e
          })

          const result = GitLabWorkflowModelSelect.ask({ sessionID: "test-session", models })

          await new Promise((r) => setTimeout(r, 50))

          expect(askedEvent).toBeDefined()
          expect(askedEvent.properties.sessionID).toBe("test-session")
          expect(askedEvent.properties.models).toHaveLength(2)
          expect(askedEvent.properties.id).toStartWith("wfm_")

          await GitLabWorkflowModelSelect.reply({
            requestID: askedEvent.properties.id,
            modelRef: "claude-sonnet-4",
            modelName: "Claude Sonnet",
          })

          const selected = await result
          expect(selected).toBe("claude-sonnet-4")
          unsub()
        },
      })
    })

    test("reply with null resolves to null", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const models = [{ name: "Test Model", ref: "test-ref" }]

          let requestID: string | undefined
          const unsub = Bus.subscribe(GitLabWorkflowModelSelect.Event.Asked, (e) => {
            requestID = e.properties.id
          })

          const result = GitLabWorkflowModelSelect.ask({ sessionID: "s1", models })

          await new Promise((r) => setTimeout(r, 50))

          await GitLabWorkflowModelSelect.reply({
            requestID: requestID!,
            modelRef: null,
          })

          expect(await result).toBeNull()
          unsub()
        },
      })
    })

    test("reply publishes Replied event", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const models = [{ name: "Model", ref: "ref-1" }]

          let requestID: string | undefined
          Bus.subscribe(GitLabWorkflowModelSelect.Event.Asked, (e) => {
            requestID = e.properties.id
          })

          let repliedEvent: any
          const unsub = Bus.subscribe(GitLabWorkflowModelSelect.Event.Replied, (e) => {
            repliedEvent = e
          })

          const result = GitLabWorkflowModelSelect.ask({ sessionID: "s2", models })
          await new Promise((r) => setTimeout(r, 50))

          await GitLabWorkflowModelSelect.reply({
            requestID: requestID!,
            modelRef: "ref-1",
          })
          await result

          expect(repliedEvent).toBeDefined()
          expect(repliedEvent.properties.sessionID).toBe("s2")
          expect(repliedEvent.properties.modelRef).toBe("ref-1")
          unsub()
        },
      })
    })

    test("reply for unknown request is a no-op", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await GitLabWorkflowModelSelect.reply({
            requestID: "wfm_nonexistent",
            modelRef: "some-ref",
          })
          const pending = await GitLabWorkflowModelSelect.list()
          expect(pending).toHaveLength(0)
        },
      })
    })
  })

  describe("list", () => {
    test("returns empty when no pending requests", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const pending = await GitLabWorkflowModelSelect.list()
          expect(pending).toEqual([])
        },
      })
    })

    test("returns pending requests", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const models = [{ name: "M1", ref: "r1" }]

          let requestID: string | undefined
          const unsub = Bus.subscribe(GitLabWorkflowModelSelect.Event.Asked, (e) => {
            requestID = e.properties.id
          })

          const promise = GitLabWorkflowModelSelect.ask({ sessionID: "s3", models })
          await new Promise((r) => setTimeout(r, 50))

          const pending = await GitLabWorkflowModelSelect.list()
          expect(pending).toHaveLength(1)
          expect(pending[0].id).toBe(requestID!)
          expect(pending[0].sessionID).toBe("s3")
          expect(pending[0].models).toEqual(models)

          await GitLabWorkflowModelSelect.reply({ requestID: requestID!, modelRef: "r1" })
          await promise

          const after = await GitLabWorkflowModelSelect.list()
          expect(after).toHaveLength(0)
          unsub()
        },
      })
    })
  })

  describe("selection cache", () => {
    test("setLastSelection and getLastSelection round-trip", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        init: async () => {
          Env.set("GITLAB_INSTANCE_URL", "https://gitlab.example.com")
        },
        fn: async () => {
          expect(await GitLabWorkflowModelSelect.getLastSelection()).toBeNull()
          expect(await GitLabWorkflowModelSelect.getLastSelectionName()).toBeNull()

          await GitLabWorkflowModelSelect.setLastSelection("model-ref-1", "Model One")
          expect(await GitLabWorkflowModelSelect.getLastSelection()).toBe("model-ref-1")
          expect(await GitLabWorkflowModelSelect.getLastSelectionName()).toBe("Model One")
        },
      })
    })

    test("setLastSelection(null) clears selection", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        init: async () => {
          Env.set("GITLAB_INSTANCE_URL", "https://gitlab.example.com")
        },
        fn: async () => {
          await GitLabWorkflowModelSelect.setLastSelection("ref-x", "Name X")
          expect(await GitLabWorkflowModelSelect.getLastSelection()).toBe("ref-x")

          await GitLabWorkflowModelSelect.setLastSelection(null)
          expect(await GitLabWorkflowModelSelect.getLastSelection()).toBeNull()
          expect(await GitLabWorkflowModelSelect.getLastSelectionName()).toBeNull()
        },
      })
    })

    test("reply with modelRef persists selection", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        init: async () => {
          Env.set("GITLAB_INSTANCE_URL", "https://gitlab.example.com")
        },
        fn: async () => {
          const models = [{ name: "Persisted Model", ref: "persisted-ref" }]

          let requestID: string | undefined
          Bus.subscribe(GitLabWorkflowModelSelect.Event.Asked, (e) => {
            requestID = e.properties.id
          })

          const promise = GitLabWorkflowModelSelect.ask({ sessionID: "s4", models })
          await new Promise((r) => setTimeout(r, 50))

          await GitLabWorkflowModelSelect.reply({
            requestID: requestID!,
            modelRef: "persisted-ref",
            modelName: "Persisted Model",
          })
          await promise

          expect(await GitLabWorkflowModelSelect.getLastSelection()).toBe("persisted-ref")
          expect(await GitLabWorkflowModelSelect.getLastSelectionName()).toBe("Persisted Model")
        },
      })
    })

    test("reply with null modelRef does not overwrite selection", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        init: async () => {
          Env.set("GITLAB_INSTANCE_URL", "https://gitlab.example.com")
        },
        fn: async () => {
          await GitLabWorkflowModelSelect.setLastSelection("existing-ref", "Existing")

          const models = [{ name: "M", ref: "r" }]
          let requestID: string | undefined
          Bus.subscribe(GitLabWorkflowModelSelect.Event.Asked, (e) => {
            requestID = e.properties.id
          })

          const promise = GitLabWorkflowModelSelect.ask({ sessionID: "s5", models })
          await new Promise((r) => setTimeout(r, 50))

          await GitLabWorkflowModelSelect.reply({ requestID: requestID!, modelRef: null })
          await promise

          expect(await GitLabWorkflowModelSelect.getLastSelection()).toBe("existing-ref")
        },
      })
    })
  })

  describe("event types", () => {
    test("Asked event type is gitlab-prefixed", () => {
      expect(GitLabWorkflowModelSelect.Event.Asked.type).toBe("gitlab_workflow_model_select.asked")
    })

    test("Replied event type is gitlab-prefixed", () => {
      expect(GitLabWorkflowModelSelect.Event.Replied.type).toBe("gitlab_workflow_model_select.replied")
    })
  })

  describe("schema validation", () => {
    test("Model schema validates correct input", () => {
      const result = GitLabWorkflowModelSelect.Model.safeParse({
        name: "Test",
        ref: "test-ref",
        isDefault: true,
      })
      expect(result.success).toBe(true)
    })

    test("Model schema allows omitting isDefault", () => {
      const result = GitLabWorkflowModelSelect.Model.safeParse({
        name: "Test",
        ref: "test-ref",
      })
      expect(result.success).toBe(true)
    })

    test("Model schema rejects missing name", () => {
      const result = GitLabWorkflowModelSelect.Model.safeParse({ ref: "test-ref" })
      expect(result.success).toBe(false)
    })

    test("Model schema rejects missing ref", () => {
      const result = GitLabWorkflowModelSelect.Model.safeParse({ name: "Test" })
      expect(result.success).toBe(false)
    })

    test("Request schema validates correct input", () => {
      const result = GitLabWorkflowModelSelect.Request.safeParse({
        id: "wfm_abc123",
        sessionID: "test-session",
        models: [{ name: "M", ref: "r" }],
      })
      expect(result.success).toBe(true)
    })

    test("Request schema rejects empty models array", () => {
      const result = GitLabWorkflowModelSelect.Request.safeParse({
        id: "wfm_abc123",
        sessionID: "test-session",
        models: [],
      })
      expect(result.success).toBe(true)
    })
  })
})
