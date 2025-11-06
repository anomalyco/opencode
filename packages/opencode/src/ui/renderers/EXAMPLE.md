# Steering Questions Example

## Test the Widget

To test the steering questions widget, ask the AI to show you one:

```
Show me a steering question asking about framework preferences
```

## Expected AI Response

The AI should respond with something like:

```
I'll create a steering question widget to gather your framework preferences:

<steering-question id="framework-setup">
{
  "title": "Framework Selection",
  "description": "Let me know which technologies you prefer:",
  "questions": [
    {
      "id": "frontend",
      "label": "Frontend Framework",
      "type": "single-choice",
      "options": ["React", "Vue", "Svelte", "Vanilla JS"],
      "required": true
    },
    {
      "id": "styling",
      "label": "Styling Approach (select all that apply)",
      "type": "multi-choice",
      "options": ["Tailwind CSS", "CSS Modules", "Styled Components", "SCSS"]
    },
    {
      "id": "features",
      "label": "Additional Features",
      "type": "multi-choice",
      "options": ["Dark Mode", "i18n", "TypeScript", "Unit Tests"]
    },
    {
      "id": "notes",
      "label": "Special Requirements",
      "type": "text",
      "placeholder": "Any specific needs or constraints?"
    }
  ],
  "submitLabel": "Set Up Project"
}
</steering-question>

Once you submit your choices, I'll configure the project according to your preferences.
```

## What You'll See

### Before Submission

```
┃ Framework Selection
┃ Let me know which technologies you prefer:
┃
┃ Frontend Framework *
┃ ○ React  ○ Vue  ○ Svelte  ○ Vanilla JS
┃
┃ Styling Approach (select all that apply)
┃ ☐ Tailwind CSS  ☐ CSS Modules  ☐ Styled Components  ☐ SCSS
┃
┃ Additional Features
┃ ☐ Dark Mode  ☐ i18n  ☐ TypeScript  ☐ Unit Tests
┃
┃ Special Requirements
┃ Any specific needs or constraints?
┃
┃ ○ Set Up Project (complete required fields)
```

### With Selections

After clicking options (assuming you selected React and Tailwind):

```
┃ Framework Selection
┃ Let me know which technologies you prefer:
┃
┃ Frontend Framework *
┃ ◉ React  ○ Vue  ○ Svelte  ○ Vanilla JS
┃
┃ Styling Approach (select all that apply)
┃ ☑ Tailwind CSS  ☐ CSS Modules  ☐ Styled Components  ☐ SCSS
┃
┃ Additional Features
┃ ☑ Dark Mode  ☑ TypeScript  ☐ i18n  ☐ Unit Tests
┃
┃ Special Requirements
┃ Any specific needs or constraints?
┃
┃ ▶ Set Up Project
```

### After Submission

```
┃ Framework Selection
┃ Let me know which technologies you prefer:
┃
┃ ✓ Answers Submitted
┃ Frontend Framework: React
┃ Styling Approach: Tailwind CSS
┃ Additional Features: Dark Mode, TypeScript
```

Then a user message is automatically sent:

```
Steering question answers:

**frontend**: React
**styling**: Tailwind CSS
**features**: Dark Mode, TypeScript
```

## Real Use Cases

### 1. Architecture Decisions

```
I need to build a web application but I want to understand your preferences first.

<steering-question id="architecture">
{
  "title": "Architecture Decisions",
  "questions": [
    {
      "id": "backend",
      "label": "Backend Framework",
      "type": "single-choice",
      "options": ["Express", "Fastify", "Hono", "Bun native"],
      "required": true
    },
    {
      "id": "database",
      "label": "Database",
      "type": "single-choice",
      "options": ["PostgreSQL", "MySQL", "SQLite", "MongoDB"],
      "required": true
    },
    {
      "id": "deployment",
      "label": "Deployment Target",
      "type": "single-choice",
      "options": ["Docker", "Serverless", "VPS", "Vercel/Netlify"],
      "required": true
    }
  ]
}
</steering-question>
```

### 2. Feature Selection

```
Let's configure which features to include:

<steering-question id="features">
{
  "title": "Feature Configuration",
  "description": "Select the features you want to enable:",
  "questions": [
    {
      "id": "auth",
      "label": "Authentication",
      "type": "multi-choice",
      "options": ["Email/Password", "OAuth (Google, GitHub)", "Magic Links", "2FA"]
    },
    {
      "id": "features",
      "label": "Additional Features",
      "type": "multi-choice",
      "options": ["File Uploads", "Real-time Updates", "Analytics", "Search", "Comments"]
    }
  ]
}
</steering-question>
```

### 3. Configuration Settings

```
I need to configure some settings:

<steering-question id="config">
{
  "title": "Application Configuration",
  "questions": [
    {
      "id": "environment",
      "label": "Environment",
      "type": "single-choice",
      "options": ["Development", "Staging", "Production"],
      "required": true
    },
    {
      "id": "port",
      "label": "Port Number",
      "type": "text",
      "placeholder": "3000",
      "required": true
    },
    {
      "id": "domain",
      "label": "Domain Name",
      "type": "text",
      "placeholder": "example.com"
    }
  ]
}
</steering-question>
```

### 4. Bug Fix Approach

```
I found the issue. How would you like me to fix it?

<steering-question id="fix-approach">
{
  "title": "Fix Strategy",
  "description": "There are multiple ways to address this bug:",
  "questions": [
    {
      "id": "approach",
      "label": "Preferred Approach",
      "type": "single-choice",
      "options": [
        "Quick fix (minimal changes)",
        "Refactor (improve code structure)",
        "Rewrite (cleanest solution)"
      ],
      "required": true
    },
    {
      "id": "tests",
      "label": "Testing",
      "type": "single-choice",
      "options": [
        "Add unit tests",
        "Add integration tests",
        "Manual testing only"
      ]
    }
  ]
}
</steering-question>
```

## Widget States

### Loading State
While streaming, the widget may appear incomplete - this is normal and expected.

### Interactive State
All options are clickable:
- **Single choice**: Click to select (radio behavior)
- **Multi choice**: Click to toggle (checkbox behavior)
- **Text**: Click to enter text (requires prompt integration)

### Validation State
- Required fields show `*` indicator
- Submit button disabled until all required fields answered
- Visual feedback on hover

### Submitted State
- Green checkmark
- Summary of answers
- Widget no longer interactive
- Answers sent as user message

## Tips for AI Usage

When the AI wants to use steering questions effectively:

1. **Be specific with labels** - Clear, concise question text
2. **Limit options** - 3-6 options is ideal for readability
3. **Group related questions** - Keep related choices together
4. **Use descriptions** - Help users understand the context
5. **Mark important fields required** - Ensure critical info is gathered
6. **Provide good defaults** - Order options by commonality
7. **Give meaningful IDs** - Use descriptive question IDs for clarity

## Debugging

If the widget doesn't render:

1. **Check JSON syntax** - Ensure valid JSON in widget content
2. **Check pattern match** - Opening and closing tags must be present
3. **Check console logs** - Look for widget detection messages
4. **Verify questions array** - Must be a valid array with objects

Debug logs appear as:
```
[MessageWidgets.detect] Found INCOMPLETE widget: steering-question
[PluginComponent] ✓ Found core widget: steering-question
```
