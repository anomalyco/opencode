# integration

## GET /api/integration

Retrieve available integrations and their authentication methods.

Returns: `{ location: Location.PublicRef; data: Integration.Info[] }`

## GET /api/integration/{integrationID}

Retrieve one integration and its authentication methods.

Returns: `{ location: Location.PublicRef; data: Integration.Info }`

## POST /api/experimental/integration/wellknown (experimental)

Discover and persist an experimental wellknown integration source.

Body:
- `url: string`

Returns: nothing

## POST /api/integration/{integrationID}/connect/key

Run a key authentication method and store the resulting credential.

Body:
- `key: string`
- `answer?: Record<string, Form.Value>`
- `label?: string`

Returns: nothing

## POST /api/integration/{integrationID}/connect/external

Run an external authentication method and store a reference to its credential source.

Body:
- `methodID: string`
- `answer?: Record<string, Form.Value>`
- `label?: string`

Returns: nothing

## POST /api/integration/{integrationID}/connect/oauth

Start an OAuth attempt and return the authorization details.

Body:
- `methodID: string`
- `answer?: Record<string, Form.Value>`
- `label?: string`

Returns: `{ location: Location.PublicRef; data: Integration.AttemptEncoded }`

## GET /api/integration/{integrationID}/connect/oauth/{attemptID}

Poll the current status of an OAuth attempt.

Returns: `{ location: Location.PublicRef; data: Integration.AttemptStatus }`

## DELETE /api/integration/{integrationID}/connect/oauth/{attemptID}

Cancel an OAuth attempt and release its resources.

Returns: nothing

## POST /api/integration/{integrationID}/connect/oauth/{attemptID}/complete

Complete a code-based OAuth attempt and store the resulting credential. For an automatic attempt with `paste`, `code` is the redirect URL copied from the browser, and the result arrives through the attempt status.

Body:
- `code?: string`

Returns: nothing

## POST /api/integration/{integrationID}/connect/command

Start a command authentication attempt.

Body:
- `methodID: string`
- `label?: string`

Returns: `{ location: Location.PublicRef; data: Integration.CommandAttempt }`

## GET /api/integration/{integrationID}/connect/command/{attemptID}

Poll the current status and output of a command authentication attempt.

Returns: `{ location: Location.PublicRef; data: Integration.CommandAttemptStatus }`

## DELETE /api/integration/{integrationID}/connect/command/{attemptID}

Cancel a command authentication attempt and terminate its process.

Returns: nothing

## Types

- `Connection.CredentialInfo`: `{ type: "credential"; id: string; label: string; method: "key" | "oauth" | "external"; status?: Connection.Status }`
- `Connection.EnvInfo`: `{ type: "env"; name: string; status?: Connection.Status }`
- `Connection.Info`: `Connection.CredentialInfo | Connection.EnvInfo`
- `Connection.Status`: `{ status: "needs_auth"; message: string; url?: string }`
- `Form.BooleanField`: `{ key: string; title?: string; description?: string; required?: boolean; hidden?: boolean; when?: Form.When[]; type: "boolean"; default?: boolean }`
- `Form.ExternalField`: `{ key: string; type: "external"; url: string; title?: string; description?: string }`
- `Form.Field`: `Form.StringField | Form.NumberField | Form.IntegerField | Form.BooleanField | Form.MultiselectField | Form.ExternalField`
- `Form.Fields`: `Form.Field[]`
- `Form.IntegerField`: `{ key: string; title?: string; description?: string; required?: boolean; hidden?: boolean; when?: Form.When[]; type: "integer"; minimum?: number; maximum?: number; default?: number }`
- `Form.MultiselectField`: `{ key: string; title?: string; description?: string; required?: boolean; hidden?: boolean; when?: Form.When[]; type: "multiselect"; options: Form.Option[]; minItems?: number; maxItems?: number; custom?: boolean; default?: string[] }`
- `Form.NumberField`: `{ key: string; title?: string; description?: string; required?: boolean; hidden?: boolean; when?: Form.When[]; type: "number"; minimum?: number; maximum?: number; default?: number }`
- `Form.Option`: `{ value: string; label: string; description?: string }`
- `Form.StringField`: `{ key, title, description, required, hidden, when, type, format, minLength, maxLength, pattern, placeholder, default, options, custom }`
- `Form.Value`: `string | number | boolean | string[]`
- `Form.When`: `{ key: string; op: "eq" | "neq"; value: string | number | boolean }`
- `Integration.AttemptEncoded`: `{ attemptID: string; url: string; instructions: string; mode: "auto" | "code"; paste?: true; time: { created, expires } }`
- `Integration.AttemptStatus`: `{ status: "pending"; time: { created, expires } } | { status: "complete"; time: { created, expires } } | { status: "failed"; message: string; time: { created, expires } } | { status: "expired"; time: { created, expires } }`
- `Integration.CommandAttempt`: `{ attemptID: string; time: { created, expires } }`
- `Integration.CommandAttemptStatus`: `{ status: "pending"; message?: string; time: { created, expires } } | { status: "complete"; time: { created, expires } } | { status: "failed"; message: string; time: { created, expires } } | { status: "expired"; time: { created, expires } }`
- `Integration.CommandMethod`: `{ id: string; type: "command"; label: string; command: string[] }`
- `Integration.EnvMethod`: `{ type: "env"; names: string[] }`
- `Integration.ExternalMethod`: `{ id: string; type: "external"; label: string; form?: Form.Fields }`
- `Integration.Info`: `{ id: string; name: string; metadata?: Record<string, unknown>; methods: Integration.Method[]; connections: Connection.Info[] }`
- `Integration.KeyMethod`: `{ type: "key"; label?: string; form?: Form.Fields }`
- `Integration.Method`: `Integration.OAuthMethod | Integration.CommandMethod | Integration.KeyMethod | Integration.ExternalMethod | Integration.EnvMethod`
- `Integration.OAuthMethod`: `{ id: string; type: "oauth"; label: string; form?: Form.Fields }`
- `Location.PublicRef`: `{ directory: string }`
