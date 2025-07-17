# Attachment Restoration in Arrow History: Technical Fix Plan

## Problem Statement

When users navigate through prompt history using arrow keys, file attachments that were originally included with prompts are not being restored. Instead, the attachments appear as plain text references (e.g., `@filename.txt`) rather than as actual attachment objects that can be processed by the system.

## Root Cause Analysis

The issue stems from a fundamental mismatch between how attachments are stored in history versus how they need to be restored in the textarea:

1. **History Storage**: The current history system stores only the text prompt and basic attachment metadata (type and path) in `history.HistoryEntry.Attachments`
2. **Textarea Expectations**: The textarea expects rich `*Attachment` objects with full metadata (ID, Display, URL, Filename, MediaType) to be inserted into its content structure
3. **Missing Bridge**: There's no mechanism to convert stored attachment metadata back into the rich attachment objects needed by the textarea

## Current Architecture Issues

### Data Structure Mismatch
- **History Attachment**: `{Type: string, Path: string}`
- **Textarea Attachment**: `{ID: string, Display: string, URL: string, Filename: string, MediaType: string}`

### Missing Attachment Persistence
- Line 370 in `editor.go` shows a TODO comment indicating attachments aren't being saved to history
- Current implementation creates empty attachment arrays: `Attachments: make([]history.Attachment, 0)`

### Text-Only Restoration
- History navigation only calls `m.SetValue(m.history[m.historyIndex].Prompt)` (line 2226)
- This treats the entire prompt as plain text, losing attachment structure

## Technical Solution

### Phase 1: Enhance History Storage

#### 1.1 Expand History Attachment Structure
**File**: `packages/tui/internal/history/history.go`

```go
type Attachment struct {
    Type      string `json:"type"`      // "file"
    Path      string `json:"path"`      // Absolute file path
    Display   string `json:"display"`   // "@filename.txt"
    Filename  string `json:"filename"`  // "filename.txt"
    MediaType string `json:"mediaType"` // "text/plain", "image/png", etc.
    URL       string `json:"url"`       // file:// or data: URL
}
```

#### 1.2 Implement Attachment Conversion
**File**: `packages/tui/internal/components/chat/editor.go`

Replace the TODO section (lines 370-371) with:

```go
// Convert textarea attachments to history attachments
historyAttachments := make([]history.Attachment, 0, len(attachments))
for _, att := range attachments {
    historyAttachments = append(historyAttachments, history.Attachment{
        Type:      "file",
        Path:      extractPathFromURL(att.URL), // New helper function
        Display:   att.Display,
        Filename:  att.Filename,
        MediaType: att.MediaType,
        URL:       att.URL,
    })
}
historyEntry.Attachments = historyAttachments
```

#### 1.3 Add URL Path Extraction Helper
**File**: `packages/tui/internal/components/chat/editor.go`

```go
func extractPathFromURL(url string) string {
    if strings.HasPrefix(url, "file://") {
        return strings.TrimPrefix(url, "file://")
    }
    // For data URLs, we might need to store them differently
    // or reconstruct the original file path if available
    return url
}
```

### Phase 2: Implement Attachment Restoration

#### 2.1 Create Attachment Reconstruction Function
**File**: `packages/tui/internal/components/textarea/textarea.go`

```go
// reconstructAttachment converts a history attachment back to a textarea attachment
func (m *Model) reconstructAttachment(histAtt history.Attachment) (*Attachment, error) {
    // Generate a new unique ID for this attachment instance
    id := fmt.Sprintf("att_%d", time.Now().UnixNano())
    
    // Reconstruct the URL if needed
    url := histAtt.URL
    if url == "" && histAtt.Path != "" {
        // Reconstruct file:// URL from path
        url = "file://" + histAtt.Path
    }
    
    return &Attachment{
        ID:        id,
        Display:   histAtt.Display,
        URL:       url,
        Filename:  histAtt.Filename,
        MediaType: histAtt.MediaType,
    }, nil
}
```

#### 2.2 Enhance History Navigation Methods
**File**: `packages/tui/internal/components/textarea/textarea.go`

Replace `navigateHistoryUp` and `navigateHistoryDown` methods:

```go
func (m *Model) navigateHistoryUp() {
    if len(m.history) == 0 {
        return
    }
    
    if m.historyIndex > 0 {
        m.historyIndex--
        m.restoreHistoryEntry(m.history[m.historyIndex])
        m.historyModified = false
    } else if m.historyIndex == -1 || m.historyIndex == len(m.history) {
        m.historyIndex = len(m.history) - 1
        m.restoreHistoryEntry(m.history[m.historyIndex])
        m.historyModified = false
    }
}

func (m *Model) navigateHistoryDown() {
    if len(m.history) == 0 {
        return
    }
    
    if m.historyIndex < len(m.history)-1 {
        m.historyIndex++
        m.restoreHistoryEntry(m.history[m.historyIndex])
        m.historyModified = false
    } else {
        m.historyIndex = len(m.history)
        m.SetValue("")
        m.historyModified = false
    }
}
```

