# provider

## GET /api/provider

Retrieve active AI providers so clients can show provider availability and configuration.

Returns: `{ location: Location.PublicRef; data: Provider.Info[] }`

## GET /api/provider/{providerID}

Retrieve a single AI provider so clients can inspect its availability and endpoint settings.

Returns: `{ location: Location.PublicRef; data: Provider.Info }`

## Types

- `Location.PublicRef`: `{ directory: string }`
- `Provider.Info`: `{ id, canonical, integrationID, name, activation, package, compatibility, settings, headers, body }`
