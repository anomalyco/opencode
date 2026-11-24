# form

## GET /api/form

Retrieve pending forms for a location.

Returns: `{ location: Location.PublicRef; data: Form.Info[] }`

## Types

- `Form.BooleanField`: `{ key: string; title?: string; description?: string; required?: boolean; hidden?: boolean; when?: Form.When[]; type: "boolean"; default?: boolean }`
- `Form.ExternalField`: `{ key: string; type: "external"; url: string; title?: string; description?: string }`
- `Form.Field`: `Form.StringField | Form.NumberField | Form.IntegerField | Form.BooleanField | Form.MultiselectField | Form.ExternalField`
- `Form.Fields`: `Form.Field[]`
- `Form.Info`: `{ id: string; sessionID: string; title: string; metadata?: Record<string, unknown>; fields: Form.Fields }`
- `Form.IntegerField`: `{ key: string; title?: string; description?: string; required?: boolean; hidden?: boolean; when?: Form.When[]; type: "integer"; minimum?: number; maximum?: number; default?: number }`
- `Form.MultiselectField`: `{ key: string; title?: string; description?: string; required?: boolean; hidden?: boolean; when?: Form.When[]; type: "multiselect"; options: Form.Option[]; minItems?: number; maxItems?: number; custom?: boolean; default?: string[] }`
- `Form.NumberField`: `{ key: string; title?: string; description?: string; required?: boolean; hidden?: boolean; when?: Form.When[]; type: "number"; minimum?: number; maximum?: number; default?: number }`
- `Form.Option`: `{ value: string; label: string; description?: string }`
- `Form.StringField`: `{ key, title, description, required, hidden, when, type, format, minLength, maxLength, pattern, placeholder, default, options, custom }`
- `Form.When`: `{ key: string; op: "eq" | "neq"; value: string | number | boolean }`
- `Location.PublicRef`: `{ directory: string }`
