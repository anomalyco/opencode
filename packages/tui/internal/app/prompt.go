package app

import (
	"errors"
	"time"

	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/attachment"
	"github.com/sst/opencode/internal/id"
)

type Prompt struct {
	Text        string                   `toml:"text"`
	Attachments []*attachment.Attachment `toml:"attachments"`
}

func (p Prompt) ToMessage(
	messageID string,
	sessionID string,
) Message {
	message := opencode.UserMessage{
		ID:        messageID,
		SessionID: sessionID,
		Role:      opencode.UserMessageRoleUser,
		Time: opencode.UserMessageTime{
			Created: float64(time.Now().UnixMilli()),
		},
	}

	text := p.Text
	textAttachments := []*attachment.Attachment{}
	for _, attachment := range p.Attachments {
		if attachment.Type == "text" {
			textAttachments = append(textAttachments, attachment)
		}
	}
	for i := 0; i < len(textAttachments)-1; i++ {
		for j := i + 1; j < len(textAttachments); j++ {
			if textAttachments[i].StartIndex < textAttachments[j].StartIndex {
				textAttachments[i], textAttachments[j] = textAttachments[j], textAttachments[i]
			}
		}
	}
	for _, att := range textAttachments {
		if source, ok := att.GetTextSource(); ok {
			if att.StartIndex > att.EndIndex || att.EndIndex > len(text) {
				continue
			}
			text = text[:att.StartIndex] + source.Value + text[att.EndIndex:]
		}
	}

	parts := []opencode.PartUnion{opencode.TextPart{
		ID:        id.Ascending(id.Part),
		MessageID: messageID,
		SessionID: sessionID,
		Type:      opencode.TextPartTypeText,
		Text:      text,
	}}
	for _, attachment := range p.Attachments {
		if attachment.Type == "agent" {
			source, _ := attachment.GetAgentSource()
			parts = append(parts, opencode.AgentPart{
				ID:        id.Ascending(id.Part),
				MessageID: messageID,
				SessionID: sessionID,
				Name:      source.Name,
				Source: opencode.AgentPartSource{
					Value: attachment.Display,
					Start: int64(attachment.StartIndex),
					End:   int64(attachment.EndIndex),
				},
			})
			continue
		}

		text := opencode.FilePartSourceText{
			Start: int64(attachment.StartIndex),
			End:   int64(attachment.EndIndex),
			Value: attachment.Display,
		}
		source := &opencode.FilePartSource{}
		switch attachment.Type {
		case "text":
			continue
		case "file":
			if fileSource, ok := attachment.GetFileSource(); ok {
				source = &opencode.FilePartSource{
					Text: text,
					Path: fileSource.Path,
					Type: opencode.FilePartSourceTypeFile,
				}
			}
		case "symbol":
			if symbolSource, ok := attachment.GetSymbolSource(); ok {
				source = &opencode.FilePartSource{
					Text: text,
					Path: symbolSource.Path,
					Type: opencode.FilePartSourceTypeSymbol,
					Kind: int64(symbolSource.Kind),
					Name: symbolSource.Name,
					Range: opencode.SymbolSourceRange{
						Start: opencode.SymbolSourceRangeStart{
							Line:      float64(symbolSource.Range.Start.Line),
							Character: float64(symbolSource.Range.Start.Char),
						},
						End: opencode.SymbolSourceRangeEnd{
							Line:      float64(symbolSource.Range.End.Line),
							Character: float64(symbolSource.Range.End.Char),
						},
					},
				}
			}
		}
		parts = append(parts, opencode.FilePart{
			ID:        id.Ascending(id.Part),
			MessageID: messageID,
			SessionID: sessionID,
			Type:      opencode.FilePartTypeFile,
			Filename:  attachment.Filename,
			Mime:      attachment.MediaType,
			URL:       attachment.URL,
			Source:    *source,
		})
	}
	return Message{
		Info:  message,
		Parts: parts,
	}
}

