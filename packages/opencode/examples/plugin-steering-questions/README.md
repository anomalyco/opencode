# Steering Questions Plugin

Interactive Q&A widget plugin that allows the AI model to ask specific steering questions within the message list, helping guide the conversation and gather requirements before implementation.

## Features

- **Multiple Question Types**: Single choice, multi-choice, and text input
- **Tab-Based Organization**: Group related questions into logical tabs
- **Visual Feedback**: Clear indication of selected options and submission state
- **Required Fields**: Mark questions as required to ensure complete answers
- **Inline Display**: Renders directly in the message stream, not in a sidebar

## Use Cases

- **Architecture Decisions**: Ask about framework choices, styling approaches, database selection
- **Feature Requirements**: Gather specific requirements before implementation
- **Configuration Options**: Let users choose between different implementation approaches
- **Preference Collection**: Understand coding style, naming conventions, test preferences

## How It Works

The plugin registers as a message widget that renders interactive question forms. The AI model can trigger the widget by including structured configuration in its response.

### Question Types

1. **Single Choice**: Radio button style - select one option
2. **Multi Choice**: Checkbox style - select multiple options
3. **Text Input**: Free-form text response

## Example Usage

```typescript
// Example configuration the model would provide
{
  "title": "Project Setup Preferences",
  "description": "Help me configure your project correctly:",
  "tabs": [
    {
      "id": "architecture",
      "label": "Architecture",
      "questions": [
        {
          "id": "framework",
          "label": "Frontend Framework",
          "type": "single-choice",
          "options": ["React", "Vue", "Svelte", "Vanilla JS"],
          "required": true
        }
      ]
    },
    {
      "id": "tooling",
      "label": "Tooling",
      "questions": [
        {
          "id": "styling",
          "label": "Styling Approach",
          "type": "multi-choice",
          "options": ["CSS Modules", "Tailwind", "Styled Components", "SCSS"]
        },
        {
          "id": "notes",
          "label": "Additional Requirements",
          "type": "text",
          "placeholder": "Any specific requirements?"
        }
      ]
    }
  ]
}
```

## Integration

The plugin integrates with OpenCode's message rendering system:

1. Model includes steering question configuration in response
2. Plugin renders interactive widget in message list
3. User interacts with questions (select options, enter text)
4. User submits answers
5. Answers are sent back to the model as context
6. Model uses answers to guide implementation

## Visual Design

- **Boxed Layout**: Questions appear in a bordered box within the message stream
- **Color Coding**: Active selections highlighted in accent color
- **Hover Effects**: Visual feedback on interactive elements
- **Submission State**: Clear indication when answers are submitted

## Limitations

- Text input is simplified (display only) - full implementation would need prompt/dialog integration
- Currently a demonstration of the concept - needs backend integration for answer handling
- No validation rules beyond required fields

## Future Enhancements

- Input validation (regex, min/max length, numeric ranges)
- Conditional questions (show question B only if question A has certain answer)
- File upload questions
- Date/time pickers
- Slider inputs for numeric ranges
- Dependency tracking between questions
- Answer persistence across sessions
- Edit submitted answers

## Installation

```bash
# Add to opencode.jsonc plugins
{
  "plugins": [
    "./examples/plugin-steering-questions"
  ]
}
```

## Architecture

This plugin demonstrates how to:

- Register custom message widgets
- Use SolidJS reactivity in plugin components
- Handle user interactions (mouse events)
- Manage complex form state
- Integrate with OpenCode's theme system
- Provide visual feedback for user actions
