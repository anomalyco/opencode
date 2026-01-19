<!-- Powered by BMAD-CORE™ -->

# Test Framework Setup

**Workflow ID**: `_bmad/bmm/testarch/framework`
**Version**: 4.0 (BMad v6)

---

## Overview

Initialize a production-ready test framework architecture (Playwright or Cypress) with fixtures, helpers, configuration, and best practices. This workflow scaffolds the complete testing infrastructure for modern web applications.

---

## Preflight Requirements

**Critical:** Verify these requirements before proceeding. If any fail, HALT and notify the user.

- ✅ `package.json` exists in project root
- ✅ No modern E2E test harness is already configured (check for existing `playwright.config.*` or `cypress.config.*`)
- ✅ Architectural/stack context available (project type, bundler, dependencies)

---

## Step 1: Run Preflight Checks

### Actions

1. **Validate package.json**
   - Read `{project-root}/package.json`
   - Extract project type (React, Vue, Angular, Next.js, Node, etc.)
   - Identify bundler (Vite, Webpack, Rollup, esbuild)
   - Note existing test dependencies

2. **Check for Existing Framework**
   - Search for `playwright.config.*`, `cypress.config.*`, `cypress.json`
   - Check `package.json` for `@playwright/test` or `cypress` dependencies
   - If found, HALT with message: "Existing test framework detected. Use workflow `upgrade-framework` instead."

3. **Gather Context**
   - Look for architecture documents (`architecture.md`, `tech-spec*.md`)
   - Check for API documentation or endpoint lists
   - Identify authentication requirements

**Halt Condition:** If preflight checks fail, stop immediately and report which requirement failed.

---

## Step 2: Scaffold Framework

### Actions

1. **Framework Selection**

   **Default Logic:**
   - **Playwright** (recommended for):
     - Large repositories (100+ files)
     - Performance-critical applications
     - Multi-browser support needed
     - Complex user flows requiring video/trace debugging
     - Projects requiring worker parallelism

   - **Cypress** (recommended for):
     - Small teams prioritizing developer experience
     - Component testing focus
     - Real-time reloading during test development
     - Simpler setup requirements

   **Detection Strategy:**
   - Check `package.json` for existing preference
   - Consider `project_size` variable from workflow config
   - Use `framework_preference` variable if set
   - Default to **Playwright** if uncertain

