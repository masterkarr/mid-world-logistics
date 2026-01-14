import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

// Initialize Powertools
const logger = new Logger({ serviceName: 'transport-service' });
const tracer = new Tracer({ serviceName: 'transport-service' });

// The Transport Service is a "Pure Consumer"
// It doesn't need to know who sent the event, only the schema.

export const handler = async (event: any) => {
    // 0. Validate environment variables
    const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;
    if (!EVENT_BUS_NAME) {
        logger.error('Missing required environment variable', { variable: 'EVENT_BUS_NAME' });
        throw new Error('EVENT_BUS_NAME environment variable is required');
    }

    // 1. Structured Logging
    logger.info('Transport service activated', {
        eventSource: event.source,
        eventType: event['detail-type'],
        cargoDetails: event.detail
    });

    // 2. Simulation Logic
    // In a real app, this might schedule a truck or drone.
    // Here, we just acknowledge receipt.
    const cargoId = event.detail.cargoId || 'UNKNOWN';
    logger.info('Dispatching transport', { cargoId });

    return { status: 'dispatched', cargoId };
};