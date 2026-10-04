import { Effect } from "effect"
import { spawnSync } from "child_process"
import type { Strategy, ValidationResult } from "../strategy"

const PYTHON_VALIDATOR_SCRIPT = `
import ast, sys
try:
    ast.parse(sys.stdin.read())
    print("OK")
except SyntaxError as e:
    line = e.lineno or 1
    offset = e.offset or 1
    msg = e.msg or "invalid syntax"
    print(f"ERROR:{line}:{offset}:{msg}")
except Exception as e:
    print(f"ERROR:1:1:{str(e)}")
`

export class PythonValidator implements Strategy {
  readonly name = "python"
  readonly extensions = [".py", ".pyi"] as const

  validate(filepath: string, content: string): Effect.Effect<ValidationResult> {
    return Effect.sync(() => {
      try {
        const proc = spawnSync("python3", ["-c", PYTHON_VALIDATOR_SCRIPT], {
          input: content,
          encoding: "utf-8",
          timeout: 2000,
        })

        if (proc.error) {
          // If python3 is not available on system, fall back gracefully
          return { valid: true, errors: [] }
        }

        const output = (proc.stdout || "").trim()
        if (output.startsWith("ERROR:")) {
          const parts = output.split(":")
          const line = parseInt(parts[1], 10) || 1
          const column = parseInt(parts[2], 10) || 1
          const message = parts.slice(3).join(":") || "Syntax error"
          return {
            valid: false,
            errors: [
              {
                line,
                column,
                message,
              },
            ],
          }
        }

        return { valid: true, errors: [] }
      } catch {
        return { valid: true, errors: [] }
      }
    })
  }
}

export const pythonValidator = new PythonValidator()
