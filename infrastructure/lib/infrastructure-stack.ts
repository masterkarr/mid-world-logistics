import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { CfnStage } from 'aws-cdk-lib/aws-apigatewayv2';
import * as path from 'path';
import { Construct } from 'constructs';

export class InfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. SAFETY NET (DLQ)
    const deadLetterQueue = new sqs.Queue(this, 'TransportDLQ', {
      queueName: 'mid-world-transport-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // 2. STORAGE
    const waystationTable = new dynamodb.Table(this, 'WaystationTable', {
      tableName: 'mid-world-waystation',
      partitionKey: { name: 'partitionKey', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sortKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, 
    });

    // 3. EVENT BUS
    const theBeamEventBus = new events.EventBus(this, 'TheBeam', {
      eventBusName: 'mid-world-logistics-bus',
    });

    // 4. COMPUTE (With Safety Rails)
    const inventoryFunction = new nodejs.NodejsFunction(this, 'InventoryFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../src/inventory/index.ts'),
      handler: 'handler',
      tracing: lambda.Tracing.ACTIVE,
      reservedConcurrentExecutions: 5,
      environment: {
        TABLE_NAME: waystationTable.tableName,
        EVENT_BUS_NAME: theBeamEventBus.eventBusName,
      },
    });

    const transportFunction = new nodejs.NodejsFunction(this, 'TransportFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../src/transport/index.ts'),
      handler: 'handler',
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        EVENT_BUS_NAME: theBeamEventBus.eventBusName,
      },
    });

    // 5. PERMISSIONS
    waystationTable.grantReadWriteData(inventoryFunction);
    theBeamEventBus.grantPutEventsTo(inventoryFunction);
    theBeamEventBus.grantPutEventsTo(transportFunction);

    // 6. RULES
    const cargoStoredRule = new events.Rule(this, 'CargoStoredRule', {
      eventBus: theBeamEventBus,
      eventPattern: { source: ['mid-world.inventory'], detailType: ['CargoStored'] },
    });
    cargoStoredRule.addTarget(new targets.LambdaFunction(transportFunction, {
      deadLetterQueue: deadLetterQueue,
      retryAttempts: 2,
    }));

    // 7. PUBLIC API (With Throttling)
    const api = new apigw.HttpApi(this, 'MidWorldApi', {
      description: 'Public endpoint for Mid-World Logistics',
    });

    api.addRoutes({
      path: '/cargo',
      methods: [apigw.HttpMethod.POST],
      integration: new HttpLambdaIntegration('InventoryIntegration', inventoryFunction),
    });

    // API Throttling
    if (api.defaultStage && api.defaultStage.node.defaultChild) {
      const stage = api.defaultStage.node.defaultChild as CfnStage;
      stage.defaultRouteSettings = {
        throttlingRateLimit: 10,  // Max 10 requests per second
        throttlingBurstLimit: 5,
      };
    }
    
    // Outputs
    new cdk.CfnOutput(this, 'DLQUrl', { value: deadLetterQueue.queueUrl });
    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url! });
  }
}