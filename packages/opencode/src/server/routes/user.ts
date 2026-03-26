import { HostedAuth } from "@/hosted/auth"
import { HostedUser } from "@/hosted/user"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { lazy } from "@/util/lazy"
import z from "zod"

const Me = z
  .object({
    enabled: z.boolean(),
    user: HostedUser.Info.optional(),
  })
  .meta({
    ref: "HostedMe",
  })

export const UserRoutes = lazy(() =>
  new Hono()
    .get(
      "/me",
      describeRoute({
        summary: "Get hosted auth status",
        operationId: "user.me",
        responses: {
          200: {
            description: "Hosted auth status",
            content: {
              "application/json": {
                schema: resolver(Me),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(HostedAuth.status())
      },
    )
    .post(
      "/login",
      describeRoute({
        summary: "Login hosted user",
        operationId: "user.login",
        responses: {
          200: {
            description: "Logged in user",
            content: {
              "application/json": {
                schema: resolver(HostedUser.Info),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          email: z.string().email(),
          password: z.string().min(8),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const user = await HostedAuth.login(c, body)
        return c.json(user)
      },
    )
    .post(
      "/logout",
      describeRoute({
        summary: "Logout hosted user",
        operationId: "user.logout",
        responses: {
          200: {
            description: "Logged out",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await HostedAuth.logout(c)
        return c.json(true)
      },
    )
    .get(
      "/",
      describeRoute({
        summary: "List hosted users",
        operationId: "user.list",
        responses: {
          200: {
            description: "Hosted users",
            content: {
              "application/json": {
                schema: resolver(HostedUser.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        HostedAuth.requireAdmin()
        return c.json(await HostedUser.list())
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create hosted user",
        operationId: "user.create",
        responses: {
          200: {
            description: "Created hosted user",
            content: {
              "application/json": {
                schema: resolver(HostedUser.Info),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          email: z.string().email(),
          password: z.string().min(8),
          role: HostedUser.Role.default("member"),
        }),
      ),
      async (c) => {
        HostedAuth.requireAdmin()
        const body = c.req.valid("json")
        return c.json(await HostedUser.create(body))
      },
    )
    .patch(
      "/:userID",
      describeRoute({
        summary: "Update hosted user",
        operationId: "user.update",
        responses: {
          200: {
            description: "Updated hosted user",
            content: {
              "application/json": {
                schema: resolver(HostedUser.Info),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          userID: HostedUser.Info.shape.id,
        }),
      ),
      validator(
        "json",
        z.object({
          role: HostedUser.Role.optional(),
          disabled: z.boolean().optional(),
        }),
      ),
      async (c) => {
        HostedAuth.requireAdmin()
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        return c.json(await HostedUser.update({ userID: param.userID, ...body }))
      },
    ),
)
