# Event Indexer & Relayer

## Overview

A Node.js/Express server that serves two purposes:

1. **Event Indexer**: Polls Soroban RPC for contract events and caches them locally, working around testnet event pruning limits (~120,000 ledgers)
2. **Relay Proxy**: Securely proxies Soroban transaction submissions through OpenZeppelin Stellar Channels for gasless relaying

## Quick Start

```bash
cd indexer
npm install
npm run start
# Server starts on http://localhost:8123
```

## API Reference

### `GET /api/events`

Returns cached contract events.

**Response:**
```json
{
  "contractId": "CC...",
  "lastSyncedLedger": 1234567,
  "events": [
    {
      "id": "12345-1",
      "type": "contract",
      "ledger": 1234500,
      "ledgerClosedAt": "2025-01-15T10:30:00Z",
      "contractId": "CC...",
      "txHash": "abc...",
      "topic": ["base64..."],
      "value": "base64...",
      "tokenAddress": "CA..."   // extracted token contract address (if available)
    }
  ]
}
```

### `POST /api/reset`

Resets the indexer database (clears events, starts fresh sync).

**Response:**
```json
{ "success": true }
```

### `POST /api/relay`

Proxies a Soroban transaction to OpenZeppelin Stellar Channels for gasless execution.

**Request Body:**
```json
{
  "func": "base64_encoded_host_function_xdr",
  "auth": ["base64_encoded_auth_entries"]
}
```

**Headers:**
- `x-api-key`: (Optional) Required if `RELAY_API_KEY` environment variable is set

**Response (Success):**
```json
{
  "success": true,
  "hash": "transaction_hash_hex"
}
```

**Response (Error):**
```json
{
  "error": "OpenZeppelin Channels relay failed",
  "details": "error message"
}
```

### Indexer Database

Events are cached in `indexer/indexer_db.json`:

```json
{
  "lastSyncedLedger": 1234567,
  "events": [...],
  "contractId": "CC..."
}
```

The database is auto-saved after each sync cycle and persists across restarts.

## Architecture

```
┌──────────────┐     Polls every 5s     ┌─────────────────┐
│  Soroban RPC │ ◄──────────────────── │  Indexer Server │
│  (testnet)   │                        │  (port 8123)    │
└──────┬───────┘                        └────────┬────────┘
       │                                         │
       │ getEvents()                             │ GET /api/events
       ▼                                         ▼
┌──────────────────┐                  ┌──────────────────┐
│  Ledger Events   │                  │  React Frontend  │
│  (pruned after   │                  │  (port 5173)     │
│   ~120K ledgers) │                  └──────────────────┘
└──────────────────┘
```

## Relay Flow

```
User Action (Shielded Transfer)
        │
        ▼
Frontend generates UltraHonk proof
        │
        ▼
Frontend serializes HostFunction XDR
        │
        ▼
POST /api/relay { func, auth }
        │
        ▼
Indexer appends OpenZeppelin API key
        │
        ▼
OpenZeppelin Channels Service
        │
        ▼
Fee-bump transaction broadcast to Stellar Testnet
        │
        ▼
Transaction confirmed (user pays 0 gas)
```

## Configuration

The indexer autodetects `.env` files by searching (in order):

1. `../frontend/.env` (shared frontend config)
2. `.env` (indexer-local config)
3. `../.env` (root workspace config)

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 8123) |
| `OPENZEPPELIN_CHANNELS_API_KEY` | API key for gasless relaying |
| `RELAY_API_KEY` | Optional API key to secure the relay endpoint |

## Event Sanitization

Events are sanitized before storage to ensure portability:

- ScVal topics are converted to base64 strings
- ScVal values are converted to base64 strings
- Token addresses are extracted from transaction envelopes and appended to event records
- Duplicate events are filtered by event ID

## Token Address Extraction

The indexer extracts the token contract address from the transaction envelope XDR when indexing events. This enables the frontend to filter events by asset type without additional RPC calls.

The extraction logic:
1. Parses the `TransactionEnvelope` from base64 XDR
2. Handles V0, V1, and fee-bump envelopes
3. Finds the `invokeHostFunction` operation
4. Extracts the contract address argument

## Migration Support

The indexer includes a one-time migration function (`migrateDbEvents`) that backfills `tokenAddress` fields for events that were indexed before the extraction logic was added.

## Error Handling

- **Out-of-range start ledger**: Automatically adjusts to the minimum available ledger
- **RPC timeouts**: Retries on next 5s poll cycle
- **Database corruption**: Resets to empty state on parse failure
- **Contract redeployment**: Detects contract ID changes and resets database automatically
