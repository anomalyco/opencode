# Testing Guide for Jupyter Notebook Support

This guide provides step-by-step instructions for testing the new Jupyter notebook support in OpenCode.

## Prerequisites

### 1. Install Dependencies

```bash
# Install nbformat to create test notebooks
pip install nbformat

# Or install Jupyter (includes nbformat)
pip install jupyter
```

### 2. Create Test Notebooks

```bash
# Create test directory
mkdir D:/test_notebooks
cd D:/test_notebooks

# Create test notebooks
python ../test_notebooks/create_test_notebooks.py

# Or create manually using Jupyter
# jupyter notebook simple_test.ipynb
```

## Testing Methods

### Method 1: Manual Tool Testing

Start OpenCode and test each tool:

```bash
cd D:/opencode
opencode
```

#### Test 1: Read Notebook
```
read_notebook("D:/test_notebooks/simple_test.ipynb")
```
**Expected Output**: 
- Notebook summary with metadata
- List of all cells with indices
- Cell content previews
- Execution counts for code cells

#### Test 2: List Cells
```
list_notebook_cells("D:/test_notebooks/complex_test.ipynb")
```
**Expected Output**:
- Quick overview of all cells
- Cell indices and types
- Content previews

#### Test 3: List Only Code Cells
```
list_notebook_cells(
  "D:/test_notebooks/complex_test.ipynb",
  cellType="code",
  maxPreviewLength=100
)
```
**Expected Output**: Only code cells listed

#### Test 4: Edit a Cell
```
edit_notebook_cell(
  "D:/test_notebooks/simple_test.ipynb",
  cellIndex=1,
  newSource="print('Hello from OpenCode!')"
)
```
**Expected Output**:
- Confirmation of edit
- Diff summary
- Updated notebook info

#### Test 5: Add a Cell
```
add_notebook_cell(
  "D:/test_notebooks/simple_test.ipynb",
  cellType="markdown",
  source="## New Section\n\nAdded by OpenCode",
  position=2
)
```
**Expected Output**:
- Cell added confirmation
- Position info
- Updated cell count

#### Test 6: Delete a Cell
```
delete_notebook_cell(
  "D:/test_notebooks/simple_test.ipynb",
  cellIndex=0
)
```
**Expected Output**:
- Deletion confirmation
- Cell info that was deleted
- Updated notebook summary

### Method 2: Automated Testing Script

Create a test script:

```bash
# D:/test_notebooks/test_opencode.sh
#!/bin/bash

echo "Testing OpenCode Jupyter Support..."

# Test 1: Read notebook
echo "Test 1: Reading notebook..."
opencode eval "read_notebook('D:/test_notebooks/simple_test.ipynb')"

# Test 2: Edit cell
echo "Test 2: Editing cell..."
opencode eval "edit_notebook_cell('D:/test_notebooks/simple_test.ipynb', 1, 'print(\"Edited by OpenCode\")')"

# Test 3: Add cell
echo "Test 3: Adding cell..."
opencode eval "add_notebook_cell('D:/test_notebooks/simple_test.ipynb', 'code', 'x = 100')"

# Test 4: List cells
echo "Test 4: Listing cells..."
opencode eval "list_notebook_cells('D:/test_notebooks/simple_test.ipynb')"

echo "Tests completed!"
```

### Method 3: Unit Testing

Create unit tests in the repository:

```typescript
// D:/opencode/packages/opencode/src/notebook/test.ts
import { 
  parseNotebook, 
  addCell, 
  editCell, 
  deleteCell,
  normalizeSource 
} from "../notebook"

describe("Notebook Utilities", () => {
  test("parse valid notebook", () => {
    const content = JSON.stringify({
      cells: [{ cell_type: "code", metadata: {}, source: "print('test')" }],
      metadata: { language_info: { name: "python" } },
      nbformat: 4,
      nbformat_minor: 2
    })
    
    const result = parseNotebook(content)
    expect(result.success).toBe(true)
    expect(result.notebook?.cells.length).toBe(1)
  })

  test("normalize source handles both formats", () => {
    expect(normalizeSource("single line")).toBe("single line")
    expect(normalizeSource(["line1", "line2"])).toBe("line1line2")
  })

  test("add cell inserts at correct position", () => {
    const notebook = {
      cells: [{ cell_type: "code", metadata: {}, source: "cell 1" }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 2
    }
    
    const updated = addCell(notebook, "code", "new cell", 0)
    expect(updated.cells.length).toBe(2)
    expect(updated.cells[0].source).toContain("new cell")
  })

  test("edit cell modifies correct cell", () => {
    const notebook = {
      cells: [
        { cell_type: "code", metadata: {}, source: "original" }
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 2
    }
    
    const updated = editCell(notebook, 0, "modified")
    expect(updated.cells[0].source).toContain("modified")
  })

  test("delete cell removes correct cell", () => {
    const notebook = {
      cells: [
        { cell_type: "code", metadata: {}, source: "cell 1" },
        { cell_type: "markdown", metadata: {}, source: "cell 2" }
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 2
    }
    
    const updated = deleteCell(notebook, 0)
    expect(updated.cells.length).toBe(1)
    expect(updated.cells[0].source).toContain("cell 2")
  })
})
```

