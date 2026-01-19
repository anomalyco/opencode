# Document Project Workflow Router

<critical>The workflow execution engine is governed by: {project-root}/_bmad/core/tasks/workflow.xml</critical>
<critical>You MUST have already loaded and processed: {project-root}/_bmad/bmm/workflows/document-project/workflow.yaml</critical>
<critical>Communicate all responses in {communication_language}</critical>

<workflow>

<critical>This router determines workflow mode and delegates to specialized sub-workflows</critical>

<step n="1" goal="Validate workflow and get project info">

<invoke-workflow path="{project-root}/_bmad/bmm/workflows/workflow-status">
  <param>mode: data</param>
  <param>data_request: project_config</param>
</invoke-workflow>

<check if="status_exists == false">
  <output>{{suggestion}}</output>
  <output>Note: Documentation workflow can run standalone. Continuing without progress tracking.</output>
  <action>Set standalone_mode = true</action>
  <action>Set status_file_found = false</action>
</check>

<check if="status_exists == true">
  <action>Store {{status_file_path}} for later updates</action>
  <action>Set status_file_found = true</action>

  <!-- Extract brownfield/greenfield from status data -->
  <check if="field_type == 'greenfield'">
    <output>Note: This is a greenfield project. Documentation workflow is typically for brownfield projects.</output>
    <ask>Continue anyway to document planning artifacts? (y/n)</ask>
    <check if="n">
      <action>Exit workflow</action>
    </check>
  </check>

  <!-- Now validate sequencing -->
  <invoke-workflow path="{project-root}/_bmad/bmm/workflows/workflow-status">
    <param>mode: validate</param>
    <param>calling_workflow: document-project</param>
  </invoke-workflow>

  <check if="warning != ''">
    <output>{{warning}}</output>
    <output>Note: This may be auto-invoked by prd for brownfield documentation.</output>
    <ask>Continue with documentation? (y/n)</ask>
    <check if="n">
      <output>{{suggestion}}</output>
      <action>Exit workflow</action>
    </check>
  </check>
</check>

</step>

<step n="2" goal="Check for resumability and determine workflow mode">
<critical>SMART LOADING STRATEGY: Check state file FIRST before loading any CSV files</critical>

<action>Check for existing state file at: {output_folder}/project-scan-report.json</action>

<check if="project-scan-report.json exists">
  <action>Read state file and extract: timestamps, mode, scan_level, current_step, completed_steps, project_classification</action>
  <action>Extract cached project_type_id(s) from state file if present</action>
  <action>Calculate age of state file (current time - last_updated)</action>

<ask>I found an in-progress workflow state from {{last_updated}}.

**Current Progress:**

- Mode: {{mode}}
- Scan Level: {{scan_level}}
- Completed Steps: {{completed_steps_count}}/{{total_steps}}
- Last Step: {{current_step}}
- Project Type(s): {{cached_project_types}}

Would you like to:

1. **Resume from where we left off** - Continue from step {{current_step}}
2. **Start fresh** - Archive old state and begin new scan
3. **Cancel** - Exit without changes

