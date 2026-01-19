# Create Wireframe - Workflow Instructions

```xml
<critical>The workflow execution engine is governed by: {project-root}/_bmad/core/tasks/workflow.xml</critical>
<critical>You MUST have already loaded and processed: {installed_path}/workflow.yaml</critical>
<critical>This workflow creates website or app wireframes in Excalidraw format.</critical>

<workflow>

  <step n="0" goal="Contextual Analysis">
    <action>Review user's request and extract: wireframe type, fidelity level, screen count, device type, save location</action>
    <check if="ALL requirements clear"><action>Skip to Step 5</action></check>
  </step>

  <step n="1" goal="Identify Wireframe Type" elicit="true">
    <action>Ask: "What type of wireframe do you need?"</action>
    <action>Present options:
      1. Website (Desktop)
      2. Mobile App (iOS/Android)
      3. Web App (Responsive)
      4. Tablet App
      5. Multi-platform
    </action>
    <action>WAIT for selection</action>
  </step>

  <step n="2" goal="Gather Requirements" elicit="true">
    <action>Ask fidelity level (Low/Medium/High)</action>
    <action>Ask screen count (Single/Few 2-3/Multiple 4-6/Many 7+)</action>
    <action>Ask device dimensions or use standard</action>
    <action>Ask save location</action>
  </step>

  <step n="3" goal="Check Theme" elicit="true">
    <action>Check for existing theme.json, ask to use if exists</action>
  </step>

  <step n="4" goal="Create Theme" elicit="true">
    <action>Ask: "Choose a wireframe style:"</action>
    <action>Present numbered options:
      1. Classic Wireframe
         - Background: #ffffff (white)
         - Container: #f5f5f5 (light gray)
         - Border: #9e9e9e (gray)
         - Text: #424242 (dark gray)

      2. High Contrast
         - Background: #ffffff (white)
         - Container: #eeeeee (light gray)
         - Border: #212121 (black)
         - Text: #000000 (black)

      3. Blueprint Style
         - Background: #1a237e (dark blue)
         - Container: #3949ab (blue)
         - Border: #7986cb (light blue)
         - Text: #ffffff (white)

      4. Custom - Define your own colors
    </action>
    <action>WAIT for selection</action>
    <action>Create theme.json based on selection</action>
    <action>Confirm with user</action>
  </step>

  <step n="5" goal="Plan Wireframe Structure">
    <action>List all screens and their purposes</action>
    <action>Map navigation flow between screens</action>
    <action>Identify key UI elements for each screen</action>
    <action>Show planned structure, confirm with user</action>
  </step>

  <step n="6" goal="Load Resources">
    <action>Load {{templates}} and extract `wireframe` section</action>
    <action>Load {{library}}</action>
    <action>Load theme.json</action>
    <action>Load {{helpers}}</action>
  </step>

  <step n="7" goal="Build Wireframe Elements">
    <critical>Follow {{helpers}} for proper element creation</critical>

    <substep>For Each Screen:
      - Create container/frame
      - Add header section
      - Add content areas
      - Add navigation elements
      - Add interactive elements (buttons, inputs)
      - Add labels and annotations
    </substep>

    <substep>Build Order:
      1. Screen containers
      2. Layout sections (header, content, footer)
      3. Navigation elements
      4. Content blocks
      5. Interactive elements
      6. Labels and annotations
      7. Flow indicators (if multi-screen)
    </substep>

    <substep>Fidelity Guidelines:
      - Low: Basic shapes, minimal detail, placeholder text
      - Medium: More defined elements, some styling, representative content
      - High: Detailed elements, realistic sizing, actual content examples
    </substep>
  </step>

  <step n="8" goal="Optimize and Save">
    <action>Strip unused elements and elements with isDeleted: true</action>
    <action>Save to {{default_output_file}}</action>
  </step>

  <step n="9" goal="Validate JSON Syntax">
    <critical>NEVER delete the file if validation fails - always fix syntax errors</critical>
    <action>Run: node -e "JSON.parse(require('fs').readFileSync('{{default_output_file}}', 'utf8')); console.log('✓ Valid JSON')"</action>
    <check if="validation fails (exit code 1)">
      <action>Read the error message carefully - it shows the syntax error and position</action>
      <action>Open the file and navigate to the error location</action>
      <action>Fix the syntax error (add missing comma, bracket, or quote as indicated)</action>
      <action>Save the file</action>
      <action>Re-run validation with the same command</action>
      <action>Repeat until validation passes</action>
    </check>
    <action>Once validation passes, confirm with user</action>
  </step>

  <step n="10" goal="Validate Content">
    <invoke-task>Validate against {{validation}}</invoke-task>
  </step>

</workflow>
```
