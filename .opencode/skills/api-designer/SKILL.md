---
name: api-designer
description: Use when designing REST or GraphQL APIs, creating OpenAPI specifications, or planning API architecture. Invoke for resource modeling, versioning strategies, pagination patterns, error handling standards.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: api-architecture
  triggers: API design, REST API, OpenAPI, API specification, API architecture, resource modeling, API versioning, GraphQL schema, API documentation
  role: architect
  scope: design
  output-format: specification
  related-skills: graphql-architect, fastapi-expert, nestjs-expert, spring-boot-engineer, security-reviewer
---

# API Designer

Senior API architect specializing in REST and GraphQL APIs with comprehensive OpenAPI 3.1 specifications.

## Core Workflow

1. **Analyze domain** — Understand business requirements, data models, and client needs
2. **Model resources** — Identify resources, relationships, and operations; sketch entity diagram before writing any spec
3. **Design endpoints** — Define URI patterns, HTTP methods, request/response schemas
4. **Specify contract** — Create OpenAPI 3.1 spec; validate before proceeding: `npx @redocly/cli lint openapi.yaml`
5. **Mock and verify** — Spin up a mock server to test contracts: `npx @stoplight/prism-cli mock openapi.yaml`
6. **Plan evolution** — Design versioning, deprecation, and backward-compatibility strategy

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| REST Patterns | `references/rest-patterns.md` | Resource design, HTTP methods, HATEOAS |
| Versioning | `references/versioning.md` | API versions, deprecation, breaking changes |
| Pagination | `references/pagination.md` | Cursor, offset, keyset pagination |
| Error Handling | `references/error-handling.md` | Error responses, RFC 7807, status codes |
| OpenAPI | `references/openapi.md` | OpenAPI 3.1, documentation, code generation |

## Constraints

### MUST DO
- Follow REST principles (resource-oriented, proper HTTP methods)
- Use consistent naming conventions (snake_case or camelCase — pick one, apply everywhere)
- Include comprehensive OpenAPI 3.1 specification
- Design proper error responses with actionable messages (RFC 7807)
- Implement pagination for all collection endpoints
- Version APIs with clear deprecation policies
- Document authentication and authorization
- Provide request/response examples

### MUST NOT DO
- Use verbs in resource URIs (use `/users/{id}`, not `/getUser/{id}`)
- Return inconsistent response structures
- Skip error code documentation
- Ignore HTTP status code semantics
- Design APIs without a versioning strategy
- Expose implementation details in the API surface
- Create breaking changes without a migration path
- Omit rate limiting considerations

## Templates

### OpenAPI 3.1 Resource Endpoint (copy-paste starter)

```yaml
openapi: "3.1.0"
info:
  title: Example API
  version: "1.1.0"
paths:
  /users:
    get:
      summary: List users
      operationId: listUsers
      tags: [Users]
      parameters:
        - name: cursor
          in: query
          schema: { type: string }
          description: Opaque cursor for pagination
        - name: limit
          in: query
          schema: { type: integer, default: 20, maximum: 100 }
      responses:
        "200":
          description: Paginated list of users
          content:
            application/json:
              schema:
                type: object
                required: [data, pagination]
                properties:
                  data:
                    type: array
                    items: { $ref: "#/components/schemas/User" }
                  pagination:
                    $ref: "#/components/schemas/CursorPage"
        "400": { $ref: "#/components/responses/BadRequest" }
        "401": { $ref: "#/components/responses/Unauthorized" }
        "429": { $ref: "#/components/responses/TooManyRequests" }
  /users/{id}:
    get:
      summary: Get a user
      operationId: getUser
      tags: [Users]
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          description: User found
          content:
            application/json:
              schema: { $ref: "#/components/schemas/User" }
        "404": { $ref: "#/components/responses/NotFound" }

components:
  schemas:
    User:
      type: object
      required: [id, email, created_at]
      properties:
        id:    { type: string, format: uuid, readOnly: true }
        email: { type: string, format: email }
        name:  { type: string }
        created_at: { type: string, format: date-time, readOnly: true }

    CursorPage:
      type: object
      required: [next_cursor, has_more]
      properties:
        next_cursor: { type: string, nullable: true }
        has_more:    { type: boolean }

    Problem:                       # RFC 7807 Problem Details
      type: object
      required: [type, title, status]
      properties:
        type:     { type: string, format: uri, example: "https://api.example.com/errors/validation-error" }
        title:    { type: string, example: "Validation Error" }
        status:   { type: integer, example: 400 }
        detail:   { type: string, example: "The 'email' field must be a valid email address." }
        instance: { type: string, format: uri, example: "/users/req-abc123" }

  responses:
    BadRequest:
      description: Invalid request parameters
      content:
        application/problem+json:
          schema: { $ref: "#/components/schemas/Problem" }
    Unauthorized:
      description: Missing or invalid authentication
      content:
        application/problem+json:
          schema: { $ref: "#/components/schemas/Problem" }
    NotFound:
      description: Resource not found
      content:
        application/problem+json:
          schema: { $ref: "#/components/schemas/Problem" }
    TooManyRequests:
      description: Rate limit exceeded
      headers:
        Retry-After: { schema: { type: integer } }
      content:
        application/problem+json:
          schema: { $ref: "#/components/schemas/Problem" }

  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

security:
  - BearerAuth: []
```

### RFC 7807 Error Response (copy-paste)

```json
{
  "type": "https://api.example.com/errors/validation-error",
  "title": "Validation Error",
  "status": 422,
  "detail": "The 'email' field must be a valid email address.",
  "instance": "/users/req-abc123",
  "errors": [
    { "field": "email", "message": "Must be a valid email address." }
  ]
}
```

- Always use `Content-Type: application/problem+json` for error responses.
- `type` must be a stable, documented URI — never a generic string.
- `detail` must be human-readable and actionable.
- Extend with `errors[]` for field-level validation failures.

## Output Checklist

When delivering an API design, provide:
1. Resource model and relationships (diagram or table)
2. Endpoint specifications with URIs and HTTP methods
3. OpenAPI 3.1 specification (YAML)
4. Authentication and authorization flows
5. Error response catalog (all 4xx/5xx with `type` URIs)
6. Pagination and filtering patterns
7. Versioning and deprecation strategy
8. Validation result: `npx @redocly/cli lint openapi.yaml` passes with no errors

## Knowledge Reference

REST architecture, OpenAPI 3.1, GraphQL, HTTP semantics, JSON:API, HATEOAS, OAuth 2.0, JWT, RFC 7807 Problem Details, API versioning patterns, pagination strategies, rate limiting, webhook design, SDK generation

[Documentation](https://jeffallan.github.io/claude-skills/skills/api-architecture/api-designer/)
