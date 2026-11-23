# websearch

## GET /api/websearch/provider

Return the registered web search providers.

Returns: `{ location: Location.PublicRef; data: WebSearch.Provider[] }`

## POST /api/websearch

Run one web search through the selected provider. Specify a provider to override the configured default.

Body:
- `query: string`
- `providerID?: string`

Returns: `{ location: Location.PublicRef; data: WebSearch.ResponseEncoded }`

## Types

- `Location.PublicRef`: `{ directory: string }`
- `WebSearch.Provider`: `{ id: string; name: string }`
- `WebSearch.ResponseEncoded`: `{ providerID: string; results: WebSearch.Result[] }`
- `WebSearch.Result`: `{ url: string; title?: string; content?: string; time: { published } }`
