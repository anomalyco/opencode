import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { Brand } from "../brand"
import { z } from "zod"
import { errors } from "./error"

// Create a new Hono instance for Brand routes
export const BrandRoute = new Hono()

BrandRoute.get(
    "/",
    describeRoute({
        summary: "Get Brand Context",
        description: "Retrieve the current brand context object for the project.",
        operationId: "brand.get",
        responses: {
            200: {
                description: "Brand Context",
                content: {
                    "application/json": {
                        schema: resolver(Brand.Context.nullable()),
                    },
                },
            },
        },
    }),
    async (c) => {
        const context = await Brand.get()
        return c.json(context)
    }
)

BrandRoute.post(
    "/",
    describeRoute({
        summary: "Create Brand Context",
        description: "Initialize a new brand context.",
        operationId: "brand.create",
        responses: {
            200: {
                description: "Created Context",
                content: {
                    "application/json": {
                        schema: resolver(Brand.Context),
                    },
                },
            },
        },
    }),
    validator("json", z.object({ name: z.string().optional() })),
    async (c) => {
        const input = c.req.valid("json")
        const context = await Brand.create(input)
        return c.json(context)
    }
)

BrandRoute.post(
    "/approve",
    describeRoute({
        summary: "Approve Brand Context",
        description: "Lock the brand context as the source of truth.",
        operationId: "brand.approve",
        responses: {
            200: {
                description: "Approved Context",
                content: {
                    "application/json": {
                        schema: resolver(Brand.Context),
                    },
                },
            },
            ...errors(400),
        },
    }),
    async (c) => {
        const context = await Brand.approve()
        return c.json(context)
    }
)

// TODO: Implement Asset Upload Route (requires multipart handling)
