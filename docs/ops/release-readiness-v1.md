# Release Readiness V1

## Phase 6 Exit Criteria

- Backend integration tests pass.
- Frontend unit tests pass.
- Frontend production build succeeds.
- Metrics endpoint is reachable and exposes non-empty counters.
- Verify flow confirms both `verified` and `tampered` scenarios.
- Incident runbook is reviewed by operators.

## UAT Checklist

1. Ingest sample logs from at least 3 devices.
2. Confirm logs appear in Log Explorer.
3. Verify at least one normal payload returns `verified`.
4. Modify one payload and confirm `tampered` result.
5. Confirm dashboard counters update after verification.
6. Confirm metrics include ingest, verify, and retry counters.

## SLO Baseline

- API availability: 99.5% monthly.
- P95 ingest latency: <= 2 seconds for files <= 1 MB.
- P95 verify latency: <= 1 second.

## Key Management

- Keep Solana signing key outside repository.
- Rotate ingest API key every 90 days.
- Restrict production key access to on-call operators.

## Rollback

1. Stop backend service.
2. Restore previous backend binary/container image.
3. Restore previous env values and API keys if needed.
4. Restart service and verify `/health` and `/metrics`.
