# Create Diagram - Workflow Instructions

```xml
<critical>The workflow execution engine is governed by: {project-root}/_bmad/core/tasks/workflow.xml</critical>
<critical>You MUST have already loaded and processed: {installed_path}/workflow.yaml</critical>
<critical>This workflow creates system architecture diagrams, ERDs, UML diagrams, or general technical diagrams in Excalidraw format.</critical>

<workflow>

  <step n="0" goal="Contextual Analysis">
    <action>Review user's request and extract: diagram type, components/entities, relationships, notation preferences</action>
    <check if="ALL requirements clear"><action>Skip to Step 5</action></check>
    <check if="SOME requirements clear"><action>Only ask about missing info in Steps 1-2</action></check>
  </step>

  <step n="1" goal="Identify Diagram Type" elicit="true">
    <action>Ask: "What type of technical diagram do you need?"</action>
    <action>Present options:
      1. System Architecture
      2. Entity-Relationship Diagram (ERD)
      3. UML Class Diagram
      4. UML Sequence Diagram
      5. UML Use Case Diagram
      6. Network Diagram
      7. Other
    </action>
    <action>WAIT for selection</action>
  </step>

  <step n="2" goal="Gather Requirements" elicit="true">
    <action>Ask: "Describe the components/entities and their relationships"</action>
    <action>Ask: "What notation standard? (Standard/Simplified/Strict UML-ERD)"</action>
    <action>WAIT for user input</action>
    <action>Summarize what will be included and confirm with user</action>
  </step>

  <step n="3" goal="Check for Existing Theme" elicit="true">
    <action>Check if theme.json exists at output location</action>
    <check if="exists"><action>Ask to use it, load if yes, else proceed to Step 4</action></check>
    <check if="not exists"><action>Proceed to Step 4</action></check>
  </step>

  <step n="4" goal="Create Theme" elicit="true">
    <action>Ask: "Choose a color scheme for your diagram:"</action>
    <action>Present numbered options:
      1. Professional
         - Component: #e3f2fd (light blue)
         - Database: #e8f5e9 (light green)
         - Service: #fff3e0 (light orange)
         - Border: #1976d2 (blue)

      2. Colorful
         - Component: #e1bee7 (light purple)
         - Database: #c5e1a5 (light lime)
         - Service: #ffccbc (light coral)
         - Border: #7b1fa2 (purple)

      3. Minimal
         - Component: #f5f5f5 (light gray)
         - Database: #eeeeee (gray)
         - Service: #e0e0e0 (medium gray)
         - Border: #616161 (dark gray)

      4. Custom - Define your own colors
    </action>
    <action>WAIT for selection</action>
    <action>Create theme.json based on selection</action>
    <action>Show preview and confirm</action>
  </step>

  <step n="5" goal="Plan Diagram Structure">
    <action>List all components/entities</action>
    <action>Map all relationships</action>
    <action>Show planned layout</action>
    <action>Ask: "Structure looks correct? (yes/no)"</action>
    <check if="no"><action>Adjust and repeat</action></check>
  </step>

  <step n="6" goal="Load Resources">
    <action>Load {{templates}} and extract `diagram` section</action>
    <action>Load {{library}}</action>
    <action>Load theme.json and merge with template</action>
    <action>Load {{helpers}} for guidelines</action>
  </step>

  <step n="7" goal="Build Diagram Elements">
    <critical>Follow {{helpers}} for proper element creation</critical>

    <substep>For Each Component:
      - Generate unique IDs (component-id, text-id, group-id)
      - Create shape with groupIds
      - Calculate text width
      - Create text with containerId and matching groupIds
      - Add boundElements
    </substep>

    <substep>For Each Connection:
      - Determine arrow type (straight/elbow)
      - Create with startBinding and endBinding
      - Update boundElements on both components
    </substep>

    <substep>Build Order by Type:
      - Architecture: Services → Databases → Connections → Labels
      - ERD: Entities → Attributes → Relationships → Cardinality
      - UML Class: Classes → Attributes → Methods → Relationships
      - UML Sequence: Actors → Lifelines → Messages → Returns
      - UML Use Case: Actors → Use Cases → Relationships
    </substep>

    <substep>Alignment:
      - Snap to 20px grid
      - Space: 40px between components, 60px between sections
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
    <action>Once validation passes, confirm: "Diagram created at {{default_output_file}}. Open to view?"</action>
  </step>

  <step n="10" goal="Validate Content">
    <invoke-task>Validate against {{validation}} using {_bmad}/core/tasks/validate-workflow.xml</invoke-task>
  </step>

</workflow>
```