Run tests:
```bash
cd D:/opencode
bun test packages/opencode/src/notebook/test.ts
```

### Method 4: Integration Testing

Test with real notebooks:

```bash
# Test with a real Jupyter notebook
cd D:/test_notebooks

# Create a notebook from Jupyter first
jupyter notebook test.ipynb
# Add some cells manually, save, and close

# Then use OpenCode to read it
opencode
> read_notebook("D:/test_notebooks/test.ipynb")
```

## Validation Checklist

Test each feature and verify:

### Read Notebook ✅
- [ ] Displays notebook metadata
- [ ] Shows correct cell count
- [ ] Lists all cell types (code, markdown, raw)
- [ ] Displays execution counts
- [ ] Shows outputs for code cells
- [ ] Handles empty notebooks
- [ ] Handles invalid JSON gracefully

### Edit Notebook Cell ✅
- [ ] Edits code cells correctly
- [ ] Edits markdown cells correctly
- [ ] Preserves cell metadata
- [ ] Preserves execution counts
- [ ] Preserves outputs
- [ ] Handles out-of-bounds indices
- [ ] Shows confirmation before edit

### Add Notebook Cell ✅
- [ ] Adds code cells
- [ ] Adds markdown cells
- [ ] Adds raw cells
- [ ] Inserts at correct position
- [ ] Appends when no position specified
- [ ] Initializes code cells with null execution_count

### Delete Notebook Cell ✅
- [ ] Deletes cells correctly
- [ ] Preserves other cells
- [ ] Updates indices correctly
- [ ] Handles last cell deletion
- [ ] Shows confirmation before delete

### List Notebook Cells ✅
- [ ] Lists all cells
- [ ] Filters by cell type
- [ ] Shows correct indices
- [ ] Displays content preview
- [ ] Shows execution counts
- [ ] Handles empty notebooks

## Common Issues & Solutions

### Issue: "File not found"
**Solution**: Use absolute paths or check current working directory
```
read_notebook("D:/absolute/path/to/notebook.ipynb")
```

### Issue: "Invalid notebook format"
**Solution**: Ensure the file is valid JSON and has required fields
```bash
# Validate with Python
python -c "import json; json.load(open('test.ipynb'))"
```

### Issue: "Cell index out of bounds"
**Solution**: Use `list_notebook_cells` to see valid indices first

### Issue: Changes not saved
**Solution**: Ensure you confirm the permission prompt when asked

## Performance Testing

Test with large notebooks:

```python
# Create a large notebook (1000 cells)
import nbformat
from nbformat.v4 import new_notebook, new_code_cell

nb = new_notebook()
for i in range(1000):
    nb.cells.append(new_code_cell(f"# Cell {i}\nprint({i})"))

with open('large_test.ipynb', 'w') as f:
    nbformat.write(nb, f)

# Test reading performance
# opencode
# > read_notebook("large_test.ipynb")
```

## Debugging

Enable debug mode:

```bash
cd D:/opencode
opencode --log-level DEBUG
```

Check file timestamps:
```bash
ls -la D:/test_notebooks/
```

Verify notebook format:
```python
import nbformat
nb = nbformat.read('test.ipynb', as_version=4)
print(f"Cells: {len(nb.cells)}")
print(f"Format: {nb.nbformat}.{nb.nbformat_minor}")
```

## Next Steps After Testing

1. **Report Issues**: Create GitHub issues for any bugs found
2. **Submit PR**: If tests pass, prepare for pull request
3. **Add Tests**: Contribute unit tests to the repository
4. **Documentation**: Update main README with notebook support info

## Test Results Template

```
Testing Date: [DATE]
OpenCode Version: [VERSION]
Test Environment: [OS/Shell]

Results:
✅ read_notebook - PASSED/FAILED
✅ edit_notebook_cell - PASSED/FAILED
✅ add_notebook_cell - PASSED/FAILED
✅ delete_notebook_cell - PASSED/FAILED
✅ list_notebook_cells - PASSED/FAILED

Notes:
[Any issues or observations]
```
