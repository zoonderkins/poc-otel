package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/yourusername/microservices/shared"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gorilla/mux/otelmux"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
)

type OrderItem struct {
	ProductID string  `json:"productId"`
	Quantity  int     `json:"quantity"`
	Price     float64 `json:"price"`
}

type Order struct {
	ID        string      `json:"id"`
	UserID    string      `json:"userId"`
	Items     []OrderItem `json:"items"`
	Total     float64     `json:"total"`
	Status    string      `json:"status"`
	CreatedAt time.Time   `json:"createdAt"`
}

var orders = make(map[string][]Order)

func main() {
	tp, err := shared.InitTracer("order-service")
	if err != nil {
		log.Fatal(err)
	}
	defer tp.Shutdown(context.Background())

	r := mux.NewRouter()
	r.Use(otelmux.Middleware("order-service"))
	r.Use(shared.CorsMiddleware)
	r.Use(shared.AuthMiddleware)

	r.HandleFunc("/api/health", healthCheck).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/orders/{userId}", getOrders).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/orders/checkout/{userId}", checkout).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/orders/{orderId}/status", updateOrderStatus).Methods("PUT", "OPTIONS")

	port := os.Getenv("PORT")
	if port == "" {
		port = "3004"
	}

	log.Printf("Order service running on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func healthCheck(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "healthy",
		"service": "order-service",
	})
}

func getOrders(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tracer := otel.Tracer("order-service")
	_, span := tracer.Start(ctx, "get-orders")
	defer span.End()

	vars := mux.Vars(r)
	userID := vars["userId"]

	userOrders, exists := orders[userID]
	if !exists {
		userOrders = []Order{}
	}

	json.NewEncoder(w).Encode(userOrders)
}

func checkout(w http.ResponseWriter, r *http.Request) {
	ctx := shared.ExtractTraceContextFromRequest(r)
	tracer := otel.Tracer("order-service")
	ctx, span := tracer.Start(ctx, "checkout")
	defer span.End()

	vars := mux.Vars(r)
	userID := vars["userId"]
	span.SetAttributes(attribute.String("user.id", userID))

	cartURL := fmt.Sprintf("http://cart-service:3003/api/cart/%s", userID)
	cartReq, err := shared.CreateTracedRequest(ctx, "GET", cartURL, nil)
	if err != nil {
		span.RecordError(err)
		http.Error(w, "Failed to create request", http.StatusInternalServerError)
		return
	}
	cartReq.Header.Set("Authorization", r.Header.Get("Authorization"))

	cartResp, err := http.DefaultClient.Do(cartReq)
	if err != nil {
		log.Printf("Error fetching cart: %v", err)
		http.Error(w, "Failed to fetch cart", http.StatusInternalServerError)
		return
	}
	defer cartResp.Body.Close()

	if cartResp.StatusCode != http.StatusOK {
		log.Printf("Cart service returned status: %d", cartResp.StatusCode)
		http.Error(w, "Failed to fetch cart", http.StatusInternalServerError)
		return
	}

	var cart struct {
		Items []OrderItem `json:"items"`
	}
	if err := json.NewDecoder(cartResp.Body).Decode(&cart); err != nil {
		log.Printf("Error decoding cart response: %v", err)
		http.Error(w, "Failed to decode cart data", http.StatusInternalServerError)
		return
	}

	var total float64
	for _, item := range cart.Items {
		total += item.Price * float64(item.Quantity)
	}

	order := Order{
		ID:        uuid.New().String(),
		UserID:    userID,
		Items:     cart.Items,
		Total:     total,
		Status:    "pending",
		CreatedAt: time.Now(),
	}

	if _, exists := orders[userID]; !exists {
		orders[userID] = []Order{}
	}
	orders[userID] = append(orders[userID], order)

	clearCartURL := fmt.Sprintf("http://cart-service:3003/api/cart/%s", userID)
	clearCartReq, err := http.NewRequest("DELETE", clearCartURL, nil)
	if err != nil {
		log.Printf("Error creating clear cart request: %v", err)
	} else {
		clearCartReq.Header.Set("Authorization", r.Header.Get("Authorization"))
		_, err = http.DefaultClient.Do(clearCartReq)
		if err != nil {
			log.Printf("Error clearing cart: %v", err)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(order)
}

func updateOrderStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tracer := otel.Tracer("order-service")
	_, span := tracer.Start(ctx, "update-order-status")
	defer span.End()

	vars := mux.Vars(r)
	orderID := vars["orderId"]

	var statusUpdate struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&statusUpdate); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	orderFound := false
	for userID, userOrders := range orders {
		for i, order := range userOrders {
			if order.ID == orderID {
				orders[userID][i].Status = statusUpdate.Status
				json.NewEncoder(w).Encode(orders[userID][i])
				orderFound = true
				break
			}
		}
		if orderFound {
			break
		}
	}

	if !orderFound {
		http.Error(w, "Order not found", http.StatusNotFound)
	}
}
