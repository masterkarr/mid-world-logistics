![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/masterkarr/mid-world-logistics/pipeline.yml)
![GitHub top language](https://img.shields.io/github/languages/top/masterkarr/mid-world-logistics)

# Mid-World Logistics

**Distributed Systems R&D Sandbox**

This project serves as a practical exploration of event-driven architecture within the AWS ecosystem. It models a distributed supply chain, designed to isolate and solve specific challenges inherent to high-scale logistics: eventual consistency, idempotent processing, and service decoupling.

Unlike a standard CRUD application, the goal here is to enforce strict architectural boundaries using **Hexagonal Architecture** (Ports and Adapters). The domain logic is agnostic of the underlying AWS primitives, allowing for rigorous unit testing and clean separation of concerns.

## System Design Goals

The repository prioritizes the operational resilience and long-term maintainability of the system over simple feature delivery.

* **Infrastructure as Code:** All resources are defined via AWS CDK (TypeScript), enforcing a strict prohibition on manual console configuration to prevent configuration drift.
* **Event Sourcing:** State changes are propagated via Amazon EventBridge to maintain loose coupling between the *Transport* and *Inventory* domains.
* **Observability:** Implementation of structured logging and distributed tracing to ensure visibility into asynchronous workflows.
* **Cost Governance:** Application of "Safety Rails" including API throttling (10 req/s) and Lambda concurrency limits to prevent "Wallet Denial of Service."

## Domain Context

The system borrows nomenclature from Stephen King's *The Dark Tower* series to model a fragmented supply chain. This abstraction allows for testing complex routing logic without relying on proprietary data models.

* **Cargo:** Discrete assets requiring tracking across boundaries.
* **Waystations:** Nodes in the network where inventory state is reconciled (DynamoDB).
* **The Beam:** The central event bus governing data flow between disparate services (EventBridge).

## 🚀 Getting Started

Follow these steps to deploy the architecture from a fresh clone.

### Prerequisites
* **Node.js** (v18 or newer)
* **AWS CLI** (Configured with `aws configure`)
* **AWS CDK** (`npm install -g aws-cdk`)

### 1. Installation
Install dependencies for both the root project and the infrastructure definition.

```bash
# Clone the repository
git clone [https://github.com/masterkarr/mid-world-logistics.git](https://github.com/masterkarr/mid-world-logistics.git)
cd mid-world-logistics

# Install root dependencies
npm install

# Install CDK dependencies
cd infrastructure
npm install
````

### 2. AWS Bootstrap (First Time Only)
If you are deploying to a new AWS Account or Region (e.g., us-east-1) for the first time, you must initialize the CDK assets bucket. This allows CDK to store your Lambda code and CloudFormation templates.

```bash
# From the /infrastructure folder
npx cdk bootstrap
````

### 3. Deploy Stack
Synthesize and push the CloudFormation template.

```bash
# From /infrastructure directory
npx cdk deploy
````
* **Note: You will be prompted to approve IAM security changes. Enter y to proceed.**
* **Output: Upon success, the CLI will output your public ApiUrl.**

### 4. Automated Verification
Run the integrated test suite to confirm the system is operational.

```bash
# Return to root directory
cd ..

# Run unit and integration tests
npm test
````

### 5. Live Smoke Test
You can verify the live API using curl. Replace <YOUR_API_URL> with the ApiUrl output from Step 3.

* **Procedure: Execute the command listed in SOP-001: Manual Smoke Test.**
* **Verification: Confirm the item appears in DynamoDB and the TransportFunction logs show activity.**
```bash
curl -X POST <YOUR_API_URL>/cargo \
  -H "Content-Type: application/json" \
  -d '{"cargoId": "SMOKE-TEST-001", "location": "Thunderclap Station"}'
````