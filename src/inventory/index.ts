import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

// Initialize variables but don't create clients yet (Lazy Loading)
let docClient: DynamoDBDocumentClient;
let ebClient: EventBridgeClient;

export const handler = async (event: any) => {
  console.log('📝 INVENTORY RECEIVED:', JSON.stringify(event, null, 2));

  // 1. Initialize Clients (Lazy Pattern)
  // This ensures we pick up the Mocks and Env Vars correctly during tests/execution
  if (!docClient) {
    const dbClient = new DynamoDBClient({});
    docClient = DynamoDBDocumentClient.from(dbClient);
  }
  if (!ebClient) {
    ebClient = new EventBridgeClient({});
  }

  // 2. Load Env Vars at Runtime (ensures freshness)
  const TABLE_NAME = process.env.TABLE_NAME || '';
  const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || '';

  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event;
    
    if (!body.cargoId || !body.location) {
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
    console.log(`DB WRITE SUCCESS: ${body.cargoId}`);

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
    // Add this log to help debug if it fails again
    console.log(`EVENT PUBLISHED: CargoStored to bus ${EVENT_BUS_NAME}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Cargo Processed', id: body.cargoId }),
    };

  } catch (error: any) {
    console.error('ERROR:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};