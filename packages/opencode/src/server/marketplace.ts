import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Marketplace, MarketplaceSchema } from "../marketplace"
import { errors } from "./error"

export const MarketplaceRoute = new Hono()
  .get(
    "/sources",
    describeRoute({
      summary: "List marketplace sources",
      description: "List all configured marketplace sources (GitHub repositories).",
      operationId: "marketplace.sources.list",
      responses: {
        200: {
          description: "List of marketplace sources",
          content: {
            "application/json": {
              schema: resolver(z.array(MarketplaceSchema.Source)),
            },
          },
        },
      },
    }),
    async (c) => {
      const sources = await Marketplace.listSources()
      return c.json(sources)
    },
  )
  .post(
    "/sources/validate",
    describeRoute({
      summary: "Validate marketplace source",
      description: "Validate a marketplace source by fetching its registry.",
      operationId: "marketplace.sources.validate",
      responses: {
        200: {
          description: "Validation result",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  valid: z.boolean(),
                  error: z.string().optional(),
                  registry: MarketplaceSchema.RegistryIndex.optional(),
                }),
              ),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("json", MarketplaceSchema.Source),
    async (c) => {
      const source = c.req.valid("json")
      const result = await Marketplace.validateSource(source)
      return c.json(result)
    },
  )
  .get(
    "/agents",
    describeRoute({
      summary: "List marketplace agents",
      description: "List all available agents from configured marketplace sources.",
      operationId: "marketplace.agents.list",
      responses: {
        200: {
          description: "List of available agents",
          content: {
            "application/json": {
              schema: resolver(
                z.array(
                  z.object({
                    source: MarketplaceSchema.Source,
                    agent: MarketplaceSchema.AgentEntry,
                    installed: z.boolean(),
                    installedPath: z.string().optional(),
                  }),
                ),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const refresh = c.req.query("refresh") === "true"
      const source = c.req.query("source")
      const agents = await Marketplace.listAgents({ refresh, source })
      return c.json(agents)
    },
  )
  .get(
    "/agents/search",
    describeRoute({
      summary: "Search marketplace agents",
      description: "Search for agents across all marketplace sources.",
      operationId: "marketplace.agents.search",
      responses: {
        200: {
          description: "Search results",
          content: {
            "application/json": {
              schema: resolver(
                z.array(
                  z.object({
                    source: MarketplaceSchema.Source,
                    agent: MarketplaceSchema.AgentEntry,
                    installed: z.boolean(),
                    installedPath: z.string().optional(),
                  }),
                ),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const query = c.req.query("q") ?? ""
      const results = await Marketplace.searchAgents(query)
      return c.json(results)
    },
  )
  .post(
    "/agents/install",
    describeRoute({
      summary: "Install agent from marketplace",
      description: "Install an agent from a marketplace source.",
      operationId: "marketplace.agents.install",
      responses: {
        200: {
          description: "Agent installed successfully",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  path: z.string(),
                }),
              ),
            },
          },
        },
        ...errors(400, 409),
      },
    }),
    validator(
      "json",
      z.object({
        source: MarketplaceSchema.Source,
        agentPath: z.string(),
        scope: z.enum(["global", "project"]),
        force: z.boolean().optional(),
      }),
    ),
    async (c) => {
      const { source, agentPath, scope, force } = c.req.valid("json")
      const path = await Marketplace.installAgent({ source, agentPath, scope, force })
      return c.json({ path })
    },
  )
  .delete(
    "/agents/uninstall",
    describeRoute({
      summary: "Uninstall marketplace agent",
      description: "Uninstall an agent that was installed from the marketplace.",
      operationId: "marketplace.agents.uninstall",
      responses: {
        200: {
          description: "Agent uninstalled successfully",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.literal(true) })),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "json",
      z.object({
        localPath: z.string(),
      }),
    ),
    async (c) => {
      const { localPath } = c.req.valid("json")
      await Marketplace.uninstallAgent(localPath)
      return c.json({ success: true as const })
    },
  )
  .post(
    "/refresh",
    describeRoute({
      summary: "Refresh marketplace sources",
      description: "Refresh all marketplace source registries.",
      operationId: "marketplace.refresh",
      responses: {
        200: {
          description: "Refresh results",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  success: z.array(z.string()),
                  failed: z.array(
                    z.object({
                      repo: z.string(),
                      error: z.string(),
                    }),
                  ),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const result = await Marketplace.refreshAllSources()
      return c.json(result)
    },
  )
  .get(
    "/auth",
    describeRoute({
      summary: "Check GitHub auth status",
      description: "Check if GitHub authentication is available for private repositories.",
      operationId: "marketplace.auth.status",
      responses: {
        200: {
          description: "Authentication status",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  authenticated: z.boolean(),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const authenticated = await Marketplace.hasGitHubAuth()
      return c.json({ authenticated })
    },
  )
