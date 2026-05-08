<!-- Context: workflows/task-breakdown | Priority: high | Version: 2.0 | Updated: 2025-01-21 -->

# Task Breakdown Guidelines

## Quick Reference

**When to Use**: 4+ files, >60 min effort, complex dependencies, multi-step coordination

**Process**: Scope → Phases → Small Tasks (1-2h) → Dependencies → Estimates

**Template Sections**: Overview, Prerequisites, Tasks (by Phase), Testing Strategy, Total Estimate, Notes

**Best Practices**: Keep tasks small (1-2h), make dependencies clear, include verification, be realistic with estimates

---

## Purpose
Framework for breaking down complex tasks into manageable, sequential subtasks.

## When to Use
Reference this when:
- Task involves 4+ files
- Estimated effort >60 minutes
- Complex dependencies exist
- Multi-step coordination needed
- User requests task breakdown

## Breakdown Process

### 1. Understand the Full Scope
- What's the complete requirement?
- What are all the components needed?
- What's the end goal?
- What are the constraints?

### 2. Identify Major Phases
- What are the logical groupings?
- What must happen first?
- What can happen in parallel?
- What depends on what?

### 3. Break Into Small Tasks
- Each task should be 1-2 hours max
- Clear, actionable items
- Independently completable
- Easy to verify completion

### 4. Define Dependencies
- What must be done first?
- What can be done in parallel?
- What blocks what?
- What's the critical path?

### 5. Estimate Effort
- Realistic time estimates
- Include testing time
- Account for unknowns
- Add buffer for complexity

## Breakdown Template

```markdown
# Task Breakdown: {Task Name}

## Overview
{1-2 sentence description of what we're building}

## Prerequisites
- [ ] {Prerequisite 1}
- [ ] {Prerequisite 2}

## Tasks

### Phase 1: {Phase Name}
**Goal:** {What this phase accomplishes}

- [ ] **Task 1.1:** {Description}
  - **Files:** {files to create/modify}
  - **Estimate:** {time estimate}
  - **Dependencies:** {none / task X}
  - **Verification:** {how to verify it's done}

- [ ] **Task 1.2:** {Description}
  - **Files:** {files to create/modify}
  - **Estimate:** {time estimate}
  - **Dependencies:** {task 1.1}
  - **Verification:** {how to verify it's done}

### Phase 2: {Phase Name}
**Goal:** {What this phase accomplishes}

- [ ] **Task 2.1:** {Description}
  - **Files:** {files to create/modify}
  - **Estimate:** {time estimate}
  - **Dependencies:** {phase 1 complete}
  - **Verification:** {how to verify it's done}

## Testing Strategy
- [ ] Unit tests for {component}
- [ ] Integration tests for {flow}
- [ ] Manual testing: {scenarios}

## Total Estimate
**Time:** {X} hours
**Complexity:** {Low / Medium / High}

## Notes
{Any important context, decisions, or considerations}
```

## Example Breakdown

```markdown
# Task Breakdown: User Authentication System

## Overview
Build authentication system with login, registration, and password reset.

## Prerequisites
- [ ] Database schema designed
- [ ] Email service configured

## Tasks

### Phase 1: Core Authentication
**Goal:** Basic login/logout functionality

- [ ] **Task 1.1:** Create user model and database schema
  - **Files:** `models/user.js`, `migrations/001_users.sql`
  - **Estimate:** 1 hour
  - **Dependencies:** none
  - **Verification:** Can create user in database

- [ ] **Task 1.2:** Implement password hashing
  - **Files:** `utils/password.js`
  - **Estimate:** 30 min
  - **Dependencies:** Task 1.1
  - **Verification:** Passwords are hashed, not plain text

- [ ] **Task 1.3:** Create login endpoint
  - **Files:** `routes/auth.js`, `controllers/auth.js`
  - **Estimate:** 1.5 hours
  - **Dependencies:** Task 1.1, 1.2
  - **Verification:** Can login with valid credentials

### Phase 2: Registration
**Goal:** New user registration

- [ ] **Task 2.1:** Create registration endpoint
  - **Files:** `routes/auth.js`, `controllers/auth.js`
  - **Estimate:** 1 hour
  - **Dependencies:** Phase 1 complete
  - **Verification:** Can create new user account

- [ ] **Task 2.2:** Add email validation
  - **Files:** `utils/validation.js`
  - **Estimate:** 30 min
  - **Dependencies:** Task 2.1
  - **Verification:** Invalid emails rejected

### Phase 3: Password Reset
**Goal:** Users can reset forgotten passwords

- [ ] **Task 3.1:** Generate reset tokens
  - **Files:** `utils/tokens.js`
  - **Estimate:** 1 hour
  - **Dependencies:** Phase 1 complete
  - **Verification:** Tokens generated and validated

- [ ] **Task 3.2:** Create reset endpoints
  - **Files:** `routes/auth.js`, `controllers/auth.js`
  - **Estimate:** 1.5 hours
  - **Dependencies:** Task 3.1
  - **Verification:** Can request and complete password reset

- [ ] **Task 3.3:** Send reset emails
  - **Files:** `services/email.js`
  - **Estimate:** 1 hour
  - **Dependencies:** Task 3.2
  - **Verification:** Reset emails sent successfully

## Testing Strategy
- [ ] Unit tests for password hashing
- [ ] Unit tests for token generation
- [ ] Integration tests for login flow
- [ ] Integration tests for registration flow
- [ ] Integration tests for password reset flow
- [ ] Manual testing: Complete user journey

## Total Estimate
**Time:** 8.5 hours
**Complexity:** Medium

## Notes
- Use bcrypt for password hashing (industry standard)
- Reset tokens expire after 1 hour
- Rate limit password reset requests
- Email service must be configured before Phase 3
```

## Best Practices

### Keep Tasks Small
- 1-2 hours maximum per task
- If larger, break it down further
- Each task should be completable in one sitting

### Make Dependencies Clear
- Explicitly state what must be done first
- Identify parallel work opportunities
- Note blocking dependencies

### Include Verification
- How do you know the task is done?
- What should work when complete?
- How can it be tested?

### Be Realistic with Estimates
- Include time for testing
- Account for unknowns
- Add buffer for complexity
- Better to overestimate than underestimate

### Group Related Work
- Organize by feature or component
- Keep related tasks together
- Make phases logical and cohesive

## Common Patterns

### Database-First Pattern
1. Design schema
2. Create migrations
3. Build models
4. Implement business logic
5. Add API endpoints
6. Write tests

### Feature-First Pattern
1. Define requirements
2. Design interface
3. Implement core logic
4. Add error handling
5. Write tests
6. Document usage

### Refactoring Pattern
1. Add tests for existing behavior
2. Refactor small section
3. Verify tests still pass
4. Repeat for next section
5. Clean up and optimize
6. Update documentation

## Quick Reference

**Good breakdown:**
- Small, focused tasks (1-2 hours)
- Clear dependencies
- Realistic estimates
- Verification criteria
- Logical phases

**Breakdown checklist:**
- [ ] All requirements captured
- [ ] Tasks are small and focused
- [ ] Dependencies identified
- [ ] Estimates are realistic
- [ ] Testing included
- [ ] Verification criteria clear
