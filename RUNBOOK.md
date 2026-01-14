# Operational Runbook: Mid-World Logistics

## 🚨 Incident Response Levels

| Severity | Description | Trigger | Response SLA |
| :--- | :--- | :--- | :--- |
| **SEV-1 (Critical)** | **Data Loss / System Down**<br>API Gateway returning 500s. Cargo cannot be ingested. | CloudWatch Alarm: `5xxErrorRate > 1%` | 15 Minutes |
| **SEV-2 (High)** | **Processing Failure**<br>Cargo stored in DB but `TransportFunction` is failing. | DLQ Depth > 1 | 1 Hour |
| **SEV-3 (Medium)** | **Performance Degradation**<br>High latency or minor throttling. | Latency > 2s | 4 Hours |

---

## 🛠 Troubleshooting Guides

### Scenario A: API is returning 500 Errors (SEV-1)
**Symptoms:** Client receives `Internal Server Error` when POSTing cargo.
**Investigation Steps:**
1. **Check CloudWatch Logs:**
   - Go to Log Group: `/aws/lambda/InfrastructureStack-InventoryFunction...`
   - Filter logs for `ERROR` or `timeout`.
   - *Common Cause:* Permission errors (DynamoDB access) or payload parsing failures.
2. **Check DynamoDB Throttling:**
   - Go to DynamoDB Console -> `WaystationTable` -> **Monitor**.
   - If `WriteThrottledEvents` > 0, the On-Demand scaling is lagging or we hit an account limit.

### Scenario B: Cargo is stuck / Not Moving (SEV-2)
**Symptoms:** Item appears in DynamoDB, but `TransportFunction` logs are empty.
**Investigation Steps:**
1. **Check the Dead Letter Queue (DLQ):**
   - Go to SQS Console -> `InfrastructureStack-TransportDLQ`.
   - If `Messages Available` > 0, the EventBridge rule triggered, but the Transport Lambda crashed repeatedly.
2. **Inspect the Failed Message:**
   - Poll a message from the DLQ in the console.
   - Look at the `payload`. Did a bad character cause a JSON parse error?
3. **Check EventBridge Rules:**
   - Go to EventBridge -> Buses -> `TheBeam`.
   - verify the Rule `mid-world.inventory` is enabled.

---

## 🔄 Standard Operating Procedures (SOPs)

### SOP-001: Manual Smoke Test
To verify system health after a deployment:

```bash
# 1. Send a test payload (Requires API Key)
curl -X POST <YOUR_API_URL>cargo \
  -H "Content-Type: application/json" \
  -H "x-api-key: <YOUR_KEY_VALUE>" \
  -d '{"cargoId": "SMOKE-TEST-001", "location": "Thunderclap Station"}'

# 2. Verify Response
# Expected Output: {"message": "Cargo Processed", "id": "SMOKE-TEST-001"}

# 3. Verify Transport
# Check CloudWatch Logs for TransportFunction to confirm "Moving cargo..."
````
### SOP-002: Developer Testing
Use these commands to verify logic and infrastructure locally before opening a Pull Request.

**1. Run All Logic Tests (Root)**
Executes unit tests for Lambda functions (Inventory, Transport) using the root `jest.config.js`.
```bash
# Option A: Run all tests
npx jest

# Option B: Run a specific test file
npx jest src/transport/index.test.ts

# Option C: Watch mode (Re-runs on save)
npx jest --watch
````
**2. Run Infrastructure Tests (CDK) Executes the security and compliance tests defined in the infrastructure folder**
```bash
cd infrastructure

# Run all infrastructure tests
npx jest

# Troubleshooting: Pass the config explicitly if Jest gets confused
npx jest --config jest.config.js
````

**3. Understanding Test Failures**
* **Logic Failures: Usually indicate a bug in src/. Check the "EXPECTED" vs "RECEIVED" output in the terminal.**
* **Infrastructure Failures: Indicate a security violation (e.g., missing API Key or public S3 bucket). You must fix the stack definition in lib/infrastructure-stack.ts to pass.**

---

### SOP-003: System Deployment
Use this procedure when deploying changes to the infrastructure or application code.

**Prerequisites:**
- AWS CLI configured with AdministratorAccess (or sufficient CDK permissions).
- Node.js dependencies installed (`npm install` in root and `/infrastructure`).

**Step 1: Bootstrap Environment (First Run Only)**

If deploying to a new AWS Account or Region for the first time, you must initialize the CDK assets bucket.

```bash
cd infrastructure
npx cdk bootstrap
```

**Step 2: Deploy Stack**

Synthesize and push the CloudFormation template.

```bash
# From /infrastructure directory
npx cdk deploy
```

- **Action:** Review the IAM Security Changes list presented by the CLI.
- **Confirm:** Type `y` and press Enter to execute.
- **Outcome:** The CLI will display the ApiUrl output upon success.

**Step 3: Retrieve API Key (CRITICAL)**

The API is protected by a strict usage plan. You must retrieve your unique API Key from AWS to make requests.

*Where to run:* Local Terminal (Bash/Zsh)

```bash
# 1. Fetch the internal ID of the key named 'mid-world-developer-key'
KEY_ID=$(aws apigateway get-api-keys --query "items[?name=='mid-world-developer-key'].id" --output text)

