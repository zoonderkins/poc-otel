FROM golang:1.23-alpine AS builder

# Set working directory
WORKDIR /build

# Copy the entire backend directory
COPY . .

# Set working directory to cart-service
WORKDIR /build/cart-service

# Download dependencies
RUN go mod download

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux go build -o main .

# Create a minimal production image
FROM alpine:latest
WORKDIR /app

# Copy the binary from builder
COPY --from=builder /build/cart-service/main .

# Run the binary
CMD ["./main"]