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
# 1. Send a test payload
curl -X POST https://<YOUR_API_ID>[.execute-api.us-east-1.amazonaws.com/prod/cargo](https://.execute-api.us-east-1.amazonaws.com/prod/cargo) \
  -H "Content-Type: application/json" \
  -d '{"cargoId": "SMOKE-TEST-001", "location": "Thunderclap Station"}'

# 2. Verify Response
# Expected Output: {"message": "Cargo stored", "id": "SMOKE-TEST-001"}

# 3. Verify Transport
# Check CloudWatch Logs for TransportFunction to confirm "Moving cargo..."