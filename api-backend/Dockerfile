FROM golang:1.22.3-alpine

WORKDIR /app

# Install build essentials and OpenTelemetry Collector
RUN apk add --no-cache gcc musl-dev curl && \
    curl -L https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.96.0/otelcol-contrib_0.96.0_linux_amd64.tar.gz -o otelcol.tar.gz && \
    tar xzf otelcol.tar.gz && \
    mv otelcol-contrib /usr/local/bin/ && \
    rm otelcol.tar.gz

COPY go.mod go.sum ./
RUN go mod download && go mod verify

COPY . .

EXPOSE 3000

RUN go build -o main main.go

# Start both the collector and your application
CMD ["/bin/sh", "-c", "otelcol-contrib --config /etc/otel/collector.yaml & ./main"]