package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/yourusername/microservices/shared"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gorilla/mux/otelmux"
	"go.opentelemetry.io/otel"
)

type User struct {
	ID       string `json:"id,string"`
	Username string `json:"username"`
	Password string `json:"password,omitempty"`
	Email    string `json:"email"`
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type RegisterRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Email    string `json:"email"`
}

type AuthResponse struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	tracer := otel.Tracer("auth-service")
	_, span := tracer.Start(r.Context(), "login")
	defer span.End()

	var loginReq LoginRequest

	if err := json.NewDecoder(r.Body).Decode(&loginReq); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Simple authentication for demo
	if loginReq.Username == "admin" && loginReq.Password == "admin" {
		sessionID := uuid.New().String()
		token, err := shared.GenerateToken(loginReq.Username, sessionID)
		if err != nil {
			http.Error(w, "Failed to generate token", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"token":     token,
			"sessionId": sessionID,
			"username":  loginReq.Username,
		})
	} else {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
	}
}

func main() {
	tp, err := shared.InitTracer("auth-service")
	if err != nil {
		log.Fatal(err)
	}
	defer tp.Shutdown(context.Background())

	router := mux.NewRouter()
	router.Use(otelmux.Middleware("auth-service"))

	router.HandleFunc("/api/auth/login", handleLogin).Methods("POST", "OPTIONS")

	port := "3001"
	log.Printf("Auth service running on port %s", port)
	if err := http.ListenAndServe(":"+port, router); err != nil {
		log.Fatal(err)
	}
}
