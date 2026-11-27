# session/form

## GET /api/session/{sessionID}/form

Retrieve pending forms for a session.

Returns: `{ data: Form.Info[] }`

## GET /api/session/{sessionID}/form/{formID}

Retrieve a form and its current state for a session.

Returns: `{ data: Form.Detail }`

## POST /api/session/{sessionID}/form/{formID}/reply

Submit an answer to a pending form.

Body:
- `answer: Record<string, Form.Value>`

Returns: nothing

## Types

- `Form.BooleanField`: `{ key: string; title?: string; description?: string; required?: boolean; hidden?: boolean; when?: Form.When[]; type: "boolean"; default?: boolean }`
- `Form.Detail`: `{ id: string; sessionID: string; title: string; metadata?: Record<string, unknown>; fields: Form.Fields; state: Form.State }`
- `Form.ExternalField`: `{ key: string; type: "external"; url: string; title?: string; description?: string }`
- `Form.Field`: `Form.StringField | Form.NumberField | Form.IntegerField | Form.BooleanField | Form.MultiselectField | Form.ExternalField`
- `Form.Fields`: `Form.Field[]`
- `Form.Info`: `{ id: string; sessionID: string; title: string; metadata?: Record<string, unknown>; fields: Form.Fields }`
- `Form.IntegerField`: `{ key: string; title?: string; description?: string; required?: boolean; hidden?: boolean; when?: Form.When[]; type: "integer"; minimum?: number; maximum?: number; default?: number }`
- `Form.MultiselectField`: `{ key: string; title?: string; description?: string; required?: boolean; hidden?: boolean; when?: Form.When[]; type: "multiselect"; options: Form.Option[]; minItems?: number; maxItems?: number; custom?: boolean; default?: string[] }`
- `Form.NumberField`: `{ key: string; title?: string; description?: string; required?: boolean; hidden?: boolean; when?: Form.When[]; type: "number"; minimum?: number; maximum?: number; default?: number }`
- `Form.Option`: `{ value: string; label: string; description?: string }`
- `Form.State`: `{ status: "pending" } | { status: "answered"; answer: Record<string, Form.Value> } | { status: "cancelled"; message?: string }`
- `Form.StringField`: `{ key, title, description, required, hidden, when, type, format, minLength, maxLength, pattern, placeholder, default, options, custom }`
- `Form.Value`: `string | number | boolean | string[]`
- `Form.When`: `{ key: string; op: "eq" | "neq"; value: string | number | boolean }`