2. **Create Directory Structure**

   ```
   {project-root}/
   ├── tests/                        # Root test directory
   │   ├── e2e/                      # Test files (users organize as needed)
   │   ├── support/                  # Framework infrastructure (key pattern)
   │   │   ├── fixtures/             # Test fixtures (data, mocks)
   │   │   ├── helpers/              # Utility functions
   │   │   └── page-objects/         # Page object models (optional)
   │   └── README.md                 # Test suite documentation
   ```

   **Note**: Users organize test files (e2e/, api/, integration/, component/) as needed. The **support/** folder is the critical pattern for fixtures and helpers used across tests.

3. **Generate Configuration File**

   **For Playwright** (`playwright.config.ts` or `playwright.config.js`):

   ```typescript
   import { defineConfig, devices } from '@playwright/test';

   export default defineConfig({
     testDir: './tests/e2e',
     fullyParallel: true,
     forbidOnly: !!process.env.CI,
     retries: process.env.CI ? 2 : 0,
     workers: process.env.CI ? 1 : undefined,

     timeout: 60 * 1000, // Test timeout: 60s
     expect: {
       timeout: 15 * 1000, // Assertion timeout: 15s
     },

     use: {
       baseURL: process.env.BASE_URL || 'http://localhost:3000',
       trace: 'retain-on-failure',
       screenshot: 'only-on-failure',
       video: 'retain-on-failure',
       actionTimeout: 15 * 1000, // Action timeout: 15s
       navigationTimeout: 30 * 1000, // Navigation timeout: 30s
     },

     reporter: [['html', { outputFolder: 'test-results/html' }], ['junit', { outputFile: 'test-results/junit.xml' }], ['list']],

     projects: [
       { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
       { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
       { name: 'webkit', use: { ...devices['Desktop Safari'] } },
     ],
   });
   ```

   **For Cypress** (`cypress.config.ts` or `cypress.config.js`):

   ```typescript
   import { defineConfig } from 'cypress';

   export default defineConfig({
     e2e: {
       baseUrl: process.env.BASE_URL || 'http://localhost:3000',
       specPattern: 'tests/e2e/**/*.cy.{js,jsx,ts,tsx}',
       supportFile: 'tests/support/e2e.ts',
       video: false,
       screenshotOnRunFailure: true,

       setupNodeEvents(on, config) {
         // implement node event listeners here
       },
     },

     retries: {
       runMode: 2,
       openMode: 0,
     },

     defaultCommandTimeout: 15000,
     requestTimeout: 30000,
     responseTimeout: 30000,
     pageLoadTimeout: 60000,
   });
   ```

4. **Generate Environment Configuration**

   Create `.env.example`:

   ```bash
   # Test Environment Configuration
   TEST_ENV=local
   BASE_URL=http://localhost:3000
   API_URL=http://localhost:3001/api

   # Authentication (if applicable)
   TEST_USER_EMAIL=test@example.com
   TEST_USER_PASSWORD=

   # Feature Flags (if applicable)
   FEATURE_FLAG_NEW_UI=true

   # API Keys (if applicable)
   TEST_API_KEY=
   ```

5. **Generate Node Version File**

   Create `.nvmrc`:

   ```
   20.11.0
   ```

   (Use Node version from existing `.nvmrc` or default to current LTS)

6. **Implement Fixture Architecture**

   **Knowledge Base Reference**: `testarch/knowledge/fixture-architecture.md`

   Create `tests/support/fixtures/index.ts`:

   ```typescript
   import { test as base } from '@playwright/test';
   import { UserFactory } from './factories/user-factory';

   type TestFixtures = {
     userFactory: UserFactory;
   };

   export const test = base.extend<TestFixtures>({
     userFactory: async ({}, use) => {
       const factory = new UserFactory();
       await use(factory);
       await factory.cleanup(); // Auto-cleanup
     },
   });

   export { expect } from '@playwright/test';
   ```

7. **Implement Data Factories**

   **Knowledge Base Reference**: `testarch/knowledge/data-factories.md`

   Create `tests/support/fixtures/factories/user-factory.ts`:

   ```typescript
   import { faker } from '@faker-js/faker';

   export class UserFactory {
     private createdUsers: string[] = [];

     async createUser(overrides = {}) {
       const user = {
         email: faker.internet.email(),
         name: faker.person.fullName(),
         password: faker.internet.password({ length: 12 }),
         ...overrides,
       };

       // API call to create user
       const response = await fetch(`${process.env.API_URL}/users`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(user),
       });

       const created = await response.json();
       this.createdUsers.push(created.id);
       return created;
     }

     async cleanup() {
       // Delete all created users
       for (const userId of this.createdUsers) {
         await fetch(`${process.env.API_URL}/users/${userId}`, {
           method: 'DELETE',
         });
       }
       this.createdUsers = [];
     }
   }
   ```

8. **Generate Sample Tests**

   Create `tests/e2e/example.spec.ts`:

   ```typescript
   import { test, expect } from '../support/fixtures';

   test.describe('Example Test Suite', () => {
     test('should load homepage', async ({ page }) => {
       await page.goto('/');
       await expect(page).toHaveTitle(/Home/i);
     });

     test('should create user and login', async ({ page, userFactory }) => {
       // Create test user
       const user = await userFactory.createUser();

       // Login
       await page.goto('/login');
       await page.fill('[data-testid="email-input"]', user.email);
       await page.fill('[data-testid="password-input"]', user.password);
       await page.click('[data-testid="login-button"]');

       // Assert login success
       await expect(page.locator('[data-testid="user-menu"]')).toBeVisible();
     });
   });
   ```

9. **Update package.json Scripts**

   Add minimal test script to `package.json`:

   ```json
   {
     "scripts": {
       "test:e2e": "playwright test"
     }
   }
   ```

   **Note**: Users can add additional scripts as needed (e.g., `--ui`, `--headed`, `--debug`, `show-report`).

10. **Generate Documentation**

    Create `tests/README.md` with setup instructions (see Step 3 deliverables).

---

## Step 3: Deliverables

### Primary Artifacts Created

1. **Configuration File**
   - `playwright.config.ts` or `cypress.config.ts`
   - Timeouts: action 15s, navigation 30s, test 60s
   - Reporters: HTML + JUnit XML

2. **Directory Structure**
   - `tests/` with `e2e/`, `api/`, `support/` subdirectories
   - `support/fixtures/` for test fixtures
   - `support/helpers/` for utility functions

3. **Environment Configuration**
   - `.env.example` with `TEST_ENV`, `BASE_URL`, `API_URL`
   - `.nvmrc` with Node version

4. **Test Infrastructure**
   - Fixture architecture (`mergeTests` pattern)
   - Data factories (faker-based, with auto-cleanup)
   - Sample tests demonstrating patterns

5. **Documentation**
   - `tests/README.md` with setup instructions
   - Comments in config files explaining options

### README Contents

The generated `tests/README.md` should include:

- **Setup Instructions**: How to install dependencies, configure environment
- **Running Tests**: Commands for local execution, headed mode, debug mode
- **Architecture Overview**: Fixture pattern, data factories, page objects
- **Best Practices**: Selector strategy (data-testid), test isolation, cleanup
- **CI Integration**: How tests run in CI/CD pipeline
- **Knowledge Base References**: Links to relevant TEA knowledge fragments

---

## Important Notes

### Knowledge Base Integration

**Critical:** Check configuration and load appropriate fragments.

Read `{config_source}` and check `config.tea_use_playwright_utils`.

**If `config.tea_use_playwright_utils: true` (Playwright Utils Integration):**

Consult `{project-root}/_bmad/bmm/testarch/tea-index.csv` and load:

- `overview.md` - Playwright utils installation and design principles
- `fixtures-composition.md` - mergeTests composition with playwright-utils
- `auth-session.md` - Token persistence setup (if auth needed)
- `api-request.md` - API testing utilities (if API tests planned)
- `burn-in.md` - Smart test selection for CI (recommend during framework setup)
- `network-error-monitor.md` - Automatic HTTP error detection (recommend in merged fixtures)
- `data-factories.md` - Factory patterns with faker (498 lines, 5 examples)

Recommend installing playwright-utils:

```bash
npm install -D @seontechnologies/playwright-utils
```

Recommend adding burn-in and network-error-monitor to merged fixtures for enhanced reliability.

**If `config.tea_use_playwright_utils: false` (Traditional Patterns):**

Consult `{project-root}/_bmad/bmm/testarch/tea-index.csv` and load:

- `fixture-architecture.md` - Pure function → fixture → `mergeTests` composition with auto-cleanup (406 lines, 5 examples)
- `data-factories.md` - Faker-based factories with overrides, nested factories, API seeding, auto-cleanup (498 lines, 5 examples)
- `network-first.md` - Network-first testing safeguards: intercept before navigate, HAR capture, deterministic waiting (489 lines, 5 examples)
- `playwright-config.md` - Playwright-specific configuration: environment-based, timeout standards, artifact output, parallelization, project config (722 lines, 5 examples)
- `test-quality.md` - Test design principles: deterministic, isolated with cleanup, explicit assertions, length/time limits (658 lines, 5 examples)

### Framework-Specific Guidance

**Playwright Advantages:**

- Worker parallelism (significantly faster for large suites)
- Trace viewer (powerful debugging with screenshots, network, console)
- Multi-language support (TypeScript, JavaScript, Python, C#, Java)
- Built-in API testing capabilities
- Better handling of multiple browser contexts

**Cypress Advantages:**

- Superior developer experience (real-time reloading)
- Excellent for component testing (Cypress CT or use Vitest)
- Simpler setup for small teams
- Better suited for watch mode during development

**Avoid Cypress when:**

- API chains are heavy and complex
- Multi-tab/window scenarios are common
- Worker parallelism is critical for CI performance

### Selector Strategy

**Always recommend**:

- `data-testid` attributes for UI elements
- `data-cy` attributes if Cypress is chosen
- Avoid brittle CSS selectors or XPath

### Contract Testing

For microservices architectures, **recommend Pact** for consumer-driven contract testing alongside E2E tests.

### Failure Artifacts

Configure **failure-only** capture:

- Screenshots: only on failure
- Videos: retain on failure (delete on success)
- Traces: retain on failure (Playwright)

This reduces storage overhead while maintaining debugging capability.

---

## Output Summary

After completing this workflow, provide a summary:

```markdown
## Framework Scaffold Complete

