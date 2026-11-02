import type { Task } from "../types"
import { PACKAGE_JSON } from "./shared"

export const navigation: Task = {
  id: "navigation",
  category: "navigation",
  prompt: [
    "Do not modify any files.",
    "Read the repository and answer: what is DEFAULT_TIMEOUT_MS in src/config.ts, and which exported function in that file uses it?",
    "Reply with the number of milliseconds and the function name.",
  ].join(" "),
  solutionFinal: "DEFAULT_TIMEOUT_MS is 4500 and withTimeout uses it.",
  files: {
    "package.json": PACKAGE_JSON,
    "src/config.ts": [
      "export const DEFAULT_TIMEOUT_MS = 4500",
      "",
      "export function withTimeout<T>(task: Promise<T>): Promise<T> {",
      "  return Promise.race([",
      "    task,",
      "    new Promise<never>((_, reject) => {",
      '      setTimeout(() => reject(new Error("timeout")), DEFAULT_TIMEOUT_MS)',
      "    }),",
      "  ])",
      "}",
      "",
    ].join("\n"),
    "src/client.ts": [
      'import { withTimeout } from "./config"',
      "",
      "export function fetchUser(id: string) {",
      "  return withTimeout(Promise.resolve({ id }))",
      "}",
      "",
    ].join("\n"),
  },
  verify: {
    files: {
      "verify.ts": [
        'const final = await Bun.file("eval-verify/final.txt").text()',
        'const status = await Bun.file("eval-verify/git-status.txt").text()',
        "",
        "if (status.trim() !== \"\") {",
        '  console.error("workspace was modified:\\n" + status)',
        "  process.exit(1)",
        "}",
        "",
        'if (!final.includes("4500")) {',
        '  console.error("final answer is missing the timeout value 4500")',
        "  process.exit(1)",
        "}",
        "",
        'if (!final.includes("withTimeout")) {',
        '  console.error("final answer is missing the function name withTimeout")',
        "  process.exit(1)",
        "}",
        "",
      ].join("\n"),
    },
    command: [process.execPath, "eval-verify/verify.ts"],
  },
}
