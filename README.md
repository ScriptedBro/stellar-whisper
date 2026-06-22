# Stellar Whisper: Fully Shielded Wallet & Remittance

Stellar Whisper is a **compliance-first, fully shielded wallet and remittance application** built for stablecoins (USDC/EURC) on the Stellar network. It leverages zero-knowledge cryptography and Soroban smart contracts to enable private stablecoin deposits, transfers, and withdrawals.

---

## 🌟 Key Features

- **Shielded Stablecoin Transfers**: Users deposit public stablecoins into a Soroban-based privacy pool and perform end-to-end transfers completely off-ledger.
- **Client-Side ZK Proof Generation**: The browser generates real UltraHonk zero-knowledge proofs using the Aztec Barretenberg WASM engine (`@aztec/bb.js`). The prover executes the full Noir circuit witness, performs multi-scalar multiplication (MSM), and compiles polynomial commitments — all client-side, ensuring private inputs never leave the user's device.
- **Value Conservation System**: The system verifies balance conservation using a 7-parameter public input schema:
  $$\text{Input Amount} = \text{Withdraw Amount} + \text{Recipient Output} + \text{Change Output}$$
- **Double-Spend Nullifier Guard**: Prevents double-spending of note commitments by tracking nullifiers in persistent storage on-chain.
- **Compliance & Clean Source Screening**: Before shielding assets, the application screens depositors' public wallets against sanctions lists (OFAC) and risk databases (e.g., Chainalysis/Elliptic).
- **Compliant Disclosures (Receipts Vault)**: Users can view details of their operations in the Receipts Vault to satisfy tax or KYC audit requirements, proving their funds originated from a clean source without leaking their current destination wallet or other pool activity.

---

## 🏗️ Architecture

```
                                 [ USER ]
                                    │
            ┌───────────────────────┴───────────────────────┐
            ▼                                               ▼
    [ Generate ZK Proof ]                            [ Deposit USDC ]
   (UltraHonk via bb.js)                           (Public Transfer)
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

### Cryptographic Parameters & Primitives

- **Merkle Tree Depth**: 16 levels (maximum pool capacity of 65,536 leaves per instance).
- **Hashing**: Poseidon hashing over the BN254 scalar field (`soroban_poseidon` + `bn254::Fr`) for Merkle tree compression, note commitments, nullifiers, and public-key derivation. Poseidon is the optimal hash for ZK circuits — orders of magnitude cheaper in constraints than SHA-256.
- **Proving System**: Noir circuit compiled to UltraHonk (Aztec Barretenberg). Proofs are generated client-side in the browser via `@aztec/bb.js` WASM and submitted on-chain as raw proof bytes.
- **Verifier Contract**: Implements the **full UltraHonk verification protocol** on-chain as a Soroban smart contract. The verifier performs:
  1. Proof deserialization and structural validation against the embedded verification key (VK).
  2. Fiat–Shamir challenge generation (Oink transcript rounds).
  3. Public-input delta computation for the permutation grand-product argument.
  4. **Sumcheck protocol verification** — validates the multilinear polynomial evaluations.
  5. **Shplemini batch-opening verification** (Gemini + Shplonk + KZG pairing check) — cryptographically verifies polynomial commitment openings using BN254 elliptic curve pairings via Soroban's native `bn254` host functions.

  This ensures that private preimages (secret keys and nullifier nonces) are never exposed on-chain or leaked in the ledger history.

---

## 📁 Repository Layout

- `/contracts/whisper` — Soroban smart contract managing the shielded pool, Merkle commitments, and nullifier tracking.
- `/contracts/verifier` — Full UltraHonk ZK verifier contract implementing sumcheck, Shplemini/KZG pairing verification, and Fiat–Shamir transcript generation on-chain via Soroban's native BN254 host functions.
- `/circuits/whisper` — Noir zero-knowledge circuit that validates commitments, Merkle paths, and outputs nullifiers.
- `/frontend` — Vite + React (TypeScript) dashboard demonstrating shielding, private transferring, and ZK compliance report generation.
  - `src/components/` — UI components broken down by section (layout, vault, pool, send, compliance).
  - `src/hooks/` — Modular React hooks isolating wallet connection, balances, notes syncing, Soroban calls, and transfer flows.
  - `src/lib/` — Cryptographic utilities, Merkle path generators, and decryption tools.
  - `src/types/` — Shared TypeScript type declarations.
  - `src/config/` — Deployment JSON data, default values, and local environment variables.
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
```
Install dependencies and start the dev server:
```bash
npm install
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🔒 Security & Compliance Note
This repository contains a zero-knowledge remittance protocol designed for private stablecoin transfers.

**Cryptographic Verification:**
Private keys and nullifier nonces never leave client memory. Real UltraHonk ZK proof bytes are generated in-browser by the Aztec Barretenberg WASM engine and verified on-chain by a full UltraHonk verifier contract. The on-chain verifier executes the complete cryptographic verification pipeline — including Fiat–Shamir transcript generation, sumcheck protocol verification, and Shplemini batch-opening (Gemini + Shplonk + KZG pairing) — using Soroban's native BN254 elliptic curve host functions introduced in Protocol 26.

**Prototype Disclaimer:**
While the cryptographic pipeline is fully implemented end-to-end, this remains a hackathon prototype. The implementation must be audited and verified by independent professional cryptographers before any production deployment.
