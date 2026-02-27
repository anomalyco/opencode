import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { GitLabWorkflowModelSelect } from "../../session/gitlab-workflow-model-select"
import { Provider } from "../../provider/provider"
import { Instance } from "../../project/instance"
import { GitLabModelDiscovery, GitLabProjectDetector, GitLabModelCache } from "@gitlab/gitlab-ai-provider"
import { Log } from "../../util/log"
import z from "zod"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const log = Log.create({ service: "gitlab-workflow-model-select" })

export const GitLabWorkflowModelSelectRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List pending GitLab workflow model selections",
        operationId: "gitlab_workflow_model_select.list",
        responses: {
          200: {
            description: "List of pending GitLab workflow model selection requests",
            content: {
              "application/json": {
                schema: resolver(GitLabWorkflowModelSelect.Request.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const requests = await GitLabWorkflowModelSelect.list()
        return c.json(requests)
      },
    )
    .post(
      "/discover",
      describeRoute({
        summary: "Discover available GitLab workflow models and publish selection event",
        operationId: "gitlab_workflow_model_select.discover",
        responses: {
          200: {
            description: "Discovery result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    status: z.enum(["asked", "cached", "pinned", "default", "no_models", "no_provider"]),
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

        const existingSelection = await GitLabWorkflowModelSelect.getLastSelection()
        log.debug("discover check", { existingSelection })

        const provider = await Provider.getProvider("gitlab")
        if (!provider) {
          return c.json({ status: "no_provider" as const, modelRef: null })
        }

        const instanceUrl = (provider.options.instanceUrl as string) || "https://gitlab.com"
        const apiKey = provider.options.apiKey as string | undefined
        if (!apiKey) {
          return c.json({ status: "no_provider" as const, modelRef: null })
        }

        const headers = () => ({
          Authorization: `Bearer ${apiKey}`,
          ...(provider.options.aiGatewayHeaders as Record<string, string> | undefined),
        })

        try {
          const detector = new GitLabProjectDetector({ instanceUrl, getHeaders: headers })
          const project = await detector.detectProject(Instance.directory)

          let namespaceId: string | null = null
          if (project?.pathWithNamespace) {
            const rootGroupPath = project.pathWithNamespace.split("/")[0]
            try {
              const res = await fetch(`${instanceUrl}/api/v4/groups/${encodeURIComponent(rootGroupPath)}`, {
                headers: headers(),
              })
              if (res.ok) {
                const data = (await res.json()) as { id: number }
                namespaceId = `gid://gitlab/Group/${data.id}`
              }
            } catch {
              // fallback to direct namespace
            }
          }
          if (!namespaceId && project?.namespaceId) {
            namespaceId = `gid://gitlab/Group/${project.namespaceId}`
          }

          if (!namespaceId) {
            try {
              const res = await fetch(
                `${instanceUrl}/api/v4/groups?top_level_only=true&min_access_level=10&per_page=1`,
                { headers: headers() },
              )
              if (res.ok) {
                const groups = (await res.json()) as Array<{ id: number }>
                if (groups.length > 0) {
                  namespaceId = `gid://gitlab/Group/${groups[0].id}`
                  log.debug("using first top-level group as fallback namespace", { namespaceId })
                }
              }
            } catch {
              // best-effort
            }
          }

          const cache = new GitLabModelCache(Instance.directory, instanceUrl)

          if (namespaceId) {
            try {
              const discovery = new GitLabModelDiscovery({ instanceUrl, getHeaders: headers })
              const discovered = await discovery.discover(namespaceId)
              cache.saveDiscovery(discovered)

              log.debug("discovery result", {
                namespaceId,
                pinnedModel: discovered.pinnedModel?.ref ?? null,
                selectableModels: discovered.selectableModels.length,
                defaultModel: discovered.defaultModel?.ref ?? null,
                modelSwitchingEnabled: discovered.modelSwitchingEnabled,
              })

              if (discovered.pinnedModel) {
                await GitLabWorkflowModelSelect.setLastSelection(
                  discovered.pinnedModel.ref,
                  discovered.pinnedModel.name,
                )
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
                const result = await GitLabWorkflowModelSelect.ask({
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
                    await GitLabWorkflowModelSelect.setLastSelection(match.ref, match.name)
                    return c.json({ status: "asked" as const, modelRef: match.ref, modelName: match.name })
                  }
                }
                return c.json({ status: "asked" as const, modelRef: result })
              }

              if (discovered.defaultModel) {
                await GitLabWorkflowModelSelect.setLastSelection(
                  discovered.defaultModel.ref,
                  discovered.defaultModel.name,
                )
                return c.json({
                  status: "default" as const,
                  modelRef: discovered.defaultModel.ref,
                  modelName: discovered.defaultModel.name,
                })
              }
            } catch (err) {
              log.debug("namespace discovery failed, trying user namespace", {
                namespaceId,
                error: err instanceof Error ? err.message : String(err),
              })
            }
          }

          await GitLabWorkflowModelSelect.setLastSelection("default", "Namespace Default")
          return c.json({
            status: "default" as const,
            modelRef: "default",
            modelName: "Namespace Default",
          })
        } catch (err) {
          log.warn("gitlab workflow model discovery failed", {
            error: err instanceof Error ? err.message : String(err),
          })
          return c.json({ status: "no_models" as const, modelRef: null })
        }
      },
    )
    .post(
      "/clear",
      describeRoute({
        summary: "Clear cached GitLab workflow model selection",
        operationId: "gitlab_workflow_model_select.clear",
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
        await GitLabWorkflowModelSelect.setLastSelection(null)
        return c.json(true)
      },
    )
    .post(
      "/:requestID/reply",
      describeRoute({
        summary: "Reply to GitLab workflow model selection",
        operationId: "gitlab_workflow_model_select.reply",
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
        await GitLabWorkflowModelSelect.reply({
          requestID: params.requestID,
          modelRef: json.modelRef,
          modelName: json.modelName,
        })
        return c.json(true)
      },
    ),
)
