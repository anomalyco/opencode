import { expect, test } from "bun:test"

// Windows does not deliver POSIX user signals.
test.skipIf(process.platform === "win32")(
  "an installed signal survives absent and removed subscribers",
  async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `
    import { ProcessSignal } from ${JSON.stringify(new URL("./process-signal.ts", import.meta.url).pathname)};
    const deadline = setTimeout(() => process.exit(2), 10000);
    let ignored = 0;
    ProcessSignal.install("SIGUSR2", () => {
      console.log("ignored");
      if (++ignored === 2) {
        clearTimeout(deadline);
        process.exit(0);
      }
      const remove = ProcessSignal.subscribe("SIGUSR2", () => {
        console.log("captured");
        remove();
        process.kill(process.pid, "SIGUSR2");
      });
      process.kill(process.pid, "SIGUSR2");
    });
    process.kill(process.pid, "SIGUSR2");
  `,
      ],
      { stdout: "pipe", stderr: "pipe" },
    )
    expect(await new Response(child.stderr).text()).toBe("")
    expect(await child.exited).toBe(0)
    expect((await new Response(child.stdout).text()).trim().split("\n")).toEqual(["ignored", "captured", "ignored"])
  },
  15000,
)
