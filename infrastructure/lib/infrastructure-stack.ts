import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
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
      reservedConcurrentExecutions: 10,
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
    
    // ====================================================
    // OBSERVABILITY: CloudWatch Alarms & Monitoring
    // ====================================================
    
    // SNS Topic for Alarm Notifications
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: 'mid-world-alarms',
      displayName: 'Mid-World Logistics System Alarms',
    });

    // Alarm 1: API Gateway 5xx Errors (SEV-1)
    const apiErrorAlarm = new cloudwatch.Alarm(this, 'ApiErrorAlarm', {
      alarmName: 'mid-world-api-5xx-errors',
      alarmDescription: 'API Gateway is returning 5xx errors - SEV-1 Incident',
      metric: api.metricServerError({
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    apiErrorAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));

    // Alarm 2: Dead Letter Queue Depth (SEV-2)
    const dlqAlarm = new cloudwatch.Alarm(this, 'DLQAlarm', {
      alarmName: 'mid-world-transport-dlq-depth',
      alarmDescription: 'Messages in DLQ - Transport function failures - SEV-2 Incident',
      metric: deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        statistic: 'Maximum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dlqAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));

    // Alarm 3: Inventory Lambda Errors
    const inventoryErrorAlarm = new cloudwatch.Alarm(this, 'InventoryErrorAlarm', {
      alarmName: 'mid-world-inventory-errors',
      alarmDescription: 'Inventory Lambda function errors detected',
      metric: inventoryFunction.metricErrors({
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 3,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    inventoryErrorAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));

    // Alarm 4: Transport Lambda Errors
    const transportErrorAlarm = new cloudwatch.Alarm(this, 'TransportErrorAlarm', {
      alarmName: 'mid-world-transport-errors',
      alarmDescription: 'Transport Lambda function errors detected',
      metric: transportFunction.metricErrors({
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 3,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    transportErrorAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));

    // Alarm 5: API Latency (SEV-3)
    const apiLatencyAlarm = new cloudwatch.Alarm(this, 'ApiLatencyAlarm', {
      alarmName: 'mid-world-api-high-latency',
      alarmDescription: 'API Gateway latency above 2 seconds - SEV-3 Performance Degradation',
      metric: api.metricLatency({
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 2000, // 2 seconds in milliseconds
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    apiLatencyAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));
    
    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url });
    new cdk.CfnOutput(this, 'AlarmTopicArn', { 
      value: alarmTopic.topicArn,
      description: 'Subscribe to this SNS topic to receive alarm notifications',
    });
  }
}
