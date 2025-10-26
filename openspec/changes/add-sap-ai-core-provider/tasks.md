## 0. Research & Evaluation

- [ ] 0.0 Add placeholder section in `design.md` (Library Evaluation & Decision)
- [ ] 0.1 Inventory existing SAP AI Core related JS/TS libraries (SAP Cloud SDK modules, xssec, community wrappers)
- [ ] 0.2 Assess dependency graph & Bun compatibility (transitive deps, native modules)
- [ ] 0.3 Compare against opencode rules (simplicity, minimal code, avoid unnecessary frameworks)
- [ ] 0.4 Decide: adopt library vs custom lightweight fetch wrapper
- [ ] 0.5 Record decision & rationale in `design.md` under "Library Evaluation & Decision"
- [ ] 0.6 Update proposal if decision alters scope (re-run validation)

## 1. Implementation (start only after 0.x complete)

- [x] 1.1 Add `sap-ai-core` loader to `CUSTOM_LOADERS` (`provider.ts:27`)
- [x] 1.2 Parse service key JSON + discrete env vars
- [x] 1.3 Implement OAuth2 client credentials token acquisition + caching
- [x] 1.4 Inject fetch timeout + abort logic (reuse pattern from `provider.ts:425`)
- [x] 1.5 Support model alias mapping with real ID (reuse `realIdByKey` pattern)
- [x] 1.6 Add config schema support (`config.ts`)
- [x] 1.7 Normalize errors (auth -> ProviderAuthError, throttle -> ProviderRateLimitError, missing model)
- [x] 1.8 Unit tests for loader, token lifecycle, alias mapping (see `packages/opencode/test/provider/sap-ai-core.test.ts`)
- [ ] 1.9 Documentation update (README provider section)
- [ ] 1.10 Optional dynamic deployment listing (flag-gated)

## 2. Validation

- [ ] 2.1 Run `openspec validate add-sap-ai-core-provider --strict`
- [ ] 2.2 Verify provider appears with credentials
- [ ] 2.3 Exercise error paths (invalid secret)

## 3. Observability

- [ ] 3.1 Add initialization log entry
- [ ] 3.2 Add timing around model calls

## 4. Review

- [ ] 4.1 Security review (no secret logging)
- [ ] 4.2 Performance review (token fetch concurrency)
- [ ] 4.3 Approve proposal before merging implementation
