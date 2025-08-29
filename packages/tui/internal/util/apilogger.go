package util

import (
	"context"
	"fmt"
	"log/slog"
	"reflect"
	"sync"

	opencode "github.com/sst/opencode-sdk-go"
)

func sanitizeValue(val any) any {
	if val == nil {
		return nil
	}

	if err, ok := val.(error); ok {
		return err.Error()
	}

	v := reflect.ValueOf(val)
	if v.Kind() == reflect.Interface && !v.IsNil() {
		return fmt.Sprintf("%T", val)
	}

	return val
}

type APILogHandler struct {
	client  *opencode.Client
	service string
	level   slog.Level
	attrs   []slog.Attr
	groups  []string
	mu      sync.Mutex
	queue   chan opencode.AppLogParams
}

func NewAPILogHandler(ctx context.Context, client *opencode.Client, service string, level slog.Level) *APILogHandler {
	result := &APILogHandler{
		client:  client,
		service: service,
		level:   level,
		attrs:   make([]slog.Attr, 0),
		groups:  make([]string, 0),
		queue:   make(chan opencode.AppLogParams, 100_000),
	}
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case params := <-result.queue:
				_, err := client.App.Log(context.Background(), params)
				if err != nil {
					slog.Error("Failed to log to API", "error", err)
				}
			}
		}
	}()
	return result
}

func (h *APILogHandler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= h.level
}

func (h *APILogHandler) Handle(ctx context.Context, r slog.Record) error {
	var apiLevel opencode.AppLogParamsLevel
	switch r.Level {
	case slog.LevelDebug:
		apiLevel = opencode.AppLogParamsLevelDebug
	case slog.LevelInfo:
		apiLevel = opencode.AppLogParamsLevelInfo
	case slog.LevelWarn:
		apiLevel = opencode.AppLogParamsLevelWarn
	case slog.LevelError:
		apiLevel = opencode.AppLogParamsLevelError
	default:
		apiLevel = opencode.AppLogParamsLevelInfo
	}

	extra := make(map[string]any)

	h.mu.Lock()
	for _, attr := range h.attrs {
		val := attr.Value.Any()
		extra[attr.Key] = sanitizeValue(val)
	}
	h.mu.Unlock()

	r.Attrs(func(attr slog.Attr) bool {
		val := attr.Value.Any()
		extra[attr.Key] = sanitizeValue(val)
		return true
	})

	params := opencode.AppLogParams{
		Service: opencode.F(h.service),
		Level:   opencode.F(apiLevel),
		Message: opencode.F(r.Message),
	}

	if len(extra) > 0 {
		params.Extra = opencode.F(extra)
	}

	h.queue <- params

	return nil
}

// WithAttrs returns a new Handler whose attributes consist of
// both the receiver's attributes and the arguments.
func (h *APILogHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	h.mu.Lock()
	defer h.mu.Unlock()

	newHandler := &APILogHandler{
		client:  h.client,
		service: h.service,
		level:   h.level,
		attrs:   make([]slog.Attr, len(h.attrs)+len(attrs)),
		groups:  make([]string, len(h.groups)),
	}

	copy(newHandler.attrs, h.attrs)
	copy(newHandler.attrs[len(h.attrs):], attrs)
	copy(newHandler.groups, h.groups)

	return newHandler
}

// WithGroup returns a new Handler with the given group appended to
// the receiver's existing groups.
func (h *APILogHandler) WithGroup(name string) slog.Handler {
	h.mu.Lock()
	defer h.mu.Unlock()

	newHandler := &APILogHandler{
		client:  h.client,
		service: h.service,
		level:   h.level,
		attrs:   make([]slog.Attr, len(h.attrs)),
		groups:  make([]string, len(h.groups)+1),
	}

	copy(newHandler.attrs, h.attrs)
	copy(newHandler.groups, h.groups)
	newHandler.groups[len(h.groups)] = name

	return newHandler
}
