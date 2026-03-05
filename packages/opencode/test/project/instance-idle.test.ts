import { afterEach, describe, expect, mock, test } from "bun:test";
import { Log } from "../../src/util/log";

Log.init({ print: false });

let calls = 0;
mock.module("../../src/project/project", () => ({
  Project: {
    fromDirectory: async (dir: string) => {
      calls++;
      return {
        project: { id: "test" },
        sandbox: dir,
      };
    },
  },
}));

// Set a short idle timeout before Flag module loads
process.env.OPENCODE_IDLE_TIMEOUT = "50";

const { Instance } = await import("../../src/project/instance");

function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

describe("Instance idle timeout", () => {
  afterEach(async () => {
    for (const entry of Instance.list()) {
      await Instance.disposeByDirectory(entry.directory);
    }
  });

  test("provide creates and returns result", async () => {
    const result = await Instance.provide({
      directory: "/tmp/idle-test-1",
      fn: () => 42,
    });
    expect(result).toBe(42);
  });

  test("list returns cached instances with ref counts", async () => {
    await Instance.provide({
      directory: "/tmp/idle-test-2",
      fn: async () => {
        const list = Instance.list();
        expect(list.length).toBeGreaterThanOrEqual(1);
        const entry = list.find((e) => e.directory === "/tmp/idle-test-2");
        expect(entry).toBeTruthy();
        expect(entry!.refs).toBe(1);
      },
    });
  });

  test("idle timer disposes instance after timeout", async () => {
    await Instance.provide({
      directory: "/tmp/idle-test-3",
      fn: () => {},
    });

    expect(Instance.list().some((e) => e.directory === "/tmp/idle-test-3")).toBe(true);

    await wait(100);

    expect(Instance.list().some((e) => e.directory === "/tmp/idle-test-3")).toBe(false);
  });

  test("new provide cancels idle timer", async () => {
    await Instance.provide({
      directory: "/tmp/idle-test-4",
      fn: () => {},
    });

    await wait(25);

    await Instance.provide({
      directory: "/tmp/idle-test-4",
      fn: () => {},
    });

    // Original timer would have fired by now
    await wait(40);
    expect(Instance.list().some((e) => e.directory === "/tmp/idle-test-4")).toBe(true);

    // Now wait for the reset timer
    await wait(60);
    expect(Instance.list().some((e) => e.directory === "/tmp/idle-test-4")).toBe(false);
  });

  test("after idle disposal, new provide creates fresh instance", async () => {
    const before = calls;

    await Instance.provide({
      directory: "/tmp/idle-test-5",
      fn: () => {},
    });
    expect(calls).toBe(before + 1);

    await wait(100);

    await Instance.provide({
      directory: "/tmp/idle-test-5",
      fn: () => {},
    });
    expect(calls).toBe(before + 2);
  });

  test("disposeByDirectory removes instance", async () => {
    await Instance.provide({
      directory: "/tmp/idle-test-6",
      fn: () => {},
    });

    expect(Instance.list().some((e) => e.directory === "/tmp/idle-test-6")).toBe(true);

    const disposed = await Instance.disposeByDirectory("/tmp/idle-test-6");
    expect(disposed).toBe(true);
    expect(Instance.list().some((e) => e.directory === "/tmp/idle-test-6")).toBe(false);

    const again = await Instance.disposeByDirectory("/tmp/idle-test-6");
    expect(again).toBe(false);
  });

  test("concurrent provides share instance and track refs", async () => {
    const gate = Promise.withResolvers<void>();

    const p1 = Instance.provide({
      directory: "/tmp/idle-test-7",
      fn: async () => {
        await gate.promise;
      },
    });

    // Small delay to let p1 start
    await wait(5);

    const p2 = Instance.provide({
      directory: "/tmp/idle-test-7",
      fn: async () => {
        const entry = Instance.list().find((e) => e.directory === "/tmp/idle-test-7");
        expect(entry!.refs).toBe(2);
        gate.resolve();
      },
    });

    await Promise.all([p1, p2]);

    // Refs should be 0 after both complete
    const entry = Instance.list().find((e) => e.directory === "/tmp/idle-test-7");
    if (entry) expect(entry.refs).toBe(0);
  });

  test("dispose within provide cancels idle timer", async () => {
    await Instance.provide({
      directory: "/tmp/idle-test-8",
      fn: async () => {
        await Instance.dispose();
      },
    });

    // Instance already disposed inside fn — should not be in list
    expect(Instance.list().some((e) => e.directory === "/tmp/idle-test-8")).toBe(false);

    // No idle timer should fire (nothing to dispose)
    await wait(100);
    expect(Instance.list().some((e) => e.directory === "/tmp/idle-test-8")).toBe(false);
  });
});
