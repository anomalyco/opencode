# Sample Steering Form

This demonstrates how to use the steering questions plugin in OpenCode to gather user requirements before implementing features.

## Example: Building a Todo App

Here's how you would use a steering form to gather requirements for building a todo application:

```
I'll help you build a todo application. Let me first understand your requirements and preferences:

<steering-question id="todo-app-requirements">
{
  "title": "Todo App Configuration",
  "description": "Please specify your preferences for the todo application:",
  "questions": [
    {
      "id": "framework",
      "label": "Frontend Framework",
      "type": "single-choice",
      "options": ["React", "Vue", "Svelte", "Vanilla JavaScript"],
      "required": true
    },
    {
      "id": "features",
      "label": "Required Features",
      "type": "multi-choice",
      "options": [
        "Due dates", 
        "Priority levels", 
        "Categories/tags", 
        "Search functionality", 
        "Bulk operations", 
        "Data persistence",
        "Dark mode"
      ],
      "required": false
    },
    {
      "id": "styling",
      "label": "Styling Approach",
      "type": "single-choice",
      "options": ["Tailwind CSS", "CSS Modules", "Styled Components", "Plain CSS"],
      "required": true
    },
    {
      "id": "data-storage",
      "label": "Data Storage",
      "type": "single-choice",
      "options": ["Local Storage", "IndexedDB", "JSON file", "REST API"],
      "required": true
    },
    {
      "id": "special-requirements",
      "label": "Special Requirements",
      "type": "text",
      "placeholder": "Any specific requirements, constraints, or preferences?",
      "required": false
    }
  ],
  "submitLabel": "Start Building"
}
</steering-question>

Once you submit your preferences, I'll create a customized todo application that matches your exact specifications.
```

## Example: API Design

Here's another example for designing an API:

```
Let me understand the requirements for your REST API:

<steering-question id="api-design">
{
  "title": "API Design Preferences", 
  "description": "Help me design the perfect API for your needs:",
  "questions": [
    {
      "id": "authentication",
      "label": "Authentication Method",
      "type": "single-choice", 
      "options": ["JWT tokens", "Session cookies", "API keys", "OAuth 2.0", "No authentication"],
      "required": true
    },
    {
      "id": "database",
      "label": "Database Technology",
      "type": "single-choice",
      "options": ["PostgreSQL", "MySQL", "MongoDB", "SQLite", "Redis"],
      "required": true
    },
    {
      "id": "features",
      "label": "Required Features",
      "type": "multi-choice",
      "options": [
        "Rate limiting",
        "Request logging", 
        "Error handling middleware",
        "Input validation",
        "API documentation",
        "CORS configuration",
        "Caching"
      ],
      "required": false
    },
    {
      "id": "framework",
      "label": "Backend Framework",
      "type": "single-choice",
      "options": ["Express.js", "Fastify", "Koa.js", "NestJS", "Hapi.js"],
      "required": true
    },
    {
      "id": "endpoints",
      "label": "Core Endpoints Needed",
      "type": "text", 
      "placeholder": "List the main endpoints you need (e.g., users, posts, comments)",
      "required": false
    }
  ],
  "submitLabel": "Generate API"
}
</steering-question>
```

## How It Works

1. **Model Response**: The AI includes the steering question widget in its message
2. **User Interaction**: User sees clickable options and can make selections
3. **Form Submission**: When user clicks submit, their answers are sent back as a new message
4. **Implementation**: AI receives the answers and proceeds with implementation based on user preferences

## Question Types

- **single-choice**: Radio buttons (○ ◉) - user picks one option
- **multi-choice**: Checkboxes (☐ ☑) - user picks multiple options  
- **text**: Text input field - user types custom text

## Best Practices

1. **Group related questions** - Keep related decisions together
2. **Use clear labels** - Make questions easy to understand
3. **Provide good options** - Give 3-6 meaningful choices for selection questions
4. **Mark required fields** - Use `"required": true` for critical decisions
5. **Add descriptions** - Help users understand what they're choosing
6. **Meaningful IDs** - Use descriptive question IDs for easier processing

## Processing Answers

When the user submits, you'll receive a message like:

```
Steering Question Answers:
- Framework: React
- Features: Due dates, Priority levels, Dark mode
- Styling: Tailwind CSS
- Data Storage: Local Storage
- Special Requirements: Please make it mobile-responsive
```

You can then use these answers to customize your implementation approach.