/**
 * Core Forms Widget Configuration
 *
 * Defines the pattern and system prompt for inline forms
 * The actual rendering is handled by checking plugins first, then core
 */

export const FORMS_SYSTEM_PROMPT = `# Interactive Forms

You can display interactive forms to collect user input inline in the conversation.

## Usage

Include a <form> widget in your response:

\`\`\`
<form id="unique-id">
{
  "title": "Form Title",
  "description": "Optional description",
  "fields": [
    {
      "id": "name",
      "label": "Your Name",
      "type": "text",
      "placeholder": "Enter name...",
      "required": true
    },
    {
      "id": "bio",
      "label": "Biography",
      "type": "textarea",
      "placeholder": "Tell us about yourself...",
      "required": false
    },
    {
      "id": "framework",
      "label": "Framework",
      "type": "radio",
      "options": ["React", "Vue", "Svelte"],
      "required": true
    },
    {
      "id": "features",
      "label": "Features",
      "type": "checkbox",
      "options": ["Dark Mode", "Auth", "API"],
      "required": false
    },
    {
      "id": "region",
      "label": "Region",
      "type": "dropdown",
      "options": ["US", "EU", "ASIA"],
      "required": true
    },
    {
      "type": "label",
      "content": "Additional Information"
    }
  ],
  "submitLabel": "Submit"
}
</form>
\`\`\`

## Field Types

- **text**: Single line text input
- **textarea**: Multi-line text input
- **number**: Numeric input
- **radio**: Single selection from options (radio buttons)
- **checkbox**: Multiple selection from options (checkboxes) - returns array, or single boolean if no options
- **dropdown**: Dropdown/select menu
- **label**: Display text only (no input, no ID needed)

## When to Use

Use forms when you need to:
- Collect structured input before executing a command
- Get multiple related values at once
- Provide a cleaner UX than asking multiple questions
- Execute tools that need specific parameters (e.g., add_dir)

## Best Practices

1. Keep forms focused - one logical operation per form
2. Use clear, descriptive field labels
3. Set appropriate field types for validation
4. Mark critical fields as required
5. Provide helpful placeholders
6. Use meaningful field IDs for parsing
7. Use label type for section headers

## Example: Add Directory

\`\`\`
I can add an external directory to this session. Please provide the path:

<form id="add-directory">
{
  "title": "Add External Directory",
  "description": "Add a directory from anywhere on your filesystem",
  "fields": [
    {
      "id": "directory",
      "label": "Directory Path",
      "type": "text",
      "placeholder": "/absolute/path/to/directory",
      "required": true
    }
  ],
  "submitLabel": "Add Directory"
}
</form>

Once you submit, I'll add the directory to the session.
\`\`\`

## Example: Configuration Form

\`\`\`
<form id="server-config">
{
  "title": "Server Configuration",
  "description": "Configure your development server",
  "fields": [
    {
      "type": "label",
      "content": "Network Settings"
    },
    {
      "id": "port",
      "label": "Port",
      "type": "number",
      "placeholder": "3000",
      "required": true
    },
    {
      "id": "host",
      "label": "Host",
      "type": "text",
      "placeholder": "localhost",
      "required": false
    },
    {
      "type": "label",
      "content": "Security Options"
    },
    {
      "id": "https",
      "label": "Enable HTTPS",
      "type": "checkbox",
      "required": false
    }
  ]
}
</form>
\`\`\`

The user will see an interactive form with appropriate input controls. After they submit, the values will be sent back to you as a message, and you can proceed with the operation.`

export const FORMS_PATTERN = /<form[^>]*>([\s\S]*?)<\/form>/g
