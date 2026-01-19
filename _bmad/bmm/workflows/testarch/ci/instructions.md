<!-- Powered by BMAD-CORE™ -->

# CI/CD Pipeline Setup

**Workflow ID**: `_bmad/bmm/testarch/ci`
**Version**: 4.0 (BMad v6)

---

## Overview

Scaffolds a production-ready CI/CD quality pipeline with test execution, burn-in loops for flaky test detection, parallel sharding, artifact collection, and notification configuration. This workflow creates platform-specific CI configuration optimized for fast feedback and reliable test execution.

Note: This is typically a one-time setup per repo; run it any time after the test framework exists, ideally before feature work starts.

---

## Preflight Requirements

**Critical:** Verify these requirements before proceeding. If any fail, HALT and notify the user.

- ✅ Git repository is initialized (`.git/` directory exists)
- ✅ Local test suite passes (`npm run test:e2e` succeeds)
- ✅ Test framework is configured (from `framework` workflow)
- ✅ Team agrees on target CI platform (GitHub Actions, GitLab CI, Circle CI, etc.)
- ✅ Access to CI platform settings/secrets available (if updating existing pipeline)

---

## Step 1: Run Preflight Checks

### Actions

1. **Verify Git Repository**
   - Check for `.git/` directory
   - Confirm remote repository configured (`git remote -v`)
   - If not initialized, HALT with message: "Git repository required for CI/CD setup"

2. **Validate Test Framework**
   - Look for `playwright.config.*` or `cypress.config.*`
   - Read framework configuration to extract:
     - Test directory location
     - Test command
     - Reporter configuration
     - Timeout settings
   - If not found, HALT with message: "Run `framework` workflow first to set up test infrastructure"

3. **Run Local Tests**
   - Execute `npm run test:e2e` (or equivalent from package.json)
   - Ensure tests pass before CI setup
   - If tests fail, HALT with message: "Fix failing tests before setting up CI/CD"

4. **Detect CI Platform**
   - Check for existing CI configuration:
     - `.github/workflows/*.yml` (GitHub Actions)
     - `.gitlab-ci.yml` (GitLab CI)
     - `.circleci/config.yml` (Circle CI)
     - `Jenkinsfile` (Jenkins)
   - If found, ask user: "Update existing CI configuration or create new?"
   - If not found, detect platform from git remote:
     - `github.com` → GitHub Actions (default)
     - `gitlab.com` → GitLab CI
     - Ask user if unable to auto-detect

5. **Read Environment Configuration**
   - Use `.nvmrc` for Node version if present
   - If missing, default to a current LTS (Node 24) or newer instead of a fixed old version
   - Read `package.json` to identify dependencies (affects caching strategy)

**Halt Condition:** If preflight checks fail, stop immediately and report which requirement failed.

---

## Step 2: Scaffold CI Pipeline

### Actions

1. **Select CI Platform Template**

   Based on detection or user preference, use the appropriate template:

   **GitHub Actions** (`.github/workflows/test.yml`):
   - Most common platform
   - Excellent caching and matrix support
   - Free for public repos, generous free tier for private

   **GitLab CI** (`.gitlab-ci.yml`):
   - Integrated with GitLab
   - Built-in registry and runners
   - Powerful pipeline features

   **Circle CI** (`.circleci/config.yml`):
   - Fast execution with parallelism
   - Docker-first approach
   - Enterprise features

   **Jenkins** (`Jenkinsfile`):
   - Self-hosted option
   - Maximum customization
   - Requires infrastructure management

2. **Generate Pipeline Configuration**

   Use templates from `{installed_path}/` directory:
   - `github-actions-template.yml`
   - `gitlab-ci-template.yml`

   **Key pipeline stages:**

   ```yaml
   stages:
     - lint # Code quality checks
     - test # Test execution (parallel shards)
     - burn-in # Flaky test detection
     - report # Aggregate results and publish
   ```

3. **Configure Test Execution**

   **Parallel Sharding:**

   ```yaml
   strategy:
     fail-fast: false
     matrix:
       shard: [1, 2, 3, 4]

   steps:
     - name: Run tests
       run: npm run test:e2e -- --shard=${{ matrix.shard }}/${{ strategy.job-total }}
   ```

   **Purpose:** Splits tests into N parallel jobs for faster execution (target: <10 min per shard)

4. **Add Burn-In Loop**

   **Critical pattern from production systems:**

   ```yaml
   burn-in:
     name: Flaky Test Detection
     runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v4

       - name: Setup Node
         uses: actions/setup-node@v4
         with:
           node-version-file: '.nvmrc'

       - name: Install dependencies
         run: npm ci

       - name: Run burn-in loop (10 iterations)
         run: |
           for i in {1..10}; do
             echo "🔥 Burn-in iteration $i/10"
             npm run test:e2e || exit 1
           done

       - name: Upload failure artifacts
         if: failure()
         uses: actions/upload-artifact@v4
         with:
           name: burn-in-failures
           path: test-results/
           retention-days: 30
   ```

   **Purpose:** Runs tests multiple times to catch non-deterministic failures before they reach main branch.

   **When to run:**
   - On pull requests to main/develop
   - Weekly on cron schedule
   - After significant test infrastructure changes

