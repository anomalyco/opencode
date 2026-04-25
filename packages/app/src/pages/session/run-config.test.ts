import { describe, expect, test } from "bun:test"
import {
  cargoRunConfigs,
  goRunConfigs,
  gradleRunConfigs,
  loadProjectRunConfigs,
  makeRunConfigs,
  mavenRunConfigs,
  packageRunConfigs,
  runConfigList,
} from "./run-config"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"

describe("packageRunConfigs", () => {
  test("uses packageManager to build script commands", () => {
    expect(
      packageRunConfigs(
        JSON.stringify({
          packageManager: "pnpm@9.0.0",
          scripts: {
            dev: "vite",
            test: "bun test",
            ignored: 42,
          },
        }),
      ),
    ).toEqual([
      { id: "package.dev", title: "dev", command: "pnpm run dev" },
      { id: "package.test", title: "test", command: "pnpm run test" },
    ])
  })

  test("falls back to npm", () => {
    expect(packageRunConfigs(JSON.stringify({ scripts: { build: "vite build" } }))).toEqual([
      { id: "package.build", title: "build", command: "npm run build" },
    ])
  })
})

describe("project file run config detectors", () => {
  test("detects go commands", () => {
    expect(goRunConfigs("module example.com/app")).toEqual([
      { id: "go.run", title: "Go run", command: "go run ." },
      { id: "go.test", title: "Go test", command: "go test ./..." },
    ])
  })

  test("detects maven commands with wrapper and spring boot", () => {
    expect(mavenRunConfigs("<artifactId>spring-boot-maven-plugin</artifactId>", "./mvnw")).toEqual([
      { id: "maven.spring-boot", title: "Spring Boot", command: "./mvnw spring-boot:run" },
      { id: "maven.test", title: "Maven test", command: "./mvnw test" },
    ])
  })

  test("detects gradle commands with wrapper", () => {
    expect(gradleRunConfigs('plugins { id("org.springframework.boot") }', "./gradlew")).toEqual([
      { id: "gradle.boot-run", title: "Spring Boot", command: "./gradlew bootRun" },
      { id: "gradle.test", title: "Gradle test", command: "./gradlew test" },
    ])
  })

  test("detects cargo commands", () => {
    expect(cargoRunConfigs('[package]\nname = "app"')).toEqual([
      { id: "cargo.run", title: "Cargo run", command: "cargo run" },
      { id: "cargo.test", title: "Cargo test", command: "cargo test" },
    ])
  })

  test("detects common make targets", () => {
    expect(makeRunConfigs("dev:\n\tair\ncustom:\n\techo no\ntest:\n\tgo test ./...")).toEqual([
      { id: "make.dev", title: "make dev", command: "make dev" },
      { id: "make.test", title: "make test", command: "make test" },
    ])
  })

  test("loads monorepo configs without reading missing marker files", async () => {
    const readPaths: string[] = []
    const client = {
      find: {
        files: () => Promise.resolve({ data: [] }),
        text: ({ pattern, directory }: { pattern: string; directory?: string }) =>
          Promise.resolve({
            data:
              pattern === "^func\\s+main\\s*\\(" && directory === "/repo/backend"
                ? [{ path: { text: "cmd/server/main.go" } }]
                : pattern === "^package\\s+main$" && directory === "/repo/backend"
                ? [{ path: { text: "cmd/server/main.go" } }]
                : [],
          }),
      },
      file: {
        list: ({ path }: { path: string }) =>
          Promise.resolve({
            data: {
              "": [
                { name: "frontend", path: "frontend", absolute: "/repo/frontend", type: "directory", ignored: false },
                { name: "backend", path: "backend", absolute: "/repo/backend", type: "directory", ignored: false },
                {
                  name: "node_modules",
                  path: "node_modules",
                  absolute: "/repo/node_modules",
                  type: "directory",
                  ignored: false,
                },
              ],
              frontend: [
                {
                  name: "package.json",
                  path: "frontend/package.json",
                  absolute: "/repo/frontend/package.json",
                  type: "file",
                  ignored: false,
                },
              ],
               backend: [
                 {
                   name: "go.mod",
                   path: "backend/go.mod",
                   absolute: "/repo/backend/go.mod",
                   type: "file",
                   ignored: false,
                  },
                  {
                    name: "cmd",
                    path: "backend/cmd",
                    absolute: "/repo/backend/cmd",
                    type: "directory",
                    ignored: false,
                  },
                ],
                "backend/cmd": [
                  {
                    name: "server",
                    path: "backend/cmd/server",
                    absolute: "/repo/backend/cmd/server",
                    type: "directory",
                    ignored: false,
                  },
                ],
                "backend/cmd/server": [
                  {
                    name: "main.go",
                    path: "backend/cmd/server/main.go",
                    absolute: "/repo/backend/cmd/server/main.go",
                    type: "file",
                    ignored: false,
                  },
                ],
              }[path],
          }),
        read: ({ path }: { path: string }) => {
          readPaths.push(path)
          return Promise.resolve({
            data: {
              type: "text" as const,
              content: {
                "frontend/package.json": JSON.stringify({ scripts: { dev: "vite" } }),
                "backend/go.mod": "module example.com/backend",
              }[path],
            },
          })
        },
      },
    } as unknown as OpencodeClient

    await expect(loadProjectRunConfigs(client)).resolves.toEqual([
      { id: "frontend.package.dev", title: "frontend: dev", command: "npm run dev", cwd: "/repo/frontend" },
      {
        id: "backend.go.run",
        title: "backend: Go run",
        command: "go run cmd/server/main.go",
        cwd: "/repo/backend",
      },
      { id: "backend.go.test", title: "backend: Go test", command: "go test ./...", cwd: "/repo/backend" },
    ])
    expect(readPaths).toEqual(["frontend/package.json", "backend/go.mod"])
  })

  test("loads standalone java run command with main file path", async () => {
    const client = {
      find: {
        files: () => Promise.resolve({ data: [] }),
        text: ({ pattern, directory }: { pattern: string; directory?: string }) =>
          Promise.resolve({
            data:
              pattern === "public\\s+static\\s+void\\s+main\\s*\\(" && !directory
                ? [{ path: { text: "java-app/src/cli/App.java" } }]
                : [],
          }),
      },
      file: {
        list: ({ path }: { path: string }) =>
          Promise.resolve({
            data: {
              "": [
                { name: "java-app", path: "java-app", absolute: "/repo/java-app", type: "directory", ignored: false },
              ],
              "java-app": [
                {
                  name: "src",
                  path: "java-app/src",
                  absolute: "/repo/java-app/src",
                  type: "directory",
                  ignored: false,
                },
              ],
              "java-app/src": [
                {
                  name: "cli",
                  path: "java-app/src/cli",
                  absolute: "/repo/java-app/src/cli",
                  type: "directory",
                  ignored: false,
                },
              ],
              "java-app/src/cli": [
                {
                  name: "App.java",
                  path: "java-app/src/cli/App.java",
                  absolute: "/repo/java-app/src/cli/App.java",
                  type: "file",
                  ignored: false,
                },
              ],
            }[path],
          }),
        read: () => Promise.resolve({ data: { type: "text" as const, content: undefined } }),
      },
    } as unknown as OpencodeClient

    await expect(loadProjectRunConfigs(client)).resolves.toEqual([
      {
        id: "java-app/src/cli.java.run",
        title: "java-app/src/cli: Java run",
        command: "java App.java",
        cwd: "/repo/java-app/src/cli",
      },
    ])
  })

  test("loads standalone go run command for non-main filename discovered by search", async () => {
    const client = {
      find: {
        files: () => Promise.resolve({ data: [] }),
        text: ({ pattern, directory }: { pattern: string; directory?: string }) =>
          Promise.resolve({
            data:
              pattern === "^func\\s+main\\s*\\(" && !directory
                ? [{ path: { text: "go-app/cmd/server.go" } }]
                : pattern === "^package\\s+main$" && !directory
                ? [{ path: { text: "go-app/cmd/server.go" } }]
                : [],
          }),
      },
      file: {
        list: ({ path }: { path: string }) =>
          Promise.resolve({
            data: {
              "": [{ name: "go-app", path: "go-app", absolute: "/repo/go-app", type: "directory", ignored: false }],
              "go-app": [
                {
                  name: "cmd",
                  path: "go-app/cmd",
                  absolute: "/repo/go-app/cmd",
                  type: "directory",
                  ignored: false,
                },
              ],
              "go-app/cmd": [
                {
                  name: "server.go",
                  path: "go-app/cmd/server.go",
                  absolute: "/repo/go-app/cmd/server.go",
                  type: "file",
                  ignored: false,
                },
              ],
            }[path],
          }),
        read: () => Promise.resolve({ data: { type: "text" as const, content: undefined } }),
      },
    } as unknown as OpencodeClient

    await expect(loadProjectRunConfigs(client)).resolves.toEqual([
      { id: "go-app/cmd.go.run", title: "go-app/cmd: Go run", command: "go run server.go", cwd: "/repo/go-app/cmd" },
    ])
  })

  test("loads standalone kotlin run command discovered by search", async () => {
    const client = {
      find: {
        files: () => Promise.resolve({ data: [] }),
        text: ({ pattern, directory }: { pattern: string; directory?: string }) =>
          Promise.resolve({
            data:
              pattern === "fun\\s+main\\s*\\(" && !directory
                ? [{ path: { text: "kotlin-app/src/App.kt" } }]
                : [],
          }),
      },
      file: {
        list: ({ path }: { path: string }) =>
          Promise.resolve({
            data: {
              "": [
                { name: "kotlin-app", path: "kotlin-app", absolute: "/repo/kotlin-app", type: "directory", ignored: false },
              ],
              "kotlin-app": [
                {
                  name: "src",
                  path: "kotlin-app/src",
                  absolute: "/repo/kotlin-app/src",
                  type: "directory",
                  ignored: false,
                },
              ],
              "kotlin-app/src": [
                {
                  name: "App.kt",
                  path: "kotlin-app/src/App.kt",
                  absolute: "/repo/kotlin-app/src/App.kt",
                  type: "file",
                  ignored: false,
                },
              ],
            }[path],
          }),
        read: () => Promise.resolve({ data: { type: "text" as const, content: undefined } }),
      },
    } as unknown as OpencodeClient

    await expect(loadProjectRunConfigs(client)).resolves.toEqual([
      {
        id: "kotlin-app/src.kotlin.run",
        title: "kotlin-app/src: Kotlin run",
        command: "kotlinc App.kt -include-runtime -d App.jar && java -jar App.jar",
        cwd: "/repo/kotlin-app/src",
      },
    ])
  })

  test("loads nested cargo project discovered by file search", async () => {
    const client = {
      find: {
        files: ({ query }: { query: string }) =>
          Promise.resolve({
            data: query === "Cargo.toml" ? ["tools/rust-cli/Cargo.toml"] : [],
          }),
        text: () => Promise.resolve({ data: [] }),
      },
      file: {
        list: ({ path }: { path: string }) =>
          Promise.resolve({
            data: {
              "": [{ name: "tools", path: "tools", absolute: "/repo/tools", type: "directory", ignored: false }],
              tools: [
                {
                  name: "rust-cli",
                  path: "tools/rust-cli",
                  absolute: "/repo/tools/rust-cli",
                  type: "directory",
                  ignored: false,
                },
              ],
              "tools/rust-cli": [
                {
                  name: "Cargo.toml",
                  path: "tools/rust-cli/Cargo.toml",
                  absolute: "/repo/tools/rust-cli/Cargo.toml",
                  type: "file",
                  ignored: false,
                },
              ],
            }[path],
          }),
        read: ({ path }: { path: string }) =>
          Promise.resolve({
            data: {
              type: "text" as const,
              content: {
                "tools/rust-cli/Cargo.toml": '[package]\nname = "rust-cli"',
              }[path],
            },
          }),
      },
    } as unknown as OpencodeClient

    await expect(loadProjectRunConfigs(client)).resolves.toEqual([
      { id: "tools/rust-cli.cargo.run", title: "tools/rust-cli: Cargo run", command: "cargo run", cwd: "/repo/tools/rust-cli" },
      {
        id: "tools/rust-cli.cargo.test",
        title: "tools/rust-cli: Cargo test",
        command: "cargo test",
        cwd: "/repo/tools/rust-cli",
      },
    ])
  })

  test("loads standalone python run command discovered by search", async () => {
    const client = {
      find: {
        files: () => Promise.resolve({ data: [] }),
        text: ({ pattern }: { pattern: string }) =>
          Promise.resolve({
            data:
              pattern === "if\\s+__name__\\s*==\\s*[\"']__main__[\"']\\s*:"
                ? [{ path: { text: "python-app/app.py" } }]
                : [],
          }),
      },
      file: {
        list: ({ path }: { path: string }) =>
          Promise.resolve({
            data: {
              "": [
                { name: "python-app", path: "python-app", absolute: "/repo/python-app", type: "directory", ignored: false },
              ],
              "python-app": [
                {
                  name: "app.py",
                  path: "python-app/app.py",
                  absolute: "/repo/python-app/app.py",
                  type: "file",
                  ignored: false,
                },
              ],
            }[path],
          }),
        read: () => Promise.resolve({ data: { type: "text" as const, content: undefined } }),
      },
    } as unknown as OpencodeClient

    await expect(loadProjectRunConfigs(client)).resolves.toEqual([
      { id: "python-app.python.run", title: "python-app: Python run", command: "python app.py", cwd: "/repo/python-app" },
    ])
  })

  test("loads standalone scala run command discovered by search", async () => {
    const client = {
      find: {
        files: () => Promise.resolve({ data: [] }),
        text: ({ pattern }: { pattern: string }) =>
          Promise.resolve({
            data: pattern === "@main|def\\s+main\\s*\\(" ? [{ path: { text: "scala-app/src/App.scala" } }] : [],
          }),
      },
      file: {
        list: ({ path }: { path: string }) =>
          Promise.resolve({
            data: {
              "": [{ name: "scala-app", path: "scala-app", absolute: "/repo/scala-app", type: "directory", ignored: false }],
              "scala-app": [
                {
                  name: "src",
                  path: "scala-app/src",
                  absolute: "/repo/scala-app/src",
                  type: "directory",
                  ignored: false,
                },
              ],
              "scala-app/src": [
                {
                  name: "App.scala",
                  path: "scala-app/src/App.scala",
                  absolute: "/repo/scala-app/src/App.scala",
                  type: "file",
                  ignored: false,
                },
              ],
            }[path],
          }),
        read: () => Promise.resolve({ data: { type: "text" as const, content: undefined } }),
      },
    } as unknown as OpencodeClient

    await expect(loadProjectRunConfigs(client)).resolves.toEqual([
      { id: "scala-app/src.scala.run", title: "scala-app/src: Scala run", command: "scala App.scala", cwd: "/repo/scala-app/src" },
    ])
  })

  test("loads csharp project discovered by file search", async () => {
    const client = {
      find: {
        files: ({ query }: { query: string }) =>
          Promise.resolve({
            data: query === "csproj" ? ["dotnet-api/App.csproj"] : [],
          }),
        text: () => Promise.resolve({ data: [] }),
      },
      file: {
        list: ({ path }: { path: string }) =>
          Promise.resolve({
            data: {
              "": [
                { name: "dotnet-api", path: "dotnet-api", absolute: "/repo/dotnet-api", type: "directory", ignored: false },
              ],
              "dotnet-api": [
                {
                  name: "App.csproj",
                  path: "dotnet-api/App.csproj",
                  absolute: "/repo/dotnet-api/App.csproj",
                  type: "file",
                  ignored: false,
                },
              ],
            }[path],
          }),
        read: () => Promise.resolve({ data: { type: "text" as const, content: undefined } }),
      },
    } as unknown as OpencodeClient

    await expect(loadProjectRunConfigs(client)).resolves.toEqual([
      { id: "dotnet-api.dotnet.run", title: "dotnet-api: Dotnet run", command: "dotnet run --project App.csproj", cwd: "/repo/dotnet-api" },
      { id: "dotnet-api.dotnet.test", title: "dotnet-api: Dotnet test", command: "dotnet test App.csproj", cwd: "/repo/dotnet-api" },
    ])
  })

  test("loads swift package discovered by file search", async () => {
    const client = {
      find: {
        files: ({ query }: { query: string }) =>
          Promise.resolve({
            data: query === "Package.swift" ? ["swift-tool/Package.swift"] : [],
          }),
        text: () => Promise.resolve({ data: [] }),
      },
      file: {
        list: ({ path }: { path: string }) =>
          Promise.resolve({
            data: {
              "": [
                { name: "swift-tool", path: "swift-tool", absolute: "/repo/swift-tool", type: "directory", ignored: false },
              ],
              "swift-tool": [
                {
                  name: "Package.swift",
                  path: "swift-tool/Package.swift",
                  absolute: "/repo/swift-tool/Package.swift",
                  type: "file",
                  ignored: false,
                },
              ],
            }[path],
          }),
        read: () => Promise.resolve({ data: { type: "text" as const, content: undefined } }),
      },
    } as unknown as OpencodeClient

    await expect(loadProjectRunConfigs(client)).resolves.toEqual([
      { id: "swift-tool.swift.package.run", title: "swift-tool: Swift run", command: "swift run", cwd: "/repo/swift-tool" },
      { id: "swift-tool.swift.package.test", title: "swift-tool: Swift test", command: "swift test", cwd: "/repo/swift-tool" },
    ])
  })
})

