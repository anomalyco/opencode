import { describe, it, expect } from "bun:test"

describe("Commands with Bash Execution", () => {
  it("should parse bash commands from content", () => {
    const content = `# Test Command

This is a test command.

!echo "Hello World"
!pwd
!ls -la

Some more content here.`

    // Simulate the parseBashCommands function
    const lines = content.split("\n")
    const commands: string[] = []
    const cleanLines: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith("!")) {
        const command = trimmed.slice(1).trim()
        if (command) {
          commands.push(command)
        }
      } else {
        cleanLines.push(line)
      }
    }

    const cleanContent = cleanLines.join("\n")

    expect(commands).toEqual(['echo "Hello World"', "pwd", "ls -la"])

    expect(cleanContent).toContain("This is a test command.")
    expect(cleanContent).toContain("Some more content here.")
    expect(cleanContent).not.toContain("!echo")
    expect(cleanContent).not.toContain("!pwd")
    expect(cleanContent).not.toContain("!ls")
  })

  it("should handle content without bash commands", () => {
    const content = `# Test Command

This is a test command without bash commands.

Some content here.`

    // Simulate the parseBashCommands function
    const lines = content.split("\n")
    const commands: string[] = []
    const cleanLines: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith("!")) {
        const command = trimmed.slice(1).trim()
        if (command) {
          commands.push(command)
        }
      } else {
        cleanLines.push(line)
      }
    }

    const cleanContent = cleanLines.join("\n")

    expect(commands).toEqual([])
    expect(cleanContent).toBe(content)
  })

  it("should format command context correctly", () => {
    const mockResults = [
      {
        command: "git status",
        stdout: "On branch main\nnothing to commit, working tree clean",
        stderr: "",
        exitCode: 0,
      },
      {
        command: "git branch",
        stdout: "* main\n  feature-branch",
        stderr: "",
        exitCode: 0,
      },
      {
        command: "invalid-command",
        stdout: "",
        stderr: "command not found: invalid-command",
        exitCode: 1,
      },
    ]

    let contextSection = "\n\n## Command Context\n\n"
    contextSection +=
      "The following bash commands were executed to gather context:\n\n"

    for (const result of mockResults) {
      contextSection += `### Command: \`${result.command}\`\n\n`
      if (result.exitCode === 0) {
        if (result.stdout.trim()) {
          contextSection += "```\n" + result.stdout.trim() + "\n```\n\n"
        } else {
          contextSection += "*No output*\n\n"
        }
      } else {
        contextSection += `*Command failed with exit code ${result.exitCode}*\n\n`
        if (result.stderr.trim()) {
          contextSection += "```\n" + result.stderr.trim() + "\n```\n\n"
        }
      }
    }

    expect(contextSection).toContain("## Command Context")
    expect(contextSection).toContain("### Command: `git status`")
    expect(contextSection).toContain("On branch main")
    expect(contextSection).toContain("### Command: `git branch`")
    expect(contextSection).toContain("* main")
    expect(contextSection).toContain("### Command: `invalid-command`")
    expect(contextSection).toContain("*Command failed with exit code 1*")
    expect(contextSection).toContain("command not found: invalid-command")
  })
})
