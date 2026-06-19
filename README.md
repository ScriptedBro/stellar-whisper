# Stellar Whisper: Fully Shielded Wallet & Remittance

Stellar Whisper is a **compliance-first, fully shielded wallet and remittance application** built for stablecoins (USDC/EURC) on the Stellar network. It leverages the cryptographic primitives introduced in Stellar **Protocol 25 & 26** to perform on-chain verification of client-side zero-knowledge proofs.

---

## 🌟 Key Features
- **Shielded Stablecoin Transfers**: Users deposit public stablecoins into a Soroban-based privacy pool and perform end-to-end transfers completely off-ledger.
- **Client-Side Proof Generation**: Proofs are compiled client-side in the browser using Aztec's WebAssembly backend, preserving transaction integrity without exposing secrets.
- **Compliant Disclosures**: Users can generate a cryptographically secure **ZK Compliance Attestation** to satisfy tax or KYC audit requirements, proving they are compliant without leaking their entire private ledger history.
- **Optimized on Soroban**: Utilizes Protocol 25/26 native host functions (such as Poseidon hashing and BN254 pairing) to achieve ultra-low gas costs for Groth16/UltraHonk verification.

---

## 🏗️ Architecture

```
                                 [ USER ]
                                    │
            ┌───────────────────────┴───────────────────────┐
            ▼                                               ▼
   [ Generate ZK Proof ]                             [ Deposit USDC ]
   (Client-side Wasm / Noir)                          (Public Transfer)
            │                                               │
            │                                               ▼
            │                                     ┌───────────────────┐
            │                                     │ Soroban Pool      │
            └───────────────► [ verify_proof() ] ─►│ (Merkle updates)  │
                                   (Soroban)      └─────────┬─────────┘
                                                            │
                                                            ▼
                                                     [ Private Vault ]
                                                     (Target Payout)
```

---

## 📁 Repository Layout

- `/contracts/whisper` — Soroban smart contract managing the shielded pool, Merkle commitments, and nullifier tracking.
- `/circuits/whisper` — Noir zero-knowledge circuit that validates commitments, Merkle paths, and outputs nullifiers.
- `/frontend` — Vite + React (TypeScript) dashboard demonstrating shielding, private transferring, and ZK compliance report generation.
- `/scripts` — Build, setup, and deployment scripts to orchestrate local development.

---

## 🚀 Getting Started

### Prerequisites
Make sure you have the following installed:
- [Rust & Cargo](https://rustup.rs/) (v1.95.0+)
- [NodeJS & NPM](https://nodejs.org/) (v24+)
- [Stellar CLI](https://github.com/stellar/stellar-cli) (v25+)

### 1. Setup Environment
Run the automated setup script to verify dependencies and install the Noir compiler (`nargo`):
```bash
./scripts/setup.sh
```

Ensure the Nargo binary is loaded in your path:
```bash
export PATH="$HOME/.nargo/bin:$PATH"
```

### 2. Run Smart Contract Tests
Ensure everything works correctly in the mock Soroban environment:
```bash
cargo test
```

### 3. Deploy and Initialize (Testnet)
Deploy the contracts to the Stellar testnet and generate the frontend configs:
```bash
./scripts/deploy.sh
```

### 4. Start the Frontend
Launch the local web server to interact with the wallet interface:
```bash
cd frontend
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🔒 Security & Compliance Note
This repository contains hackathon-grade proof-of-concept code. The cryptographic hash functions are backed by standard test implementations, and the ZK circuits require thorough third-party auditing before deployment to any production mainnet environment.
