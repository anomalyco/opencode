import { describe, expect, test } from "bun:test"
import { completionScript, detectShell } from "../../src/cli/cmd/completion"

describe("cli.completion", () => {
  describe("detectShell", () => {
    test("detects fish from /usr/bin/fish", () => {
      expect(detectShell("/usr/bin/fish")).toBe("fish")
    })

    test("detects fish from /bin/fish", () => {
      expect(detectShell("/bin/fish")).toBe("fish")
    })

    test("detects fish from bare name", () => {
      expect(detectShell("fish")).toBe("fish")
    })

    test("detects bash from /bin/bash", () => {
      expect(detectShell("/bin/bash")).toBe("bash")
    })

    test("detects bash from bare name", () => {
      expect(detectShell("bash")).toBe("bash")
    })

    test("detects zsh from /bin/zsh", () => {
      expect(detectShell("/bin/zsh")).toBe("zsh")
    })

    test("detects zsh from /usr/bin/zsh", () => {
      expect(detectShell("/usr/bin/zsh")).toBe("zsh")
    })

    test("detects zsh from bare name", () => {
      expect(detectShell("zsh")).toBe("zsh")
    })

    test("defaults to bash for unknown shell", () => {
      expect(detectShell("/bin/ksh")).toBe("bash")
    })

    test("does not match shell path containing fish as substring", () => {
      expect(detectShell("/usr/bin/fisherman")).toBe("bash")
    })

    test("defaults to bash for undefined", () => {
      expect(detectShell(undefined)).toBe("bash")
    })

    test("defaults to bash for empty string", () => {
      expect(detectShell("")).toBe("bash")
    })
  })

  describe("completionScript", () => {
    describe("bash", () => {
      test("contains completion function", () => {
        expect(completionScript("bash")).toContain("_opencode_yargs_completions")
      })

      test("registers with complete builtin", () => {
        expect(completionScript("bash")).toContain("complete -o bashdefault -o default -F")
      })

      test("uses yargs completions flag", () => {
        expect(completionScript("bash")).toContain("--get-yargs-completions")
      })

      test("has begin/end markers", () => {
        const script = completionScript("bash")
        expect(script).toContain("###-begin-opencode-completions-###")
        expect(script).toContain("###-end-opencode-completions-###")
      })

      test("quotes cur_word in compgen", () => {
        expect(completionScript("bash")).toContain('-- "${cur_word}"')
      })

      test("uses mapfile for safe word splitting", () => {
        expect(completionScript("bash")).toContain("mapfile -t")
      })

      test("filters out $0 placeholder from completions", () => {
        expect(completionScript("bash")).toContain("grep -vxF '$0'")
      })
    })

    describe("fish", () => {
      test("uses Fish complete builtin", () => {
        expect(completionScript("fish")).toContain("complete -c opencode")
      })

      test("uses commandline for input", () => {
        expect(completionScript("fish")).toContain("commandline")
      })

      test("uses proper function syntax", () => {
        const script = completionScript("fish")
        expect(script).toContain("function ")
        expect(script).toContain("\nend")
      })

      test("uses yargs completions flag", () => {
        expect(completionScript("fish")).toContain("--get-yargs-completions")
      })

      test("does not contain bash syntax", () => {
        const script = completionScript("fish")
        expect(script).not.toContain("COMPREPLY")
        expect(script).not.toContain("compgen")
      })

      test("suppresses file completions", () => {
        expect(completionScript("fish")).toContain("complete -c opencode -f")
      })

      test("has begin/end markers", () => {
        const script = completionScript("fish")
        expect(script).toContain("###-begin-opencode-completions-###")
        expect(script).toContain("###-end-opencode-completions-###")
      })

      test("suppresses stderr from completion probe", () => {
        expect(completionScript("fish")).toContain("2>/dev/null")
      })

      test("sets SHELL=zsh to get yargs description output", () => {
        expect(completionScript("fish")).toContain("SHELL=zsh")
      })

      test("parses yargs colon-separated name:description format", () => {
        const script = completionScript("fish")
        expect(script).toContain("string split")
        expect(script).toContain(":")
      })

      test("uses printf for tab-separated description output", () => {
        expect(completionScript("fish")).toContain("printf '%s\\t%s\\n'")
      })

      test("filters out yargs internal placeholders after parsing", () => {
        const script = completionScript("fish")
        // Filter must run on $parts[1] (parsed name), not the raw completion
        // string, because SHELL=zsh output includes descriptions like "$0:desc"
        expect(script).toContain("switch $parts[1]")
        expect(script).toContain("'$0'")
        expect(script).toContain("'_generate_completions'")
        expect(script).toContain("continue")
      })
    })

    describe("zsh", () => {
      test("uses compdef for completion registration", () => {
        expect(completionScript("zsh")).toContain("compdef")
      })

      test("uses _describe for completion display", () => {
        expect(completionScript("zsh")).toContain("_describe 'values' reply")
      })

      test("uses yargs completions flag", () => {
        expect(completionScript("zsh")).toContain("--get-yargs-completions")
      })

      test("has begin/end markers", () => {
        const script = completionScript("zsh")
        expect(script).toContain("###-begin-opencode-completions-###")
        expect(script).toContain("###-end-opencode-completions-###")
      })

      test("does not contain bash-specific syntax", () => {
        const script = completionScript("zsh")
        expect(script).not.toContain("COMPREPLY")
        expect(script).not.toContain("compgen")
      })

      test("does not contain fish-specific syntax", () => {
        const script = completionScript("zsh")
        expect(script).not.toContain("commandline")
        expect(script).not.toContain("complete -c opencode")
      })

      test("falls back to default completion when no matches", () => {
        expect(completionScript("zsh")).toContain("_default")
      })

      test("passes COMP environment variables for context", () => {
        const script = completionScript("zsh")
        expect(script).toContain("COMP_CWORD")
        expect(script).toContain("COMP_LINE")
        expect(script).toContain("COMP_POINT")
      })

      test("supports autoload via loadautofunc", () => {
        expect(completionScript("zsh")).toContain("loadautofunc")
      })

      test("starts with #compdef directive", () => {
        expect(completionScript("zsh")).toMatch(/^#compdef opencode\n/)
      })
    })

    test("throws for unsupported shell", () => {
      // @ts-expect-error testing invalid input
      expect(() => completionScript("powershell")).toThrow()
    })
  })
})
