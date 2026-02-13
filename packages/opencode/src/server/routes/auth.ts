import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { GoogleAuth } from "../../auth/google"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const AuthRoutes = lazy(() =>
    new Hono().post(
        "/google/browser",
        describeRoute({
            summary: "Google browser OAuth",
            description: "Initiate browser-based OAuth flow for Google authentication",
            operationId: "auth.google.browser",
            responses: {
                200: {
                    description: "OAuth flow completed successfully",
                    content: {
                        "application/json": {
                            schema: resolver(
                                z.object({
                                    success: z.boolean(),
                                }),
                            ),
                        },
                    },
                },
                ...errors(400, 500),
            },
        }),
        async (c) => {
            try {
                const origin = new URL(c.req.url).origin
                await GoogleAuth.loginWeb(origin)
                return c.json({ success: true })
            } catch (error) {
                return c.json(
                    {
                        success: false,
                        error: error instanceof Error ? error.message : "Authentication failed",
                    },
                    500,
                )
            }
        },
    ),
)
