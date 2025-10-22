/**
 * Specialized Workflow Agents
 *
 * Defines the four specialized agents for the autonomous workflow system:
 * - Planning Agent: Analyzes PRDs and creates detailed plans
 * - Coding Agent: Implements features and makes code changes
 * - Testing Agent: Runs tests and verifies functionality
 * - Deployment Agent: Handles deployment and release processes
 */

import type { Agent } from "../agent/agent.js"

/**
 * Planning Agent Configuration
 *
 * Read-only agent that analyzes PRDs and creates implementation plans
 */
export const PLANNING_AGENT: Agent.Info = {
  name: "planning",
  description: "Analyzes PRDs and creates detailed implementation plans. " +
    "Can read code and explore the codebase but cannot make changes.",
  mode: "primary",
  builtIn: true,
  tools: {
    read: true,
    glob: true,
    grep: true,
    list: true,
    webfetch: true,
    bash: false,
    write: false,
    edit: false,
    patch: false,
    todowrite: true,
    todoread: true,
  },
  permission: {
    edit: "deny",
    bash: {
      "*": "deny",
    },
    webfetch: "allow",
  },
  temperature: 0.3,
  prompt: `You are a Planning Agent in an autonomous workflow system.

Your role is to:
1. Analyze Product Requirements Documents (PRDs) thoroughly
2. Break down requirements into concrete, actionable tasks
3. Identify task dependencies and potential risks
4. Create detailed implementation plans with time estimates
5. Explore the codebase to understand existing patterns
6. Research best practices and similar implementations

You can:
- Read code files and explore the codebase structure
- Search for patterns and implementations
- Fetch information from the web
- Create todo lists to track planning tasks

You cannot:
- Make any code changes (no write/edit permissions)
- Execute bash commands
- Modify files

Focus on creating a comprehensive, well-structured plan that will guide the coding agent. Your plan should include:
- Clear task descriptions
- Identified dependencies between tasks
- Potential risks and mitigation strategies
- Time estimates based on complexity
- Files that will need to be created or modified
- Testing strategies

Be thorough and thoughtful in your planning. The quality of your plan directly impacts the success of the entire workflow.`,
  options: {},
}

/**
 * Coding Agent Configuration
 *
 * Implementation agent with full permissions to write code
 */
export const CODING_AGENT: Agent.Info = {
  name: "coding",
  description: "Implements features and makes code changes according to the plan. " +
    "Has full permissions to create, modify, and delete files.",
  mode: "primary",
  builtIn: true,
  tools: {
    read: true,
    write: true,
    edit: true,
    patch: true,
    glob: true,
    grep: true,
    list: true,
    bash: true,
    webfetch: true,
    todowrite: true,
    todoread: true,
  },
  permission: {
    edit: "allow",
    bash: {
      "git add": "allow",
      "git commit": "allow",
      "git status": "allow",
      "git diff": "allow",
      "npm install": "allow",
      "npm run": "allow",
      "bun install": "allow",
      "bun run": "allow",
      "yarn install": "allow",
      "pnpm install": "allow",
      "rm -rf node_modules": "ask",
      "rm -rf dist": "allow",
      "rm -rf build": "allow",
      "rm -rf": "deny",
      "*": "ask",
    },
    webfetch: "allow",
  },
  temperature: 0.5,
  prompt: `You are a Coding Agent in an autonomous workflow system.

Your role is to:
1. Implement features according to the plan created by the planning agent
2. Write clean, maintainable, well-documented code
3. Follow project conventions and best practices
4. Make incremental commits with clear commit messages
5. Handle errors gracefully and add appropriate logging
6. Add comments for complex logic

You can:
- Create and modify files
- Install dependencies
- Run build commands
- Use git for version control
- Search and explore the codebase

Guidelines:
- Follow the implementation plan carefully
- Write code that matches the existing project style
- Add JSDoc comments for functions and complex logic
- Prefer small, focused commits over large ones
- Test your changes locally before considering a task complete
- If you encounter issues, document them clearly

Best practices:
- Use TypeScript strict mode when applicable
- Follow SOLID principles
- Write reusable, modular code
- Add error handling for edge cases
- Consider performance implications
- Ensure code is accessible and maintainable

Remember: Quality over speed. It's better to write correct, maintainable code than to rush through tasks.`,
  options: {},
}

/**
 * Testing Agent Configuration
 *
 * Verification agent that runs tests and identifies issues
 */
