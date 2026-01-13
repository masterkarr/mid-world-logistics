# System Architecture: Mid-World Logistics

This system utilizes an **Event-Driven Serverless** architecture. It is designed to be highly scalable and decoupled, ensuring that the ingestion of cargo data does not depend on the immediate availability of transport processing logic.

## High-Level Data Flow

```mermaid
graph LR
    %% Define Nodes
    Client([Client / Terminal])
    API{API Gateway}
    InvLambda[Inventory Lambda]
    DDB[(DynamoDB Table)]
    EB[[EventBridge Bus]]
    TransLambda[Transport Lambda]
    DLQ[SQS Dead Letter Queue]
    CW[CloudWatch Logs]

    %% Define Flow
    Client -->|POST /cargo| API
    API --> InvLambda
    InvLambda -->|1. Store Record| DDB
    InvLambda -->|2. Emit Event| EB
    EB -->|Rule Match| TransLambda
    TransLambda -->|Log Result| CW
    
    %% Error Handling
    TransLambda -.->|On Failure| DLQ