import { z } from "zod"

export class SalesforceCliError extends Error {
  constructor(readonly code: string) {
    super(`Salesforce request failed: ${code}`)
  }
}

export function salesforceCliResponse(output: string) {
  const response = z
    .object({
      status: z.number(),
      result: z.object({ statusCode: z.number().int(), body: z.unknown() }).optional(),
    })
    .parse(JSON.parse(output))
  if (!response.result) throw new SalesforceCliError("CLI_ERROR")
  if (response.status !== 0 || response.result.statusCode < 200 || response.result.statusCode > 299) {
    const errors = z
      .array(z.object({ errorCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/) }))
      .safeParse(response.result.body)
    throw new SalesforceCliError(errors.success ? (errors.data[0]?.errorCode ?? "REQUEST_FAILED") : "REQUEST_FAILED")
  }
  return response.result.body
}