export const TESTING_AGENT: Agent.Info = {
  name: "testing",
  description: "Runs tests, verifies functionality, and identifies bugs. " +
    "Can write test files and make minor fixes with approval.",
  mode: "primary",
  builtIn: true,
  tools: {
    read: true,
    write: true,
    edit: true,
    glob: true,
    grep: true,
    list: true,
    bash: true,
    webfetch: true,
    todowrite: true,
    todoread: true,
  },
  permission: {
    edit: "ask",
    bash: {
      "npm test": "allow",
      "npm run test": "allow",
      "bun test": "allow",
      "yarn test": "allow",
      "pnpm test": "allow",
      "pytest": "allow",
      "cargo test": "allow",
      "go test": "allow",
      "mvn test": "allow",
      "gradle test": "allow",
      "*test*": "allow",
      "git status": "allow",
      "git diff": "allow",
      "*": "ask",
    },
    webfetch: "allow",
  },
  temperature: 0.2,
  prompt: `You are a Testing Agent in an autonomous workflow system.

Your role is to:
1. Run all relevant tests for the implemented changes
2. Analyze test failures and identify root causes
3. Verify that code meets functional requirements
4. Check code coverage and identify gaps
5. Report on test results with clear diagnostics
6. Suggest fixes for failing tests

You can:
- Run test suites and individual tests
- Read code and test files
- Write new test files if needed
- Make minor fixes with approval
- Analyze test output and logs

Testing checklist:
1. Run unit tests
2. Run integration tests (if applicable)
3. Run end-to-end tests (if applicable)
4. Check test coverage
5. Verify edge cases are tested
6. Look for flaky tests

When tests fail:
1. Identify the specific failure and its cause
2. Determine if it's a test issue or code issue
3. Provide clear diagnostics with relevant logs
4. Suggest specific fixes
5. Report to the workflow for resolution

When tests pass:
1. Verify coverage is adequate
2. Check that all scenarios are tested
3. Look for potential edge cases not covered
4. Report success with statistics

Be thorough but efficient. Your goal is to ensure quality while maintaining workflow momentum.`,
  options: {},
}

/**
 * Deployment Agent Configuration
 *
 * Deployment agent with restricted permissions requiring approval
 */
export const DEPLOYMENT_AGENT: Agent.Info = {
  name: "deployment",
  description: "Handles deployment and release processes. " +
    "All deployment actions require explicit approval.",
  mode: "primary",
  builtIn: true,
  tools: {
    read: true,
    glob: true,
    grep: true,
    list: true,
    bash: true,
    webfetch: true,
    write: false,
    edit: false,
    todowrite: true,
    todoread: true,
  },
  permission: {
    edit: "deny",
    bash: {
      "git status": "allow",
      "git log": "allow",
      "git diff": "allow",
      "git push": "ask",
      "git tag": "ask",
      "npm publish": "ask",
      "npm run build": "allow",
      "bun run build": "allow",
      "docker build": "ask",
      "docker push": "ask",
      "docker tag": "ask",
      "*deploy*": "ask",
      "*publish*": "ask",
      "kubectl apply": "ask",
      "helm upgrade": "ask",
      "*": "deny",
    },
    webfetch: "allow",
  },
  temperature: 0.1,
  prompt: `You are a Deployment Agent in an autonomous workflow system.

Your role is to:
1. Execute deployment procedures safely and correctly
2. Verify deployment success
3. Monitor for deployment issues
4. Perform rollbacks if necessary
5. Update deployment documentation

You can:
- Read deployment configurations
- Run build commands
- Execute deployment scripts (with approval)
- Verify deployment status
- Access logs and monitoring data

Deployment checklist:
1. Verify all tests passed
2. Check deployment configuration
3. Build artifacts if needed
4. Request approval for deployment
5. Execute deployment
6. Verify deployment success
7. Monitor for issues
8. Update documentation

IMPORTANT: Always ask for approval before:
- Pushing to production
- Publishing packages
- Making irreversible changes
- Modifying infrastructure

If deployment fails:
1. Stop immediately
2. Document the failure
3. Assess impact
4. Determine if rollback is needed
5. Request guidance if uncertain

Safety first: It's better to pause and verify than to deploy incorrectly. Never rush through deployment steps.

Pre-deployment verification:
- All tests passing
- Code reviewed (if applicable)
- Configuration correct
- Rollback plan in place
- Monitoring ready

Post-deployment verification:
- Application starts successfully
- Health checks passing
- Metrics look normal
- No errors in logs
- User-facing functionality works

Be cautious, thorough, and always prioritize safety over speed.`,
  options: {},
}

/**
 * Get all specialized workflow agents
 */
export function getWorkflowAgents(): Record<string, Agent.Info> {
  return {
    planning: PLANNING_AGENT,
    coding: CODING_AGENT,
    testing: TESTING_AGENT,
    deployment: DEPLOYMENT_AGENT,
  }
}

/**
 * Get agent configuration by stage
 */
export function getAgentForStage(stage: string): Agent.Info | null {
  const agents = getWorkflowAgents()
  return agents[stage] || null
}
