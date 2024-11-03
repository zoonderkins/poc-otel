package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"

	"github.com/gorilla/mux"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/yourusername/microservices/shared"
	"github.com/yourusername/microservices/shared/metrics"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gorilla/mux/otelmux"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.4.0"
)

// Product represents a product from the product service
type Product struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Price       float64 `json:"price"`
	Description string  `json:"description"`
}

type CartItem struct {
	ProductID string  `json:"productId"`
	Quantity  int     `json:"quantity"`
	Price     float64 `json:"price,omitempty"`
	Name      string  `json:"productName,omitempty"`
}

type Cart struct {
	UserID string     `json:"userId"`
	Items  []CartItem `json:"items"`
}

// In-memory store for carts
var (
	carts = make(map[string]Cart)
	mu    sync.RWMutex
)

var tracer = otel.Tracer("cart-service")
var logger *shared.Logger

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
		semconv.ServiceNameKey.String("cart-service"),
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

// Add this function to verify JWT token
func verifyToken(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Handle preflight OPTIONS requests
		if r.Method == "OPTIONS" {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.WriteHeader(http.StatusOK)
			return
		}

		// Get the Authorization header
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			log.Printf("No Authorization header found")
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// Log the received headers for debugging
		log.Printf("Received headers: %v", r.Header)
		log.Printf("Auth header: %s", authHeader)

		// For now, just allow the request if Authorization header exists
		next.ServeHTTP(w, r)
	}
}

func main() {
	tp, err := shared.InitTracer("cart-service")
	if err != nil {
		log.Fatal(err)
	}
	defer tp.Shutdown(context.Background())

	// Initialize logger
	logger = shared.NewLogger("cart-service")

	r := mux.NewRouter()
	r.Use(otelmux.Middleware("cart-service"))
	r.Use(metrics.MetricsMiddleware("cart-service"))

	// Health check endpoint (no auth required)
	r.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
	}).Methods("GET")

	// Cart endpoints with auth
	r.HandleFunc("/api/cart/{userId}", verifyToken(getCart)).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/cart/{userId}/items", verifyToken(addToCart)).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/cart/{userId}/items/{productId}", verifyToken(removeFromCart)).Methods("DELETE", "OPTIONS")
	r.HandleFunc("/api/cart/{userId}", verifyToken(clearCart)).Methods("DELETE", "OPTIONS")

	// Add metrics endpoint
	r.Handle("/metrics", promhttp.Handler())

	port := os.Getenv("PORT")
	if port == "" {
		port = "3003"
	}

	log.Printf("Cart service starting on port %s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatal(err)
	}
}

