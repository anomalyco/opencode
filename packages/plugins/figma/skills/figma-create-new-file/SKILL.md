---
name: figma-create-new-file
description: "Always use this skill when the user wants to create a new Figma Design, FigJam, or Slides file. You MUST invoke this skill BEFORE every `create_new_file` tool call."
disable-model-invocation: false
---

# Create a new file in Figma

Steps to create a new Figma Design, FigJam, or Slides file using the `create_new_file` MCP tool.

## Step 1: Resolve the `planKey` and `editorType`

Use the `planKey` the user provided or selected for this task. Otherwise, call `whoami` and inspect the returned plans.

- No plans: inform the user that file creation cannot proceed.
- One plan: use its `key` as `planKey`.
- Multiple plans: show the available plans, ask the user to select one and then use that plan's `key` as `planKey`.

Infer `editorType` from the requested file type by choosing from the tool's advertised input enum. If unclear, ask the user to specify the file type.

## Step 2: Call create_new_file

Call the `create_new_file` tool with all three required arguments:

- `fileName`: Required. Choose a concise name if the user does not provide one.
- `planKey`: Required. Use the `planKey` resolved in Step 1.
- `editorType`: Required. Use the `editorType` selected in Step 1.
- `projectId`: Optional. Set it to create the file in a specific project.

```json
{
  "fileName": "Quarterly planning",
  "planKey": "team::1234567890",
  "editorType": "design"
}
```

- Use the `file_key` from the `create_new_file` tool response for subsequent tool calls like `use_figma`.

## Step 3: (Slides only) Handle the empty grid

A new Slides file contains no slides: `figma.getSlideGrid()` returns `[]`. Before reading properties such as theme tokens from a slide, call `figma.createSlide()` or handle the empty case. The first `createSlide()` call automatically creates row 0 and inserts the slide.
