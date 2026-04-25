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
      { id: "backend.go.run", title: "backend: Go run", command: "go run .", cwd: "/repo/backend" },
      { id: "backend.go.test", title: "backend: Go test", command: "go test ./...", cwd: "/repo/backend" },
    ])
    expect(readPaths).toEqual(["frontend/package.json", "backend/go.mod"])
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
