# Create Data Flow Diagram - Workflow Instructions

```xml
<critical>The workflow execution engine is governed by: {project-root}/_bmad/core/tasks/workflow.xml</critical>
<critical>You MUST have already loaded and processed: {installed_path}/workflow.yaml</critical>
<critical>This workflow creates data flow diagrams (DFD) in Excalidraw format.</critical>

<workflow>

  <step n="0" goal="Contextual Analysis">
    <action>Review user's request and extract: DFD level, processes, data stores, external entities</action>
    <check if="ALL requirements clear"><action>Skip to Step 4</action></check>
  </step>

  <step n="1" goal="Identify DFD Level" elicit="true">
    <action>Ask: "What level of DFD do you need?"</action>
    <action>Present options:
      1. Context Diagram (Level 0) - Single process showing system boundaries
      2. Level 1 DFD - Major processes and data flows
      3. Level 2 DFD - Detailed sub-processes
      4. Custom - Specify your requirements
    </action>
    <action>WAIT for selection</action>
  </step>

  <step n="2" goal="Gather Requirements" elicit="true">
    <action>Ask: "Describe the processes, data stores, and external entities in your system"</action>
    <action>WAIT for user description</action>
    <action>Summarize what will be included and confirm with user</action>
  </step>

  <step n="3" goal="Theme Setup" elicit="true">
    <action>Check for existing theme.json, ask to use if exists</action>
    <check if="no existing theme">
      <action>Ask: "Choose a DFD color scheme:"</action>
      <action>Present numbered options:
        1. Standard DFD
           - Process: #e3f2fd (light blue)
           - Data Store: #e8f5e9 (light green)
           - External Entity: #f3e5f5 (light purple)
           - Border: #1976d2 (blue)

        2. Colorful DFD
           - Process: #fff9c4 (light yellow)
           - Data Store: #c5e1a5 (light lime)
           - External Entity: #ffccbc (light coral)
           - Border: #f57c00 (orange)

        3. Minimal DFD
           - Process: #f5f5f5 (light gray)
           - Data Store: #eeeeee (gray)
           - External Entity: #e0e0e0 (medium gray)
           - Border: #616161 (dark gray)

        4. Custom - Define your own colors
      </action>
      <action>WAIT for selection</action>
      <action>Create theme.json based on selection</action>
    </check>
  </step>

  <step n="4" goal="Plan DFD Structure">
    <action>List all processes with numbers (1.0, 2.0, etc.)</action>
    <action>List all data stores (D1, D2, etc.)</action>
    <action>List all external entities</action>
    <action>Map all data flows with labels</action>
    <action>Show planned structure, confirm with user</action>
  </step>

  <step n="5" goal="Load Resources">
    <action>Load {{templates}} and extract `dataflow` section</action>
    <action>Load {{library}}</action>
    <action>Load theme.json</action>
    <action>Load {{helpers}}</action>
  </step>

  <step n="6" goal="Build DFD Elements">
    <critical>Follow standard DFD notation from {{helpers}}</critical>

    <substep>Build Order:
      1. External entities (rectangles, bold border)
      2. Processes (circles/ellipses with numbers)
      3. Data stores (parallel lines or rectangles)
      4. Data flows (labeled arrows)
    </substep>

    <substep>DFD Rules:
      - Processes: Numbered (1.0, 2.0), verb phrases
      - Data stores: Named (D1, D2), noun phrases
      - External entities: Named, noun phrases
      - Data flows: Labeled with data names, arrows show direction
      - No direct flow between external entities
      - No direct flow between data stores
    </substep>

    <substep>Layout:
      - External entities at edges
      - Processes in center
      - Data stores between processes
      - Minimize crossing flows
      - Left-to-right or top-to-bottom flow
    </substep>
  </step>

  <step n="7" goal="Optimize and Save">
    <action>Verify DFD rules compliance</action>
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
    <action>Once validation passes, confirm with user</action>
  </step>

  <step n="9" goal="Validate Content">
    <invoke-task>Validate against {{validation}}</invoke-task>
  </step>

</workflow>
```