#### 2.3 Implement History Entry Restoration
**File**: `packages/tui/internal/components/textarea/textarea.go`

```go
// restoreHistoryEntry reconstructs a complete prompt with attachments from history
func (m *Model) restoreHistoryEntry(entry history.HistoryEntry) {
    // Clear current content
    m.Reset()
    
    // Parse the prompt text to identify attachment positions
    promptRunes := []rune(entry.Prompt)
    attachmentMap := make(map[string]*Attachment)
    
    // Reconstruct attachment objects
    for _, histAtt := range entry.Attachments {
        if att, err := m.reconstructAttachment(histAtt); err == nil {
            attachmentMap[histAtt.Display] = att
        }
    }
    
    // Parse prompt and insert attachments at correct positions
    i := 0
    for i < len(promptRunes) {
        if promptRunes[i] == '@' {
            // Find the end of the attachment reference
            start := i
            for i < len(promptRunes) && !unicode.IsSpace(promptRunes[i]) {
                i++
            }
            
            attachmentRef := string(promptRunes[start:i])
            if att, exists := attachmentMap[attachmentRef]; exists {
                // Insert the attachment object instead of text
                m.InsertAttachment(att)
            } else {
                // Fallback: insert as text if attachment not found
                m.InsertString(attachmentRef)
            }
        } else {
            // Insert regular character
            m.InsertRune(promptRunes[i])
            i++
        }
    }
}
```

### Phase 3: Handle Edge Cases

#### 3.1 File Validation
**File**: `packages/tui/internal/components/textarea/textarea.go`

```go
func (m *Model) validateAttachmentFile(path string) bool {
    if path == "" {
        return false
    }
    
    // Check if file still exists
    if _, err := os.Stat(path); os.IsNotExist(err) {
        return false
    }
    
    return true
}
```

#### 3.2 Graceful Degradation
When files are missing or inaccessible:
- Display attachment reference as plain text with a visual indicator (e.g., `@filename.txt [missing]`)
- Log warning but don't break history navigation
- Allow user to continue working with the prompt text

#### 3.3 Data URL Handling
For attachments that were stored as data URLs (images, PDFs):
- Store the complete data URL in history
- Reconstruct the attachment with the same data URL
- No file system validation needed

## Implementation Steps

### Step 1: Update History Storage (High Priority)
1. Modify `history.Attachment` structure
2. Update `editor.go` to populate attachment data
3. Add helper functions for URL/path conversion

### Step 2: Implement Restoration Logic (High Priority)
1. Add `reconstructAttachment` method
2. Add `restoreHistoryEntry` method
3. Update navigation methods to use restoration

### Step 3: Add Validation and Error Handling (Medium Priority)
1. File existence validation
2. Graceful degradation for missing files
3. Error logging and user feedback

### Step 4: Testing (Medium Priority)
1. Unit tests for attachment reconstruction
2. Integration tests for history navigation with attachments
3. Edge case testing (missing files, corrupted data)

## Migration Considerations

### Backward Compatibility
- Existing history entries without attachment data will continue to work
- New attachment fields are optional in JSON structure
- Gradual migration as users create new prompts with attachments

### Performance Impact
- Minimal: attachment reconstruction only happens during history navigation
- File validation is optional and can be disabled for performance
- In-memory caching of reconstructed attachments could be added if needed

## Testing Strategy

### Unit Tests
- `TestReconstructAttachment`: Verify conversion from history to textarea format
- `TestRestoreHistoryEntry`: Test prompt parsing and attachment insertion
- `TestAttachmentValidation`: File existence and accessibility checks

### Integration Tests
- End-to-end history navigation with various attachment types
- Mixed prompts with text and multiple attachments
- Error scenarios (missing files, permission issues)

### Manual Testing Scenarios
1. Create prompt with single file attachment → navigate away → navigate back
2. Create prompt with multiple attachments → verify all are restored
3. Delete attached file → verify graceful degradation
4. Mix of text files and images → verify different media types work

## Risk Assessment

### Low Risk
- Backward compatibility maintained
- Existing functionality unchanged
- Incremental enhancement approach

### Medium Risk
- File system dependencies (files may be moved/deleted)
- Cross-platform path handling
- Performance with large attachment histories

### Mitigation Strategies
- Comprehensive error handling
- Graceful degradation for missing files
- Optional file validation
- Thorough cross-platform testing