func getCart(w http.ResponseWriter, r *http.Request) {
	_, span := tracer.Start(r.Context(), "get-cart")
	defer span.End()

	vars := mux.Vars(r)
	userID := vars["userId"]
	span.SetAttributes(attribute.String("user.id", userID))

	mu.RLock()
	cart, exists := carts[userID]
	mu.RUnlock()

	if !exists {
		cart = Cart{
			UserID: userID,
			Items:  []CartItem{},
		}
	} else {
		// Update product details for each item
		for i, item := range cart.Items {
			productURL := fmt.Sprintf("http://product-service:3002/api/products/%s", item.ProductID)
			productResp, err := http.Get(productURL)
			if err != nil {
				log.Printf("Error fetching product %s: %v", item.ProductID, err)
				continue
			}

			var product Product
			if err := json.NewDecoder(productResp.Body).Decode(&product); err != nil {
				productResp.Body.Close()
				log.Printf("Error decoding product %s: %v", item.ProductID, err)
				continue
			}
			productResp.Body.Close()

			cart.Items[i].Price = product.Price
			cart.Items[i].Name = product.Name
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	json.NewEncoder(w).Encode(cart)
}

func addToCart(w http.ResponseWriter, r *http.Request) {
	ctx := shared.ExtractTraceContextFromRequest(r)
	tracer := otel.Tracer("cart-service")
	ctx, span := tracer.Start(ctx, "add_to_cart")
	defer span.End()

	vars := mux.Vars(r)
	userID := vars["userId"]
	span.SetAttributes(attribute.String("user.id", userID))

	var item CartItem
	if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
		logger.Info(ctx, "Failed to decode request", map[string]interface{}{
			"error":  err.Error(),
			"userId": userID,
		})
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	span.SetAttributes(
		attribute.String("user.id", userID),
		attribute.String("product.id", item.ProductID),
		attribute.Int("quantity", item.Quantity),
	)

	// Make request to product service
	req, err := shared.CreateTracedRequest(ctx, "GET",
		fmt.Sprintf("http://product-service:3002/api/products/%s", item.ProductID),
		nil)
	if err != nil {
		span.RecordError(err)
		http.Error(w, "Failed to create request", http.StatusInternalServerError)
		return
	}
	req.Header.Set("Authorization", r.Header.Get("Authorization"))

	// Inject trace context
	shared.InjectTraceContext(ctx, req.Header)
	req.Header.Set("Authorization", r.Header.Get("Authorization"))

	// Forward the Authorization header to the product service
	client := &http.Client{}
	productResp, err := client.Do(req)
	if err != nil {
		log.Printf("Error fetching product: %v", err)
		http.Error(w, "Failed to verify product", http.StatusInternalServerError)
		span.RecordError(err)
		return
	}
	defer productResp.Body.Close()

	log.Printf("Product service response status: %d", productResp.StatusCode)

	if productResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(productResp.Body)
		log.Printf("Product not found: %s. Response: %s", item.ProductID, string(body))
		http.Error(w, "Product not found", http.StatusNotFound)
		return
	}

	var product Product
	if err := json.NewDecoder(productResp.Body).Decode(&product); err != nil {
		log.Printf("Error decoding product: %v", err)
		http.Error(w, "Failed to decode product data", http.StatusInternalServerError)
		span.RecordError(err)
		return
	}

	log.Printf("Successfully fetched product: %+v", product)

	// Update item with product details
	item.Price = product.Price
	item.Name = product.Name

	span.SetAttributes(attribute.String("product.id", item.ProductID))
	span.SetAttributes(attribute.Int("quantity", item.Quantity))
	span.SetAttributes(attribute.Float64("price", item.Price))

	mu.Lock()
	cart, exists := carts[userID]
	if !exists {
		cart = Cart{
			UserID: userID,
			Items:  []CartItem{},
		}
	}

	// Update or add item
	found := false
	for i, existingItem := range cart.Items {
		if existingItem.ProductID == item.ProductID {
			cart.Items[i].Quantity = item.Quantity
			cart.Items[i].Price = item.Price
			cart.Items[i].Name = item.Name
			found = true
			break
		}
	}
	if !found {
		cart.Items = append(cart.Items, item)
	}

	carts[userID] = cart
	mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	json.NewEncoder(w).Encode(cart)
}

func removeFromCart(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		w.WriteHeader(http.StatusOK)
		return
	}

	_, span := tracer.Start(r.Context(), "remove-from-cart")
	defer span.End()

	vars := mux.Vars(r)
	userID := vars["userId"]
	productID := vars["productId"]

	span.SetAttributes(attribute.String("user.id", userID))
	span.SetAttributes(attribute.String("product.id", productID))

	mu.Lock()
	cart, exists := carts[userID]
	if !exists {
		mu.Unlock()
		http.Error(w, "Cart not found", http.StatusNotFound)
		return
	}

	// Remove item
	newItems := []CartItem{}
	for _, item := range cart.Items {
		if item.ProductID != productID {
			newItems = append(newItems, item)
		}
	}
	cart.Items = newItems
	carts[userID] = cart
	mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	json.NewEncoder(w).Encode(cart)
}

func clearCart(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		w.WriteHeader(http.StatusOK)
		return
	}

	_, span := tracer.Start(r.Context(), "clear-cart")
	defer span.End()

	vars := mux.Vars(r)
	userID := vars["userId"]
	span.SetAttributes(attribute.String("user.id", userID))

	mu.Lock()
	delete(carts, userID)
	mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	json.NewEncoder(w).Encode(map[string]string{"message": "Cart cleared"})
}