func (m Message) ToPrompt() (*Prompt, error) {
	switch m.Info.(type) {
	case opencode.UserMessage:
		text := ""
		attachments := []*attachment.Attachment{}
		for _, part := range m.Parts {
			switch p := part.(type) {
			case opencode.TextPart:
				if p.Synthetic {
					continue
				}
				text += p.Text + " "
			case opencode.AgentPart:
				attachments = append(attachments, &attachment.Attachment{
					ID:         p.ID,
					Type:       "agent",
					Display:    p.Source.Value,
					StartIndex: int(p.Source.Start),
					EndIndex:   int(p.Source.End),
					Source: &attachment.AgentSource{
						Name: p.Name,
					},
				})
			case opencode.FilePart:
				switch p.Source.Type {
				case "file":
					attachments = append(attachments, &attachment.Attachment{
						ID:         p.ID,
						Type:       "file",
						Display:    p.Source.Text.Value,
						URL:        p.URL,
						Filename:   p.Filename,
						MediaType:  p.Mime,
						StartIndex: int(p.Source.Text.Start),
						EndIndex:   int(p.Source.Text.End),
						Source: &attachment.FileSource{
							Path: p.Source.Path,
							Mime: p.Mime,
						},
					})
				case "symbol":
					r := p.Source.Range.(opencode.SymbolSourceRange)
					attachments = append(attachments, &attachment.Attachment{
						ID:         p.ID,
						Type:       "symbol",
						Display:    p.Source.Text.Value,
						URL:        p.URL,
						Filename:   p.Filename,
						MediaType:  p.Mime,
						StartIndex: int(p.Source.Text.Start),
						EndIndex:   int(p.Source.Text.End),
						Source: &attachment.SymbolSource{
							Path: p.Source.Path,
							Name: p.Source.Name,
							Kind: int(p.Source.Kind),
							Range: attachment.SymbolRange{
								Start: attachment.Position{
									Line: int(r.Start.Line),
									Char: int(r.Start.Character),
								},
								End: attachment.Position{
									Line: int(r.End.Line),
									Char: int(r.End.Character),
								},
							},
						},
					})
				}
			}
		}
		return &Prompt{
			Text:        text,
			Attachments: attachments,
		}, nil
	}
	return nil, errors.New("unknown message type")
}

func (m Message) ToSessionChatParams() []opencode.SessionPromptParamsPartUnion {
	parts := []opencode.SessionPromptParamsPartUnion{}
	for _, part := range m.Parts {
		switch p := part.(type) {
		case opencode.TextPart:
			parts = append(parts, opencode.TextPartInputParam{
				ID:        opencode.F(p.ID),
				Type:      opencode.F(opencode.TextPartInputTypeText),
				Text:      opencode.F(p.Text),
				Synthetic: opencode.F(p.Synthetic),
				Time: opencode.F(opencode.TextPartInputTimeParam{
					Start: opencode.F(p.Time.Start),
					End:   opencode.F(p.Time.End),
				}),
			})
		case opencode.FilePart:
			var source opencode.FilePartSourceUnionParam
			switch p.Source.Type {
			case "file":
				source = opencode.FileSourceParam{
					Type: opencode.F(opencode.FileSourceTypeFile),
					Path: opencode.F(p.Source.Path),
					Text: opencode.F(opencode.FilePartSourceTextParam{
						Start: opencode.F(int64(p.Source.Text.Start)),
						End:   opencode.F(int64(p.Source.Text.End)),
						Value: opencode.F(p.Source.Text.Value),
					}),
				}
			case "symbol":
				source = opencode.SymbolSourceParam{
					Type: opencode.F(opencode.SymbolSourceTypeSymbol),
					Path: opencode.F(p.Source.Path),
					Name: opencode.F(p.Source.Name),
					Kind: opencode.F(p.Source.Kind),
					Range: opencode.F(opencode.SymbolSourceRangeParam{
						Start: opencode.F(opencode.SymbolSourceRangeStartParam{
							Line:      opencode.F(float64(p.Source.Range.(opencode.SymbolSourceRange).Start.Line)),
							Character: opencode.F(float64(p.Source.Range.(opencode.SymbolSourceRange).Start.Character)),
						}),
						End: opencode.F(opencode.SymbolSourceRangeEndParam{
							Line:      opencode.F(float64(p.Source.Range.(opencode.SymbolSourceRange).End.Line)),
							Character: opencode.F(float64(p.Source.Range.(opencode.SymbolSourceRange).End.Character)),
						}),
					}),
					Text: opencode.F(opencode.FilePartSourceTextParam{
						Value: opencode.F(p.Source.Text.Value),
						Start: opencode.F(p.Source.Text.Start),
						End:   opencode.F(p.Source.Text.End),
					}),
				}
			}
			parts = append(parts, opencode.FilePartInputParam{
				ID:       opencode.F(p.ID),
				Type:     opencode.F(opencode.FilePartInputTypeFile),
				Mime:     opencode.F(p.Mime),
				URL:      opencode.F(p.URL),
				Filename: opencode.F(p.Filename),
				Source:   opencode.F(source),
			})
		case opencode.AgentPart:
			parts = append(parts, opencode.AgentPartInputParam{
				ID:   opencode.F(p.ID),
				Type: opencode.F(opencode.AgentPartInputTypeAgent),
				Name: opencode.F(p.Name),
				Source: opencode.F(opencode.AgentPartInputSourceParam{
					Value: opencode.F(p.Source.Value),
					Start: opencode.F(p.Source.Start),
					End:   opencode.F(p.Source.End),
				}),
			})
		}
	}
	return parts
}