describe("runConfigList", () => {
  test("keeps start, custom configs, and package scripts without duplicates", () => {
    expect(
      runConfigList({
        projectStart: "bun install",
        projectStartTitle: "Start",
        customRuns: [
          { name: "Dev", command: "bun dev" },
          { name: "Empty", command: " " },
        ],
        detectedRuns: [
          { id: "package.dev", title: "Dev", command: "bun dev" },
          { id: "package.test", title: "test", command: "bun run test" },
        ],
      }),
    ).toEqual([
      { id: "project.start", title: "Start", command: "bun install" },
      { id: "custom.0", title: "Dev", command: "bun dev" },
      { id: "package.test", title: "test", command: "bun run test" },
    ])
  })

  test("keeps same command in different working directories", () => {
    expect(
      runConfigList({
        projectStartTitle: "Start",
        detectedRuns: [
          { id: "frontend.package.dev", title: "frontend: dev", command: "npm run dev", cwd: "/repo/frontend" },
          { id: "admin.package.dev", title: "admin: dev", command: "npm run dev", cwd: "/repo/admin" },
        ],
      }),
    ).toEqual([
      { id: "frontend.package.dev", title: "frontend: dev", command: "npm run dev", cwd: "/repo/frontend" },
      { id: "admin.package.dev", title: "admin: dev", command: "npm run dev", cwd: "/repo/admin" },
    ])
  })
})
