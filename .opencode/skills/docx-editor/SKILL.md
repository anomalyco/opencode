---
name: docx-editor
description: Edit Word (.docx) files in-place preserving structure, styles, formatting, tables, headers, footers. Use when editing .docx / Word files, theses, reports, academic papers. Trigger: editar word, modificar docx, corregir documento, actualizar tesis, editing word documents.
---

# Word Document Editor (docx)

Use the `docx_*` MCP tools to edit Word documents in-place without converting, losing structure, or creating copies.

## Critical rules

- NEVER use `bash` to convert docx → md → docx. That destroys formatting.
- ALWAYS use the `docx_*` MCP tools for any .docx file.
- Editing is IN-PLACE on the original file — no copies, no renames, no output folder changes.

## Workflow

### 1. Understand the document
```
docx_read(filepath="/path/to/document.docx")
```
This returns:
- All paragraphs with **indices** and their style (Heading 1, Normal, etc.)
- Image counts per paragraph — `"images": N` if a paragraph contains images
- Total `image_count` at document level
- All tables with row/column counts and cell data
- Use these indices as stable references — they don't change between reads.

### 2. Find what to edit
```
docx_search(filepath="/path/to/document.docx", query="text to find")
```
Returns paragraph indices and table locations where the query appears.

### 3. Edit in-place
```
docx_edit(filepath="/path/to/document.docx", operations=[...])
```
Operations are applied in order to the SAME file. Available ops:

| Op | Description | Example |
|----|-------------|---------|
| `replace_paragraph` | Replace a specific paragraph's text by index | `{ op: "replace_paragraph", index: 5, text: "New content" }` |
| `insert_paragraph` | Insert a new paragraph after index | `{ op: "insert_paragraph", after: 5, text: "Inserted" }` |
| `delete_paragraph` | Delete a paragraph by index | `{ op: "delete_paragraph", index: 8 }` |
| `replace_text` | Find-and-replace across the whole document | `{ op: "replace_text", find: "old", replace: "new" }` |
| `append_paragraph` | Add a paragraph at the end | `{ op: "append_paragraph", text: "New paragraph" }` |
| `replace_table_cell` | Edit a table cell | `{ op: "replace_table_cell", table: 0, row: 1, col: 2, text: "Value" }` |

### 4. Batch operations
Send multiple operations in ONE `docx_edit` call when editing multiple paragraphs:
```
operations: [
  { op: "replace_paragraph", index: 3, text: "..." },
  { op: "replace_paragraph", index: 7, text: "..." },
  { op: "replace_text", find: "typo", replace: "typo fixed" }
]
```
This is faster and saves the file once.

## Style preservation

- `replace_paragraph` preserves the paragraph style (Heading 1 stays Heading 1, Normal stays Normal)
- Tables, headers, footers, page numbers are untouched unless you explicitly edit their paragraphs
- Font formatting (bold, italic, color) is preserved

## Limits

- Images are preserved during all text edits — they stay in place, untouched
- Can't create new tables, delete tables, or add/remove images (yet)
- Can't modify image size or position
- For complex structural changes, read the doc first and confirm with the user via `question`

## Example session

```
User: corregí la introducción de mi tesis Thesis.docx

1. docx_read(filepath="~/Downloads/Thesis.docx")
2. Find paragraph indices for "Introduction" section
3. Identify paragraphs 12-18 as the intro
4. docx_edit(filepath="~/Downloads/Thesis.docx", operations=[
     { op: "replace_paragraph", index: 12, text: "Corrected intro paragraph..." },
     { op: "replace_paragraph", index: 14, text: "Another correction..." }
   ])
5. Confirm changes were applied
```
