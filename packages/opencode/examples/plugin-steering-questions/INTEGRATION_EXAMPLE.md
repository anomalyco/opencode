# Integration Example: Model-Driven Steering Questions

This document shows how an AI model could use steering questions to guide conversations.

## Conversation Flow Example

### Step 1: User Request

```
User: "I need to build a task management web application"
```

### Step 2: Model Triggers Steering Questions

```
Assistant: "I'd be happy to help you build a task management application!
To ensure I create exactly what you need, let me gather some requirements first."

[Steering Question Widget Appears]
```

### Step 3: Model Provides Configuration

The model would output structured data (via a tool call or special syntax) like:

```json
{
  "type": "steering-question",
  "config": {
    "title": "Task Management App - Architecture Decisions",
    "description": "Please help me understand your preferences:",
    "tabs": [
      {
        "id": "frontend",
        "label": "Frontend",
        "questions": [
          {
            "id": "framework",
            "label": "Which framework would you prefer?",
            "type": "single-choice",
            "options": ["React", "Vue", "Svelte", "Next.js", "Nuxt.js"],
            "required": true
          },
          {
            "id": "features",
            "label": "Which features are most important?",
            "type": "multi-choice",
            "options": [
              "Drag & drop tasks",
              "Real-time collaboration",
              "Offline support",
              "Mobile responsive",
              "Dark mode"
            ],
            "required": true
          }
        ]
      },
      {
        "id": "backend",
        "label": "Backend",
        "questions": [
          {
            "id": "database",
            "label": "Database preference?",
            "type": "single-choice",
            "options": ["PostgreSQL", "MongoDB", "SQLite", "Firebase", "Supabase"],
            "required": true
          },
          {
            "id": "auth",
            "label": "Authentication method?",
            "type": "single-choice",
            "options": ["Email/Password", "OAuth (Google, GitHub)", "Magic Links", "Auth0"],
            "required": true
          }
        ]
      },
      {
        "id": "deployment",
        "label": "Deployment",
        "questions": [
          {
            "id": "hosting",
            "label": "Where will you deploy?",
            "type": "single-choice",
            "options": ["Vercel", "Netlify", "AWS", "DigitalOcean", "Self-hosted"],
            "required": true
          },
          {
            "id": "cicd",
            "label": "CI/CD preferences?",
            "type": "multi-choice",
            "options": ["GitHub Actions", "GitLab CI", "CircleCI", "Manual deployment", "None"],
            "required": false
          }
        ]
      },
      {
        "id": "preferences",
        "label": "Code Style",
        "questions": [
          {
            "id": "typescript",
            "label": "Use TypeScript?",
            "type": "single-choice",
            "options": ["Yes, strict mode", "Yes, but lenient", "No, JavaScript only"],
            "required": true
          },
          {
            "id": "testing",
            "label": "Testing setup?",
            "type": "multi-choice",
            "options": [
              "Unit tests (Vitest)",
              "E2E tests (Playwright)",
              "Integration tests",
              "None"
            ],
            "required": false
          }
        ]
      }
    ],
    "submitLabel": "Start Building"
  }
}
```

### Step 4: User Interacts

User navigates through tabs and selects:

- **Frontend Tab**: React, [Drag & drop, Real-time, Dark mode]
- **Backend Tab**: PostgreSQL, OAuth (Google, GitHub)
- **Deployment Tab**: Vercel, [GitHub Actions]
- **Code Style Tab**: Yes (strict mode), [Unit tests, E2E tests]

Clicks "Start Building"

### Step 5: Answers Sent to Model

The submitted answers are formatted and sent back:

```json
{
  "type": "steering-answers",
  "questionnaireId": "task-management-architecture",
  "answers": {
    "framework": "React",
    "features": ["Drag & drop tasks", "Real-time collaboration", "Dark mode"],
    "database": "PostgreSQL",
    "auth": "OAuth (Google, GitHub)",
    "hosting": "Vercel",
    "cicd": ["GitHub Actions"],
    "typescript": "Yes, strict mode",
    "testing": ["Unit tests (Vitest)", "E2E tests (Playwright)"]
  }
}
```

### Step 6: Model Uses Context

