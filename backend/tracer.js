const opentelemetry = require('@opentelemetry/api');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { BasicTracerProvider, ConsoleSpanExporter, SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

class Tracer {
    constructor() {
        this.sdk = null;
    }

    init() {
        try {
            const provider = new BasicTracerProvider({
                resource: new Resource({
                    [SemanticResourceAttributes.SERVICE_NAME]: 'backend-service',
                }),
            });

            // Add console exporter for debugging
            provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));

            // Configure OTLP exporter with HTTP/1.1
            const otlpExporter = new OTLPTraceExporter({
                url: 'http://tempo:4318/v1/traces',
                headers: {},
                httpAgentOptions: {
                    keepAlive: false,
                },
                protocol: 'http/1.1'
            });

            // Add OTLP exporter
            provider.addSpanProcessor(new SimpleSpanProcessor(otlpExporter));
            provider.register();

            this.sdk = new NodeSDK({
                traceExporter: otlpExporter,
                instrumentations: [
                    getNodeAutoInstrumentations({
                        '@opentelemetry/instrumentation-fs': { enabled: false },
                        '@opentelemetry/instrumentation-express': { enabled: true },
                        '@opentelemetry/instrumentation-http': { enabled: true },
                    }),
                ],
            });

            this.sdk.start();
            console.log('Tracing initialized successfully');
        } catch (error) {
            console.error('Error initializing tracer:', error);
        }
    }

    shutdown() {
        if (this.sdk) {
            return this.sdk.shutdown();
        }
        return Promise.resolve();
    }
}

module.exports = new Tracer(); 