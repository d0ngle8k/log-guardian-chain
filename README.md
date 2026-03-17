# Guardian Log

Guardian Log is a blockchain-backed log integrity platform with three runtime parts:

- `frontend/`: React dashboard and operations UI
- `backend/`: Rust API, ingest, IPFS, and Solana verification flow
- `agent-syslog-collector/`: production syslog collector binary and tests

## Start The Stack

Use the root startup script:

```powershell
./start-guardian-log.ps1
```

To also generate test syslog traffic every minute:

```powershell
./start-guardian-log.ps1 -StartSender
```

## Repo Layout

- `frontend/` contains the only production frontend application
- `backend/` contains the API, DB logic, IPFS upload, and Solana Devnet verification
- `solana-program/` contains the on-chain program and IDL assets
- `docs/` contains operational and contract documentation

## Notes

- The syslog collector currently runs from the checked-in binary under `agent-syslog-collector/target/` because the full collector source tree is not present in this workspace snapshot.
- Documentation files and context prompt files are intentionally preserved during cleanup.
