package shared

import (
	"context"
	"encoding/json"
	"log"

	"go.opentelemetry.io/otel/trace"
)

type Logger struct {
	serviceName string
	tracer      trace.Tracer
}

type LogEntry struct {
	TraceID string                 `json:"trace_id"`
	SpanID  string                 `json:"span_id"`
	Service string                 `json:"service"`
	Message string                 `json:"message"`
	Status  string                 `json:"status"`
	Data    map[string]interface{} `json:"data,omitempty"`
}

func NewLogger(serviceName string) *Logger {
	return &Logger{
		serviceName: serviceName,
	}
}

func (l *Logger) Info(ctx context.Context, msg string, data map[string]interface{}) {
	span := trace.SpanFromContext(ctx)
	entry := LogEntry{
		TraceID: span.SpanContext().TraceID().String(),
		SpanID:  span.SpanContext().SpanID().String(),
		Service: l.serviceName,
		Message: msg,
		Status:  "info",
		Data:    data,
	}
	logJSON, _ := json.Marshal(entry)
	log.Println(string(logJSON))
}

func (l *Logger) Error(ctx context.Context, msg string, err error, data map[string]interface{}) {
	span := trace.SpanFromContext(ctx)
	if data == nil {
		data = make(map[string]interface{})
	}
	data["error"] = err.Error()

	entry := LogEntry{
		TraceID: span.SpanContext().TraceID().String(),
		SpanID:  span.SpanContext().SpanID().String(),
		Service: l.serviceName,
		Message: msg,
		Status:  "error",
		Data:    data,
	}
	logJSON, _ := json.Marshal(entry)
	log.Println(string(logJSON))
}
