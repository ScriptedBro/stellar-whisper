# Stellar Whisper: Compliance-First Shielded Stablecoin Wallet

**A privacy-preserving remittance corridor on Stellar with built-in institutional compliance**

---

## 🏆 Elevator Pitch

Stellar Whisper solves the **Privacy vs. Compliance paradox** for stablecoin transfers. Using client-side zero-knowledge proofs (Noir/UltraHonk) verified on-chain via Soroban smart contracts, users can shield their balances, send private transfers, and generate cryptographic compliance reports — all without sacrificing regulatory oversight. Spending keys never leave the browser, while viewing keys enable selective audit disclosure.

---

## 🎯 Problem

Stablecoin adoption is exploding, but two competing forces collide:

1. **Privacy is a requirement** — Businesses and individuals need to protect sensitive financial data (amounts, counterparties, wallet balances) from public ledgers
2. **Compliance is mandatory** — Regulators require sanctions screening, AML monitoring, and audit trails

Existing solutions force a tradeoff: public chains (Stellar, Ethereum) expose everything, while fully anonymous mixers (Tornado Cash) are non-compliant and attract regulatory action.

---

## 💡 Solution

Stellar Whisper introduces a **Three-Key Model** that separates spending authority from audit access:

| Key | Purpose | Sharing |
|-----|---------|---------|
| **ZK Spending Key** | Signs zero-knowledge proofs for transfers | **Never leaves your device** |
| **ZK Public Key** | Pseudonymous identity in the shielded pool | Public (on-chain in commitments) |
| **Viewing Key** | Decrypts transaction history for auditing | **Share selectively** with auditors |

This enables:
- **Private transfers** where amounts and identities are hidden behind zero-knowledge proofs
- **On-chain compliance** screening against OFAC-style sanction lists
- **Selective audit disclosure** via viewing key sharing — no spending power given away

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Blockchain** | Stellar (Protocol 26) with Soroban smart contracts |
| **ZK Proving System** | Noir DSL → UltraHonk (Aztec Barretenberg) |
| **On-Chain ZK Verifier** | Custom Rust UltraHonk implementation (sumcheck, Shplemini, KZG) |
| **Frontend** | React 19, TypeScript, Vite 8 |
| **Wallet** | Stellar Freighter API |
| **Client Proving** | `@aztec/bb.js` WASM, `@noir-lang/noir_js` |
| **Cryptography** | Poseidon hash (BN254), SHA-256, AES-GCM, HKDF |
| **Indexer/Relayer** | Node.js/Express, OpenZeppelin Stellar Channels |
| **AMM** | Constant-product `x*y=k` with 0.3% LP + 0.05% protocol fee |

---

## 🔑 Key Innovations

### 1. Three-Key Cryptographic Model
Users connect their existing Stellar Freighter wallet. A deterministic signing ceremony derives all three keys from a single Ed25519 signature — no new credentials to manage.

```
Freighter Wallet
      │ SHA-256(Ed25519 signature)
      ▼
ZK Spending Key ──► ZK Public Key (identity)
      │
      └──► Viewing Key (audit)
```

### 2. Browser-Based ZK Proving
The entire UltraHonk proof pipeline runs in the browser via WebAssembly:
- Witness construction from local notes
- Multi-scalar multiplication (MSM) in WASM
- Serialized proof submission to Soroban

Private keys **never** touch a server.

### 3. Hybrid Public-Private AMM
Liquidity providers deposit publicly (no ZK complexity), while traders execute private swaps against public reserves using ZK spend proofs. Solves the cold-start liquidity problem of pure private pools.

### 4. Compliance-First by Design
- On-chain sanctions list with admin and oracle-based updates
- Ed25519 signed oracle attestations
- Deposit and withdrawal screening
- ZK Compliance Reports with cryptographic attestations

### 5. Gasless Relaying via OpenZeppelin Channels
Since ZK proofs authorize transactions (not wallet signatures), fee-bump sponsored transactions enable **completely gasless** shielded transfers — no XLM balance required.

---

## 🏗️ Architecture

