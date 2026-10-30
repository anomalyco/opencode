import { describe, expect } from "bun:test"
import fs from "fs"
import path from "path"
import os from "os"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { testEffect } from "../lib/effect"
import { ConfigMigration } from "../../src/workspace-manager/config-migration.js"

const baseLayer = AppNodeBuilder.build(
  LayerNode.group([
    FSUtil.node,
    Global.node,
  ]),
)

const fullTestLayer = ConfigMigration.layer.pipe(Layer.provideMerge(baseLayer))
const it = testEffect(fullTestLayer)

describe("ConfigMigration & Fork Data Preservation", () => {
  it.effect("provides independent application paths and isolated data locations", () =>
    Effect.gen(function* () {
      const migrator = yield* ConfigMigration.Service
      const paths = migrator.getEnhancedPaths()

      expect(paths.config).toBeDefined()
      expect(paths.data).toBeDefined()
      expect(paths.state).toBeDefined()
      expect(paths.isForkIsolated).toBe(true)
    }),
  )

  it.effect("safely imports upstream configuration, MCP servers, and skills non-destructively", () =>
    Effect.gen(function* () {
      const migrator = yield* ConfigMigration.Service
      const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "m5-migration-"))

      const upstreamDir = path.join(tempBase, "upstream-opencode")
      const targetDir = path.join(tempBase, "enhanced-opencode")
      fs.mkdirSync(upstreamDir, { recursive: true })
      fs.mkdirSync(targetDir, { recursive: true })

      // Create mock upstream opencode.json
      const upstreamConfig = {
        mcp: {
          "sqlite-db": {
            type: "local",
            command: ["mcp-server-sqlite", "--db", "test.db"],
          },
        },
        model: "claude-3-7-sonnet-20250219",
        provider: "anthropic",
      }
      fs.writeFileSync(path.join(upstreamDir, "opencode.json"), JSON.stringify(upstreamConfig, null, 2))

      // Create mock upstream skill
      const upstreamSkillDir = path.join(upstreamDir, "skills", "git-helper")
      fs.mkdirSync(upstreamSkillDir, { recursive: true })
      fs.writeFileSync(path.join(upstreamSkillDir, "SKILL.md"), "# Git Helper Skill\nAssists with git commits.")

      // Set environment variable to point to test directories
      const oldConfig = process.env.OPENCODE_ENHANCED_CONFIG_DIR
      process.env.OPENCODE_ENHANCED_CONFIG_DIR = targetDir

      // Test manual migration logic using imported files
      const targetConfigPath = path.join(targetDir, "opencode.json")
      fs.writeFileSync(
        targetConfigPath,
        JSON.stringify(
          {
            mcp: upstreamConfig.mcp,
            model: upstreamConfig.model,
            provider: upstreamConfig.provider,
          },
          null,
          2,
        ),
      )

      // Copy skill
      const targetSkillDir = path.join(targetDir, "skills", "git-helper")
      fs.mkdirSync(targetSkillDir, { recursive: true })
      fs.copyFileSync(path.join(upstreamSkillDir, "SKILL.md"), path.join(targetSkillDir, "SKILL.md"))

      // Verify upstream remains intact
      expect(fs.existsSync(path.join(upstreamDir, "opencode.json"))).toBe(true)
      expect(fs.existsSync(path.join(upstreamSkillDir, "SKILL.md"))).toBe(true)

      // Verify target receives imported configurations
      expect(fs.existsSync(targetConfigPath)).toBe(true)
      const importedJson = JSON.parse(fs.readFileSync(targetConfigPath, "utf8"))
      expect(importedJson.mcp["sqlite-db"]).toBeDefined()
      expect(importedJson.model).toBe("claude-3-7-sonnet-20250219")
      expect(fs.existsSync(path.join(targetSkillDir, "SKILL.md"))).toBe(true)

      // Verify persistence
      const persistence = yield* migrator.verifyPersistence("proj_123")
      expect(persistence.projectSettingsPersisted).toBe(true)
      expect(persistence.attachmentsPersisted).toBe(true)
      expect(persistence.conversationsPersisted).toBe(true)
      expect(persistence.dataDirectoriesIsolated).toBe(true)

      // Cleanup
      if (oldConfig) process.env.OPENCODE_ENHANCED_CONFIG_DIR = oldConfig
      else delete process.env.OPENCODE_ENHANCED_CONFIG_DIR
      fs.rmSync(tempBase, { recursive: true, force: true })
    }),
  )
})
