# Deployment Guide

## Architecture Overview

The deployment creates three Soroban contracts on Stellar testnet:

1. **Verifier Contract** — UltraHonk ZK proof verification
2. **Token Asset Contract** — USDC wrapper (or other stablecoin)
3. **Whisper Contract** — Shielded pool + AMM

## Automated Deployment

### `scripts/deploy.sh`

The deployment script handles the entire process:

```bash
./scripts/deploy.sh
```

**Steps:**
1. Compile Noir circuit: `nargo compile`
2. Build Soroban contracts: `stellar contract build`
3. Generate/fund admin key
4. Deploy verifier contract
5. Deploy USDC asset contract
6. Resolve native XLM contract ID
7. Deploy whisper contract
8. Initialize whisper (admin, token, verifier)
9. Initialize AMM pool (token_a = USDC, token_b = XLM)
10. Optionally seed pool with initial liquidity
11. Write config to `frontend/src/config/deployed.json` and `frontend/.env`

### Configuration

The script respects these environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `NETWORK` | `testnet` | Stellar network |
| `ADMIN_KEY` | `alice` | Stellar CLI key name |
| `SEED_POOL` | `true` | Whether to seed AMM with initial liquidity |
| `SEED_USDC` | `30000000000` | Initial USDC liquidity (3000 with 7 decimals) |
| `SEED_XLM` | `30000000000` | Initial XLM liquidity |

## Manual Deployment

### Prerequisites

```bash
# Ensure Stellar CLI is authenticated
stellar keys address alice

# Check balance
stellar keys balance alice --network testnet

# Fund if needed
stellar keys fund alice --network testnet
```

### Step 1: Compile Circuit

```bash
cd circuits/whisper
$HOME/.nargo/bin/nargo compile
cd ../..
```

### Step 2: Build Contracts

```bash
stellar contract build
```

### Step 3: Deploy Verifier

```bash
VERIFIER_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/verifier.wasm \
  --source alice \
  --network testnet)
echo $VERIFIER_ID
```

### Step 4: Deploy Token

```bash
TOKEN_ID=$(stellar contract asset deploy \
  --asset USDC:$(stellar keys address alice) \
  --source alice \
  --network testnet)
echo $TOKEN_ID

# Resolve XLM
TOKEN_B_ID=$(stellar contract id asset \
  --asset native \
  --network testnet)
echo $TOKEN_B_ID
```

### Step 5: Deploy Whisper Contract

```bash
WHISPER_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/whisper.wasm \
  --source alice \
  --network testnet)
echo $WHISPER_ID
```

### Step 6: Initialize

```bash
# Initialize whisper
stellar contract invoke \
  --id $WHISPER_ID \
  --source alice \
  --network testnet \
  -- \
  initialize \
  --admin $(stellar keys address alice) \
  --token $TOKEN_ID \
  --verifier $VERIFIER_ID

# Initialize AMM
stellar contract invoke \
  --id $WHISPER_ID \
  --source alice \
  --network testnet \
  -- \
  init_amm \
  --token_a $TOKEN_ID \
  --token_b $TOKEN_B_ID
```

### Step 7: Update Frontend Config

```bash
cat > frontend/src/config/deployed.json << EOF
{
  "network": "testnet",
  "adminAddress": "$(stellar keys address alice)",
  "tokenContractId": "$TOKEN_ID",
  "tokenBContractId": "$TOKEN_B_ID",
  "verifierContractId": "$VERIFIER_ID",
  "whisperContractId": "$WHISPER_ID"
}
EOF
```

## Funding USDC for Testing

```bash
./scripts/fund_usdc.sh
```

This script mints test USDC to a specified address.

## Post-Deployment

After deployment, you should:

1. **Verify contract initialization** by calling view functions:
   ```bash
   stellar contract invoke --id $WHISPER_ID --source alice --network testnet -- \
     get_reserves
   ```

2. **Test deposit** via the frontend wallet

3. **Verify events** are indexed by the indexer

## Contract Upgrades

### Circuit Version Upgrade

When upgrading the ZK circuit:

1. Recompile circuit: `nargo compile`
2. Rebuild verifier contract with new VK
3. Deploy new verifier contract
4. Call `set_verifier_for_version(version, new_verifier_address)` on whisper contract
5. Frontend uses `circuit_version` parameter to select correct verifier

### Whisper Contract Upgrade

The current architecture requires a new deployment for pool contract changes. The verifier is decoupled to minimize upgrade frequency.

## Network Configurations

### Testnet
- RPC: `https://soroban-testnet.stellar.org`
- Network Passphrase: `Test SDF Network ; September 2015`
- Faucet: Built into Stellar CLI (`stellar keys fund`)

### Future: Mainnet
- RPC: `https://soroban-mainnet.stellar.org`
- Network Passphrase: `Public Global Stellar Network ; September 2015`
- Requires real XLM for gas (unless using relayer)

## Troubleshooting

### "HostError" during deployment
- Ensure 5-second sleep between deploy and invoke commands (ledger sequence sync)
- Verify admin key has sufficient balance
- Check contract wasm paths are correct

### "Error(Contract, #2)" during initialize
- Contract already initialized — skip or redeploy

### Events not appearing in indexer
- Wait for next polling cycle (5 seconds)
- Verify contract ID matches between deployed.json and indexer database
- Reset indexer: `curl -X POST http://localhost:8123/api/reset`
