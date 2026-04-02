## Executive Summary

The `getting-started-app` is a simple Node.js/Express todo application with no authentication, authorization, input validation, or security hardening. Multiple high-severity issues were identified that would allow unauthorized data manipulation and potential data exposure. The application lacks fundamental security controls referenced in ISO 27001 controls for access control, cryptographic controls, and secure development.

## Findings

### Finding 1

- Finding ID: AUTH-01
- Observed Issue: No authentication or authorization mechanism exists. All CRUD endpoints (`/items`, `/items/:id`) are publicly accessible.
- Severity: critical
- Evidence: `src/index.js:12-15` — routes defined with no middleware for auth; no auth middleware present in codebase.
- Related Control / Principle: ISO-ISO27001pdf-020 (12.1 Access control, 12.4.3 Access control to program source code)
- Recommendation: Implement authentication middleware (e.g., JWT, session-based) and authorization checks before route handlers.

### Finding 2

- Finding ID: INPUT-01
- Observed Issue: No input validation or sanitization on `req.body.name`, `req.body.completed`, or `req.params.id`. User input is passed directly to SQL queries and returned in responses.
- Severity: high
- Evidence: `src/routes/addItem.js:7` — `name: req.body.name` used without validation; `src/routes/updateItem.js:5` — same pattern.
- Related Control / Principle: ISO-ISO27001pdf-020 (12.2.4 Output data validation)
- Recommendation: Add input validation (e.g., express-validator) and sanitize all user inputs before storage and output.

### Finding 3

- Finding ID: ERR-01
- Observed Issue: Route handlers lack error handling. Unhandled promise rejections may leak stack traces or crash the process.
- Severity: medium
- Evidence: `src/routes/addItem.js:4-13` — no try/catch; `src/routes/deleteItem.js:3-6` — same pattern.
- Related Control / Principle: ISO-ISO27001pdf-020 (12.2 Security of systems and applications)
- Recommendation: Add try/catch blocks in all route handlers and use a global error handler middleware.

### Finding 4

- Finding ID: HDR-01
- Observed Issue: No security headers (Helmet or equivalent). Missing X-Content-Type-Options, X-Frame-Options, Content-Security-Policy, etc.
- Severity: medium
- Evidence: `src/index.js:1-10` — no security middleware imported or configured.
- Related Control / Principle: ISO-ISO27001pdf-020 (12.2.1 Input data validation and associated controls)
- Recommendation: Add `helmet` middleware to set standard security headers.

### Finding 5

- Finding ID: TRANS-01
- Observed Issue: Server listens on plain HTTP (port 3000). No TLS/HTTPS configuration present.
- Severity: high
- Evidence: `src/index.js:18` — `app.listen(3000, ...)` with no TLS options.
- Related Control / Principle: ISO-ISO27001pdf-020 (12.3.1 Policy on the use of cryptographic controls)
- Recommendation: Configure TLS termination at reverse proxy level or use Node.js `https` module with valid certificates.

### Finding 6

- Finding ID: CORS-01
- Observed Issue: No CORS policy configured. The API is accessible from any origin.
- Severity: medium
- Evidence: `src/index.js:9` — `express.json()` used without `cors` middleware.
- Related Control / Principle: ISO-ISO27001pdf-020 (12.1 Access control policy)
- Recommendation: Add `cors` middleware with explicit allowed origins.

### Finding 7

- Finding ID: SRI-01
- Observed Issue: External resource loaded from Google Fonts without Subresource Integrity (SRI) hash.
- Severity: low
- Evidence: `src/static/index.html:9` — `<link href="https://fonts.googleapis.com/css?family=Lato&display=swap" rel="stylesheet" />` with no `integrity` or `crossorigin` attributes for verification.
- Related Control / Principle: ISO-ISO27001pdf-020 (12.5 Security in development)
- Recommendation: Add `integrity` and `crossorigin` attributes to external resource links.

### Finding 8

- Finding ID: CSRF-01
- Observed Issue: No CSRF protection on state-changing POST/PUT/DELETE endpoints.
- Severity: medium
- Evidence: `src/index.js:13-15` — POST, PUT, DELETE routes defined without CSRF token validation.
- Related Control / Principle: ISO-ISO27001pdf-020 (12.2.1 Input data validation)
- Recommendation: Implement CSRF tokens using `csurf` or equivalent middleware.

## Final Risk Overview

The application presents **critical** risk in its current state. The absence of authentication (AUTH-01) combined with lack of input validation (INPUT-01) and no TLS (TRANS-01) means any actor can read, create, modify, or delete all data. These three findings alone warrant immediate remediation before any deployment. Medium-severity issues (error handling, security headers, CORS, CSRF) compound the risk by enabling information leakage and cross-origin attacks. The codebase follows parameterized queries correctly for SQL injection prevention, which is a positive baseline.