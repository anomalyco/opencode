# Requirements - Google OAuth for Gemini Models

## Overview

Enable OpenCode users to authenticate with their Google account to access Gemini models through their Google AI Pro/Ultra subscriptions, while maintaining existing API key authentication.

## Functional Requirements

### FR-01: OAuth Authentication Flow
- System MUST support Google OAuth 2.0 Authorization Code flow
- System MUST support token refresh using refresh tokens
- System MUST handle token expiry gracefully
- System MUST support revocation of OAuth credentials

### FR-02: Dual Authentication Support
- System MUST support API key authentication (existing)
- System MUST support OAuth authentication (new)
- System MUST allow switching between authentication methods
- System MUST maintain backwards compatibility with existing API key users

### FR-03: Provider Integration
- System MUST pass OAuth bearer tokens to Gemini API
- System MUST use OAuth credentials for users with active Google subscriptions
- System MUST fall back to API keys if OAuth is not configured
- System MUST handle authentication errors appropriately

### FR-04: CLI Authentication
- CLI MUST provide `opencode auth login --google` command
- CLI MUST handle OAuth callback via local server
- CLI MUST store OAuth tokens securely
- CLI MUST show authentication status to user

### FR-05: Console Integration
- Console MUST provide "Connect Google Account" UI
- Console MUST display OAuth connection status
- Console MUST allow disconnecting Google account
- Console MUST handle OAuth errors with clear messages

### FR-06: Credential Storage
- System MUST store access tokens securely
- System MUST store refresh tokens securely
- System MUST track token expiry times
- System MUST associate credentials with workspaces

## Non-Functional Requirements

### NFR-01: Security
- Tokens MUST be encrypted at rest
- Tokens MUST never be logged or exposed in error messages
- OAuth state parameter MUST prevent CSRF attacks
- PKCE (Proof Key for Code Exchange) SHOULD be used for mobile/CLI

### NFR-02: Performance
- Token refresh MUST not block API calls
- Token status check SHOULD be cached for short duration
- OAuth flow MUST complete within 30 seconds

### NFR-03: Availability
- System MUST remain functional if Google OAuth is down (fallback to API keys)
- System MUST handle Google API rate limits appropriately
- Token refresh failures MUST have retry logic

### NFR-04: Usability
- OAuth setup MUST take less than 2 minutes
- Error messages MUST be actionable
- Users MUST be able to see which auth method is active
- Re-authentication flow MUST be simple

## Technical Constraints

### TC-01: Existing Infrastructure
- MUST use existing Drizzle ORM and MySQL database
- MUST work with existing provider abstraction layer
- MUST integrate with existing OpenAuthJS setup where possible
- MUST not break existing API key authentication

### TC-02: Google API Constraints
- MUST comply with Google AI API terms of service
- MUST handle Google's rate limits for subscription tiers
- MUST use correct OAuth scopes for Gemini access
- MUST handle Google's token lifecycle requirements

### TC-03: Deployment
- MUST deploy to Cloudflare Workers (backend)
- MUST support serverless environment
- MUST handle environment variable configuration
- MUST support zero-downtime deployments

## Out of Scope

- Google Cloud Platform OAuth (different from Google AI OAuth)
- Enterprise SSO integration
- OAuth for other model providers (Anthropic, OpenAI already have their own flows)
- Token sharing between workspaces
- Multi-factor authentication enforcement

## Success Metrics

- OAuth setup completion rate > 90%
- Token refresh success rate > 99%
- API regression rate = 0 (no existing API key users broken)
- Average time to authenticate < 60 seconds
- Support tickets related to auth < 5% of total
