import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { getCookie } from "hono/cookie"
import z from "zod"
import { UserSession } from "../../session/user-session"
import { clearSessionCookie, type AuthEnv } from "../middleware/auth"
import { lazy } from "../../util/lazy"

/**
 * Auth routes for session management.
 *
 * - POST /logout - Logout current session
 * - POST /logout/all - Logout all sessions for user
 * - GET /session - Get current session info
 */
export const AuthRoutes = lazy(() =>
  new Hono<AuthEnv>()
    .post(
      "/logout",
      describeRoute({
        summary: "Logout current session",
        description: "Clear the current session and redirect to login page.",
        operationId: "auth.logout",
        responses: {
          302: {
            description: "Redirect to login page",
          },
        },
      }),
      async (c) => {
        const sessionId = getCookie(c, "opencode_session")
        if (sessionId) {
          UserSession.remove(sessionId)
        }
        clearSessionCookie(c)
        return c.redirect("/login")
      },
    )
    .post(
      "/logout/all",
      describeRoute({
        summary: "Logout all sessions",
        description: "Clear all sessions for the current user and redirect to login page.",
        operationId: "auth.logoutAll",
        responses: {
          302: {
            description: "Redirect to login page",
          },
        },
      }),
      async (c) => {
        const session = c.get("session")
        if (session) {
          UserSession.removeAllForUser(session.username)
        }
        clearSessionCookie(c)
        return c.redirect("/login")
      },
    )
    .get(
      "/session",
      describeRoute({
        summary: "Get current session",
        description: "Retrieve information about the current authenticated session.",
        operationId: "auth.session",
        responses: {
          200: {
            description: "Current session info",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    id: z.string(),
                    username: z.string(),
                    createdAt: z.number(),
                    lastAccessTime: z.number(),
                  }),
                ),
              },
            },
          },
          401: {
            description: "Not authenticated",
          },
        },
      }),
      async (c) => {
        const session = c.get("session")
        if (!session) {
          return c.json({ error: "Not authenticated" }, 401)
        }
        return c.json({
          id: session.id,
          username: session.username,
          createdAt: session.createdAt,
          lastAccessTime: session.lastAccessTime,
        })
      },
    ),
)
