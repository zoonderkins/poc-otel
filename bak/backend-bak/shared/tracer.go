package shared

import (
	"context"
	"fmt"
	"net/http"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.4.0"
)

// InitTracer initializes the OpenTelemetry tracer
func InitTracer(serviceName string) (*sdktrace.TracerProvider, error) {
	exporter, err := otlptracehttp.New(
		context.Background(),
		otlptracehttp.WithEndpoint("tempo:4318"),
		otlptracehttp.WithInsecure(),
	)
	if err != nil {
		return nil, fmt.Errorf("creating OTLP trace exporter: %w", err)
	}

	resource := resource.NewWithAttributes(
		semconv.SchemaURL,
		semconv.ServiceNameKey.String(serviceName),
		semconv.DeploymentEnvironmentKey.String("development"),
		attribute.String("service.instance.id", serviceName),
	)

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(resource),
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	)

	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	return tp, nil
}

// ExtractTraceContextFromRequest extracts trace context from an HTTP request
func ExtractTraceContextFromRequest(r *http.Request) context.Context {
	ctx := r.Context()
	carrier := propagation.HeaderCarrier(r.Header)
	return otel.GetTextMapPropagator().Extract(ctx, carrier)
}

// InjectTraceContextToRequest injects trace context into an HTTP request
func InjectTraceContextToRequest(ctx context.Context, req *http.Request) {
	carrier := propagation.HeaderCarrier(req.Header)
	otel.GetTextMapPropagator().Inject(ctx, carrier)
}

// CreateTracedRequest creates a new HTTP request with trace context
func CreateTracedRequest(ctx context.Context, method, url string, body interface{}) (*http.Request, error) {
	var req *http.Request
	var err error

	if body != nil {
		req, err = http.NewRequestWithContext(ctx, method, url, nil) // Replace nil with body reader if needed
	} else {
		req, err = http.NewRequestWithContext(ctx, method, url, nil)
	}

	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	InjectTraceContextToRequest(ctx, req)
	return req, nil
}
