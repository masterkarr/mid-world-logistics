// The Transport Service is a "Pure Consumer"
// It doesn't need to know who sent the event, only the schema.

export const handler = async (event: any) => {
    // 1. Structured Logging (The eyes of the Architect)
    console.log('TRANSPORT SERVICE WOKE UP');
    console.log('------------------------------------------------');
    console.log('Event Source:', event.source);
    console.log('Event Type:', event['detail-type']);
    console.log('Cargo Details:', JSON.stringify(event.detail, null, 2));
    console.log('------------------------------------------------');

    // 2. Simulation Logic
    // In a real app, this might schedule a truck or drone.
    // Here, we just acknowledge receipt.
    const cargoId = event.detail.cargoId || 'UNKNOWN';
    console.log(`Dispatching transport for cargo: ${cargoId}`);

    return { status: 'dispatched', cargoId };
};