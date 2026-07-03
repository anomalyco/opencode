export const methods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"])
export const parameterLocations = new Set(["path", "query", "header"])

// OpenAPI: header parameters with these names SHALL be ignored.
export const ignoredHeaderParameters = new Set(["accept", "content-type", "authorization"])
export const schemeTypes = new Set(["apiKey", "http", "oauth2", "openIdConnect"])
export const blockedOperationNames = new Set(["__proto__", "constructor", "prototype"])
export const maxErrorBodyChars = 1_024

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const asArray = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : [])

export const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined

// Guards record lookups keyed by spec- or model-controlled names against
// prototype-inherited values (e.g. a parameter named `toString`).
export const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined
