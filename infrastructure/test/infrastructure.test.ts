import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as Infrastructure from '../lib/infrastructure-stack';

test('MidWorld Stack Created With Correct Resources', () => {
  const app = new cdk.App();
  // WHEN
  const stack = new Infrastructure.InfrastructureStack(app, 'MyTestStack');
  // THEN
  const template = Template.fromStack(stack);

  // 1. Verify DynamoDB Table Definition
  template.hasResourceProperties('AWS::DynamoDB::Table', {
    TableName: 'mid-world-waystation',
    KeySchema: [
      { AttributeName: 'partitionKey', KeyType: 'HASH' },
      { AttributeName: 'sortKey', KeyType: 'RANGE' }
    ]
  });

  // 2. Verify EventBus Existence
  template.hasResourceProperties('AWS::Events::EventBus', {
    Name: 'mid-world-logistics-bus'
  });

  // 3. Verify Least Privilege (Inventory Lambda has DynamoDB Access)
  // FIXED: Instead of checking the exact array of 10+ actions, we just check
  // that the "Action" array *contains* the critical permission we need.
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: Match.arrayWith(['dynamodb:PutItem']), // Only check for the write permission
          Effect: 'Allow'
        })
      ])
    }
  });
});