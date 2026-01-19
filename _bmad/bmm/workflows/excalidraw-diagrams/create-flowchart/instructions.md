# Create Flowchart - Workflow Instructions

```xml
<critical>The workflow execution engine is governed by: {project-root}/_bmad/core/tasks/workflow.xml</critical>
<critical>You MUST have already loaded and processed: {installed_path}/workflow.yaml</critical>
<critical>This workflow creates a flowchart visualization in Excalidraw format for processes, pipelines, or logic flows.</critical>

<workflow>

  <step n="0" goal="Contextual Analysis (Smart Elicitation)">
    <critical>Before asking any questions, analyze what the user has already told you</critical>

    <action>Review the user's initial request and conversation history</action>
    <action>Extract any mentioned: flowchart type, complexity, decision points, save location</action>

    <check if="ALL requirements are clear from context">
      <action>Summarize your understanding</action>
      <action>Skip directly to Step 4 (Plan Flowchart Layout)</action>
    </check>

    <check if="SOME requirements are clear">
      <action>Note what you already know</action>
      <action>Only ask about missing information in Step 1</action>
    </check>

    <check if="requirements are unclear or minimal">
      <action>Proceed with full elicitation in Step 1</action>
    </check>
  </step>

  <step n="1" goal="Gather Requirements" elicit="true">
    <action>Ask Question 1: "What type of process flow do you need to visualize?"</action>
    <action>Present numbered options:
      1. Business Process Flow - Document business workflows, approval processes, or operational procedures
      2. Algorithm/Logic Flow - Visualize code logic, decision trees, or computational processes
      3. User Journey Flow - Map user interactions, navigation paths, or experience flows
      4. Data Processing Pipeline - Show data transformation, ETL processes, or processing stages
      5. Other - Describe your specific flowchart needs
    </action>
    <action>WAIT for user selection (1-5)</action>

    <action>Ask Question 2: "How many main steps are in this flow?"</action>
    <action>Present numbered options:
      1. Simple (3-5 steps) - Quick process with few decision points
      2. Medium (6-10 steps) - Standard workflow with some branching
      3. Complex (11-20 steps) - Detailed process with multiple decision points
      4. Very Complex (20+ steps) - Comprehensive workflow requiring careful layout
    </action>
    <action>WAIT for user selection (1-4)</action>
    <action>Store selection in {{complexity}}</action>

    <action>Ask Question 3: "Does your flow include decision points (yes/no branches)?"</action>
    <action>Present numbered options:
      1. No decisions - Linear flow from start to end
      2. Few decisions (1-2) - Simple branching with yes/no paths
      3. Multiple decisions (3-5) - Several conditional branches
      4. Complex decisions (6+) - Extensive branching logic
    </action>
    <action>WAIT for user selection (1-4)</action>
    <action>Store selection in {{decision_points}}</action>

    <action>Ask Question 4: "Where should the flowchart be saved?"</action>
    <action>Present numbered options:
      1. Default location - docs/flowcharts/[auto-generated-name].excalidraw
      2. Custom path - Specify your own file path
      3. Project root - Save in main project directory
      4. Specific folder - Choose from existing folders
    </action>
    <action>WAIT for user selection (1-4)</action>
    <check if="selection is 2 or 4">
      <action>Ask for specific path</action>
      <action>WAIT for user input</action>
    </check>
    <action>Store final path in {{default_output_file}}</action>
  </step>

  <step n="2" goal="Check for Existing Theme" elicit="true">
    <action>Check if theme.json exists at output location</action>
    <check if="theme.json exists">
      <action>Ask: "Found existing theme. Use it? (yes/no)"</action>
      <action>WAIT for user response</action>
      <check if="user says yes">
        <action>Load and use existing theme</action>
        <action>Skip to Step 4</action>
      </check>
      <check if="user says no">
        <action>Proceed to Step 3</action>
      </check>
    </check>
    <check if="theme.json does not exist">
      <action>Proceed to Step 3</action>
    </check>
  </step>

  <step n="3" goal="Create Theme" elicit="true">
    <action>Ask: "Let's create a theme for your flowchart. Choose a color scheme:"</action>
    <action>Present numbered options:
      1. Professional Blue
         - Primary Fill: #e3f2fd (light blue)
         - Accent/Border: #1976d2 (blue)
         - Decision: #fff3e0 (light orange)
         - Text: #1e1e1e (dark gray)

      2. Success Green
         - Primary Fill: #e8f5e9 (light green)
         - Accent/Border: #388e3c (green)
         - Decision: #fff9c4 (light yellow)
         - Text: #1e1e1e (dark gray)

      3. Neutral Gray
         - Primary Fill: #f5f5f5 (light gray)
         - Accent/Border: #616161 (gray)
         - Decision: #e0e0e0 (medium gray)
         - Text: #1e1e1e (dark gray)

      4. Warm Orange
         - Primary Fill: #fff3e0 (light orange)
         - Accent/Border: #f57c00 (orange)
         - Decision: #ffe0b2 (peach)
         - Text: #1e1e1e (dark gray)

      5. Custom Colors - Define your own color palette
    </action>
    <action>WAIT for user selection (1-5)</action>
    <action>Store selection in {{theme_choice}}</action>

    <check if="selection is 5 (Custom)">
      <action>Ask: "Primary fill color (hex code)?"</action>
      <action>WAIT for user input</action>
      <action>Store in {{custom_colors.primary_fill}}</action>
      <action>Ask: "Accent/border color (hex code)?"</action>
      <action>WAIT for user input</action>
      <action>Store in {{custom_colors.accent}}</action>
      <action>Ask: "Decision color (hex code)?"</action>
      <action>WAIT for user input</action>
      <action>Store in {{custom_colors.decision}}</action>
    </check>

    <action>Create theme.json with selected colors</action>
    <action>Show theme preview with all colors</action>
    <action>Ask: "Theme looks good?"</action>
    <action>Present numbered options:
      1. Yes, use this theme - Proceed with theme
      2. No, adjust colors - Modify color selections
      3. Start over - Choose different preset
    </action>
    <action>WAIT for selection (1-3)</action>
    <check if="selection is 2 or 3">
      <action>Repeat Step 3</action>
    </check>
  </step>

  <step n="4" goal="Plan Flowchart Layout">
    <action>List all steps and decision points based on gathered requirements</action>
    <action>Show user the planned structure</action>
    <action>Ask: "Structure looks correct? (yes/no)"</action>
    <action>WAIT for user response</action>
    <check if="user says no">
      <action>Adjust structure based on feedback</action>
      <action>Repeat this step</action>
    </check>
  </step>

  <step n="5" goal="Load Template and Resources">
    <action>Load {{templates}} file</action>
    <action>Extract `flowchart` section from YAML</action>
    <action>Load {{library}} file</action>
    <action>Load theme.json and merge colors with template</action>
    <action>Load {{helpers}} for element creation guidelines</action>
  </step>

  <step n="6" goal="Build Flowchart Elements">
    <critical>Follow guidelines from {{helpers}} for proper element creation</critical>

    <action>Build ONE section at a time following these rules:</action>

    <substep>For Each Shape with Label:
      1. Generate unique IDs (shape-id, text-id, group-id)
      2. Create shape with groupIds: [group-id]
      3. Calculate text width: (text.length × fontSize × 0.6) + 20, round to nearest 10
      4. Create text element with:
         - containerId: shape-id
         - groupIds: [group-id] (SAME as shape)
         - textAlign: "center"
         - verticalAlign: "middle"
         - width: calculated width
      5. Add boundElements to shape referencing text
    </substep>

    <substep>For Each Arrow:
      1. Determine arrow type needed:
         - Straight: For forward flow (left-to-right, top-to-bottom)
         - Elbow: For upward flow, backward flow, or complex routing
      2. Create arrow with startBinding and endBinding
      3. Set startBinding.elementId to source shape ID
      4. Set endBinding.elementId to target shape ID
      5. Set gap: 10 for both bindings
      6. If elbow arrow, add intermediate points for direction changes
      7. Update boundElements on both connected shapes
    </substep>

    <substep>Alignment:
      - Snap all x, y to 20px grid
      - Align shapes vertically (same x for vertical flow)
      - Space elements: 60px between shapes
    </substep>

    <substep>Build Order:
      1. Start point (circle) with label
      2. Each process step (rectangle) with label
      3. Each decision point (diamond) with label
      4. End point (circle) with label
      5. Connect all with bound arrows
    </substep>
  </step>

  <step n="7" goal="Optimize and Save">
    <action>Strip unused elements and elements with isDeleted: true</action>
    <action>Save to {{default_output_file}}</action>
  </step>

  <step n="8" goal="Validate JSON Syntax">
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
    <action>Once validation passes, confirm with user: "Flowchart created at {{default_output_file}}. Open to view?"</action>
  </step>

  <step n="9" goal="Validate Content">
    <invoke-task>Validate against checklist at {{validation}} using {_bmad}/core/tasks/validate-workflow.xml</invoke-task>
  </step>

</workflow>
```