# 2. Retrieve the actual Secret Value using that ID
aws apigateway get-api-key --api-key $KEY_ID --include-value --query "value" --output text
```

**Step 4: Live Smoke Test**

Perform a functional test against the live API to verify end-to-end connectivity.

- **Procedure:** Execute the command listed in SOP-001.
- **Verification:** Confirm the item appears in DynamoDB and the TransportFunction logs show activity.

---

### SOP-004: Release Management

Use this procedure to create and publish versioned releases of the system.

**When to Create a Release:**
- After merging features to `main` that change infrastructure
- After significant application changes (new endpoints, event patterns)
- Before planned production deployments
- After critical bug fixes that require audit trail

**Versioning Strategy:**

We use [Semantic Versioning](https://semver.org/) (SemVer): `MAJOR.MINOR.PATCH`

- **MAJOR** (e.g., 1.x.x → 2.0.0): Breaking changes requiring manual intervention
  - Infrastructure changes that break existing deployments
  - API contract changes
  - Database schema migrations
  
- **MINOR** (e.g., 1.0.x → 1.1.0): New features, backwards-compatible
  - New CloudWatch alarms
  - New Lambda functions
  - New API endpoints
  - Structured logging implementation
  
- **PATCH** (e.g., 1.0.0 → 1.0.1): Bug fixes, documentation
  - Lambda bug fixes
  - Documentation updates
  - Configuration tweaks

**Step 1: Determine Version Number**

Review commits since last release:

```bash
# See all tags
git tag -l

# See commits since last tag
git log $(git describe --tags --abbrev=0)..HEAD --oneline

# Decide: MAJOR.MINOR.PATCH based on changes
```

**Step 2: Create and Push Tag**

```bash
# Tag the current main branch
git checkout main
git pull origin main

# Create annotated tag (replace X.Y.Z with your version)
git tag -a vX.Y.Z -m "Release vX.Y.Z: Brief description of changes"

# Example:
# git tag -a v1.1.0 -m "Release v1.1.0: Add CloudWatch alarms and structured logging"

# Push tag to trigger release workflow
git push origin vX.Y.Z
```

**Step 3: Verify Release**

1. **GitHub Actions:** Go to Actions tab and verify the `Release Management` workflow completes successfully
2. **GitHub Releases:** Check the [Releases](https://github.com/masterkarr/mid-world-logistics/releases) page for the new release
3. **Production Verification:** Run SOP-003 to verify the deployment is functional

**Step 4: Update Package Version (Optional)**

Update `package.json` to match the release version:

```bash
npm version X.Y.Z --no-git-tag-version
git add package.json
git commit -m "chore: bump version to X.Y.Z"
git push origin main
```

**Rollback Procedure:**

If a release causes production issues:

1. **Identify Last Good Version:**
   ```bash
   git tag -l  # Find previous stable version
   ```

2. **Checkout Previous Version:**
   ```bash
   git checkout vX.Y.Z  # Previous stable tag
   cd infrastructure
   npx cdk deploy
   ```

3. **Create Hotfix:**
   ```bash
   git checkout -b hotfix/critical-fix
   # Make fixes
   git commit -m "fix: critical production issue"
   # Merge to main and create patch release
   ```

**Release Checklist:**

- [ ] All tests passing (SOP-001)
- [ ] Infrastructure tests passing
- [ ] RUNBOOK.md updated with any new procedures
- [ ] ARCHITECTURE.md updated if system design changed
- [ ] SECURITY.md reviewed for new vulnerabilities
- [ ] Version number follows SemVer
- [ ] Tag pushed to GitHub
- [ ] Release workflow completed
- [ ] Smoke test passed (SOP-003)