import { resolver } from "hono-openapi"
import z from "zod"

const errorSchema = z.object({ error: z.string() })

const descriptions: Record<number, string> = {
  400: "Bad Request",
  404: "Not Found",
  500: "Internal Server Error",
}

export function errors(...codes: number[]) {
  return Object.fromEntries(
    codes.map((code) => [
      code,
      {
        description: descriptions[code] ?? "Error",
        content: {
          "application/json": {
            schema: resolver(errorSchema),
          },
        },
      },
    ]),
  )
}
