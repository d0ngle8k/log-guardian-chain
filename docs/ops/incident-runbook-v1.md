# Incident Runbook V1

## Severity Levels

- SEV-1: Full ingestion outage or data integrity compromise.
- SEV-2: Partial outage or sustained high error rate.
- SEV-3: Degraded but functional system.

## Immediate Triage

1. Check `/health`.
2. Check `/metrics` for rejection/retry/tampered spikes.
3. Inspect latest backend logs by `x-request-id` where available.
4. Validate Solana RPC and Pinata upstream availability.

## Common Failures

### Ingest API key failures

- Symptom: many `missing/invalid ingest API key` errors.
- Action: verify clients use the latest key and key rollout status.

### Rate-limit saturation

- Symptom: `rate limit exceeded for ingest endpoint` grows quickly.
- Action: increase `INGEST_RATE_LIMIT` temporarily and investigate traffic source.

### Retry backlog growth

- Symptom: retry enqueued increases with low retry success.
- Action: check Pinata JWT validity, Solana RPC status, signer key path.

## Communication Template

- Start time:
- Detected by:
- Impacted endpoints:
- Current severity:
- Mitigation in progress:
- Next update ETA:

## Postmortem Requirements

- Root cause summary.
- Timeline of events.
- Corrective action items with owners and due dates.
