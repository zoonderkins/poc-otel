FROM golang:1.21-alpine

WORKDIR /app

# Copy only necessary files
COPY shared/ ./shared/
COPY auth-service/ ./auth-service/
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux go build -o main ./auth-service

# Run the binary
CMD ["./main"] 