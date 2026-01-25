import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { Account } from "../../account"
import { lazy } from "../../util/lazy"

export const AccountRoutes = lazy(() =>
  new Hono().get(
    "/",
    describeRoute({
      summary: "List all accounts",
      description: "Get all configured authentication accounts including core auth and multi-account plugin entries.",
      operationId: "account.list",
      responses: {
        200: {
          description: "List of accounts",
          content: {
            "application/json": {
              schema: resolver(Account.Entry.array()),
            },
          },
        },
      },
    }),
    async (c) => {
      const accounts = await Account.list()
      return c.json(accounts)
    },
  ),
)
