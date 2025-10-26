# schema-validation Specification

## Purpose
TBD - created by archiving change update-zod-imports. Update Purpose after archive.
## Requirements
### Requirement: Unified Zod Import Path

The system SHALL use only the root `zod` import path for all runtime and type imports.

#### Scenario: Import migration

- **WHEN** building any module referencing Zod
- **THEN** no import string includes `zod/v4` or `zod/v4/core`

### Requirement: JSON Schema Generation

The system SHALL generate JSON Schema via `z.toJSONSchema` without relying on internal Zod core types.

#### Scenario: Config schema generation

- **WHEN** running `packages/opencode/script/schema.ts`
- **THEN** the resulting schema uses only standard JSON Schema constructs.

