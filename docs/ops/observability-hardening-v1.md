# Observability Hardening V1

## Scope

This document defines the minimum observability baseline for Phase 5.

## Runtime Signals

- `GET /metrics` exports Prometheus-style counters.
- `x-request-id` response header is attached to every request for trace correlation.
- Structured logs are emitted through `tracing` and can be collected by Fluentd/Vector.

## Exported Counters

- `log_guardian_ingest_requests_total`
- `log_guardian_ingest_success_total`
- `log_guardian_ingest_rejected_total`
- `log_guardian_verify_requests_total`
- `log_guardian_verify_success_total`
- `log_guardian_verify_tampered_total`
- `log_guardian_retry_enqueued_total`
- `log_guardian_retry_success_total`
- `log_guardian_retry_failure_total`

## Recommended Alerts

- Ingest rejection ratio > 20% for 5 minutes.
- Retry failure counter increases continuously for 10 minutes.
- Verify tampered counter spikes above baseline by 3x.

## Log Shipping Guidance

Example Fluentd output tags:

- `log_guardian.backend.request`
- `log_guardian.backend.retry`
- `log_guardian.backend.verify`

Include these fields when shipping logs:

- `timestamp`
- `level`
- `request_id`
- `route`
- `status_code`
- `message`
