import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

// Initialize Powertools
const logger = new Logger({ serviceName: 'inventory-service' });
const tracer = new Tracer({ serviceName: 'inventory-service' });

// Initialize variables but don't create clients yet (Lazy Loading)
let docClient: DynamoDBDocumentClient;
let ebClient: EventBridgeClient;

export const handler = async (event: any) => {
  logger.info('Inventory request received', { event });

  // 1. Initialize Clients (Lazy Pattern)
  // This ensures we pick up the Mocks and Env Vars correctly during tests/execution
  if (!docClient) {
    const dbClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
    docClient = DynamoDBDocumentClient.from(dbClient);
  }
  if (!ebClient) {
    ebClient = tracer.captureAWSv3Client(new EventBridgeClient({}));
  }

  // 2. Load Env Vars at Runtime (ensures freshness)
  const TABLE_NAME = process.env.TABLE_NAME;
  const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;

  if (!TABLE_NAME) {
    logger.error('Missing required environment variable', { variable: 'TABLE_NAME' });
    throw new Error('TABLE_NAME environment variable is required');
  }
  if (!EVENT_BUS_NAME) {
    logger.error('Missing required environment variable', { variable: 'EVENT_BUS_NAME' });
    throw new Error('EVENT_BUS_NAME environment variable is required');
  }

  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event;
    
    if (!body.cargoId || !body.location) {
      logger.warn('Invalid request - missing required fields', { body });
      throw new Error('Missing required fields: cargoId or location');
    }

    const item = {
      partitionKey: `CARGO#${body.cargoId}`,
      sortKey: `METADATA`,
      location: body.location,
      status: 'IN_STORAGE',
      updatedAt: new Date().toISOString(),
      ...body 
    };

    // 3. The Write
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    }));
    logger.info('DynamoDB write successful', { cargoId: body.cargoId, tableName: TABLE_NAME });

    // 4. The Publish
    const eventPayload = {
        Source: 'mid-world.inventory',
        DetailType: 'CargoStored',
        Detail: JSON.stringify(item),
        EventBusName: EVENT_BUS_NAME,
    };

    await ebClient.send(new PutEventsCommand({
        Entries: [eventPayload]
    }));
    logger.info('Event published to EventBridge', { 
      cargoId: body.cargoId, 
      eventBusName: EVENT_BUS_NAME,
      eventType: 'CargoStored'
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Cargo Processed', id: body.cargoId }),
    };

  } catch (error: any) {
    logger.error('Error processing cargo', { error: error.message, stack: error.stack });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};