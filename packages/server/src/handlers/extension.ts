import path from "path"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api.js"
import { Extension } from "@opencode/schema/extension"
import { ExtensionRegistry } from "@opencode/core/extension/registry"
import { UniversalMcpManager } from "@opencode/core/extension/mcp/manager"
import { SkillAdapter } from "@opencode/core/extension/skills/adapter"
import { RulesAdapter } from "@opencode/core/extension/rules/adapter"
import { PluginAdapter } from "@opencode/core/extension/plugin/adapter"
import { ExtensionDetector } from "@opencode/core/extension/detector"
import { ExtensionSecurity } from "@opencode/core/extension/security"
import { AdapterGenerator } from "@opencode/core/extension/adapter-generator"
import { ExtensionGitHub } from "@opencode/core/extension/github"
import { Global } from "@opencode/util/global"

export const ExtensionHandler = HttpApiBuilder.group(Api, "server.extension", (handlers) =>
  handlers
    .handle("extension.list", () =>
      ExtensionRegistry.Service.use((reg) => reg.list()),
    )
    .handle("extension.inspect", (ctx) =>
      Effect.gen(function* () {
        const input = ctx.payload
        const isGit =
          input.sourceUrlOrPath.startsWith("http://") ||
          input.sourceUrlOrPath.startsWith("https://") ||
          input.sourceUrlOrPath.startsWith("git@")

        if (isGit) {
          const fetchResult = yield* ExtensionGitHub.fetchRepository({
            repoUrl: input.sourceUrlOrPath,
            subpath: input.subpath,
            ref: input.ref,
          })
          const decomposed = yield* ExtensionDetector.decomposePackage(
            fetchResult.directory,
            fetchResult.source,
            "project",
          )
          return decomposed
        }

        const source: Extension.Source = {
          type: "local" as const,
          location: input.sourceUrlOrPath,
          subpath: input.subpath,
        }
        const effectiveDir = input.subpath
          ? path.join(input.sourceUrlOrPath, input.subpath)
          : input.sourceUrlOrPath
        const decomposed = yield* ExtensionDetector.decomposePackage(effectiveDir, source, "project")
        return decomposed
      }).pipe(Effect.orDie),
    )
    .handle("extension.proposeAdapter", (ctx) =>
      AdapterGenerator.inspectAndPropose(ctx.payload.cir).pipe(Effect.orDie),
    )
    .handle("extension.install", (ctx) =>
      Effect.gen(function* () {
        const input = ctx.payload
        const reg = yield* ExtensionRegistry.Service
        const global = yield* Global.Service

        let workingSourcePath = input.sourceUrlOrPath
        const isGit =
          input.sourceUrlOrPath.startsWith("http://") ||
          input.sourceUrlOrPath.startsWith("https://") ||
          input.sourceUrlOrPath.startsWith("git@")

        let sourceChecksum: string | undefined = undefined
        if (isGit) {
          const fetchResult = yield* ExtensionGitHub.fetchRepository({
            repoUrl: input.sourceUrlOrPath,
            subpath: input.subpath,
            ref: input.ref,
          })
          workingSourcePath = fetchResult.directory
          sourceChecksum = fetchResult.commitSha
        } else if (input.subpath) {
          workingSourcePath = path.join(input.sourceUrlOrPath, input.subpath)
        }

        const extName = input.overrideName ?? path.basename(workingSourcePath)
        const extId = `${extName.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}-${Date.now()}`

        const detected = yield* ExtensionDetector.detect(workingSourcePath).pipe(
          Effect.orElseSucceed(() => ({
            platform: "opencode" as const,
            category: "skill" as const,
            confidence: 0.5,
          })),
        )

        const category = input.expectedCategory ?? detected.category
        let cir: Extension.CIR

        if (category === "skill") {
          const projectDir = global.home
          const installed = yield* SkillAdapter.install(input, projectDir).pipe(
            Effect.orElseSucceed(() => ({ success: false, error: "Installation failed" })),
          )

          if ("cir" in installed && installed.cir) {
            cir = installed.cir as Extension.CIR
          } else {
            cir = {
              id: extId,
              name: extName,
              version: "1.0.0",
              category: "skill",
              originPlatform: detected.platform,
              source: {
                type: isGit ? "git" : "local",
                location: input.sourceUrlOrPath,
                ref: input.ref,
                checksum: sourceChecksum,
              },
              scope: input.targetScope,
              status: "failed",
              enabled: false,
              permissions: { filesystem: [], network: [], environment: [], commands: [] },
              metadata: {},
              error: "error" in installed && installed.error ? installed.error : "Failed to install skill",
            }
          }
        } else if (category === "rule") {
          const rules = yield* RulesAdapter.discoverRules(workingSourcePath).pipe(
            Effect.orElseSucceed(() => []),
          )
          const security = yield* ExtensionSecurity.scanDirectory(workingSourcePath).pipe(
            Effect.orElseSucceed(() => ({
              safe: true,
              riskLevel: "low" as const,
              findings: [],
              scannedFiles: 0,
              timestamp: Date.now(),
            })),
          )

          cir = {
            id: extId,
            name: extName,
            version: "1.0.0",
            category: "rule",
            originPlatform: detected.platform,
            source: {
              type: isGit ? "git" : "local",
              location: input.sourceUrlOrPath,
              checksum: sourceChecksum,
            },
            scope: input.targetScope,
            status: security.safe ? "enabled" : "failed",
            enabled: security.safe,
            security,
            permissions: { filesystem: [workingSourcePath], network: [], environment: [], commands: [] },
            metadata: { count: rules.length },
          }
        } else if (category === "plugin") {
          const report = yield* PluginAdapter.inspect(workingSourcePath).pipe(
            Effect.orElseSucceed(() => undefined),
          )
          const security = yield* ExtensionSecurity.scanDirectory(workingSourcePath).pipe(
            Effect.orElseSucceed(() => ({
              safe: true,
              riskLevel: "low" as const,
              findings: [],
              scannedFiles: 0,
              timestamp: Date.now(),
            })),
          )

          cir = {
            id: extId,
            name: report?.name ?? extName,
            version: report?.version ?? "1.0.0",
            category: "plugin",
            originPlatform: detected.platform,
            source: {
              type: isGit ? "git" : "local",
              location: input.sourceUrlOrPath,
              checksum: sourceChecksum,
            },
            scope: input.targetScope,
            status: security.safe ? "enabled" : "failed",
            enabled: security.safe,
            security,
            permissions: {
              filesystem: [workingSourcePath],
              network: [],
              environment: [],
              commands: [],
            },
            metadata: {
              toolsCount: report?.tools?.length ?? 0,
            },
          }
        } else {
          cir = {
            id: extId,
            name: extName,
            version: "1.0.0",
            category: "mcp",
            originPlatform: detected.platform,
            source: {
              type: isGit ? "git" : "local",
              location: input.sourceUrlOrPath,
              checksum: sourceChecksum,
            },
            scope: input.targetScope,
            status: "enabled",
            enabled: true,
            permissions: { filesystem: [], network: [], environment: [], commands: [] },
            metadata: {},
          }
        }

        yield* reg.register(cir)
        return cir
      }).pipe(Effect.orDie),
    )
    .handle("extension.toggle", (ctx) =>
      ExtensionRegistry.Service.use((reg) => reg.toggle(ctx.params.id, ctx.payload.enabled)),
    )
    .handle("extension.rollback", (ctx) =>
      ExtensionRegistry.Service.use((reg) => reg.rollback(ctx.params.id, ctx.payload.targetVersion)),
    )
    .handle("extension.remove", (ctx) =>
      ExtensionRegistry.Service.use((reg) => reg.remove(ctx.params.id)),
    )
    .handle("extension.mcp.test", (ctx) =>
      UniversalMcpManager.testServer(ctx.payload.name, ctx.payload.config),
    ),
)
