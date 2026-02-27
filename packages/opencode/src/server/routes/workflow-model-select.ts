import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { WorkflowModelSelect } from "../../session/workflow-model-select"
import { Provider } from "../../provider/provider"
import { Instance } from "../../project/instance"
import { GitLabModelDiscovery, GitLabProjectDetector, GitLabModelCache } from "@gitlab/gitlab-ai-provider"
import { Log } from "../../util/log"
import z from "zod"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const log = Log.create({ service: "workflow-model-select" })

export const WorkflowModelSelectRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List pending workflow model selections",
        operationId: "workflow_model_select.list",
        responses: {
          200: {
            description: "List of pending workflow model selection requests",
            content: {
              "application/json": {
                schema: resolver(WorkflowModelSelect.Request.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const requests = await WorkflowModelSelect.list()
        return c.json(requests)
      },
    )
    .post(
      "/discover",
      describeRoute({
        summary: "Discover available workflow models and publish selection event",
        operationId: "workflow_model_select.discover",
        responses: {
          200: {
            description: "Discovery result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    status: z.enum(["asked", "pinned", "default", "no_models", "no_provider"]),
                    modelRef: z.string().nullable().optional(),
                    modelName: z.string().nullable().optional(),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          sessionID: z.string().optional(),
          force: z.boolean().optional(),
        }),
      ),
      async (c) => {
        const json = c.req.valid("json")
        const sessionID = json.sessionID ?? ""

        const existingSelection = await WorkflowModelSelect.getLastSelection()
        log.info("discover check", { existingSelection })

        const provider = await Provider.getProvider("gitlab")
        if (!provider) {
          return c.json({ status: "no_provider" as const, modelRef: null })
        }

        const instanceUrl = (provider.options.instanceUrl as string) || "https://gitlab.com"
        const apiKey = provider.options.apiKey as string | undefined
        if (!apiKey) {
          return c.json({ status: "no_provider" as const, modelRef: null })
        }

        const getHeaders = () => ({
          Authorization: `Bearer ${apiKey}`,
          ...(provider.options.aiGatewayHeaders as Record<string, string> | undefined),
        })

        try {
          const detector = new GitLabProjectDetector({ instanceUrl, getHeaders })
          const project = await detector.detectProject(Instance.directory)

          let namespaceId: string | null = null
          if (project?.pathWithNamespace) {
            const rootGroupPath = project.pathWithNamespace.split("/")[0]
            try {
              const groupRes = await fetch(`${instanceUrl}/api/v4/groups/${encodeURIComponent(rootGroupPath)}`, {
                headers: getHeaders(),
              })
              if (groupRes.ok) {
                const groupData = (await groupRes.json()) as { id: number }
                namespaceId = `gid://gitlab/Group/${groupData.id}`
              }
            } catch (_) {
              // fallback to direct namespace
            }
          }
          if (!namespaceId && project?.namespaceId) {
            namespaceId = `gid://gitlab/Group/${project.namespaceId}`
          }

          if (!namespaceId) {
            try {
              const groupsRes = await fetch(
                `${instanceUrl}/api/v4/groups?top_level_only=true&min_access_level=10&per_page=1`,
                {
                  headers: getHeaders(),
                },
              )
              if (groupsRes.ok) {
                const groups = (await groupsRes.json()) as Array<{ id: number }>
                if (groups.length > 0) {
                  namespaceId = `gid://gitlab/Group/${groups[0].id}`
                  log.info("using first top-level group as fallback namespace", { namespaceId })
                }
              }
            } catch (_) {
              // best-effort
            }
          }

          const modelCache = new GitLabModelCache(Instance.directory, instanceUrl)

          if (namespaceId) {
            try {
              const discovery = new GitLabModelDiscovery({ instanceUrl, getHeaders })
              const discovered = await discovery.discover(namespaceId)
              modelCache.saveDiscovery(discovered)

              log.debug("discovery result", {
                namespaceId,
                pinnedModel: discovered.pinnedModel?.ref ?? null,
                selectableModels: discovered.selectableModels.length,
                defaultModel: discovered.defaultModel?.ref ?? null,
                modelSwitchingEnabled: discovered.modelSwitchingEnabled,
              })

              if (discovered.pinnedModel) {
                await WorkflowModelSelect.setLastSelection(discovered.pinnedModel.ref, discovered.pinnedModel.name)
                return c.json({
                  status: "pinned" as const,
                  modelRef: discovered.pinnedModel.ref,
                  modelName: discovered.pinnedModel.name,
                })
              }

              if (discovered.selectableModels.length > 0) {
                if (existingSelection) {
                  const match = discovered.selectableModels.find((m) => m.ref === existingSelection)
                  if (match) {
                    return c.json({ status: "cached" as const, modelRef: match.ref, modelName: match.name })
                  }
                }
                const defaultRef = discovered.defaultModel?.ref
                const sorted = [...discovered.selectableModels].sort((a, b) => {
                  if (a.ref === defaultRef) return -1
                  if (b.ref === defaultRef) return 1
                  return 0
                })
                const result = await WorkflowModelSelect.ask({
                  sessionID,
                  models: sorted.map((m) => ({
                    name: m.name,
                    ref: m.ref,
                    isDefault: m.ref === defaultRef,
                  })),
                })
                if (result) {
                  const match = discovered.selectableModels.find((m) => m.ref === result)
                  if (match) {
                    await WorkflowModelSelect.setLastSelection(match.ref, match.name)
                    return c.json({ status: "asked" as const, modelRef: match.ref, modelName: match.name })
                  }
                }
                return c.json({ status: "asked" as const, modelRef: result })
              }

              if (discovered.defaultModel) {
                await WorkflowModelSelect.setLastSelection(discovered.defaultModel.ref, discovered.defaultModel.name)
                return c.json({
                  status: "default" as const,
                  modelRef: discovered.defaultModel.ref,
                  modelName: discovered.defaultModel.name,
                })
              }
            } catch (err) {
              log.info("namespace discovery failed, trying user namespace", {
                namespaceId,
                error: err instanceof Error ? err.message : String(err),
              })
            }
          }

          await WorkflowModelSelect.setLastSelection("default", "Namespace Default")
          return c.json({
            status: "default" as const,
            modelRef: "default",
            modelName: "Namespace Default",
          })
        } catch (err) {
          log.warn("workflow model discovery failed", {
            error: err instanceof Error ? err.message : String(err),
          })
          return c.json({ status: "no_models" as const, modelRef: null })
        }
      },
    )
    .post(
      "/clear",
      describeRoute({
        summary: "Clear cached workflow model selection",
        operationId: "workflow_model_select.clear",
        responses: {
          200: {
            description: "Cache cleared",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await WorkflowModelSelect.setLastSelection(null)
        return c.json(true)
      },
    )
    .post(
      "/:requestID/reply",
      describeRoute({
        summary: "Reply to workflow model selection",
        operationId: "workflow_model_select.reply",
        responses: {
          200: {
            description: "Selection processed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          requestID: z.string(),
        }),
      ),
      validator(
        "json",
        z.object({
          modelRef: z.string().nullable(),
          modelName: z.string().nullable().optional(),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const json = c.req.valid("json")
        await WorkflowModelSelect.reply({
          requestID: params.requestID,
          modelRef: json.modelRef,
          modelName: json.modelName,
        })
        return c.json(true)
      },
    ),
)
