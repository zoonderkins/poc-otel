FROM golang:1.23-alpine

WORKDIR /app

# Copy the entire backend directory
COPY . .

# Download all dependencies
RUN go mod download

# Build the application
RUN go build -o main ./order-service

# Expose port
EXPOSE 3004

# Run the executable
CMD ["./main"]