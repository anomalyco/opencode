# OpenCode JSON Schemas

This directory contains JSON Schema definitions for OpenCode's Provider and Model APIs. These schemas serve as the **canonical source of truth** for API contracts, enabling type-safe client generation across multiple languages.

## Overview

OpenCode uses JSON Schema (draft-07) to define its API types, following the pattern used by specifications like Khronos glTF, OpenAPI, and Kubernetes. This approach provides:

- **Language-agnostic contracts** - Generate type-safe bindings for TypeScript, Rust, Python, C#, etc.
- **Formal specification** - Machine-readable API documentation
- **Versioning support** - Track breaking changes and schema evolution
- **Validation** - Ensure data correctness at runtime

## Schema Files

The following 21 schemas define the complete Provider and Model API:

### Core Schemas
- `providerInfo.schema.json` - Provider metadata and configuration
- `modelInfo.schema.json` - Complete model metadata with capabilities, pricing, and limits

### Model Components
- `modelAPI.schema.json` - API endpoint configuration
- `modelCapabilities.schema.json` - Feature flags (temperature, reasoning, tool calls, etc.)
- `modelCost.schema.json` - Pricing per token with cache costs
- `modelLimits.schema.json` - Context window and output limits
- `modelStatus.schema.json` - Lifecycle status (alpha, beta, active, deprecated)
- `modelOptions.schema.json` - Runtime configuration options
- `modelSelection.schema.json` - Model selection preferences

### Provider Components
- `providerSource.schema.json` - Provider origin (env, config, custom, API)
- `providerOptions.schema.json` - Provider-specific options
- `providerList.schema.json` - Collection of providers

### Options & Configuration
- `anthropicOptions.schema.json` - Anthropic-specific options
- `googleOptions.schema.json` - Google-specific options
- `openaiOptions.schema.json` - OpenAI-specific options
- `universalOptions.schema.json` - Universal options (all providers)
- `thinkingConfig.schema.json` - Thinking/reasoning configuration
- `thinkingOptions.schema.json` - Thinking budget and effort settings

### Supporting Schemas
- `ioCapabilities.schema.json` - Input/output modality capabilities
- `cacheCost.schema.json` - Cache read/write pricing
- `experimentalPricing.schema.json` - Over-200K token pricing

## Workflow

### Editing Schemas

1. Edit JSON Schema files directly in this directory
2. Validate schemas: `bun run generate:schemas`
3. Review generated TypeScript validators in `packages/opencode/generated/validators/`
4. Run tests: `bun run typecheck` and `bun test`

### Code Generation

The build system automatically generates TypeScript types and Zod validators from these schemas:

```bash
# Generate validators only
bun run generate:schemas

# Full generation (schemas + SDK + OpenAPI)
bun run generate
```

Generated files are located at:
- `packages/opencode/generated/validators/*.ts` - Zod validators and TypeScript types

**Note:** Generated files are gitignored - they're build artifacts, not source code.

### Build Integration

Schema generation is integrated with Turborepo:

```bash
# Typecheck (runs schema generation first)
bun run typecheck

# Build (includes schema generation)
bun turbo build

# Test (includes schema generation)
bun turbo opencode#test
```

## Schema Conventions

### Structure

All schemas follow these conventions:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://opencode.ai/schemas/v1/<name>.json",
  "$comment": "Source: <original TypeScript file>",
  "title": "<TypeName>",
  "description": "<Brief description>",
  "type": "object",
  "required": ["field1", "field2"],
  "properties": {
    "field1": {
      "type": "string",
      "description": "Field description",
      "examples": ["example1", "example2"]
    }
  }
}
```

### Cross-References

Use relative file paths for `$ref`:

```json
{
  "api": {
    "$ref": "modelAPI.schema.json"
  }
}
```

### Custom Extensions

Use `x-` prefix for custom metadata:

```json
{
  "x-design-notes": {
    "key-concept": "Explanation of design decision"
  }
}
```

## Validation

Schemas are validated using AJV with these rules:

- All schemas must be valid JSON Schema draft-07
- All `$ref` references must resolve
- All `$id` URLs must follow the pattern: `https://opencode.ai/schemas/v1/<name>.json`
- Custom `x-` extensions are allowed
- Examples must validate against their schemas

## VSCode Support

Add to `.vscode/settings.json` for auto-complete and validation:

```json
{
  "json.schemas": [
    {
      "fileMatch": ["schema/*.schema.json"],
      "url": "http://json-schema.org/draft-07/schema#"
    }
  ]
}
```

## External Client Generation

### Rust (Tauri, CLI)

Use `schemars` or `typify`:

```bash
# Coming soon
```

### Python

Use `datamodel-code-generator`:

```bash
# Coming soon
```

### C# (Blazor)

Use `NJsonSchema`:

```bash
# Coming soon
```

## Versioning

Schemas use semantic versioning:

- **Major version** (`v1`, `v2`) - Breaking changes (field removal, type change, required additions)
- **Minor version** - Non-breaking additions (new optional fields)
- **Patch version** - Documentation updates, examples, clarifications

Current version: `v1` (all schemas)

## Contributing

When modifying schemas:

1. **Non-breaking changes** are preferred (add optional fields, not required ones)
2. **Breaking changes** require discussion and migration plan
3. **Document changes** in schema `$comment` field
4. **Update examples** to reflect new fields
5. **Run validation** before committing

## FAQ

**Q: Why JSON Schema instead of TypeScript types?**  
A: JSON Schema is language-agnostic. TypeScript types can't be consumed by Rust, Python, or C# clients. With JSON Schema, all languages generate from the same source of truth.

**Q: Why are generated files gitignored?**  
A: They're build artifacts, like `dist/`. This keeps git history clean and avoids merge conflicts. Turborepo caching ensures fast regeneration.

**Q: Can I modify generated files?**  
A: No. Edit the JSON Schemas, then regenerate. Generated files are overwritten on every build.

**Q: How do I add a new schema?**  
A: Create `<name>.schema.json` in this directory, then run `bun run generate:schemas`. The generator will automatically include it.

## References

- [JSON Schema Specification](https://json-schema.org/draft-07/schema)
- [Understanding JSON Schema](https://json-schema.org/understanding-json-schema/)
- [JSON Schema Validator](https://www.jsonschemavalidator.net/)
- [Khronos glTF Specification](https://github.com/KhronosGroup/glTF/tree/main/specification) - Reference example

---

**Last Updated:** 2026-01-04  
**Schema Version:** v1
