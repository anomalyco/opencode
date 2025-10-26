## Why
Incorrect use of timing API caused missing success flag and improper error handling for SAP AI Core provider calls. Need to standardize timing logging and add success boolean without breaking existing behavior.

## What Changes
- Add success field to provider call telemetry
- Replace improper async usage of log.time with explicit stop() invocation
- Extend Log.time to accept appended fields

## Impact
- Affects capability: sap-ai-core (Observability requirement)
- Code touched: packages/opencode/src/provider/provider.ts, packages/opencode/src/util/log.ts
