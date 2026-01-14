import { handler } from './index';

describe('Transport Service', () => {
  beforeEach(() => {
    process.env.EVENT_BUS_NAME = 'TestBus';
  });

  afterEach(() => {
    delete process.env.EVENT_BUS_NAME;
  });

  test('Should process CargoStored event and dispatch transport', async () => {
    // 1. Simulate the incoming EventBridge Event
    // This mimics exactly what the Inventory Service publishes
    const event = {
      source: 'mid-world.inventory',
      'detail-type': 'CargoStored',
      detail: {
        cargoId: 'CARGO-999',
        location: 'Sector 7',
        status: 'IN_STORAGE'
      }
    };

    // 2. Invoke the Handler
    const result = await handler(event);

    // 3. Assertions (Contract Verification)
    
    // Verify the return value (The acknowledgement)
    expect(result).toEqual({
      status: 'dispatched',
      cargoId: 'CARGO-999'
    });
  });

  test('Should handle missing data gracefully (Resiliency)', async () => {
    const event = {
      source: 'mid-world.inventory',
      'detail-type': 'CargoStored',
      detail: {} // Malformed event missing cargoId
    };

    const result = await handler(event);

    // It should not crash, but default to UNKNOWN
    expect(result.cargoId).toBe('UNKNOWN');
    expect(result.status).toBe('dispatched');
  });
});