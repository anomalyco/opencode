## MODIFIED Requirements
### Requirement: SAP AI Core Observability
Minimal telemetry MUST be emitted for initialization and model usage.

#### Scenario: Init Log
- **WHEN** provider successfully loads
- **THEN** log entry with `{ service:"provider", providerID:"sap-ai-core", event:"init" }`

#### Scenario: Model Call Timing
- **WHEN** model call completes
- **THEN** timing logged with duration ms and success boolean (`success=true` on ok responses, `success=false` on errors)
