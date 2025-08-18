package attachment

import (
	"github.com/google/uuid"
)

type TextSource struct {
	Value string `toml:"value"`
}

type FileSource struct {
	Path string `toml:"path"`
	Mime string `toml:"mime"`
	Data []byte `toml:"data,omitempty"` // Optional for image data
}

type SymbolSource struct {
	Path  string      `toml:"path"`
	Name  string      `toml:"name"`
	Kind  int         `toml:"kind"`
	Range SymbolRange `toml:"range"`
}

type SymbolRange struct {
	Start Position `toml:"start"`
	End   Position `toml:"end"`
}

type AgentSource struct {
	Name string `toml:"name"`
}

type Position struct {
	Line int `toml:"line"`
	Char int `toml:"char"`
}

type Attachment struct {
	ID         string `toml:"id"`
	Type       string `toml:"type"`
	Display    string `toml:"display"`
	URL        string `toml:"url"`
	Filename   string `toml:"filename"`
	MediaType  string `toml:"media_type"`
	StartIndex int    `toml:"start_index"`
	EndIndex   int    `toml:"end_index"`
	Source     any    `toml:"source,omitempty"`
}

// NewAttachment creates a new attachment with a unique ID
func NewAttachment() *Attachment {
	return &Attachment{
		ID: uuid.NewString(),
	}
}

func (a *Attachment) GetTextSource() (*TextSource, bool) {
	if a.Type != "text" {
		return nil, false
	}
	ts, ok := a.Source.(*TextSource)
	return ts, ok
}

// GetFileSource returns the source as FileSource if the attachment is a file type
func (a *Attachment) GetFileSource() (*FileSource, bool) {
	if a.Type != "file" {
		return nil, false
	}
	fs, ok := a.Source.(*FileSource)
	return fs, ok
}

// GetSymbolSource returns the source as SymbolSource if the attachment is a symbol type
func (a *Attachment) GetSymbolSource() (*SymbolSource, bool) {
	if a.Type != "symbol" {
		return nil, false
	}
	ss, ok := a.Source.(*SymbolSource)
	return ss, ok
}

// GetAgentSource returns the source as AgentSource if the attachment is an agent type
func (a *Attachment) GetAgentSource() (*AgentSource, bool) {
	if a.Type != "agent" {
		return nil, false
	}
	as, ok := a.Source.(*AgentSource)
	return as, ok
}

// FromMap creates a TextSource from a map[string]any
func (ts *TextSource) FromMap(sourceMap map[string]any) {
	if value, ok := sourceMap["value"].(string); ok {
		ts.Value = value
	}
}

// FromMap creates a FileSource from a map[string]any
func (fs *FileSource) FromMap(sourceMap map[string]any) {
	if path, ok := sourceMap["path"].(string); ok {
		fs.Path = path
	}
	if mime, ok := sourceMap["mime"].(string); ok {
		fs.Mime = mime
	}
	if data, ok := sourceMap["data"].([]byte); ok {
		fs.Data = data
	}
}

// FromMap creates a SymbolSource from a map[string]any
func (ss *SymbolSource) FromMap(sourceMap map[string]any) {
	if path, ok := sourceMap["path"].(string); ok {
		ss.Path = path
	}
	if name, ok := sourceMap["name"].(string); ok {
		ss.Name = name
	}
	if kind, ok := sourceMap["kind"].(int); ok {
		ss.Kind = kind
	}
	if rangeMap, ok := sourceMap["range"].(map[string]any); ok {
		ss.Range = SymbolRange{}
		if startMap, ok := rangeMap["start"].(map[string]any); ok {
			if line, ok := startMap["line"].(int); ok {
				ss.Range.Start.Line = line
			}
			if char, ok := startMap["char"].(int); ok {
				ss.Range.Start.Char = char
			}
		}
		if endMap, ok := rangeMap["end"].(map[string]any); ok {
			if line, ok := endMap["line"].(int); ok {
				ss.Range.End.Line = line
			}
			if char, ok := endMap["char"].(int); ok {
				ss.Range.End.Char = char
			}
		}
	}
}

// FromMap creates an AgentSource from a map[string]any
func (as *AgentSource) FromMap(sourceMap map[string]any) {
	if name, ok := sourceMap["name"].(string); ok {
		as.Name = name
	}
}

// RestoreSourceType converts a map[string]any source back to the proper type
func (a *Attachment) RestoreSourceType() {
	if a.Source == nil {
		return
	}

	// Check if Source is a map[string]any
	if sourceMap, ok := a.Source.(map[string]any); ok {
		switch a.Type {
		case "text":
			ts := &TextSource{}
			ts.FromMap(sourceMap)
			a.Source = ts
		case "file":
			fs := &FileSource{}
			fs.FromMap(sourceMap)
			a.Source = fs
		case "symbol":
			ss := &SymbolSource{}
			ss.FromMap(sourceMap)
			a.Source = ss
		case "agent":
			as := &AgentSource{}
			as.FromMap(sourceMap)
			a.Source = as
		}
	}
}
