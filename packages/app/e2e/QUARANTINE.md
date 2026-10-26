# Quarantined browser tests

Beta pull request and push runs skip tests tagged `@quarantine` (`--grep-invert @quarantine`), so a test that fails in every run stops slowing every leg with retries. `dev` runs are unchanged.

To run only the quarantined tests, use `gh workflow run check-test.yml --ref beta -f quarantine=true`. Their legs report without failing the e2e checks. `nightly-beta.yml` dispatches that run, plus a full beta run, every night.

**Rule:** fix a quarantined test or delete it within 14 days of quarantine. When a fix lands, remove the tag and its row in the same pull request. Never quarantine a test that fails because of your own change; fix the test or the change.

No tests are quarantined. When you quarantine one, list it below with its failure signature, the date it was first seen red, and its owner.

| Test | Failure signature | First red | Owner |
| ---- | ----------------- | --------- | ----- |
