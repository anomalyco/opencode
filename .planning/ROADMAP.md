# OpenCode Google OAuth for Gemini Models - Roadmap

**Project:** Add Google OAuth support alongside existing API key authentication to enable users to access Gemini models through their Google AI Pro/Ultra subscriptions.

**Current State:**
- API key-based authentication for model providers
- Google OAuth exists for console app login (`@openauthjs/openauth/provider/google`)
- Gemini models configured as providers requiring API keys
- Users with Google AI Pro/Ultra subscriptions cannot use their subscription credentials

**Target State:**
- Users can authenticate via Google OAuth to use their Google AI subscription
- Existing API key authentication remains functional
- Seamless switching between API key and OAuth credentials
- Support for both Google AI Studio OAuth and Google Cloud OAuth flows

---

## Phase 01: Requirements & Discovery

**Goal:** Define technical requirements and research Google AI OAuth implementation patterns.

**Deliverables:**
- Document Google AI OAuth scopes and endpoints
- Identify token refresh requirements
- Define user experience flows
- Document data storage requirements

**Success Criteria:**
- Clear understanding of Google AI OAuth vs Google Cloud OAuth differences
- Documented API endpoints for token exchange
- User flow diagrams approved

---

## Phase 02: Database Schema Extensions

**Goal:** Extend database schema to store OAuth tokens and credentials.

**Deliverables:**
- New `google_oauth` table for storing OAuth credentials
- Migration scripts for existing databases
- Updated Drizzle schema definitions
- Token refresh logic design

**Success Criteria:**
- Schema supports access token, refresh token, expiry
- Workspace-level OAuth credential association
- Secure credential storage (encryption at rest)
- Migration tested and reversible

---

## Phase 03: Google OAuth Client Implementation

**Goal:** Implement OAuth client for Google AI authentication flow.

**Deliverables:**
- OAuth client using Google's Authorization Code flow
- Token exchange and refresh handling
- Error handling for expired/revoked tokens
- Scope configuration for Google AI access

**Success Criteria:**
- OAuth flow completes successfully
- Access tokens are obtained and stored
- Refresh tokens work correctly
- Proper error messages for failures

---

## Phase 04: Provider Integration - Gemini OAuth

**Goal:** Create new provider type that uses OAuth credentials instead of API keys.

**Deliverables:**
- `GeminiOAuthProvider` class implementation
- Credential resolution (OAuth token vs API key)
- Request signing with OAuth bearer tokens
- Fallback to API key if OAuth fails

**Success Criteria:**
- Gemini API calls work with OAuth tokens
- Existing API key providers unaffected
- Graceful fallback on token expiry
- Consistent interface across providers

---

## Phase 05: CLI Authentication Integration

**Goal:** Add Google OAuth authentication option to CLI.

**Deliverables:**
- `opencode auth login --google` command
- OAuth callback handling (local server)
- Token storage in local config
- Session management

**Success Criteria:**
- Users can authenticate via Google from CLI
- OAuth flow completes with redirect
- Tokens persist across sessions
- Clear status indicators

---

## Phase 06: Console UI Integration

**Goal:** Add Google OAuth UI to console application.

**Deliverables:**
- "Connect Google Account" button in console
- OAuth flow initiation and callback
- Credential display and management
- Disconnect/reconnect functionality

**Success Criteria:**
- UI clearly shows OAuth status
- Users can link/unlink Google account
- Existing API key UI still works
- No breaking changes to current console

---

## Phase 07: Token Lifecycle Management

**Goal:** Implement automatic token refresh and revocation handling.

**Deliverables:**
- Background token refresh worker
- Token expiry detection before API calls
- Re-authorization flow for expired sessions
- Token cleanup on workspace deletion

**Success Criteria:**
- Tokens refresh automatically before expiry
- Users prompted to re-authenticate when needed
- Stale tokens cleaned up
- No API calls with expired tokens

---

## Phase 08: Testing & Validation

**Goal:** Comprehensive testing of OAuth implementation.

**Deliverables:**
- Unit tests for OAuth client
- Integration tests for provider
- E2E tests for CLI and console flows
- Manual testing with real Google AI subscriptions

**Success Criteria:**
- All tests passing
- Real Pro/Ultra subscriptions work
- API key path still functional
- Edge cases handled (expired tokens, revoked access)

---

## Phase 09: Documentation & Release

**Goal:** Document changes and release to users.

**Deliverables:**
- User documentation for Google OAuth setup
- Migration guide for existing users
- Admin guide for OAuth configuration
- Changelog and release notes

**Success Criteria:**
- Clear setup instructions
- Troubleshooting guide for common issues
- Backwards compatibility documented
- Smooth rollout to users

---

## Dependencies

| Phase | Blocked By |
|-------|------------|
| 02 | 01 |
| 03 | 01 |
| 04 | 02, 03 |
| 05 | 03, 04 |
| 06 | 03, 04 |
| 07 | 04, 05, 06 |
| 08 | 04, 05, 06, 07 |
| 09 | 08 |

## Open Questions

1. **OAuth Provider Choice:** Use Google Cloud OAuth or Google AI Studio OAuth? (May need both)
2. **Scopes Required:** Exact OAuth scopes needed for Gemini API access via subscription
3. **Token Storage:** Encrypt tokens at rest? Key management approach?
4. **Workspace Association:** Are OAuth credentials per-user or per-workspace?
5. **Rate Limiting:** How do subscription rate limits interact with OpenCode's rate limiting?

---

## Definitions

- **Google AI Pro/Ultra:** Google's subscription tiers for Gemini model access
- **OAuth Bearer Token:** Authorization token used in API request headers
- **Refresh Token:** Long-lived token used to obtain new access tokens
- **Provider:** OpenCode's abstraction for model API integrations
