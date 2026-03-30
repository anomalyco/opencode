import { afterEach, describe, expect, test } from "bun:test";
import { Agent } from "../../src/agent/agent";
import { Instance } from "../../src/project/instance";
import { TaskTool } from "../../src/tool/task";
import { tmpdir } from "../fixture/fixture";

afterEach(async () => {
  await Instance.disposeAll();
});

describe("tool.task", () => {
  test("description sorts subagents by name and is stable across calls", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    });

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await Agent.get("build");
        const first = await TaskTool.init({ agent: build });
        const second = await TaskTool.init({ agent: build });

        expect(first.description).toBe(second.description);

        const alpha = first.description.indexOf("- alpha: Alpha agent");
        const explore = first.description.indexOf("- explore:");
        const general = first.description.indexOf("- general:");
        const zebra = first.description.indexOf("- zebra: Zebra agent");

        expect(alpha).toBeGreaterThan(-1);
        expect(explore).toBeGreaterThan(alpha);
        expect(general).toBeGreaterThan(explore);
        expect(zebra).toBeGreaterThan(general);
      },
    });
  });
});

test("accepts valid model_tier values", async () => {
  await using tmp = await tmpdir();
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const TaskInfo = await TaskTool.init();
      const schema = TaskInfo.parameters;
      const result = schema.safeParse({
        description: "Test",
        prompt: "Test prompt",
        subagent_type: "build",
        model_tier: "quick",
      });

      expect(result.success).toBe(true);
    },
  });
});

test("rejects invalid model_tier values", async () => {
  await using tmp = await tmpdir();
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const TaskInfo = await TaskTool.init();
      const schema = TaskInfo.parameters;
      const result = schema.safeParse({
        description: "Test",
        prompt: "Test prompt",
        subagent_type: "build",
        model_tier: "invalid",
      });

      expect(result.success).toBe(false);
    },
  });
});

test("model_tier is optional", async () => {
  await using tmp = await tmpdir();
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const TaskInfo = await TaskTool.init();
      const schema = TaskInfo.parameters;
      const result = schema.safeParse({ description: "Test", prompt: "Test prompt", subagent_type: "build" });

      expect(result.success).toBe(true);
    },
  });
});
