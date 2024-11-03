package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/gorilla/mux"
	"github.com/yourusername/microservices/shared"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gorilla/mux/otelmux"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.4.0"
)

type Product struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Price       float64 `json:"price"`
	Category    string  `json:"category"`
}

var products = []Product{
	{
		ID:          "1",
		Name:        "Gaming Laptop",
		Description: "High-performance gaming laptop",
		Price:       1299.99,
		Category:    "Electronics",
	},
	{
		ID:          "2",
		Name:        "Smartphone",
		Description: "Latest model smartphone",
		Price:       799.99,
		Category:    "Electronics",
	},
	{
		ID:          "3",
		Name:        "Headphones",
		Description: "Wireless noise-canceling headphones",
		Price:       199.99,
		Category:    "Electronics",
	},
}

var tracer = otel.Tracer("product-service")

func initTracer() (*sdktrace.TracerProvider, error) {
	exporter, err := otlptracehttp.New(
		context.Background(),
		otlptracehttp.WithEndpoint("tempo:4318"),
		otlptracehttp.WithInsecure(),
	)
	if err != nil {
		return nil, err
	}

	resource := resource.NewWithAttributes(
		semconv.SchemaURL,
		semconv.ServiceNameKey.String("product-service"),
		semconv.DeploymentEnvironmentKey.String("development"),
	)

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(resource),
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	)
	otel.SetTracerProvider(tp)
	return tp, nil
}

func main() {
	tp, err := initTracer()
	if err != nil {
		log.Fatal(err)
	}
	defer func() {
		if err := tp.Shutdown(context.Background()); err != nil {
			log.Printf("Error shutting down tracer provider: %v", err)
		}
	}()

	r := mux.NewRouter()
	r.Use(otelmux.Middleware("product-service"))

	// Add CORS middleware
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")

			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}

			next.ServeHTTP(w, r)
		})
	})

	r.HandleFunc("/api/health", healthCheck).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/products", getProducts).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/products/{id}", getProduct).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/products/category/{category}", getProductsByCategory).Methods("GET", "OPTIONS")

	port := os.Getenv("PORT")
	if port == "" {
		port = "3002"
	}

	log.Printf("Product service running on port %s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatal(err)
	}
}

func healthCheck(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "healthy",
		"service": "product-service",
	})
}

func getProducts(w http.ResponseWriter, r *http.Request) {
	_, span := tracer.Start(r.Context(), "get-products")
	defer span.End()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(products)
}

func getProduct(w http.ResponseWriter, r *http.Request) {
	ctx := shared.ExtractTraceContextFromRequest(r)
	tracer := otel.Tracer("product-service")
	ctx, span := tracer.Start(ctx, "get_product")
	defer span.End()

	vars := mux.Vars(r)
	productID := vars["id"]
	span.SetAttributes(attribute.String("product.id", productID))

	for _, product := range products {
		if product.ID == productID {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(product)
			return
		}
	}

	http.Error(w, "Product not found", http.StatusNotFound)
}

func getProductsByCategory(w http.ResponseWriter, r *http.Request) {
	_, span := tracer.Start(r.Context(), "get-products-by-category")
	defer span.End()

	vars := mux.Vars(r)
	category := vars["category"]
	span.SetAttributes(attribute.String("product.category", category))

	var categoryProducts []Product
	for _, product := range products {
		if product.Category == category {
			categoryProducts = append(categoryProducts, product)
		}
	}

	if len(categoryProducts) == 0 {
		http.Error(w, "No products found in this category", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(categoryProducts)
}