```
Assistant: "Perfect! Based on your choices, I'll build a task management application with:

✓ React (TypeScript strict mode)
✓ Features: Drag & drop, real-time collaboration, dark mode
✓ PostgreSQL database with OAuth authentication
✓ Deployed on Vercel with GitHub Actions CI/CD
✓ Full test coverage (Vitest + Playwright)

Let me start by setting up the project structure..."

[Model proceeds with implementation using the gathered requirements]
```

## Implementation Approaches

### Approach 1: Tool Call (Recommended)

Model has a `show_steering_questions` tool:

```typescript
{
  name: "show_steering_questions",
  description: "Display interactive questions to gather user requirements",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      tabs: { type: "array", items: { ... } }
    }
  }
}
```

Model calls tool → Widget appears → User answers → Answers sent as next user message

### Approach 2: Structured Output

Model outputs special markers:

```markdown
<steering-questions>
{
  "title": "...",
  "tabs": [...]
}
</steering-questions>
```

Parser detects marker → Renders widget → Answers collected

### Approach 3: Message Part

Extend message parts to include "steering-question" type alongside "text", "tool", "reasoning"

## Benefits

1. **Precise Requirements**: Model gathers exact specifications before coding
2. **User Control**: User explicitly chooses options rather than implicit assumptions
3. **Context Efficiency**: Structured answers more concise than natural language back-and-forth
4. **Better Outcomes**: Implementation matches user expectations first time
5. **Reduced Iterations**: Fewer "actually, I wanted X not Y" messages

## Real-World Use Cases

### Use Case 1: API Design

```
Questions:
- REST or GraphQL?
- Authentication method?
- Rate limiting needed?
- Versioning strategy?
- Documentation format (OpenAPI, GraphQL schema)?
```

### Use Case 2: Database Schema

```
Questions:
- Relationships (one-to-many, many-to-many)?
- Soft deletes?
- Timestamps (created, updated)?
- Audit logging?
- Indexing preferences?
```

### Use Case 3: UI Component

```
Questions:
- Size variants (sm, md, lg)?
- Color themes?
- Animation preferences?
- Accessibility features (ARIA labels, keyboard nav)?
- Responsive behavior?
```

### Use Case 4: Code Refactoring

```
Questions:
- Target code style (functional, OOP)?
- Breaking changes acceptable?
- Test coverage required?
- Documentation level?
- Performance priority vs readability?
```

## Technical Integration

### Backend Handler

```typescript
// When user submits answers
async function handleSteeringAnswers(sessionId: string, answers: SteeringAnswers) {
  // Store answers in session context
  await storeSessionContext(sessionId, {
    type: "steering-answers",
    data: answers,
    timestamp: Date.now(),
  })

  // Append to conversation as system message
  await appendMessage(sessionId, {
    role: "system",
    content: `User provided requirements: ${JSON.stringify(answers)}`,
  })

  // Continue conversation
  await resumeConversation(sessionId)
}
```

### Frontend Detection

```typescript
// Parse model output for steering question triggers
function parseSteeringQuestions(text: string): SteeringConfig | null {
  const match = text.match(/<steering-questions>(.*?)<\/steering-questions>/s)
  if (!match) return null

  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}
```

## Future Enhancements

1. **Conditional Logic**: Show question B only if question A = "Yes"
2. **Validation Rules**: Regex patterns, min/max values
3. **Nested Questions**: Sub-questions based on parent selection
4. **Dynamic Options**: Load options from API (e.g., available libraries)
5. **Templates**: Pre-built question sets for common scenarios
6. **Answer History**: Remember previous choices for similar projects
7. **AI Suggestions**: Model recommends options based on context
8. **Visual Previews**: Show examples for design-related choices

## Best Practices

### When to Use

✅ Complex projects with many configuration options
✅ When requirements are unclear or ambiguous
✅ User is unsure what options are available
✅ Multiple valid approaches exist
✅ Choices significantly impact implementation

### When NOT to Use

❌ Simple, obvious tasks ("fix this typo")
❌ User already provided clear specifications
❌ Only one reasonable approach
❌ Would slow down trivial operations

### Question Design

- Keep options concise (1-3 words each)
- Group related questions in tabs
- Mark truly required fields only
- Provide reasonable defaults where possible
- Use multi-choice sparingly (cognitive load)
- Order tabs logically (most important first)

## Conclusion

Steering questions bridge the gap between natural language requests and structured requirements. They empower users to guide the AI precisely while maintaining conversational flow.
