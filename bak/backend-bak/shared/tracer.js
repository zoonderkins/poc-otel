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

    init(serviceName) {
        try {
            const provider = new BasicTracerProvider({
                resource: new Resource({
                    [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
                }),
            });

            provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));

            const otlpExporter = new OTLPTraceExporter({
                url: 'http://tempo:4318/v1/traces',
                headers: {},
                httpAgentOptions: {
                    keepAlive: false,
                },
                protocol: 'http/1.1'
            });

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
            console.log(`Tracing initialized for ${serviceName}`);
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