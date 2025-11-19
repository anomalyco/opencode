import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { tmpdir } from "../../fixture/fixture"
import path from "path"
import fs from "fs/promises"
import { $ } from "bun"

describe("cli.ollama", () => {
  let originalPath: string

  beforeAll(() => {
    originalPath = process.env.PATH || ""
  })

  afterAll(() => {
    process.env.PATH = originalPath
  })

  test("generates config with models from ollama list", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Create a mock ollama binary
        const binDir = path.join(dir, "bin")
        await fs.mkdir(binDir, { recursive: true })
        const ollamaScript = path.join(binDir, "ollama")

        await Bun.write(
          ollamaScript,
          `#!/bin/bash
if [ "$1" = "list" ]; then
  cat << EOF
NAME                    ID              SIZE      MODIFIED
llama2:latest          abc123          3.8 GB    2 days ago
codellama:7b           def456          3.8 GB    3 days ago
mistral:latest         ghi789          4.1 GB    1 week ago
EOF
fi
`,
        )
        await fs.chmod(ollamaScript, 0o755)

        // Add mock binary to PATH
        process.env.PATH = `${binDir}:${originalPath}`
      },
    })

    // Run the ollama init command
    const outputFile = path.join(tmp.path, "test-config.json")
    await $`bun run ${path.join(__dirname, "../../../src/index.ts")} ollama init ${outputFile} -y`.cwd(tmp.path).quiet()

    // Verify the config file was created
    const configContent = await Bun.file(outputFile).text()
    const config = JSON.parse(configContent)

    expect(config.$schema).toBe("https://opencode.ai/config.json")
    expect(config.provider.ollama).toBeDefined()
    expect(config.provider.ollama.npm).toBe("@ai-sdk/openai-compatible")
    expect(config.provider.ollama.name).toBe("Ollama (local)")
    expect(config.provider.ollama.options.baseURL).toBe("http://localhost:11434/v1")
    expect(config.provider.ollama.models).toBeDefined()

    // Verify models are present
    expect(config.provider.ollama.models["llama2:latest"]).toEqual({ name: "llama2:latest" })
    expect(config.provider.ollama.models["codellama:7b"]).toEqual({ name: "codellama:7b" })
    expect(config.provider.ollama.models["mistral:latest"]).toEqual({ name: "mistral:latest" })
  })

  test("uses custom base URL when provided", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Create a mock ollama binary
        const binDir = path.join(dir, "bin")
        await fs.mkdir(binDir, { recursive: true })
        const ollamaScript = path.join(binDir, "ollama")

        await Bun.write(
          ollamaScript,
          `#!/bin/bash
if [ "$1" = "list" ]; then
  echo "NAME                    ID              SIZE      MODIFIED"
  echo "llama2:latest          abc123          3.8 GB    2 days ago"
fi
`,
        )
        await fs.chmod(ollamaScript, 0o755)
        process.env.PATH = `${binDir}:${originalPath}`
      },
    })

    const outputFile = path.join(tmp.path, "custom-url-config.json")
    const customUrl = "http://192.168.1.100:11434/v1"

    await $`bun run ${path.join(__dirname, "../../../src/index.ts")} ollama init ${outputFile} --base-url ${customUrl} -y`
      .cwd(tmp.path)
      .quiet()

    const configContent = await Bun.file(outputFile).text()
    const config = JSON.parse(configContent)

    expect(config.provider.ollama.options.baseURL).toBe(customUrl)
  })

  test("uses default filename when no output specified", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Create a mock ollama binary
        const binDir = path.join(dir, "bin")
        await fs.mkdir(binDir, { recursive: true })
        const ollamaScript = path.join(binDir, "ollama")

        await Bun.write(
          ollamaScript,
          `#!/bin/bash
if [ "$1" = "list" ]; then
  echo "NAME                    ID              SIZE      MODIFIED"
  echo "llama2:latest          abc123          3.8 GB    2 days ago"
fi
`,
        )
        await fs.chmod(ollamaScript, 0o755)
        process.env.PATH = `${binDir}:${originalPath}`
      },
    })

    await $`bun run ${path.join(__dirname, "../../../src/index.ts")} ollama init -y`.cwd(tmp.path).quiet()

    // Verify default filename was used
    const defaultFile = path.join(tmp.path, "opencode.json")
    const exists = await Bun.file(defaultFile).exists()
    expect(exists).toBe(true)
  })

  test("fails gracefully when ollama is not installed", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Set PATH to a directory without ollama
        const binDir = path.join(dir, "bin")
        await fs.mkdir(binDir, { recursive: true })
        process.env.PATH = binDir
      },
    })

    const outputFile = path.join(tmp.path, "should-not-exist.json")

    const result = await $`bun run ${path.join(__dirname, "../../../src/index.ts")} ollama init ${outputFile} -y`
      .cwd(tmp.path)
      .nothrow()
      .quiet()

    expect(result.exitCode).not.toBe(0)

    // Verify no config file was created
    const exists = await Bun.file(outputFile).exists()
    expect(exists).toBe(false)
  })

  test("fails gracefully when no models are available", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Create a mock ollama binary that returns no models
        const binDir = path.join(dir, "bin")
        await fs.mkdir(binDir, { recursive: true })
        const ollamaScript = path.join(binDir, "ollama")

        await Bun.write(
          ollamaScript,
          `#!/bin/bash
if [ "$1" = "list" ]; then
  echo "NAME                    ID              SIZE      MODIFIED"
fi
`,
        )
        await fs.chmod(ollamaScript, 0o755)
        process.env.PATH = `${binDir}:${originalPath}`
      },
    })

    const outputFile = path.join(tmp.path, "no-models.json")

    const result = await $`bun run ${path.join(__dirname, "../../../src/index.ts")} ollama init ${outputFile} -y`
      .cwd(tmp.path)
      .nothrow()
      .quiet()

    expect(result.exitCode).not.toBe(0)

    // Verify no config file was created
    const exists = await Bun.file(outputFile).exists()
    expect(exists).toBe(false)
  })

  test("merges with existing config file", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Create a mock ollama binary
        const binDir = path.join(dir, "bin")
        await fs.mkdir(binDir, { recursive: true })
        const ollamaScript = path.join(binDir, "ollama")

        await Bun.write(
          ollamaScript,
          `#!/bin/bash
if [ "$1" = "list" ]; then
  echo "NAME                    ID              SIZE      MODIFIED"
  echo "llama2:latest          abc123          3.8 GB    2 days ago"
fi
`,
        )
        await fs.chmod(ollamaScript, 0o755)
        process.env.PATH = `${binDir}:${originalPath}`

        // Create an existing config file with other providers
        const outputFile = path.join(dir, "existing-config.json")
        await Bun.write(
          outputFile,
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            model: "anthropic/claude-sonnet-4",
            provider: {
              anthropic: {
                models: {
                  "claude-sonnet-4": {
                    name: "Claude Sonnet 4",
                  },
                },
              },
            },
          }),
        )
      },
    })

    const outputFile = path.join(tmp.path, "existing-config.json")

    await $`bun run ${path.join(__dirname, "../../../src/index.ts")} ollama init ${outputFile} -y`.cwd(tmp.path).quiet()

    const configContent = await Bun.file(outputFile).text()
    const config = JSON.parse(configContent)

    // Verify existing anthropic config is preserved
    expect(config.model).toBe("anthropic/claude-sonnet-4")
    expect(config.provider.anthropic).toBeDefined()
    expect(config.provider.anthropic.models["claude-sonnet-4"]).toEqual({
      name: "Claude Sonnet 4",
    })

    // Verify new ollama config was added
    expect(config.provider.ollama).toBeDefined()
    expect(config.provider.ollama.models["llama2:latest"]).toEqual({ name: "llama2:latest" })
  })

  test("writes to global config when --global flag is used", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Create a mock ollama binary
        const binDir = path.join(dir, "bin")
        await fs.mkdir(binDir, { recursive: true })
        const ollamaScript = path.join(binDir, "ollama")

        await Bun.write(
          ollamaScript,
          `#!/bin/bash
if [ "$1" = "list" ]; then
  echo "NAME                    ID              SIZE      MODIFIED"
  echo "llama2:latest          abc123          3.8 GB    2 days ago"
fi
`,
        )
        await fs.chmod(ollamaScript, 0o755)
        process.env.PATH = `${binDir}:${originalPath}`
      },
    })

    // Set XDG_CONFIG_HOME to tmp directory for testing
    const originalConfigHome = process.env.XDG_CONFIG_HOME
    const testConfigDir = path.join(tmp.path, ".config", "opencode")
    await fs.mkdir(testConfigDir, { recursive: true })
    process.env.XDG_CONFIG_HOME = path.join(tmp.path, ".config")

    await $`bun run ${path.join(__dirname, "../../../src/index.ts")} ollama init --global -y`.cwd(tmp.path).quiet()

    // Restore original XDG_CONFIG_HOME
    if (originalConfigHome) {
      process.env.XDG_CONFIG_HOME = originalConfigHome
    } else {
      delete process.env.XDG_CONFIG_HOME
    }

    // Verify config was written to global location
    const globalConfigPath = path.join(testConfigDir, "opencode.json")
    const exists = await Bun.file(globalConfigPath).exists()
    expect(exists).toBe(true)

    const configContent = await Bun.file(globalConfigPath).text()
    const config = JSON.parse(configContent)

    expect(config.provider.ollama).toBeDefined()
    expect(config.provider.ollama.models["llama2:latest"]).toEqual({ name: "llama2:latest" })
  })

  test("uses 'which' command on Unix platforms", async () => {
    const { getDetectionCommand } = await import("../../../src/cli/cmd/ollama")

    expect(getDetectionCommand("linux")).toBe("which")
    expect(getDetectionCommand("darwin")).toBe("which")
    expect(getDetectionCommand("freebsd")).toBe("which")
    expect(getDetectionCommand("openbsd")).toBe("which")
  })

  test("uses 'where' command on Windows platform", async () => {
    const { getDetectionCommand } = await import("../../../src/cli/cmd/ollama")

    expect(getDetectionCommand("win32")).toBe("where")
  })
})
