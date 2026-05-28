# Troubleshooting

## Port Already In Use

- Symptom: local service fails to bind the expected port.
- Diagnose: inspect processes listening on 3000.
- Fix: stop the previous process or change the configured port.

## Database Connection Fails

- Symptom: startup or tests fail while connecting to PostgreSQL.
- Diagnose: verify env vars, local services and migrations.
- Fix: start the database or update the local configuration.

## Authentication Fails

- Symptom: redirect loop, 401/403, callback error or missing session.
- Diagnose: confirm NextAuth/Auth.js session flow.
- Fix: update local auth configuration and documented demo credentials.

## Frontend Calls Wrong API

- Symptom: UI loads but reads data from the wrong environment.
- Diagnose: inspect the API base URL in local config.
- Fix: point the app to not-applicable.

## Playwright Missing Dependencies

- Symptom: E2E fails before opening the page or video cannot be recorded.
- Diagnose: review Playwright install output.
- Fix:

```bash
npx playwright install
npx playwright install ffmpeg
```
