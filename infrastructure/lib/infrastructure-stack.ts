import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';
import { Construct } from 'constructs';

// 1. SIMPLIFY: Remove the custom 'stage' interface
export class InfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 2. CLEANUP: No more 'resourceName()' helper. We use string literals.

    // 3. DEFINE RESOURCES (Hardcoded Prod Names)
    const deadLetterQueue = new sqs.Queue(this, 'TransportDLQ', {
      queueName: 'mid-world-transport-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    const waystationTable = new dynamodb.Table(this, 'WaystationTable', {
      tableName: 'mid-world-waystation',
      partitionKey: { name: 'partitionKey', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sortKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, 
    });

    const theBeamEventBus = new events.EventBus(this, 'TheBeam', {
      eventBusName: 'mid-world-logistics-bus',
    });

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

    waystationTable.grantReadWriteData(inventoryFunction);
    theBeamEventBus.grantPutEventsTo(inventoryFunction);
    theBeamEventBus.grantPutEventsTo(transportFunction);

    const cargoStoredRule = new events.Rule(this, 'CargoStoredRule', {
      eventBus: theBeamEventBus,
      eventPattern: { source: ['mid-world.inventory'], detailType: ['CargoStored'] },
    });
    cargoStoredRule.addTarget(new targets.LambdaFunction(transportFunction, {
      deadLetterQueue: deadLetterQueue,
      retryAttempts: 2,
    }));

    const api = new apigateway.RestApi(this, 'MidWorldRestApi', {
      restApiName: 'Mid-World Public API',
      description: 'Enterprise endpoint with API Key protection',
      deployOptions: {
        stageName: 'prod',
        tracingEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      }
    });

    const cargoResource = api.root.addResource('cargo');
    cargoResource.addMethod('POST', new apigateway.LambdaIntegration(inventoryFunction), {
      apiKeyRequired: true
    });

    const plan = api.addUsagePlan('FreeTierPlan', {
      name: 'FreeTier',
      throttle: {
        rateLimit: 10,
        burstLimit: 5
      },
      quota: {
        limit: 1000,
        period: apigateway.Period.DAY
      }
    });

    const apiKey = api.addApiKey('DeveloperKey', {
      apiKeyName: 'mid-world-developer-key',
    });

    plan.addApiKey(apiKey);
    
    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url });
  }
}