```
┌─────────────┐     ┌────────────────┐     ┌──────────────────┐
│  Freighter  │     │  React Wallet  │     │  Event Indexer   │
│  (Signing)  │◄───►│  (ZK Proving)  │◄───►│  (Node.js/Express)│
└─────────────┘     └───────┬────────┘     └────────┬─────────┘
                            │                        │
                            │ Soroban RPC            │ REST API
                            ▼                        ▼
                    ┌───────────────────────────────────────┐
                    │         Soroban (Stellar Testnet)      │
                    │                                       │
                    │  ┌──────────┐    ┌────────────────┐   │
                    │  │  Shielded │    │ UltraHonk      │   │
                    │  │  Pool     │◄──►│ ZK Verifier    │   │
                    │  │  Contract │    │ Contract       │   │
                    │  └──────────┘    └────────────────┘   │
                    │         │                              │
                    │         ▼                              │
                    │  ┌──────────┐                         │
                    │  │  Public  │                         │
                    │  │  AMM     │                         │
                    │  │  Reserves│                         │
                    │  └──────────┘                         │
                    └───────────────────────────────────────┘
```

---

## 🔄 User Flow

### Shielding (Deposit)
1. User connects Freighter wallet
2. Signs authorization message to derive ZK keys
3. Enters deposit amount → commitment + encrypted note generated locally
4. Contract checks sanctions, transfers tokens to vault, inserts commitment into Merkle tree

### Private Transfer
1. Sender selects note, enters recipient's ZK public key and viewing key
2. Wallet constructs Merkle path, derives nullifier, generates UltraHonk proof in-browser
3. Contract verifies proof via verifier contract, marks nullifier spent, inserts output commitments

### Public Withdrawal
1. Same as transfer, but recipient is a public Stellar address
2. Contract verifies proof + recipient hash binding
3. Tokens transferred from vault to recipient's public address

### Compliance Report
1. User generates ZK Compliance Report using their viewing key
2. Report includes cryptographic attestation hash proving non-sanctioned status
3. Shareable with auditors without exposing spending key

---

## 📊 Test Results

All **18 unit tests** pass:

```
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.32s
```

Including:
- Full deposit → transfer → withdraw flow
- Double-spend rejection
- Invalid Merkle root rejection
- Invalid proof rejection
- Sanctions screening (deposit and withdrawal)
- Public liquidity provision
- Shielded swap against AMM reserves
- Oracle-based sanctions updates
- Cross-layer cryptographic fixture verification
- BN254 modulus reduction edge cases

---

## 🚀 Quick Start

```bash
# Prerequisites: Rust, Node.js, Stellar CLI

# 1. Install dependencies
./scripts/setup.sh

# 2. Run tests
cargo test

# 3. Deploy to testnet
./scripts/deploy.sh

# 4. Run frontend + indexer
npm install && cd indexer && npm install && cd ../frontend && npm install && cd ..
npm run dev
# Frontend: http://localhost:5173
# Indexer:  http://localhost:8123
```

---

## 📁 Repository Structure

```
contracts/           # Soroban Smart Contracts
  whisper/           #   Shielded pool (Merkle tree, AMM, compliance)
  verifier/          #   UltraHonk ZK verifier
circuits/            # Noir ZK Circuits
  whisper/           #   Spend circuit (139 lines)
frontend/            # Vite + React Web Wallet
  src/hooks/         #   Wallet, notes, transfers, Soroban calls
  src/lib/           #   Crypto primitives, Merkle utilities
  src/components/    #   Glassmorphic UI components
indexer/             # Node.js event indexer + relay proxy
scripts/             # Build, deploy, and setup scripts
```

---

## 🔮 Future Work

- **Multi-asset support** beyond USDC/XLM (EURC, ARS, BRL)
- **Light client proving** for mobile devices
- **Cross-chain bridges** to Ethereum/Solana via IBC
- **Mainnet deployment** after professional security audit
- **ZK email receipts** for regulatory reporting

---

## ⚠️ Security Notice

This is a **hackathon prototype**. The cryptographic pipeline, smart contracts, and proof circuits require professional security audit before any production deployment.
