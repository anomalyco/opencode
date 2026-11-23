# integration

## GET /api/integration

Retrieve available integrations and their authentication methods.

Returns: `{ location: Location.PublicRef; data: Integration.Info[] }`

## GET /api/integration/{integrationID}

Retrieve one integration and its authentication methods.

Returns: `{ location: Location.PublicRef; data: Integration.Info }`

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
- `Form.When`: `{ key: string; op: "eq" | "neq"; value: string | number | boolean }`
- `Integration.CommandMethod`: `{ id: string; type: "command"; label: string; command: string[] }`
- `Integration.EnvMethod`: `{ type: "env"; names: string[] }`
- `Integration.ExternalMethod`: `{ id: string; type: "external"; label: string; form?: Form.Fields }`
- `Integration.Info`: `{ id: string; name: string; metadata?: Record<string, unknown>; methods: Integration.Method[]; connections: Connection.Info[] }`
- `Integration.KeyMethod`: `{ type: "key"; label?: string; form?: Form.Fields }`
- `Integration.Method`: `Integration.OAuthMethod | Integration.CommandMethod | Integration.KeyMethod | Integration.ExternalMethod | Integration.EnvMethod`
- `Integration.OAuthMethod`: `{ id: string; type: "oauth"; label: string; form?: Form.Fields }`
- `Location.PublicRef`: `{ directory: string }`
