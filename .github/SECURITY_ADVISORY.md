# Security Advisory

Sentinel detected 1 security finding in your GitHub Actions workflows that require manual review.

## shell-injection-expr

### generate.yml (line 40)

**Severity:** critical
**Issue:** Attacker-controllable expression ${{ github.event.pull_request.head.ref }} in run: block — shell injection risk
**Fix:** Move to env: block and reference as $ENV_VAR in the shell

