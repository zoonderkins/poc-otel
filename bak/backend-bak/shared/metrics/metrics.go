package metrics

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	RequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "http_request_duration_seconds",
		Help:    "Duration of HTTP requests in seconds",
		Buckets: prometheus.DefBuckets,
	}, []string{"service", "handler", "method", "status"})

	RequestTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "http_requests_total",
		Help: "Total number of HTTP requests",
	}, []string{"service", "handler", "method", "status"})

	ServiceGraphRequests = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "traces_service_graph_request_total",
		Help: "Total number of requests between services",
	}, []string{"client", "server"})
)

// Middleware to track metrics
func MetricsMiddleware(serviceName string) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			route := mux.CurrentRoute(r)
			path, _ := route.GetPathTemplate()

			// Create response writer wrapper to capture status code
			rw := NewResponseWriter(w)

			// Call the next handler
			next.ServeHTTP(rw, r)

			// Record metrics
			duration := time.Since(start).Seconds()
			status := fmt.Sprintf("%d", rw.statusCode)

			RequestDuration.WithLabelValues(
				serviceName,
				path,
				r.Method,
				status,
			).Observe(duration)

			RequestTotal.WithLabelValues(
				serviceName,
				path,
				r.Method,
				status,
			).Inc()

			// Record service graph metrics
			if targetService := r.Header.Get("X-Target-Service"); targetService != "" {
				ServiceGraphRequests.WithLabelValues(serviceName, targetService).Inc()
			}
		})
	}
}

// ResponseWriter wrapper to capture status code
type ResponseWriter struct {
	http.ResponseWriter
	statusCode int
}

func NewResponseWriter(w http.ResponseWriter) *ResponseWriter {
	return &ResponseWriter{w, http.StatusOK}
}

func (rw *ResponseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}
