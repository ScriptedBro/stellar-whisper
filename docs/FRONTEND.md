# Frontend Architecture

## Overview

Single-page React 19 application built with Vite 8 and TypeScript. Communicates with Soroban contracts via `@stellar/stellar-sdk`, performs ZK proving via `@aztec/bb.js` WebAssembly, and connects to Stellar via Freighter API.

## Project Structure

```
frontend/src/
├── main.tsx                    # Entry point with Buffer polyfill
├── App.tsx                     # Root component with tab routing
├── index.css / App.css         # Global & component styles
├── types/index.ts              # TypeScript interfaces & constants
├── config/
│   ├── constants.ts            # RPC URL, contract IDs, sanctioned addresses
│   ├── deployed.json           # Auto-generated deployment addresses
│   └── whisper.json            # Noir circuit ABI definition (compiled)
├── lib/
│   ├── crypto.ts               # Poseidon hashing, commitment/nullifier derivation, AES-GCM
│   ├── merkle.ts               # Merkle tree construction, path generation
│   ├── fixtures.ts             # Test vectors for crypto derivations
│   ├── fixtures.test.ts        # Tests for fixtures
│   ├── test_proof.ts           # Proof generation test helpers
│   └── test_onchain.ts         # On-chain test helpers
├── hooks/
│   ├── useWallet.ts            # Freighter connection, ZK key derivation
│   ├── useBalances.ts          # Public & shielded balance management
│   ├── useNotes.ts             # Note scanning, decryption, synchronization
│   ├── useSorobanCall.ts       # Soroban transaction execution + relayer
│   └── useTransfers.ts         # Deposit, transfer, withdraw, swap orchestration
├── context/
│   └── NotificationContext.tsx  # Toast/alert notification system
└── components/
    ├── layout/                 # Header, Sidebar, Settings, Modals
    ├── vault/                  # VaultDashboard, PoolStats, ActivityLog
    ├── pool/                   # DepositPanel
    ├── send/                   # SendPanel, NoteSelector
    ├── swap/                   # SwapPanel
    ├── liquidity/              # LiquidityPanel
    └── compliance/             # CompliancePanel, ComplianceReport
```

## Hooks Architecture

### `useWallet` — Wallet Connection & Key Derivation

- Connects to Freighter browser extension
- Signs authorization message: `"Sign this message to authorize Stellar Whisper ZK Privacy Key Derivation"`
- Derives ZK Spending Key via `SHA-256(Ed25519 signature)`
- Derives Viewing Key and ZK Public Key from Spending Key
- Caches keys in `sessionStorage` (cleared on tab close)

### `useNotes` — Note Discovery & Sync

- Fetches contract events from indexer (preferred) or directly from Soroban RPC
- Decrypts `encrypted_note` fields using local Viewing Key
- Derives nullifiers and checks spent status on-chain
- Maintains ordered commitment list for Merkle tree reconstruction
- Background polling every 5 seconds for real-time updates
- Falls back to `localStorage` when RPC event pruning limits are hit

### `useTransfers` — Transaction Orchestration

- **Deposit**: Generates commitment + encrypted note, submits to `deposit()`
- **Transfer/Withdraw**: Constructs UltraHonk witness, generates proof in-browser, submits to `transfer_or_withdraw()`
- **Compliance**: Scans events, decrypts notes, generates cryptographic attestation
- Manages proving progress UI (logs, progress bar)

### `useSorobanCall` — Contract Interaction

- Builds Soroban transactions using `@stellar/stellar-sdk`
- Simulates via RPC, then submits
- Supports gasless relay through OpenZeppelin Channels
- Handles auth entry building for token approvals

## Cryptography (`lib/crypto.ts`)

All cryptographic operations run client-side:

| Function | Purpose |
|----------|---------|
| `derivePubkey(sk)` | `Poseidon(sk)` mod BN254 scalar field |
| `deriveCommitment(pk, amount, nonce, assetId)` | `Poseidon(pk, Poseidon(Poseidon(amount, nonce), assetId))` |
| `deriveNullifier(sk, nonce)` | `Poseidon(sk, nonce)` |
| `encryptNote(vk, note)` | AES-256-GCM with HKDF-derived key |
| `decryptNote(vk, ciphertext)` | AES-256-GCM decryption |
| `hashOnChain(left, right)` | Poseidon 2-to-1 compression |
| `getAssetId(address)` | SHA-256 of token contract address XDR |

### BN254 Scalar Field Reduction

All inputs to Poseidon hash are reduced modulo the BN254 scalar modulus (`0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001`) to prevent `input exceeds field modulus` errors.

## Merkle Tree (`lib/merkle.ts`)

- Depth: 16 levels (capacity: 65,536 notes)
- Poseidon 2-to-1 hash at each node
- `constructMerklePath(commitments, leafIndex)` builds path for ZK witness
- `computeLatestMerkleRootOnChain(commitments)` computes root from ordered commitment list

## Styling

Glassmorphic design system implemented in custom CSS:

- Frosted glass panels with `backdrop-filter: blur()`
- Gradient backgrounds (dark purple/blue palette)
- Lucide React icons
- Responsive layout with sidebar navigation
- Transaction status modals with animated indicators

## Dependencies

| Package | Purpose |
|---------|---------|
| `@stellar/stellar-sdk` | Soroban RPC, transaction building, XDR |
| `@stellar/freighter-api` | Wallet connection |
| `@aztec/bb.js` | UltraHonk proving engine (WASM) |
| `@noir-lang/noir_js` | Noir circuit witness generation |
| `@noir-lang/acvm_js` | ACVM execution |
| `@iden3/js-crypto` | Poseidon hash |
| `lucide-react` | UI icons |
| `buffer` | Buffer polyfill for browser |

## Environment Variables

| Variable | Required | Default |
|----------|----------|---------|
| `VITE_NETWORK` | Yes | `testnet` |
| `VITE_ADMIN_ADDRESS` | Yes | — |
| `VITE_TOKEN_CONTRACT_ID` | Yes | — |
| `VITE_TOKEN_B_CONTRACT_ID` | Yes | — |
| `VITE_VERIFIER_CONTRACT_ID` | Yes | — |
| `VITE_WHISPER_CONTRACT_ID` | Yes | — |
| `OPENZEPPELIN_CHANNELS_API_KEY` | No | — |

## Performance Notes

- First ZK proof generation may be slow (~10-30s) due to WASM compilation + MSM computation
- Subsequent proofs are faster as the WASM module stays cached
- Event sync from indexer is near-instant; direct RPC sync depends on ledger history size
- Set `VITE_*` env vars before building for production; they're compile-time inlined by Vite