**Framework Selected**: Playwright (or Cypress)

**Artifacts Created**:

- ✅ Configuration file: `playwright.config.ts`
- ✅ Directory structure: `tests/e2e/`, `tests/support/`
- ✅ Environment config: `.env.example`
- ✅ Node version: `.nvmrc`
- ✅ Fixture architecture: `tests/support/fixtures/`
- ✅ Data factories: `tests/support/fixtures/factories/`
- ✅ Sample tests: `tests/e2e/example.spec.ts`
- ✅ Documentation: `tests/README.md`

**Next Steps**:

1. Copy `.env.example` to `.env` and fill in environment variables
2. Run `npm install` to install test dependencies
3. Run `npm run test:e2e` to execute sample tests
4. Review `tests/README.md` for detailed setup instructions

**Knowledge Base References Applied**:

- Fixture architecture pattern (pure functions + mergeTests)
- Data factories with auto-cleanup (faker-based)
- Network-first testing safeguards
- Failure-only artifact capture
```

---

## Validation

After completing all steps, verify:

- [ ] Configuration file created and valid
- [ ] Directory structure exists
- [ ] Environment configuration generated
- [ ] Sample tests run successfully
- [ ] Documentation complete and accurate
- [ ] No errors or warnings during scaffold

Refer to `checklist.md` for comprehensive validation criteria.
