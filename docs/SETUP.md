# Setup Guide

## Prerequisites

| Dependency | Version | Purpose |
|-----------|---------|---------|
| Rust & Cargo | >= 1.95.0 | Soroban smart contract compilation |
| Node.js & npm | >= 24 | Frontend, indexer |
| Stellar CLI | >= 25 | Contract deployment, testnet interaction |
| Nargo (Noir) | >= 0.32.0 | ZK circuit compilation |
| Freighter Wallet | Latest | Browser wallet extension |

## Quick Start

### 1. Automated Setup

Run the setup script to verify dependencies and install the correct Noir compiler:

```bash
./scripts/setup.sh
```

This checks for Rust, Node.js, Stellar CLI, and installs `nargo` if missing.

### 2. Environment Configuration

Copy the example environment file:

```bash
cp frontend/.env.example frontend/.env
```

Key environment variables:

| Variable | Description |
|----------|-------------|
| `VITE_NETWORK` | Stellar network (testnet/public) |
| `VITE_ADMIN_ADDRESS` | Admin Stellar public key |
| `VITE_TOKEN_CONTRACT_ID` | USDC token contract ID |
| `VITE_TOKEN_B_CONTRACT_ID` | XLM/wrapped token contract ID |
| `VITE_VERIFIER_CONTRACT_ID` | Verifier contract ID |
| `VITE_WHISPER_CONTRACT_ID` | Main shielded pool contract ID |
| `OPENZEPPELIN_CHANNELS_API_KEY` | API key for gasless relaying |

### 3. Install Dependencies

```bash
# Root workspace (concurrently)
npm install

# Indexer
cd indexer && npm install && cd ..

# Frontend
cd frontend && npm install && cd ..
```

### 4. Run Tests

Validate cryptographic operations and pool logic:

```bash
cargo test
```

Expected output: `18 passed; 0 failed`

### 5. Deploy to Testnet

Build, optimize, and deploy contracts:

```bash
./scripts/deploy.sh
```

This deploys the verifier, USDC token asset, and whisper contracts, initializes them, and writes contract IDs to `frontend/src/config/deployed.json` and `frontend/.env`.

### 6. Run Development Environment

Start both the indexer and frontend concurrently:

```bash
npm run dev
```

| Service | URL | Description |
|---------|-----|-------------|
| Vite Dev Server | http://localhost:5173 | React frontend |
| Indexer API | http://localhost:8123 | Event cache + relay proxy |

## Manual Setup Steps

If the automated setup doesn't work, follow these manual steps:

### Installing Nargo (Noir Compiler)

```bash
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup -v 0.32.0
export PATH="$HOME/.nargo/bin:$PATH"
```

### Building Contracts

```bash
# Compile Noir circuit
cd circuits/whisper && $HOME/.nargo/bin/nargo compile && cd ../..

# Build Soroban contracts
stellar contract build
```

### Funding Test Account

```bash
stellar keys fund alice --network testnet
```

## Gasless Relayer Setup

1. Visit https://channels.openzeppelin.com/testnet/gen to generate a free Stellar Channels API key
2. Add it to `frontend/.env`:
   ```
   OPENZEPPELIN_CHANNELS_API_KEY="your_key_here"
   ```
3. Restart the application
4. The indexer will route all shielded transactions through the relayer

## Troubleshooting

### Nargo not found
Ensure `~/.nargo/bin` is in your PATH: `export PATH="$HOME/.nargo/bin:$PATH"`

### Contract deployment fails
- Verify Stellar CLI is installed and authenticated
- Check testnet account has sufficient funds: `stellar keys balance alice --network testnet`
- Increase sleep intervals between deployments if ledger sequence errors occur

### Frontend can't connect to indexer
- Ensure indexer is running on port 8123
- Check for CORS issues in browser console
- The frontend falls back to direct RPC scanning if indexer is unreachable

### Merkle tree desync errors
Run a fresh sync: click the sync button in the vault dashboard, or clear localStorage and reconnect wallet.
