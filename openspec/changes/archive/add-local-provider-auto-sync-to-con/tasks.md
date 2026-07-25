# Tasks: Add local provider auto-sync to context sidebar via mDNS

## Phase 1 — Analysis & Requirements
- [ ] 1. Analyze existing mDNS discovery implementation to identify the current service type and port constants used by llama-swap providers.
  - Validation: grep -r "serviceType\|_ollama\|_skein" --include="*.ts" --include="*.js" packages/
- [ ] 2. Examine the context sidebar component (likely in `packages/console/app/src/...`) to understand how providers are currently rendered and managed in state.
  - Validation: find packages/console -name "*sidebar*" -o -name "*context*" | head -20
- [ ] 3. Review the existing local provider auto-sync logic in the local module to ensure alignment with the mDNS discovery mechanism.
  - Validation: git log --oneline --all --grep="local" -20 | head -10

## Phase 2 — Implementation — Discovery Service
- [ ] 4. Update the mDNS service discovery constants in the local provider module to include the correct service instance name (e.g., `ctx-skein`) and port.
  - Validation: git diff packages/local/src/discovery.js --stat
- [ ] 5. Implement the mDNS browsing logic within the local provider module to listen for announcements from other running OpenCode instances.
  - Validation: npm test -- packages/local --filter=local
- [ ] 6. Add the service type constants and registration logic to the mDNS library usage in the local provider initialization.
  - Validation: grep -n "bonjour\|dns-sd" packages/local/src/*.ts

## Phase 3 — Implementation — Context Sidebar Integration
- [ ] 7. Integrate the auto-synced provider list into the context sidebar data model to ensure new providers appear without manual refresh.
  - Validation: grep -n "providers\|sidebar" packages/console/app/src/components/*.tsx | head -20
- [ ] 8. Update the context sidebar UI component to render "auto-synced" local providers with a distinct visual indicator (e.g., badge).
  - Validation: npm run build:console
- [ ] 9. Connect the context sidebar state to the mDNS listener to trigger UI updates when a new provider is discovered.
  - Validation: git diff packages/console/app/src/... --stat
- [ ] 10. Implement the "skip own IPs" logic within the context sidebar state handler to prevent the local provider from showing up as a remote provider.
  - Validation: grep -n "ownIP\|localhost" packages/console/app/src/*.ts

## Phase 4 — Testing & Validation
- [ ] 11. Add unit tests for the mDNS discovery function to verify it correctly filters out the local instance and identifies remote providers.
  - Validation: npm test -- packages/local --filter=local -- --grep="mdns"
- [ ] 12. Create integration tests to simulate a network environment with two OpenCode instances to ensure auto-sync happens successfully.
  - Validation: npm test -- packages/local --filter=local -- --grep="integration"
- [ ] 13. Test the context sidebar UI manually to ensure the new provider appears with the correct badge and can be selected.
  - Validation: npm run dev

## Phase 5 — Documentation & Cleanup
- [ ] 14. Update the README.md if necessary to mention the auto-sync feature and how it works for local providers.
  - Validation: git diff README.md --stat
- [ ] 15. Commit all changes with a clear message describing the addition of local provider auto-sync via mDNS.
  - Validation: git log --oneline -1
- [ ] 16. Update CHANGELOG.md (if present) to document the new feature.
  - Validation: git diff CHANGELOG.md --stat