import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"
import type { Definition, JsonSchema } from "../tool.js"

/** A parsed OpenAPI 3.x document. YAML must be parsed by the host. */
export type Document = Record<string, unknown>

/** The operation identity handed to auth resolution and errors. */
export type Operation = {
  readonly operationId: string | undefined
  readonly method: string
  readonly path: string
  readonly summary: string | undefined
  readonly description: string | undefined
}

/** A resolved OpenAPI security scheme from `components.securitySchemes`. */
export type SecurityScheme =
  | { readonly type: "apiKey"; readonly name: string; readonly in: "header" | "query" | "cookie" }
  | { readonly type: "http"; readonly scheme: string }
  | { readonly type: "oauth2" }
  | { readonly type: "openIdConnect" }

/**
 * Credential material returned by a host auth resolver. `apiKey` uses the scheme's carrier;
 * `header` supports nonstandard schemes.
 */
export type Credential =
  | { readonly type: "bearer"; readonly token: string }
  | { readonly type: "basic"; readonly username: string; readonly password: string }
  | { readonly type: "apiKey"; readonly value: string }
  | { readonly type: "header"; readonly name: string; readonly value: string }

/**
 * Resolves credentials at call time. `undefined` tries the next OR alternative; failure aborts.
 */
export type AuthResolver = (context: {
  readonly name: string
  readonly definition: SecurityScheme
  readonly scopes: ReadonlyArray<string>
  readonly operation: Operation
}) => Effect.Effect<Credential | undefined, unknown>

export type Options = {
  readonly spec: Document
  /** Overrides all document, path, and operation `servers`. Required when no applicable absolute server URL exists. */
  readonly baseUrl?: string | undefined
  /** Host credential resolution, keyed by security scheme name. */
  readonly auth?: { readonly resolve: AuthResolver } | undefined
  /** Static headers on every request. Not model-visible; declared header params may override them, auth always wins. */
  readonly headers?: Readonly<Record<string, string>> | undefined
}

/** An operation that could not be represented as a tool, and why. */
export type Skipped = {
  readonly method: string
  readonly path: string
  readonly reason: string
}

export type Tools = { [name: string]: Definition<HttpClient.HttpClient> | Tools }

export type Result = {
  /** Tool subtree; the host places it under a key in its `tools` tree. */
  readonly tools: Tools
  readonly skipped: ReadonlyArray<Skipped>
}

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string }

export type InputLocation = "path" | "query" | "header" | "body"

export type InputField = {
  readonly inputName: string
  readonly name: string
  readonly location: InputLocation
  readonly required: boolean
  readonly schema: JsonSchema
  readonly style: "simple" | "form" | "deepObject" | undefined
  readonly explode: boolean | undefined
}

export type Body = { readonly required: boolean; readonly mode: "object" | "value"; readonly mediaType: string }

export type OperationInput = {
  readonly fields: ReadonlyArray<InputField>
  readonly body: Body | undefined
}

export type SecurityRequirement = Readonly<Record<string, ReadonlyArray<string>>>

export type Plan = {
  readonly operation: Operation
  readonly url: string
  readonly fields: ReadonlyArray<InputField>
  readonly body: Body | undefined
  readonly security: ReadonlyArray<SecurityRequirement>
  readonly schemes: Readonly<Record<string, SecurityScheme>>
  readonly auth: { readonly resolve: AuthResolver } | undefined
  readonly headers: Readonly<Record<string, string>>
}

export type AppliedAuth = {
  readonly headers: Readonly<Record<string, string>>
  readonly query: Readonly<Record<string, string>>
}
