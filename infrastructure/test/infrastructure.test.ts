import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as Infrastructure from '../lib/infrastructure-stack';

test('MidWorld Stack Created With Correct Resources', () => {
  const app = new cdk.App();
  // WHEN
  const stack = new Infrastructure.InfrastructureStack(app, 'MyTestStack');
  
  // THEN
  const template = Template.fromStack(stack);

  // Verify DynamoDB Table Definition
  template.hasResourceProperties('AWS::DynamoDB::Table', {
    TableName: 'mid-world-waystation',
    KeySchema: [
      { AttributeName: 'partitionKey', KeyType: 'HASH' },
      { AttributeName: 'sortKey', KeyType: 'RANGE' }
    ]
  });

  // Verify EventBus Existence
  template.hasResourceProperties('AWS::Events::EventBus', {
    Name: 'mid-world-logistics-bus'
  });

  // Verify Least Privilege (Inventory Lambda has DynamoDB Access)
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: Match.arrayWith(['dynamodb:PutItem']),
          Effect: 'Allow'
        })
      ])
    }
  });

  // Verify REST API is created
  template.hasResourceProperties('AWS::ApiGateway::RestApi', {
    Name: 'Mid-World Public API'
  });

  // Verify Usage Plan (The Wallet Shield) exists
  template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
    UsagePlanName: 'FreeTier',
    Quota: {
      Limit: 1000,
      Period: 'DAY'
    },
    Throttle: {
      RateLimit: 10,
      BurstLimit: 5
    }
  });

  // Verify Method is Protected (API Key Required)
  template.hasResourceProperties('AWS::ApiGateway::Method', {
    HttpMethod: 'POST',
    ResourceId: { Ref: Match.anyValue() },
    RestApiId: { Ref: Match.anyValue() },
    ApiKeyRequired: true // <--- CRITICAL SECURITY CHECK
  });
});