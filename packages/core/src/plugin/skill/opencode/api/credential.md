# credential

## GET /api/credential

List every stored integration credential, including its secret value.

Returns: `{ data: Credential.Entry[] }`

## Types

- `Credential.Entry`: `{ id: string; integrationID: string; label: string; active: boolean; value: Credential.Value }`
- `Credential.External`: `{ type: "external"; methodID: string; metadata?: Record<string, unknown> }`
- `Credential.Key`: `{ type: "key"; key: string; metadata?: Record<string, unknown> }`
- `Credential.OAuth`: `{ type: "oauth"; methodID: string; refresh: string; access: string; expires: number; metadata?: Record<string, unknown> }`
- `Credential.Value`: `Credential.OAuth | Credential.Key | Credential.External`
