// The C.p scenarios run one prompt script on each side: `parity/oracle/C.p-prompts.ts` with
// `@clack/prompts`, and the same script in `opencode-prompt-demo` with the Rust kit.
import path from "node:path"
import type { Side } from "../../cli/client"
import type { PtyStep } from "../../pty/run"

const rs = path.resolve(import.meta.dir, "../../..")

export function demo(name: string) {
  return (side: Side) =>
    side === "ts"
      ? ["bun", path.join(rs, "parity/oracle/C.p-prompts.ts"), name]
      : [path.join(rs, "target/debug/opencode-prompt-demo"), name]
}

// One key (or chunk of typed text), then a checkpoint once the screen has settled.
export function press(keys: string, checkpoint: string, until?: string): PtyStep {
  return { keys, until: until === undefined ? undefined : { screen: until }, settle: 250, checkpoint }
}
