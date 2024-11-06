package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"

	"api-backend/otel"

	"github.com/gorilla/mux"
	_ "github.com/mattn/go-sqlite3"
	"go.elastic.co/apm/module/apmgorilla/v2"
	"go.elastic.co/apm/module/apmsql/v2"
	_ "go.elastic.co/apm/module/apmsql/v2/sqlite3"
	"go.elastic.co/apm/v2"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gorilla/mux/otelmux"
	"go.opentelemetry.io/otel/trace"
)

// ToDoCreate represents the structure for creating a new todo
type ToDoCreate struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Completed   bool   `json:"completed"`
}

// ToDoUpdate represents the structure for updating a todo
type ToDoUpdate struct {
	Title       *string `json:"title,omitempty"`
	Description *string `json:"description,omitempty"`
	Completed   *bool   `json:"completed,omitempty"`
}

// ToDoInDB represents a todo item in the database
type ToDoInDB struct {
	ID          int    `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Completed   bool   `json:"completed"`
}

var db *sql.DB
var tracer trace.Tracer
var elasticApm *apm.Tracer

// Add structured logging
type LogEntry struct {
	Level     string `json:"level"`
	Message   string `json:"message"`
	TraceID   string `json:"traceID,omitempty"`
	SpanID    string `json:"spanID,omitempty"`
	Operation string `json:"operation,omitempty"`
}

// Helper function to log with trace context
func logWithContext(ctx context.Context, level, operation, message string) {
	spanCtx := trace.SpanContextFromContext(ctx)
	entry := LogEntry{
		Level:     level,
		Message:   message,
		Operation: operation,
	}

	if spanCtx.IsValid() {
		entry.TraceID = spanCtx.TraceID().String()
		entry.SpanID = spanCtx.SpanID().String()
	}

	jsonBytes, err := json.Marshal(entry)
	if err != nil {
		log.Printf("Error marshaling log entry: %v", err)
		return
	}

	log.Println(string(jsonBytes))
}

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "/data/todos.db")
	if err != nil {
		return err
	}

	// Create todos table if it doesn't exist
	createTableSQL := `
	CREATE TABLE IF NOT EXISTS todos (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		title TEXT NOT NULL,
		description TEXT NOT NULL,
		completed BOOLEAN NOT NULL DEFAULT FALSE
	);`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		return err
	}

	// Check if table is empty
	var count int
	err = db.QueryRow("SELECT COUNT(*) FROM todos").Scan(&count)
	if err != nil {
		return err
	}

	// Insert initial todos if table is empty
	if count == 0 {
		initialTodos := []ToDoCreate{
			{
				Title:       "Learn OpenTelemetry",
				Description: "Study distributed tracing with OpenTelemetry",
				Completed:   false,
			},
			{
				Title:       "Setup Grafana",
				Description: "Configure Grafana dashboards for monitoring",
				Completed:   true,
			},
			{
				Title:       "Implement Todo App",
				Description: "Create a full-stack todo application with tracing",
				Completed:   false,
			},
			{
				Title:       "Study Tempo",
				Description: "Learn how to use Grafana Tempo for trace visualization",
				Completed:   false,
			},
		}

		for _, todo := range initialTodos {
			_, err := db.Exec(
				"INSERT INTO todos (title, description, completed) VALUES (?, ?, ?)",
				todo.Title, todo.Description, todo.Completed,
			)
			if err != nil {
				return err
			}
		}
		log.Println("Initialized database with sample todos")
	}

	return nil
}

func main() {
	// Initialize Elastic APM with more configuration
	elasticApm, err := apm.NewTracerOptions(apm.TracerOptions{
		ServiceName:        "api-backend",
		ServiceVersion:     "1.0.0",
		ServiceEnvironment: "development",
	})
	if err != nil {
		log.Fatalf("Error initializing Elastic APM: %v", err)
	}
	defer elasticApm.Close()

	// Wrap the database with APM
	db, err = apmsql.Open("sqlite3", "/data/todos.db")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Handle SIGINT (CTRL+C) gracefully
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	// Initialize OpenTelemetry
	tp, err := otel.InitOpenTelemetry(ctx, "api-backend")
	if err != nil {
		log.Fatal(err)
	}
	defer func() {
		if err := tp.Shutdown(context.Background()); err != nil {
			log.Printf("Error shutting down tracer provider: %v", err)
		}
	}()

	// Get the tracer from the provider
	tracer = tp.Tracer("api-backend")

	port := os.Getenv("EXPOSE_PORT")
	if port == "" {
		port = "8000"
	}

	r := mux.NewRouter()
	r.Use(otelmux.Middleware("api-backend"))
	r.Use(apmgorilla.Middleware())

	// CORS middleware
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, Authorization, X-CSRF-Token, traceparent")

			// Handle preflight requests
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}
			next.ServeHTTP(w, r)
		})
	})

	// Routes
	r.HandleFunc("/todos", createTodo).Methods("POST")
	r.HandleFunc("/todos/{id}", readTodo).Methods("GET")
	r.HandleFunc("/todos/{id}", updateTodo).Methods("PUT")
	r.HandleFunc("/todos/{id}", deleteTodo).Methods("DELETE")
	r.HandleFunc("/todos", listTodos).Methods("GET")
	r.HandleFunc("/error", errorHandler).Methods("GET")

	log.Printf("Server starting on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func createTodo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Start Elastic APM transaction
	tx := apm.TransactionFromContext(ctx)
	defer tx.End()

	// Start OpenTelemetry span
	span := trace.SpanFromContext(ctx)
	defer span.End()

	logWithContext(ctx, "info", "createTodo", "Starting todo creation")

	var todo ToDoCreate
	if err := json.NewDecoder(r.Body).Decode(&todo); err != nil {
		logWithContext(ctx, "error", "createTodo", fmt.Sprintf("Invalid request body: %v", err))
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	result, err := db.Exec(
		"INSERT INTO todos (title, description, completed) VALUES (?, ?, ?)",
		todo.Title, todo.Description, todo.Completed,
	)
	if err != nil {
		logWithContext(ctx, "error", "createTodo", fmt.Sprintf("Database error: %v", err))
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	id, _ := result.LastInsertId()
	todoItem := &ToDoInDB{
		ID:          int(id),
		Title:       todo.Title,
		Description: todo.Description,
		Completed:   todo.Completed,
	}

	logWithContext(ctx, "info", "createTodo", fmt.Sprintf("Todo created successfully with ID: %d", id))
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(todoItem)
}

func readTodo(w http.ResponseWriter, r *http.Request) {
	_, span := tracer.Start(r.Context(), "readTodo")
	defer span.End()

	vars := mux.Vars(r)
	id, err := strconv.Atoi(vars["id"])
	if err != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}

	var todo ToDoInDB
	err = db.QueryRow(
		"SELECT id, title, description, completed FROM todos WHERE id = ?",
		id,
	).Scan(&todo.ID, &todo.Title, &todo.Description, &todo.Completed)

	if err == sql.ErrNoRows {
		log.Printf("Read todo: %d not found", id)
		http.Error(w, "ToDo not found", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("Read todo: %d", id)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(todo)
}

func updateTodo(w http.ResponseWriter, r *http.Request) {
	_, span := tracer.Start(r.Context(), "updateTodo")
	defer span.End()

	vars := mux.Vars(r)
	id, err := strconv.Atoi(vars["id"])
	if err != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}

	var update ToDoUpdate
	if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// First, check if the todo exists
	var todo ToDoInDB
	err = db.QueryRow(
		"SELECT id, title, description, completed FROM todos WHERE id = ?",
		id,
	).Scan(&todo.ID, &todo.Title, &todo.Description, &todo.Completed)

	if err == sql.ErrNoRows {
		log.Printf("Update todo: %d not found", id)
		http.Error(w, "ToDo not found", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Update only the fields that were provided
	if update.Title != nil {
		todo.Title = *update.Title
	}
	if update.Description != nil {
		todo.Description = *update.Description
	}
	if update.Completed != nil {
		todo.Completed = *update.Completed
	}

	_, err = db.Exec(
		"UPDATE todos SET title = ?, description = ?, completed = ? WHERE id = ?",
		todo.Title, todo.Description, todo.Completed, id,
	)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("Update todo: %d", id)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(todo)
}

func deleteTodo(w http.ResponseWriter, r *http.Request) {
	_, span := tracer.Start(r.Context(), "deleteTodo")
	defer span.End()

	vars := mux.Vars(r)
	id, err := strconv.Atoi(vars["id"])
	if err != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}

	// First, get the todo to return it
	var todo ToDoInDB
	err = db.QueryRow(
		"SELECT id, title, description, completed FROM todos WHERE id = ?",
		id,
	).Scan(&todo.ID, &todo.Title, &todo.Description, &todo.Completed)

	if err == sql.ErrNoRows {
		log.Printf("Delete todo: %d not found", id)
		http.Error(w, "ToDo not found", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Then delete it
	_, err = db.Exec("DELETE FROM todos WHERE id = ?", id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("Delete todo: %d", id)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(todo)
}

func listTodos(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Start APM transaction
	tx := apm.TransactionFromContext(ctx)
	if tx == nil {
		tx = elasticApm.StartTransaction("listTodos", "request")
		defer tx.End()
		ctx = apm.ContextWithTransaction(ctx, tx)
	}

	// Start OpenTelemetry span
	otelSpan := trace.SpanFromContext(ctx)
	defer otelSpan.End()

	logWithContext(ctx, "info", "listTodos", "Fetching todos list")

	skip, _ := strconv.Atoi(r.URL.Query().Get("skip"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit == 0 {
		limit = 10
	}

	// Start APM span for database query
	apmSpan := tx.StartSpan("query todos", "db.sqlite3", nil)
	defer apmSpan.End()

	rows, err := db.Query(
		"SELECT id, title, description, completed FROM todos LIMIT ? OFFSET ?",
		limit, skip,
	)
	if err != nil {
		logWithContext(ctx, "error", "listTodos", fmt.Sprintf("Database error: %v", err))
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	todos := []ToDoInDB{}
	for rows.Next() {
		var todo ToDoInDB
		if err := rows.Scan(&todo.ID, &todo.Title, &todo.Description, &todo.Completed); err != nil {
			logWithContext(ctx, "error", "listTodos", fmt.Sprintf("Error scanning row: %v", err))
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		todos = append(todos, todo)
	}

	logWithContext(ctx, "info", "listTodos", fmt.Sprintf("Successfully fetched %d todos", len(todos)))
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(todos)
}

func errorHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	span := trace.SpanFromContext(ctx)
	defer span.End()

	logWithContext(ctx, "error", "errorHandler", "Triggered error endpoint")
	http.Error(w, "This is an error", http.StatusInternalServerError)
}
