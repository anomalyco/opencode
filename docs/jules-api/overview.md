# API Reference

> Source: https://jules.google/docs/api/reference/overview

The Jules REST API allows you to programmatically create and manage coding sessions, monitor progress, and retrieve results. This reference documents all available endpoints, request/response formats, and data types.

## Base URL

All API requests should be made to:

```
https://jules.googleapis.com/v1alpha
```

## Authentication

The Jules REST API uses API keys for authentication. Get your API key from [jules.google.com/settings](https://jules.google.com/settings).

```bash
curl -H "x-goog-api-key: $JULES_API_KEY" \
  https://jules.googleapis.com/v1alpha/sessions
```

See the [Authentication Guide](https://jules.google/docs/api/reference/authentication) for details.

## Endpoints

| Resource | Documentation |
|----------|--------------|
| Sessions | [Sessions](https://jules.google/docs/api/reference/sessions) |
| Activities | [Activities](https://jules.google/docs/api/reference/activities) |
| Sources | [Sources](https://jules.google/docs/api/reference/sources) |
| Types | [Types](https://jules.google/docs/api/reference/types) |

## Common Patterns

### Pagination

List endpoints support pagination using `pageSize` and `pageToken` parameters:

```bash
# First page
curl -H "x-goog-api-key: $JULES_API_KEY" \
  "https://jules.googleapis.com/v1alpha/sessions?pageSize=10"

# Next page (using token from previous response)
curl -H "x-goog-api-key: $JULES_API_KEY" \
  "https://jules.googleapis.com/v1alpha/sessions?pageSize=10&pageToken=NEXT_PAGE_TOKEN"
```

### Resource Names

Resources use hierarchical names following Google API conventions:

- **Sessions**: `sessions/{sessionId}`
- **Activities**: `sessions/{sessionId}/activities/{activityId}`
- **Sources**: `sources/{sourceId}`

### Error Handling

The API returns standard HTTP status codes:

| Code | Meaning |
|------|---------|
| `200` | Success |
| `400` | Bad Request |
| `401` | Unauthorized |
| `403` | Forbidden |
| `404` | Not Found |
| `429` | Too Many Requests |
| `500` | Internal Server Error |

Error responses include a JSON body with details:

```json
{
  "error": {
    "code": 400,
    "message": "Invalid session ID format",
    "status": "INVALID_ARGUMENT"
  }
}
```