5. **Configure Caching**

   **Node modules cache:**

   ```yaml
   - name: Cache dependencies
     uses: actions/cache@v4
     with:
       path: ~/.npm
       key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
       restore-keys: |
         ${{ runner.os }}-node-
   ```

   **Browser binaries cache (Playwright):**

   ```yaml
   - name: Cache Playwright browsers
     uses: actions/cache@v4
     with:
       path: ~/.cache/ms-playwright
       key: ${{ runner.os }}-playwright-${{ hashFiles('**/package-lock.json') }}
   ```

   **Purpose:** Reduces CI execution time by 2-5 minutes per run.

6. **Configure Artifact Collection**

   **Failure artifacts only:**

   ```yaml
   - name: Upload test results
     if: failure()
     uses: actions/upload-artifact@v4
     with:
       name: test-results-${{ matrix.shard }}
       path: |
         test-results/
         playwright-report/
       retention-days: 30
   ```

   **Artifacts to collect:**
   - Traces (Playwright) - full debugging context
   - Screenshots - visual evidence of failures
   - Videos - interaction playback
   - HTML reports - detailed test results
   - Console logs - error messages and warnings

7. **Add Retry Logic**

   ```yaml
   - name: Run tests with retries
     uses: nick-invision/retry@v2
     with:
       timeout_minutes: 30
       max_attempts: 3
       retry_on: error
       command: npm run test:e2e
   ```

   **Purpose:** Handles transient failures (network issues, race conditions)

8. **Configure Notifications** (Optional)

   If `notify_on_failure` is enabled:

   ```yaml
   - name: Notify on failure
     if: failure()
     uses: 8398a7/action-slack@v3
     with:
       status: ${{ job.status }}
       text: 'Test failures detected in PR #${{ github.event.pull_request.number }}'
       webhook_url: ${{ secrets.SLACK_WEBHOOK }}
   ```

9. **Generate Helper Scripts**

   **Selective testing script** (`scripts/test-changed.sh`):

   ```bash
   #!/bin/bash
   # Run only tests for changed files

   CHANGED_FILES=$(git diff --name-only HEAD~1)

   if echo "$CHANGED_FILES" | grep -q "src/.*\.ts$"; then
     echo "Running affected tests..."
     npm run test:e2e -- --grep="$(echo $CHANGED_FILES | sed 's/src\///g' | sed 's/\.ts//g')"
   else
     echo "No test-affecting changes detected"
   fi
   ```

   **Local mirror script** (`scripts/ci-local.sh`):

   ```bash
   #!/bin/bash
   # Mirror CI execution locally for debugging

   echo "🔍 Running CI pipeline locally..."

   # Lint
   npm run lint || exit 1

   # Tests
   npm run test:e2e || exit 1

   # Burn-in (reduced iterations)
   for i in {1..3}; do
     echo "🔥 Burn-in $i/3"
     npm run test:e2e || exit 1
   done

   echo "✅ Local CI pipeline passed"
   ```

10. **Generate Documentation**

    **CI README** (`docs/ci.md`):
    - Pipeline stages and purpose
    - How to run locally
    - Debugging failed CI runs
    - Secrets and environment variables needed
    - Notification setup
    - Badge URLs for README

    **Secrets checklist** (`docs/ci-secrets-checklist.md`):
    - Required secrets list (SLACK_WEBHOOK, etc.)
    - Where to configure in CI platform
    - Security best practices

---

## Step 3: Deliverables

### Primary Artifacts Created

1. **CI Configuration File**
   - `.github/workflows/test.yml` (GitHub Actions)
   - `.gitlab-ci.yml` (GitLab CI)
   - `.circleci/config.yml` (Circle CI)

2. **Pipeline Stages**
   - **Lint**: Code quality checks (ESLint, Prettier)
   - **Test**: Parallel test execution (4 shards)
   - **Burn-in**: Flaky test detection (10 iterations)
   - **Report**: Result aggregation and publishing

3. **Helper Scripts**
   - `scripts/test-changed.sh` - Selective testing
   - `scripts/ci-local.sh` - Local CI mirror
   - `scripts/burn-in.sh` - Standalone burn-in execution

4. **Documentation**
   - `docs/ci.md` - CI pipeline guide
   - `docs/ci-secrets-checklist.md` - Required secrets
   - Inline comments in CI configuration

5. **Optimization Features**
   - Dependency caching (npm, browser binaries)
   - Parallel sharding (4 jobs default)
   - Retry logic (2 retries on failure)
   - Failure-only artifact upload

### Performance Targets

- **Lint stage**: <2 minutes
- **Test stage** (per shard): <10 minutes
- **Burn-in stage**: <30 minutes (10 iterations)
- **Total pipeline**: <45 minutes

**Speedup:** 20× faster than sequential execution through parallelism and caching.

---

## Important Notes

### Knowledge Base Integration

**Critical:** Check configuration and load appropriate fragments.

Read `{config_source}` and check `config.tea_use_playwright_utils`.

**Core CI Patterns (Always load):**

