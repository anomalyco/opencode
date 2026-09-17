import { describe, test, expect, afterAll } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import * as LSPServer from "@/lsp/server"
import type { InstanceContext } from "@/project/instance-context"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tmpBase = path.join(os.tmpdir(), "opencode-jdtls-test")

function makeCtx(directory: string): InstanceContext {
  return { directory, worktree: "/", project: {} as any }
}

async function mkdirp(p: string) {
  await fs.mkdir(p, { recursive: true })
}

async function touch(p: string) {
  await mkdirp(path.dirname(p))
  await fs.writeFile(p, "", "utf-8")
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(async () => {
  await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {})
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("JDTLS.root", () => {
  // -------------------------------------------------------------------------
  // Maven
  // -------------------------------------------------------------------------
  describe("Maven", () => {
    test("single-module Maven project returns pom.xml directory", async () => {
      const root = path.join(tmpBase, "single-maven")
      await mkdirp(root)
      await touch(path.join(root, "pom.xml"))
      const srcDir = path.join(root, "src", "main", "java", "com", "example")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "App.java"))

      const file = path.join(srcDir, "App.java")
      const result = await LSPServer.JDTLS.root(file, makeCtx(root))
      expect(result).toBe(root)
    })

    test("multi-module Maven project follows <module> chain to top-level pom.xml", async () => {
      const root = path.join(tmpBase, "multi-maven")
      await mkdirp(root)
      // Parent pom with <module>module-a</module>
      await Bun.write(path.join(root, "pom.xml"), "<project><modules><module>module-a</module></modules></project>")
      // Child module with its own pom.xml
      const childDir = path.join(root, "module-a")
      await mkdirp(childDir)
      await touch(path.join(childDir, "pom.xml"))
      const srcDir = path.join(childDir, "src", "main", "java", "com", "example")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "App.java"))

      const file = path.join(srcDir, "App.java")
      const result = await LSPServer.JDTLS.root(file, makeCtx(root))
      // Parent declares module-a as module → root is parent directory
      expect(result).toBe(root)
    })

    test("Maven project inside a nested directory (ctx.directory is workspace root)", async () => {
      // Workspace root = ctx.directory, Maven project in a subdirectory
      const workspace = path.join(tmpBase, "maven-workspace")
      await mkdirp(workspace)
      const projectDir = path.join(workspace, "my-maven-app")
      await touch(path.join(projectDir, "pom.xml"))
      const srcDir = path.join(projectDir, "src", "main", "java", "com", "example")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "App.java"))

      const file = path.join(srcDir, "App.java")
      const result = await LSPServer.JDTLS.root(file, makeCtx(workspace))
      // findUp finds projectDir's pom.xml (only one), returns projectDir
      expect(result).toBe(projectDir)
    })

    test("nested independent Maven project stops at its own pom.xml", async () => {
      const workspace = path.join(tmpBase, "nested-independent")
      await mkdirp(workspace)
      // Parent pom WITHOUT <module>tools/sample</module>
      await Bun.write(
        path.join(workspace, "pom.xml"),
        "<project><modules><module>module-a</module></modules></project>",
      )
      // Independent project nested inside
      const projectDir = path.join(workspace, "tools", "sample")
      await mkdirp(projectDir)
      await touch(path.join(projectDir, "pom.xml"))
      const srcDir = path.join(projectDir, "src", "main", "java", "com", "example")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "App.java"))

      const file = path.join(srcDir, "App.java")
      const result = await LSPServer.JDTLS.root(file, makeCtx(workspace))
      // workspace/pom.xml does NOT declare tools/sample as module → stop at tools/sample
      expect(result).toBe(projectDir)
    })

    test("three-level Maven module chain resolves to top-level", async () => {
      const root = path.join(tmpBase, "three-level")
      await mkdirp(root)
      await Bun.write(path.join(root, "pom.xml"), "<project><modules><module>apps</module></modules></project>")
      const appsDir = path.join(root, "apps")
      await mkdirp(appsDir)
      await Bun.write(path.join(appsDir, "pom.xml"), "<project><modules><module>my-app</module></modules></project>")
      const appDir = path.join(appsDir, "my-app")
      await mkdirp(appDir)
      await touch(path.join(appDir, "pom.xml"))
      const srcDir = path.join(appDir, "src", "main", "java", "com", "example")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "App.java"))

      const file = path.join(srcDir, "App.java")
      const result = await LSPServer.JDTLS.root(file, makeCtx(root))
      expect(result).toBe(root)
    })

    test("three-level Maven chain stops when <module> link is broken", async () => {
      const root = path.join(tmpBase, "broken-chain")
      await mkdirp(root)
      await Bun.write(path.join(root, "pom.xml"), "<project><modules><module>apps</module></modules></project>")
      const appsDir = path.join(root, "apps")
      await mkdirp(appsDir)
      await touch(path.join(appsDir, "pom.xml")) // Empty pom, no <module> declaration
      const appDir = path.join(appsDir, "my-app")
      await mkdirp(appDir)
      await touch(path.join(appDir, "pom.xml"))
      const srcDir = path.join(appDir, "src", "main", "java", "com", "example")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "App.java"))

      const file = path.join(srcDir, "App.java")
      const result = await LSPServer.JDTLS.root(file, makeCtx(root))
      // apps/pom.xml has no <module>my-app</module> → stop at my-app
      expect(result).toBe(appDir)
    })

    test("<module> with ./ prefix is normalized correctly", async () => {
      const root = path.join(tmpBase, "dot-slash-module")
      await mkdirp(root)
      await Bun.write(path.join(root, "pom.xml"), "<project><modules><module>./module-a</module></modules></project>")
      const childDir = path.join(root, "module-a")
      await mkdirp(childDir)
      await touch(path.join(childDir, "pom.xml"))
      const srcDir = path.join(childDir, "src", "main", "java", "com", "example")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "App.java"))

      const file = path.join(srcDir, "App.java")
      const result = await LSPServer.JDTLS.root(file, makeCtx(root))
      expect(result).toBe(root)
    })

    test("<module> with trailing slash is normalized correctly", async () => {
      const root = path.join(tmpBase, "trailing-slash-module")
      await mkdirp(root)
      await Bun.write(path.join(root, "pom.xml"), "<project><modules><module>module-a/</module></modules></project>")
      const childDir = path.join(root, "module-a")
      await mkdirp(childDir)
      await touch(path.join(childDir, "pom.xml"))
      const srcDir = path.join(childDir, "src", "main", "java", "com", "example")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "App.java"))

      const file = path.join(srcDir, "App.java")
      const result = await LSPServer.JDTLS.root(file, makeCtx(root))
      expect(result).toBe(root)
    })
  })

  // -------------------------------------------------------------------------
  // Gradle
  // -------------------------------------------------------------------------
  describe("Gradle", () => {
    test("Gradle project with settings.gradle in a subdirectory of ctx.directory", async () => {
      // Workspace root = ctx.directory, Gradle project in a subdirectory
      const workspace = path.join(tmpBase, "gradle-sub")
      await mkdirp(workspace)
      const projectDir = path.join(workspace, "gradle-app")
      await touch(path.join(projectDir, "settings.gradle"))
      await touch(path.join(projectDir, "build.gradle"))
      const srcDir = path.join(projectDir, "src", "main", "java", "com", "example")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "App.java"))

      const file = path.join(srcDir, "App.java")
      const result = await LSPServer.JDTLS.root(file, makeCtx(workspace))
      expect(result).toBe(projectDir)
    })

    test("Gradle project with only build.gradle in a subdirectory", async () => {
      const workspace = path.join(tmpBase, "gradle-build-sub")
      await mkdirp(workspace)
      const projectDir = path.join(workspace, "gradle-app")
      await touch(path.join(projectDir, "build.gradle"))
      const srcDir = path.join(projectDir, "src", "main", "java", "com", "example")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "App.java"))

      const file = path.join(srcDir, "App.java")
      const result = await LSPServer.JDTLS.root(file, makeCtx(workspace))
      expect(result).toBe(projectDir)
    })

    test("Gradle monorepo with settings.gradle takes precedence over nested pom.xml", async () => {
      const workspace = path.join(tmpBase, "gradle-monorepo")
      await mkdirp(workspace)
      const gradleRoot = path.join(workspace, "gradle-project")
      await touch(path.join(gradleRoot, "settings.gradle"))
      await touch(path.join(gradleRoot, "gradlew"))
      // Submodule has pom.xml too
      const subDir = path.join(gradleRoot, "module-a")
      await mkdirp(subDir)
      await touch(path.join(subDir, "pom.xml"))
      const srcDir = path.join(subDir, "src", "main", "java", "com", "example")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "App.java"))

      const file = path.join(srcDir, "App.java")
      const result = await LSPServer.JDTLS.root(file, makeCtx(workspace))
      // Gradle markers found at gradleRoot level
      expect(result).toBe(gradleRoot)
    })

    test("settings.gradle.kts (Kotlin DSL) is recognized", async () => {
      const workspace = path.join(tmpBase, "gradle-kts-settings")
      await mkdirp(workspace)
      const projectDir = path.join(workspace, "gradle-app")
      await touch(path.join(projectDir, "settings.gradle.kts"))
      const srcDir = path.join(projectDir, "src", "main", "java", "com", "example")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "App.java"))

      const file = path.join(srcDir, "App.java")
      const result = await LSPServer.JDTLS.root(file, makeCtx(workspace))
      expect(result).toBe(projectDir)
    })

    test("build.gradle.kts (Kotlin DSL) is recognized", async () => {
      const workspace = path.join(tmpBase, "gradle-kts-build")
      await mkdirp(workspace)
      const projectDir = path.join(workspace, "gradle-app")
      await touch(path.join(projectDir, "build.gradle.kts"))
      const srcDir = path.join(projectDir, "src", "main", "java", "com", "example")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "App.java"))

      const file = path.join(srcDir, "App.java")
      const result = await LSPServer.JDTLS.root(file, makeCtx(workspace))
      expect(result).toBe(projectDir)
    })

    test("gradlew (without settings.gradle) in a subdirectory is recognized", async () => {
      const workspace = path.join(tmpBase, "gradlew-sub")
      await mkdirp(workspace)
      const projectDir = path.join(workspace, "gradle-app")
      await touch(path.join(projectDir, "gradlew"))
      const srcDir = path.join(projectDir, "src", "main", "java", "com", "example")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "App.java"))

      const file = path.join(srcDir, "App.java")
      const result = await LSPServer.JDTLS.root(file, makeCtx(workspace))
      expect(result).toBe(projectDir)
    })

    test("pom.xml is excluded when gradlew is present at same level", async () => {
      const workspace = path.join(tmpBase, "gradle-excludes-maven")
      await mkdirp(workspace)
      const projectDir = path.join(workspace, "mixed-project")
      // Both pom.xml and gradlew exist
      await touch(path.join(projectDir, "pom.xml"))
      await touch(path.join(projectDir, "gradlew"))
      const srcDir = path.join(projectDir, "src", "main", "java", "com", "example")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "App.java"))

      const file = path.join(srcDir, "App.java")
      const result = await LSPServer.JDTLS.root(file, makeCtx(workspace))
      // Gradle wrapper takes precedence
      expect(result).toBe(projectDir)
    })
  })

  // -------------------------------------------------------------------------
  // Eclipse
  // -------------------------------------------------------------------------
  describe("Eclipse", () => {
    test("Eclipse project with .project in a subdirectory", async () => {
      const workspace = path.join(tmpBase, "eclipse-sub")
      await mkdirp(workspace)
      const projectDir = path.join(workspace, "eclipse-app")
      await touch(path.join(projectDir, ".project"))
      await touch(path.join(projectDir, ".classpath"))
      const srcDir = path.join(projectDir, "src", "com", "example")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "App.java"))

      const file = path.join(srcDir, "App.java")
      const result = await LSPServer.JDTLS.root(file, makeCtx(workspace))
      expect(result).toBe(projectDir)
    })
  })

  // -------------------------------------------------------------------------
  // No markers
  // -------------------------------------------------------------------------
  describe("No build markers", () => {
    test("Java file with no build markers returns undefined", async () => {
      const root = path.join(tmpBase, "no-build")
      await mkdirp(root)
      const srcDir = path.join(root, "src")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "App.java"))

      const file = path.join(srcDir, "App.java")
      const result = await LSPServer.JDTLS.root(file, makeCtx(root))
      expect(result).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // Additional validation scenarios
  // -------------------------------------------------------------------------
  describe("Additional Maven module-chain validation", () => {
    // Scenario 1: <module> with multi-segment path (e.g. <module>tools/sample</module>)
    test("<module> multi-segment path matches nested directory", async () => {
      const root = path.join(tmpBase, "multi-seg-module")
      await mkdirp(root)
      await Bun.write(path.join(root, "pom.xml"), "<project><modules><module>tools/sample</module></modules></project>")
      const childDir = path.join(root, "tools", "sample")
      await mkdirp(childDir)
      await touch(path.join(childDir, "pom.xml"))
      const srcDir = path.join(childDir, "src", "main", "java", "com", "example")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "App.java"))

      const file = path.join(srcDir, "App.java")
      const result = await LSPServer.JDTLS.root(file, makeCtx(root))
      expect(result).toBe(root)
    })

    // Scenario 2: <module> declaration does not match actual directory name
    test("<module> declaration mismatch does not falsely match", async () => {
      const root = path.join(tmpBase, "module-mismatch")
      await mkdirp(root)
      // Parent declares module-a, but actual directory is module-b
      await Bun.write(path.join(root, "pom.xml"), "<project><modules><module>module-a</module></modules></project>")
      const childDir = path.join(root, "module-b")
      await mkdirp(childDir)
      await touch(path.join(childDir, "pom.xml"))
      const srcDir = path.join(childDir, "src", "main", "java", "com", "example")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "App.java"))

      const file = path.join(srcDir, "App.java")
      const result = await LSPServer.JDTLS.root(file, makeCtx(root))
      // module-b is not declared as a module → stop at module-b
      expect(result).toBe(childDir)
    })

    // Scenario 3: Multiple <module> declarations
    test("multiple <module> declarations allow second module to traverse up", async () => {
      const root = path.join(tmpBase, "multi-modules")
      await mkdirp(root)
      await Bun.write(
        path.join(root, "pom.xml"),
        "<project><modules><module>module-a</module><module>module-b</module></modules></project>",
      )
      const childA = path.join(root, "module-a")
      await mkdirp(childA)
      await touch(path.join(childA, "pom.xml"))
      const childB = path.join(root, "module-b")
      await mkdirp(childB)
      await touch(path.join(childB, "pom.xml"))
      const srcDir = path.join(childB, "src", "main", "java", "com", "example")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "App.java"))

      const file = path.join(srcDir, "App.java")
      const result = await LSPServer.JDTLS.root(file, makeCtx(root))
      expect(result).toBe(root)
    })

    // Scenario 4: XML comments should not be matched as module declarations
    test("XML-commented <module> is not matched", async () => {
      const root = path.join(tmpBase, "commented-module")
      await mkdirp(root)
      await Bun.write(
        path.join(root, "pom.xml"),
        "<project><modules><!-- <module>module-a</module> --></modules></project>",
      )
      const childDir = path.join(root, "module-a")
      await mkdirp(childDir)
      await touch(path.join(childDir, "pom.xml"))
      const srcDir = path.join(childDir, "src", "main", "java", "com", "example")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "App.java"))

      const file = path.join(srcDir, "App.java")
      const result = await LSPServer.JDTLS.root(file, makeCtx(root))
      // Commented-out module should not be matched → stop at module-a
      expect(result).toBe(childDir)
    })

    // Scenario 5: pom.xml at ctx.directory itself
    test("pom.xml at ctx.directory itself is found correctly", async () => {
      const root = path.join(tmpBase, "pom-at-ctx")
      await mkdirp(root)
      await touch(path.join(root, "pom.xml"))
      const srcDir = path.join(root, "src", "main", "java", "com", "example")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "App.java"))

      const file = path.join(srcDir, "App.java")
      const result = await LSPServer.JDTLS.root(file, makeCtx(root))
      expect(result).toBe(root)
    })

    // Scenario 6: Mixed Gradle + Maven sibling projects don't interfere
    test("Maven and Gradle sibling projects don't interfere", async () => {
      const workspace = path.join(tmpBase, "mixed-siblings")
      await mkdirp(workspace)
      // Gradle project
      const gradleDir = path.join(workspace, "gradle-project")
      await touch(path.join(gradleDir, "settings.gradle"))
      const gradleSrc = path.join(gradleDir, "src", "main", "java", "com", "example")
      await mkdirp(gradleSrc)
      await touch(path.join(gradleSrc, "GradleApp.java"))
      // Maven project
      const mavenDir = path.join(workspace, "maven-project")
      await touch(path.join(mavenDir, "pom.xml"))
      const mavenSrc = path.join(mavenDir, "src", "main", "java", "com", "example")
      await mkdirp(mavenSrc)
      await touch(path.join(mavenSrc, "MavenApp.java"))

      const gradleResult = await LSPServer.JDTLS.root(path.join(gradleSrc, "GradleApp.java"), makeCtx(workspace))
      expect(gradleResult).toBe(gradleDir)

      const mavenResult = await LSPServer.JDTLS.root(path.join(mavenSrc, "MavenApp.java"), makeCtx(workspace))
      expect(mavenResult).toBe(mavenDir)
    })
  })
})
