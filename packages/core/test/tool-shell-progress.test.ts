import { describe, expect, test } from "bun:test"
import { ShellProgress } from "@opencode-ai/core/tool/shell-progress"

describe("ShellProgress", () => {
  test("parses tqdm style frames", () => {
    expect(ShellProgress.parseFrame("Downloading:  62%|██████    | 621/1000 [00:33<00:21, 18.4it/s]")).toMatchObject({
      label: "Downloading",
      percent: 62,
      current: 621,
      total: 1000,
      rate: "18.4it/s",
      eta: "00:21",
    })
  })

  test("cleans repeated carriage-return progress frames", () => {
    const cleaned = ShellProgress.cleanOutput(
      "\r  0%|          | 0/10 [00:00<?, ?it/s]\r 50%|█████     | 5/10 [00:01<00:01, 5.0it/s]\r100%|██████████| 10/10 [00:02<00:00, 5.0it/s]\ndone\n",
    )

    expect(cleaned.frames).toBe(3)
    expect(cleaned.output).toContain("[progress:")
    expect(cleaned.output).toContain("100%")
    expect(cleaned.output).toContain("done")
    expect(cleaned.output).not.toContain("█████")
  })

  test("leaves ordinary logs alone", () => {
    const cleaned = ShellProgress.cleanOutput("installing\nbuilding\ndone\n")
    expect(cleaned.frames).toBe(0)
    expect(cleaned.output).toBe("installing\nbuilding\ndone\n")
  })
})
