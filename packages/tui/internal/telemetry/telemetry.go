package telemetry

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	"go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.4.0"
	oteltrace "go.opentelemetry.io/otel/trace"
)

type TraceContext struct {
	TraceID     string `json:"traceId"`
	SpanID      string `json:"spanId"`
	TraceFlags  int    `json:"traceFlags"`
	Traceparent string `json:"traceparent"`
}

func InitTelemetry(ctx context.Context, serviceName, serviceVersion string) (context.Context, func(), error) {
	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if endpoint == "" {
		slog.Debug("Not initializing OTEL")
		return ctx, func() {}, nil
	}

	slog.Info("Initializing OpenTelemetry", "endpoint", endpoint, "serviceName", serviceName, "serviceVersion", serviceVersion)
	exporter, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpointURL(endpoint),
	)
	if err != nil {
		return ctx, nil, err
	}

	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceNameKey.String(serviceName),
			semconv.ServiceVersionKey.String(serviceVersion),
		),
	)
	if err != nil {
		return ctx, nil, err
	}

	tp := trace.NewTracerProvider(
		trace.WithBatcher(exporter),
		trace.WithResource(res),
	)

	otel.SetTracerProvider(tp)

	// Parse trace context from environment variable if present
	ctx = parseTraceContext(ctx)

	return ctx, func() {
		if err := tp.Shutdown(ctx); err != nil {
		}
	}, nil
}

func parseTraceContext(ctx context.Context) context.Context {
	traceContextStr := os.Getenv("OTEL_TRACE_CONTEXT")
	if traceContextStr == "" {
		return ctx
	}

	var traceContext TraceContext
	if err := json.Unmarshal([]byte(traceContextStr), &traceContext); err != nil {
		slog.Warn("[otel] Failed to parse trace context", "error", err)
		return ctx
	}

	// Parse trace ID and span ID
	traceID, err := oteltrace.TraceIDFromHex(traceContext.TraceID)
	if err != nil {
		slog.Warn("[otel] Invalid trace ID", "traceId", traceContext.TraceID, "error", err)
		return ctx
	}

	spanID, err := oteltrace.SpanIDFromHex(traceContext.SpanID)
	if err != nil {
		slog.Warn("[otel] Invalid span ID", "spanId", traceContext.SpanID, "error", err)
		return ctx
	}

	// Create span context
	spanContext := oteltrace.NewSpanContext(oteltrace.SpanContextConfig{
		TraceID:    traceID,
		SpanID:     spanID,
		TraceFlags: oteltrace.TraceFlags(traceContext.TraceFlags),
		Remote:     true,
	})

	// Set the span context in the context
	ctx = oteltrace.ContextWithRemoteSpanContext(ctx, spanContext)

	slog.Debug("[otel] Parsed trace context", "traceId", traceContext.TraceID, "spanId", traceContext.SpanID)
	return ctx
}

var (
	tracer = otel.Tracer("opencode-tui")
)

// TraceConfig is a function that configures a span with additional attributes or settings.
type TraceConfig func(oteltrace.Span)

// Traced executes a function within an OpenTelemetry span context.
// It creates a new span with the given name, passes the span context to the function,
// and automatically handles span completion and error status.
//
// The function accepts optional TraceConfig functions to configure the span with
// additional attributes, events, or other span properties.
//
// If the function returns an error, the span status is set to Error with the error message.
// Otherwise, the span status is set to Ok.
func Traced[T any](ctx context.Context, name string, fn func(context.Context) (T, error), config ...TraceConfig) (T, error) {
	ctx, close, _ := NewSpan(ctx, name, config...)
	value, err := fn(ctx)
	close(err)

	return value, err
}

// WithSpan executes a function within an OpenTelemetry span context.
// It creates a new span with the given name, passes the span context to the function,
// and automatically handles span completion and error status.
//
// The function accepts optional TraceConfig functions to configure the span with
// additional attributes, events, or other span properties.
//
// If the function returns an error, the span status is set to Error with the error message.
// Otherwise, the span status is set to Ok.
func WithSpan(ctx context.Context, name string, fn func(context.Context) error, config ...TraceConfig) error {
	ctx, close, _ := NewSpan(ctx, name, config...)
	err := fn(ctx)
	close(err)

	return err
}

func SetStatus(err error) TraceConfig {
	return func(span oteltrace.Span) {
		if err == nil {
			span.SetStatus(codes.Ok, "")
		} else {
			span.SetStatus(codes.Error, err.Error())
		}
	}
}

// NewSpan creates a new OpenTelemetry span with the given name and optional configuration.
// It returns a new context with the span, a function to close the span and set its
// status, and the created span itself.
func NewSpan(parentContext context.Context, name string, config ...TraceConfig) (context.Context, func(error), oteltrace.Span) {
	ctx, span := tracer.Start(parentContext, name)

	for _, cfg := range config {
		cfg(span)
	}

	return ctx, func(err error) {
		SetStatus(err)(span)
		span.End()
	}, span
}

// WithAttributes is a TraceConfig that sets attributes on the span.
func WithAttributes(kvs ...attribute.KeyValue) TraceConfig {
	return func(span oteltrace.Span) {
		span.SetAttributes(kvs...)
	}
}

// SetAttributes sets attributes on the current span in the context.
func SetAttributes(ctx context.Context, kvs ...attribute.KeyValue) {
	if span := oteltrace.SpanFromContext(ctx); span != nil {
		span.SetAttributes(kvs...)
	}
}
