package telemetry

import (
	"context"
	"fmt"
	"net/http"

	"github.com/sst/opencode-sdk-go/option"
	"go.opentelemetry.io/otel/propagation"
)

// OtelHeaderRequestMiddleware creates an HTTP middleware that injects OpenTelemetry trace headers
// into outgoing requests and wraps them with tracing, except for POST requests to /log.
func OtelHeaderRequestMiddleware() option.RequestOption {
	return option.WithMiddleware(func(req *http.Request, next option.MiddlewareNext) (*http.Response, error) {
		if req.Method == "POST" && req.URL.Path == "/log" {
			return next(req)
		}

		// Get the context from the request
		ctx := req.Context()
		return Traced(ctx, fmt.Sprintf("request %s %s", req.Method, req.URL.Path), func(ctx context.Context) (*http.Response, error) {
			// Create a propagator to inject trace context into headers
			propagator := propagation.NewCompositeTextMapPropagator(
				propagation.TraceContext{},
				propagation.Baggage{},
			)

			// Inject the trace context into the request headers
			propagator.Inject(ctx, propagation.HeaderCarrier(req.Header))

			res, err := next(req)
			return res, err
		})
	})
}
