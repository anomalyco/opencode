import { describe, test, expect } from "bun:test"
import { PlanMode, validateCommandForPlanMode, isPlanMode } from "./plan-mode"

describe("PlanMode", () => {
  describe("isPlanMode", () => {
    test("returns true for plan agent", () => {
      expect(isPlanMode("plan")).toBe(true)
    })

    test("returns false for build agent", () => {
      expect(isPlanMode("build")).toBe(false)
    })

    test("returns false for other agents", () => {
      expect(isPlanMode("general")).toBe(false)
      expect(isPlanMode("explore")).toBe(false)
    })
  })

  describe("validateCommandForPlanMode", () => {
    describe("non-plan mode", () => {
      test("allows all commands in build mode", () => {
        expect(validateCommandForPlanMode("rm -rf /", "build").allowed).toBe(true)
        expect(validateCommandForPlanMode("git commit -m 'test'", "build").allowed).toBe(true)
      })
    })

    describe("destructive commands", () => {
      test("blocks rm command", () => {
        const result = validateCommandForPlanMode("rm file.txt", "plan")
        expect(result.allowed).toBe(false)
        expect(result.command).toBe("rm")
      })

      test("blocks rm -rf", () => {
        const result = validateCommandForPlanMode("rm -rf /", "plan")
        expect(result.allowed).toBe(false)
      })

      test("blocks sed command", () => {
        const result = validateCommandForPlanMode("sed -i 's/old/new/g' file.txt", "plan")
        expect(result.allowed).toBe(false)
        expect(result.command).toBe("sed")
      })

      test("blocks mv command", () => {
        const result = validateCommandForPlanMode("mv old.txt new.txt", "plan")
        expect(result.allowed).toBe(false)
      })

      test("blocks mkdir command", () => {
        const result = validateCommandForPlanMode("mkdir newdir", "plan")
        expect(result.allowed).toBe(false)
      })

      test("blocks chmod command", () => {
        const result = validateCommandForPlanMode("chmod +x script.sh", "plan")
        expect(result.allowed).toBe(false)
      })
    })

    describe("package manager commands", () => {
      test("blocks npm install", () => {
        const result = validateCommandForPlanMode("npm install", "plan")
        expect(result.allowed).toBe(false)
      })

      test("blocks npm i shorthand", () => {
        const result = validateCommandForPlanMode("npm i lodash", "plan")
        expect(result.allowed).toBe(false)
      })

      test("blocks yarn add", () => {
        const result = validateCommandForPlanMode("yarn add react", "plan")
        expect(result.allowed).toBe(false)
      })

      test("blocks pip install", () => {
        const result = validateCommandForPlanMode("pip install requests", "plan")
        expect(result.allowed).toBe(false)
      })
    })

    describe("git commands", () => {
      test("blocks git commit", () => {
        const result = validateCommandForPlanMode("git commit -m 'test'", "plan")
        expect(result.allowed).toBe(false)
      })

      test("blocks git push", () => {
        const result = validateCommandForPlanMode("git push origin main", "plan")
        expect(result.allowed).toBe(false)
      })

      test("allows git status", () => {
        const result = validateCommandForPlanMode("git status", "plan")
        expect(result.allowed).toBe(true)
      })

      test("allows git diff", () => {
        const result = validateCommandForPlanMode("git diff", "plan")
        expect(result.allowed).toBe(true)
      })

      test("allows git log", () => {
        const result = validateCommandForPlanMode("git log --oneline", "plan")
        expect(result.allowed).toBe(true)
      })

      test("allows git branch", () => {
        const result = validateCommandForPlanMode("git branch -a", "plan")
        expect(result.allowed).toBe(true)
      })
    })

    describe("read-only commands", () => {
      test("allows ls", () => {
        expect(validateCommandForPlanMode("ls -la", "plan").allowed).toBe(true)
      })

      test("allows cat", () => {
        expect(validateCommandForPlanMode("cat file.txt", "plan").allowed).toBe(true)
      })

      test("allows grep", () => {
        expect(validateCommandForPlanMode("grep -r 'pattern' src/", "plan").allowed).toBe(true)
      })

      test("allows find", () => {
        expect(validateCommandForPlanMode("find . -name '*.ts'", "plan").allowed).toBe(true)
      })

      test("allows echo", () => {
        expect(validateCommandForPlanMode("echo 'hello world'", "plan").allowed).toBe(true)
      })

      test("allows pwd", () => {
        expect(validateCommandForPlanMode("pwd", "plan").allowed).toBe(true)
      })

      test("allows which", () => {
        expect(validateCommandForPlanMode("which node", "plan").allowed).toBe(true)
      })
    })

    describe("dangerous characters", () => {
      test("blocks backtick command substitution", () => {
        const result = validateCommandForPlanMode("echo `date`", "plan")
        expect(result.allowed).toBe(false)
      })

      test("blocks newline injection", () => {
        const result = validateCommandForPlanMode("echo hello\nrm -rf /", "plan")
        expect(result.allowed).toBe(false)
      })
    })

    describe("edge cases", () => {
      test("handles empty command", () => {
        expect(validateCommandForPlanMode("", "plan").allowed).toBe(true)
      })

      test("handles whitespace-only command", () => {
        expect(validateCommandForPlanMode("   ", "plan").allowed).toBe(true)
      })

      test("handles commands with leading whitespace", () => {
        const result = validateCommandForPlanMode("   rm file.txt", "plan")
        expect(result.allowed).toBe(false)
      })

      test("is case-insensitive for commands", () => {
        const result = validateCommandForPlanMode("RM file.txt", "plan")
        expect(result.allowed).toBe(false)
      })
    })
  })
})
