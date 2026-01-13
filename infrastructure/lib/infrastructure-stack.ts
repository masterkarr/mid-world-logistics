import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs'; // <-- NEW: For the DLQ
import * as path from 'path';
import { Construct } from 'constructs';

export class InfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. THE SAFETY NET (Reliability)
    // If the Transport Service fails 3 times, the event goes here.
    const deadLetterQueue = new sqs.Queue(this, 'TransportDLQ', {
      queueName: 'mid-world-transport-dlq',
      retentionPeriod: cdk.Duration.days(14), // Keep failed messages for 2 weeks
    });

    // 2. THE STORAGE
    const waystationTable = new dynamodb.Table(this, 'WaystationTable', {
      tableName: 'mid-world-waystation',
      partitionKey: { name: 'partitionKey', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sortKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, 
    });

    // 3. THE BROKER
    const theBeamEventBus = new events.EventBus(this, 'TheBeam', {
      eventBusName: 'mid-world-logistics-bus',
    });

    // 4. THE COMPUTE (With Observability)
    
    // Service A: Inventory
    const inventoryFunction = new nodejs.NodejsFunction(this, 'InventoryFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../src/inventory/index.ts'),
      handler: 'handler',
      tracing: lambda.Tracing.ACTIVE, // <-- NEW: Enable X-Ray Tracing
      environment: {
        TABLE_NAME: waystationTable.tableName,
        EVENT_BUS_NAME: theBeamEventBus.eventBusName,
      },
    });

    // Service B: Transport
    const transportFunction = new nodejs.NodejsFunction(this, 'TransportFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../src/transport/index.ts'),
      handler: 'handler',
      tracing: lambda.Tracing.ACTIVE, // <-- NEW: Enable X-Ray Tracing
      environment: {
        EVENT_BUS_NAME: theBeamEventBus.eventBusName,
      },
    });

    // 5. THE WIRING (Permissions)
    waystationTable.grantReadWriteData(inventoryFunction);
    theBeamEventBus.grantPutEventsTo(inventoryFunction);
    theBeamEventBus.grantPutEventsTo(transportFunction);

    // 6. THE RULE (With Redundancy)
    const cargoStoredRule = new events.Rule(this, 'CargoStoredRule', {
      eventBus: theBeamEventBus,
      eventPattern: {
        source: ['mid-world.inventory'],
        detailType: ['CargoStored'],
      },
    });

    // Connect the rule to Lambda, but attach the DLQ for failures
    cargoStoredRule.addTarget(new targets.LambdaFunction(transportFunction, {
      deadLetterQueue: deadLetterQueue, // <-- NEW: If Lambda fails, send here
      retryAttempts: 2, // Retry twice before giving up
    }));
    
    // Output the DLQ URL so we can check it later
    new cdk.CfnOutput(this, 'DLQUrl', { value: deadLetterQueue.queueUrl });
  }
}