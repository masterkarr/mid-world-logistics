import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

// Initialize outside the handler to take advantage of Execution Context reuse (Warm Starts)
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME || '';

export const handler = async (event: any) => {
  console.log('EVENT RECEIVED:', JSON.stringify(event, null, 2));

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

    const command = new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    });

    await docClient.send(command);
    console.log(`SUCCESS: Cargo ${body.cargoId} stored at ${body.location}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Cargo Stored', id: body.cargoId }),
    };

  } catch (error: any) {
    console.error('ERROR:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};