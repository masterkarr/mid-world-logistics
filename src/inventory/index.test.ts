import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

// 1. Create Mocks BEFORE importing handler
const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

// Must import handler after mocks are created
import { handler } from './index';

describe('Inventory Service', () => {
  beforeEach(() => {
    ddbMock.reset();
    ebMock.reset();
    
    // Setup mock responses
    ddbMock.on(PutCommand).resolves({});
    ebMock.on(PutEventsCommand).resolves({ 
      FailedEntryCount: 0,
      Entries: [] 
    });
    
    process.env.TABLE_NAME = 'TestTable';
    process.env.EVENT_BUS_NAME = 'TestBus';
  });

  afterEach(() => {
    ddbMock.restore();
    ebMock.restore();
  });

  test('Should validate missing fields', async () => {
    const event = { body: JSON.stringify({ cargoId: '123' }) }; // Missing location
    
    const result = await handler(event);
    
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error).toContain('Missing required fields');
  });

  test('Should store item and publish event on valid input', async () => {
    // A. Setup Input
    const payload = { cargoId: 'TEST-1', location: 'DOCK-Z' };
    const event = { body: JSON.stringify(payload) };

    // C. Invoke Handler
    const result = await handler(event);

    // D. Assertions
    expect(result.statusCode).toBe(200);

    // Verify DynamoDB was called with correct PK/SK logic
    expect(ddbMock.calls()).toHaveLength(1);
    const dbCallArgs = ddbMock.call(0).args[0] as any; // Cast to access input
    expect(dbCallArgs.input.Item.partitionKey).toBe('CARGO#TEST-1');
    expect(dbCallArgs.input.Item.status).toBe('IN_STORAGE');

    // Verify EventBridge was called
    expect(ebMock.calls()).toHaveLength(1);
    const ebCallArgs = ebMock.call(0).args[0] as any;
    expect(ebCallArgs.input.Entries[0].Source).toBe('mid-world.inventory');
    expect(ebCallArgs.input.Entries[0].DetailType).toBe('CargoStored');
  });
});