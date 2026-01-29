# Jupyter Notebook Support in OpenCode

This feature adds native support for editing Jupyter notebook (`.ipynb`) files in OpenCode, making it a powerful tool for data scientists and researchers who use notebooks.

## Features

### 📓 Five New Tools

1. **read_notebook** - Parse and display notebook structure
   - Shows metadata (format version, language, kernel info)
   - Lists all cells with types and content previews
   - Displays execution counts and outputs for code cells

2. **edit_notebook_cell** - Edit specific cells
   - Modify cell content while preserving metadata
   - Maintains execution counts and outputs
   - Supports code, markdown, and raw cells

3. **add_notebook_cell** - Insert new cells
   - Add cells at any position (or at the end)
   - Choose cell type (code, markdown, raw)
   - Automatically initializes code cells with null execution count

4. **delete_notebook_cell** - Remove cells
   - Delete cells by index
   - Preserves all other cells
   - Provides confirmation before deletion

5. **list_notebook_cells** - Quick cell overview
   - List all cells with indices
   - Filter by cell type
   - Show content previews

## Usage Examples

### Read a Notebook
```
read_notebook("path/to/notebook.ipynb")
```

### Edit a Code Cell
```
edit_notebook_cell(
  filePath="path/to/notebook.ipynb",
  cellIndex=2,
  newSource="print('Hello, World!')"
)
```

### Add a New Markdown Cell
```
add_notebook_cell(
  filePath="path/to/notebook.ipynb",
  cellType="markdown",
  source="# Analysis Results\n\nThis notebook shows...",
  position=0
)
```

### Delete a Cell
```
delete_notebook_cell(
  filePath="path/to/notebook.ipynb",
  cellIndex=5
)
```

### List All Code Cells
```
list_notebook_cells(
  filePath="path/to/notebook.ipynb",
  cellType="code",
  maxPreviewLength=100
)
```

## Technical Details

### Notebook Format Support
- Jupyter notebook format 4.x
- JSON structure validation
- Preserves all metadata fields
- Handles both string and string[] source formats

### Cell Types
- **Code cells**: Execution state, outputs preserved
- **Markdown cells**: GitHub-flavored markdown
- **Raw cells**: Unformatted text

### Implementation
The implementation uses TypeScript with Zod for parameter validation and follows OpenCode's tool architecture patterns. All tools:
- Request user permission before modifications
- Track file changes with FileTime
- Support external directory access
- Provide detailed error messages
- Include diff tracking

## Files Added

- `packages/opencode/src/notebook/index.ts` - Core notebook utilities
- `packages/opencode/src/tool/read-notebook.ts` - Read notebook tool
- `packages/opencode/src/tool/edit-notebook-cell.ts` - Edit cell tool
- `packages/opencode/src/tool/add-notebook-cell.ts` - Add cell tool
- `packages/opencode/src/tool/delete-notebook-cell.ts` - Delete cell tool
- `packages/opencode/src/tool/list-notebook-cells.ts` - List cells tool

## Testing

To test the notebook support:

1. Create a sample notebook:
```python
# In Jupyter or with nbformat
import nbformat
nb = nbformat.v4.new_notebook()
nb.cells.append(nbformat.v4.new_code_cell("print('Hello')"))
nbformat.write(nb, 'test.ipynb')
```

2. Use OpenCode to interact with it:
```bash
opencode
> read_notebook("test.ipynb")
> edit_notebook_cell("test.ipynb", 0, "print('Updated')")
> add_notebook_cell("test.ipynb", "markdown", "# Title")
```

## Benefits

- **No notebook conversion needed** - Work directly with .ipynb files
- **Preserves execution state** - Outputs and counts maintained
- **Collaboration friendly** - Version control compatible
- **Terminal-based workflow** - Edit notebooks without leaving the terminal
- **AI-assisted** - Use OpenCode's AI to refactor and improve notebooks

## Future Enhancements

Possible future improvements:
- Cell execution support
- Image output handling
- Notebook conversion tools
- Cell reordering operations
- Bulk cell operations

## Contributing

This is an open-source contribution to OpenCode. For issues, suggestions, or improvements, please:
1. Check the existing GitHub issues
2. Create a new issue with the "notebook" label
3. Submit PRs with clear descriptions

## License

This feature follows the same license as OpenCode (MIT License).
