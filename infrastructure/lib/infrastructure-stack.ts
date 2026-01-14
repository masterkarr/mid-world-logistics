import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway'; // <-- Using REST API (v1)
import * as path from 'path';
import { Construct } from 'constructs';

interface MidWorldProps extends cdk.StackProps {
  stage?: string;
}

export class InfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: MidWorldProps) {
    super(scope, id, props);

    const stage = props?.stage || 'dev';
    const resourceName = (name: string) => stage === 'prod' ? name : `${name}-${stage}`;

    // 1. SAFETY NET (DLQ)
    const deadLetterQueue = new sqs.Queue(this, 'TransportDLQ', {
      queueName: resourceName('mid-world-transport-dlq'),
      retentionPeriod: cdk.Duration.days(14),
    });

    // 2. STORAGE
    const waystationTable = new dynamodb.Table(this, 'WaystationTable', {
      tableName: resourceName('mid-world-waystation'),
      partitionKey: { name: 'partitionKey', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sortKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, 
    });

    // 3. EVENT BUS
    const theBeamEventBus = new events.EventBus(this, 'TheBeam', {
      eventBusName: resourceName('mid-world-logistics-bus'),
    });

    // 4. COMPUTE
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

    // ============================================================
    // 7. THE FORTRESS (REST API with Keys & Usage Plans)
    // ============================================================
    const api = new apigateway.RestApi(this, 'MidWorldRestApi', {
      restApiName: resourceName('Mid-World Public API'),
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

    // Add Route: POST /cargo
    const cargoResource = api.root.addResource('cargo');
    cargoResource.addMethod('POST', new apigateway.LambdaIntegration(inventoryFunction), {
      apiKeyRequired: true // <--- 🔒 THE LOCK
    });

    // Create the Usage Plan (The "Bill Shield")
    const plan = api.addUsagePlan('FreeTierPlan', {
      name: resourceName('FreeTier'),
      throttle: {
        rateLimit: 10,
        burstLimit: 5
      },
      quota: {
        limit: 1000,     // 🛡️ HARD CAP: 1000 requests/day
        period: apigateway.Period.DAY
      }
    });

    // Create the Key
    const apiKey = api.addApiKey('DeveloperKey', {
      apiKeyName: resourceName('mid-world-developer-key'),
    });

    // Bind Key to Plan
    plan.addApiKey(apiKey);
    
    // Outputs
    new cdk.CfnOutput(this, 'DLQUrl', { value: deadLetterQueue.queueUrl });
    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url });
  }
}