Your choice [1/2/3]:
</ask>

  <check if="user selects 1">
    <action>Set resume_mode = true</action>
    <action>Set workflow_mode = {{mode}}</action>
    <action>Load findings summaries from state file</action>
    <action>Load cached project_type_id(s) from state file</action>

    <critical>CONDITIONAL CSV LOADING FOR RESUME:</critical>
    <action>For each cached project_type_id, load ONLY the corresponding row from: {documentation_requirements_csv}</action>
    <action>Skip loading project-types.csv and architecture_registry.csv (not needed on resume)</action>
    <action>Store loaded doc requirements for use in remaining steps</action>

    <action>Display: "Resuming {{workflow_mode}} from {{current_step}} with cached project type(s): {{cached_project_types}}"</action>

    <check if="workflow_mode == deep_dive">
      <action>Load and execute: {installed_path}/workflows/deep-dive-instructions.md with resume context</action>
    </check>

    <check if="workflow_mode == initial_scan OR workflow_mode == full_rescan">
      <action>Load and execute: {installed_path}/workflows/full-scan-instructions.md with resume context</action>
    </check>

  </check>

  <check if="user selects 2">
    <action>Create archive directory: {output_folder}/.archive/</action>
    <action>Move old state file to: {output_folder}/.archive/project-scan-report-{{timestamp}}.json</action>
    <action>Set resume_mode = false</action>
    <action>Continue to Step 0.5</action>
  </check>

  <check if="user selects 3">
    <action>Display: "Exiting workflow without changes."</action>
    <action>Exit workflow</action>
  </check>

  <check if="state file age >= 24 hours">
    <action>Display: "Found old state file (>24 hours). Starting fresh scan."</action>
    <action>Archive old state file to: {output_folder}/.archive/project-scan-report-{{timestamp}}.json</action>
    <action>Set resume_mode = false</action>
    <action>Continue to Step 0.5</action>
  </check>

</step>

<step n="3" goal="Check for existing documentation and determine workflow mode" if="resume_mode == false">
<action>Check if {output_folder}/index.md exists</action>

<check if="index.md exists">
  <action>Read existing index.md to extract metadata (date, project structure, parts count)</action>
  <action>Store as {{existing_doc_date}}, {{existing_structure}}</action>

<ask>I found existing documentation generated on {{existing_doc_date}}.

What would you like to do?

1. **Re-scan entire project** - Update all documentation with latest changes
2. **Deep-dive into specific area** - Generate detailed documentation for a particular feature/module/folder
3. **Cancel** - Keep existing documentation as-is

Your choice [1/2/3]:
</ask>

  <check if="user selects 1">
    <action>Set workflow_mode = "full_rescan"</action>
    <action>Display: "Starting full project rescan..."</action>
    <action>Load and execute: {installed_path}/workflows/full-scan-instructions.md</action>
    <action>After sub-workflow completes, continue to Step 4</action>
  </check>

  <check if="user selects 2">
    <action>Set workflow_mode = "deep_dive"</action>
    <action>Set scan_level = "exhaustive"</action>
    <action>Display: "Starting deep-dive documentation mode..."</action>
    <action>Load and execute: {installed_path}/workflows/deep-dive-instructions.md</action>
    <action>After sub-workflow completes, continue to Step 4</action>
  </check>

  <check if="user selects 3">
    <action>Display message: "Keeping existing documentation. Exiting workflow."</action>
    <action>Exit workflow</action>
  </check>
</check>

<check if="index.md does not exist">
  <action>Set workflow_mode = "initial_scan"</action>
  <action>Display: "No existing documentation found. Starting initial project scan..."</action>
  <action>Load and execute: {installed_path}/workflows/full-scan-instructions.md</action>
  <action>After sub-workflow completes, continue to Step 4</action>
</check>

</step>

<step n="4" goal="Update status and complete">

<check if="status_file_found == true">
  <invoke-workflow path="{project-root}/_bmad/bmm/workflows/workflow-status">
    <param>mode: update</param>
    <param>action: complete_workflow</param>
    <param>workflow_name: document-project</param>
  </invoke-workflow>

  <check if="success == true">
    <output>Status updated!</output>
  </check>
</check>

<output>**✅ Document Project Workflow Complete, {user_name}!**

**Documentation Generated:**

- Mode: {{workflow_mode}}
- Scan Level: {{scan_level}}
- Output: {output_folder}/index.md and related files

{{#if status_file_found}}
**Status Updated:**

- Progress tracking updated

**Next Steps:**

- **Next required:** {{next_workflow}} ({{next_agent}} agent)

Check status anytime with: `workflow-status`
{{else}}
**Next Steps:**
Since no workflow is in progress:

- Refer to the BMM workflow guide if unsure what to do next
- Or run `workflow-init` to create a workflow path and get guided next steps
  {{/if}}
  </output>

</step>

</workflow>
