/**
 * Simple Steering Questions Plugin (No JSX)
 * Direct export that works with Bun runtime
 */

const SteeringQuestionsPlugin = async () => {
  return {
    "ui.register": async (_input, output) => {
      output.messageWidgets = [
        {
          id: "steering-question",
          pattern: /<steering-question[^>]*>([\s\S]*?)<\/steering-question>/g,
          systemPrompt: `# Steering Questions

You can ask the user interactive questions to gather requirements before implementing features.

## Usage

Include a <steering-question> widget in your response:

\`\`\`
<steering-question id="unique-id">
{
  "title": "Title of the question set",
  "description": "Optional description",
  "questions": [
    {
      "id": "question-id",
      "label": "Question Label",
      "type": "single-choice",
      "options": ["Option 1", "Option 2", "Option 3"],
      "required": true
    }
  ],
  "submitLabel": "Continue"
}
</steering-question>
\`\`\`

The user will see an interactive widget with clickable options.`,
        },
      ]
    },

    "ui.render": async (input, output) => {
      const { componentId, context } = input
      
      if (componentId === "steering-question") {
        // Return a component function (not JSX, but a valid OpenTUI component)
        const SteeringQuestion = () => {
          const config = context.config || {}
          const title = config.title || "Question"
          const description = config.description || ""
          const questions = config.questions || []
          
          // Return OpenTUI element structure directly (without JSX)
          return {
            type: "box",
            props: {
              padding: 1,
              border: "single",
              borderColor: "blue",
            },
            children: [
              {
                type: "text",
                props: { 
                  content: `📋 ${title}`,
                  fg: "#00aaff",
                  bold: true
                }
              },
              description && {
                type: "text",
                props: { 
                  content: description,
                  fg: "#888888"
                }
              },
              ...questions.map((q, i) => ({
                type: "text",
                props: {
                  content: `\n${i + 1}. ${q.label} (${q.type})${q.required ? ' *' : ''}`,
                  fg: "#ffffff"
                }
              }))
            ].filter(Boolean)
          }
        }
        
        output.component = SteeringQuestion
        output.type = "component"
      }
    },
  }
}

export default SteeringQuestionsPlugin
