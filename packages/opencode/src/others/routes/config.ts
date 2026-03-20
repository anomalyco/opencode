/**
 * Others 配置路由
 * 用于获取和更新 others.json 配置
 */
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { OthersConfigService, OthersConfig } from "../config"
import { lazy } from "@/util/lazy"
import { errors } from "@/server/error"

export const OthersConfigRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get others configuration",
        description: "Retrieve the current others configuration settings for UI element visibility.",
        operationId: "others.config.get",
        responses: {
          200: {
            description: "Get others config",
            content: {
              "application/json": {
                schema: resolver(OthersConfig),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await OthersConfigService.get()
        return c.json(config)
      },
    )
    .patch(
      "/",
      describeRoute({
        summary: "Update others configuration",
        description: "Update others configuration settings for UI element visibility.",
        operationId: "others.config.update",
        responses: {
          200: {
            description: "Successfully updated others config",
            content: {
              "application/json": {
                schema: resolver(OthersConfig),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", OthersConfig),
      async (c) => {
        const config = c.req.valid("json")
        const updated = await OthersConfigService.update(config)
        return c.json(updated)
      },
    ),
)
