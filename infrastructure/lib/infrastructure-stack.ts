import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import { Construct } from 'constructs';

export class InfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ========================================================================
    // 1. THE STORAGE (Waystation)
    // ========================================================================
    const waystationTable = new dynamodb.Table(this, 'WaystationTable', {
      tableName: 'mid-world-waystation',
      partitionKey: { name: 'partitionKey', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sortKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For R&D only
    });

    // ========================================================================
    // 2. THE BROKER (The Beam)
    // ========================================================================
    const theBeamEventBus = new events.EventBus(this, 'TheBeam', {
      eventBusName: 'mid-world-logistics-bus',
    });

    // ========================================================================
    // 3. THE COMPUTE (Services)
    // ========================================================================
    
    // Service A: Inventory Service (Manages the Table)
    const inventoryFunction = new nodejs.NodejsFunction(this, 'InventoryFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../src/inventory/index.ts'),
      handler: 'handler',
      environment: {
        TABLE_NAME: waystationTable.tableName,
        EVENT_BUS_NAME: theBeamEventBus.eventBusName,
      },
    });

    // Service B: Transport Service (Reacts to Events)
    const transportFunction = new nodejs.NodejsFunction(this, 'TransportFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../src/transport/index.ts'),
      handler: 'handler',
      environment: {
        EVENT_BUS_NAME: theBeamEventBus.eventBusName,
      },
    });

    // ========================================================================
    // 4. THE WIRING (Event Rules & Permissions)
    // ========================================================================
    
    // Permission: Inventory needs R/W access to the table
    waystationTable.grantReadWriteData(inventoryFunction);
    
    // Permission: Both need permission to publish events to The Beam
    theBeamEventBus.grantPutEventsTo(inventoryFunction);
    theBeamEventBus.grantPutEventsTo(transportFunction);

    // Rule: When Inventory says "CargoStored", Trigger Transport
    const cargoStoredRule = new events.Rule(this, 'CargoStoredRule', {
      eventBus: theBeamEventBus,
      eventPattern: {
        source: ['mid-world.inventory'],
        detailType: ['CargoStored'],
      },
    });

    cargoStoredRule.addTarget(new targets.LambdaFunction(transportFunction));

    // ========================================================================
    // 5. THE OUTPUTS
    // ========================================================================
    new cdk.CfnOutput(this, 'InventoryFunctionArn', { value: inventoryFunction.functionArn });
    new cdk.CfnOutput(this, 'BeamEventBusArn', { value: theBeamEventBus.eventBusArn });
  }
}