- `ci-burn-in.md` - Burn-in loop patterns: 10-iteration detection, GitHub Actions workflow, shard orchestration, selective execution (678 lines, 4 examples)
- `selective-testing.md` - Changed test detection strategies: tag-based, spec filters, diff-based selection, promotion rules (727 lines, 4 examples)
- `visual-debugging.md` - Artifact collection best practices: trace viewer, HAR recording, custom artifacts, accessibility integration (522 lines, 5 examples)
- `test-quality.md` - CI-specific test quality criteria: deterministic tests, isolated with cleanup, explicit assertions, length/time optimization (658 lines, 5 examples)
- `playwright-config.md` - CI-optimized configuration: parallelization, artifact output, project dependencies, sharding (722 lines, 5 examples)

**If `config.tea_use_playwright_utils: true`:**

Load playwright-utils CI-relevant fragments:

- `burn-in.md` - Smart test selection with git diff analysis (very important for CI optimization)
- `network-error-monitor.md` - Automatic HTTP 4xx/5xx detection (recommend in CI pipelines)

Recommend:

- Add burn-in script for pull request validation
- Enable network-error-monitor in merged fixtures for catching silent failures
- Reference full docs in `*framework` and `*automate` workflows

### CI Platform-Specific Guidance

**GitHub Actions:**

- Use `actions/cache` for caching
- Matrix strategy for parallelism
- Secrets in repository settings
- Free 2000 minutes/month for private repos

**GitLab CI:**

- Use `.gitlab-ci.yml` in root
- `cache:` directive for caching
- Parallel execution with `parallel: 4`
- Variables in project CI/CD settings

**Circle CI:**

- Use `.circleci/config.yml`
- Docker executors recommended
- Parallelism with `parallelism: 4`
- Context for shared secrets

### Burn-In Loop Strategy

**When to run:**

- ✅ On PRs to main/develop branches
- ✅ Weekly on schedule (cron)
- ✅ After test infrastructure changes
- ❌ Not on every commit (too slow)

**Iterations:**

- **10 iterations** for thorough detection
- **3 iterations** for quick feedback
- **100 iterations** for high-confidence stability

**Failure threshold:**

- Even ONE failure in burn-in → tests are flaky
- Must fix before merging

### Artifact Retention

**Failure artifacts only:**

- Saves storage costs
- Maintains debugging capability
- 30-day retention default

**Artifact types:**

- Traces (Playwright) - 5-10 MB per test
- Screenshots - 100-500 KB per screenshot
- Videos - 2-5 MB per test
- HTML reports - 1-2 MB per run

### Selective Testing

**Detect changed files:**

```bash
git diff --name-only HEAD~1
```

**Run affected tests only:**

- Faster feedback for small changes
- Full suite still runs on main branch
- Reduces CI time by 50-80% for focused PRs

**Trade-off:**

- May miss integration issues
- Run full suite at least on merge

### Local CI Mirror

**Purpose:** Debug CI failures locally

**Usage:**

```bash
./scripts/ci-local.sh
```

**Mirrors CI environment:**

- Same Node version
- Same test command
- Same stages (lint → test → burn-in)
- Reduced burn-in iterations (3 vs 10)

---

## Output Summary

After completing this workflow, provide a summary:

```markdown
## CI/CD Pipeline Complete

**Platform**: GitHub Actions (or GitLab CI, etc.)

**Artifacts Created**:

- ✅ Pipeline configuration: .github/workflows/test.yml
- ✅ Burn-in loop: 10 iterations for flaky detection
- ✅ Parallel sharding: 4 jobs for fast execution
- ✅ Caching: Dependencies + browser binaries
- ✅ Artifact collection: Failure-only traces/screenshots/videos
- ✅ Helper scripts: test-changed.sh, ci-local.sh, burn-in.sh
- ✅ Documentation: docs/ci.md, docs/ci-secrets-checklist.md

**Performance:**

- Lint: <2 min
- Test (per shard): <10 min
- Burn-in: <30 min
- Total: <45 min (20× speedup vs sequential)

**Next Steps**:

1. Commit CI configuration: `git add .github/workflows/test.yml && git commit -m "ci: add test pipeline"`
2. Push to remote: `git push`
3. Configure required secrets in CI platform settings (see docs/ci-secrets-checklist.md)
4. Open a PR to trigger first CI run
5. Monitor pipeline execution and adjust parallelism if needed

**Knowledge Base References Applied**:

- Burn-in loop pattern (ci-burn-in.md)
- Selective testing strategy (selective-testing.md)
- Artifact collection (visual-debugging.md)
- Test quality criteria (test-quality.md)
```

---

## Validation

After completing all steps, verify:

- [ ] CI configuration file created and syntactically valid
- [ ] Burn-in loop configured (10 iterations)
- [ ] Parallel sharding enabled (4 jobs)
- [ ] Caching configured (dependencies + browsers)
- [ ] Artifact collection on failure only
- [ ] Helper scripts created and executable (`chmod +x`)
- [ ] Documentation complete (ci.md, secrets checklist)
- [ ] No errors or warnings during scaffold

Refer to `checklist.md` for comprehensive validation criteria.
