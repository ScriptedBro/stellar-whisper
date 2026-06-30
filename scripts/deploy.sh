#!/bin/bash
set -e

echo "=== Stellar Whisper Deployment Script ==="

# Define networks and keys
NETWORK="testnet" # Default to testnet, can change to local
ADMIN_KEY="alice"

# 1. Compile the ZK circuit
echo "Step 1: Compiling ZK Circuit with Nargo..."
cd circuits/whisper
$HOME/.nargo/bin/nargo compile
cd ../..

# 2. Build the Soroban contracts
echo "Step 2: Building Soroban Smart Contracts..."
stellar contract build

# 3. Setup Admin Key
if ! stellar keys address $ADMIN_KEY &> /dev/null; then
    echo "ℹ️ Admin key '$ADMIN_KEY' not found. Generating new key..."
    stellar keys generate --global $ADMIN_KEY
    stellar keys fund $ADMIN_KEY --network $NETWORK
fi

ADMIN_ADDRESS=$(stellar keys address $ADMIN_KEY)
echo "Admin Address: $ADMIN_ADDRESS"

# 4. Deploy the verifier contract
echo "Step 3a: Deploying Verifier Contract..."
VERIFIER_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/verifier.wasm \
  --source $ADMIN_KEY \
  --network $NETWORK)
echo "✅ Verifier Contract Deployed! ID: $VERIFIER_ID"
echo "Sleeping 5 seconds to sync ledger sequence number..."
sleep 5

# 5. Deploy the asset wrapper contract (USDC wrapper)
echo "Step 3b: Deploying USDC Token Asset Contract..."
# If the asset contract is already deployed, it will return the existing ID.
TOKEN_ID=$(stellar contract asset deploy \
  --asset USDC:$ADMIN_ADDRESS \
  --source $ADMIN_KEY \
  --network $NETWORK 2>/dev/null || stellar contract id asset \
  --asset USDC:$ADMIN_ADDRESS \
  --network $NETWORK)
echo "✅ USDC Token Asset Contract Deployed! ID: $TOKEN_ID"
echo "Sleeping 5 seconds to sync ledger sequence number..."
sleep 5

# 5b. Resolve the native token contract ID (XLM wrapper)
echo "Step 3e: Resolving Native Token (XLM) Contract ID..."
TOKEN_B_ID=$(stellar contract id asset \
  --asset native \
  --network $NETWORK)
echo "✅ Native Token Contract ID Resolved: $TOKEN_B_ID"
echo "Sleeping 5 seconds to sync ledger sequence number..."
sleep 5

# 6. Deploy the main whisper contract
echo "Step 3c: Deploying Whisper Contract..."
WHISPER_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/whisper.wasm \
  --source $ADMIN_KEY \
  --network $NETWORK)
echo "✅ Whisper Contract Deployed! ID: $WHISPER_ID"
echo "Sleeping 5 seconds to sync ledger sequence number..."
sleep 5

# 7. Initialize the whisper contract
echo "Step 3d: Initializing Whisper Contract on Testnet..."
stellar contract invoke \
  --id $WHISPER_ID \
  --source $ADMIN_KEY \
  --network $NETWORK \
  -- \
  initialize \
  --admin $ADMIN_ADDRESS \
  --token $TOKEN_ID \
  --verifier $VERIFIER_ID

# 7b. Initialize the AMM pool
echo "Step 3f: Initializing AMM Pool..."
stellar contract invoke \
  --id $WHISPER_ID \
  --source $ADMIN_KEY \
  --network $NETWORK \
  -- \
  init_amm \
  --token_a $TOKEN_ID \
  --token_b $TOKEN_B_ID

echo "✅ Whisper Contract and AMM Pool initialized successfully!"

# 7c. Seed the AMM pool with initial liquidity (if SEED_POOL=true)
if [ "${SEED_POOL:-true}" = "true" ]; then
  echo "Step 3g: Seeding AMM Pool with initial liquidity..."
  SEED_USDC=${SEED_USDC:-30000000000}
  SEED_XLM=${SEED_XLM:-30000000000}
  SEED_DEADLINE=$(date -d "+1 hour" +%s)
  
  stellar contract invoke \
    --id $WHISPER_ID \
    --source $ADMIN_KEY \
    --network $NETWORK \
    -- \
    add_liquidity \
    --from $ADMIN_ADDRESS \
    --amount_a $SEED_USDC \
    --amount_b $SEED_XLM \
    --min_shares 0 \
    --deadline $SEED_DEADLINE
  
  echo "✅ AMM Pool seeded with $(($SEED_USDC / 10000000)) USDC and $(($SEED_XLM / 10000000)) XLM!"
fi

# 8. Write config to frontend
echo "Step 4: Writing deployment details to frontend configuration..."
mkdir -p frontend/src/config
cat << EOF > frontend/src/config/deployed.json
{
  "network": "$NETWORK",
  "adminAddress": "$ADMIN_ADDRESS",
  "tokenContractId": "$TOKEN_ID",
  "tokenBContractId": "$TOKEN_B_ID",
  "verifierContractId": "$VERIFIER_ID",
  "whisperContractId": "$WHISPER_ID"
}
EOF

if [ -f frontend/.env ]; then
    # Keep any lines that do NOT match the VITE_ keys we are updating
    grep -v -E "^(VITE_NETWORK|VITE_ADMIN_ADDRESS|VITE_TOKEN_CONTRACT_ID|VITE_TOKEN_B_CONTRACT_ID|VITE_VERIFIER_CONTRACT_ID|VITE_WHISPER_CONTRACT_ID)=" frontend/.env > frontend/.env.tmp || true
else
    touch frontend/.env.tmp
fi

cat << EOF >> frontend/.env.tmp
VITE_NETWORK="$NETWORK"
VITE_ADMIN_ADDRESS="$ADMIN_ADDRESS"
VITE_TOKEN_CONTRACT_ID="$TOKEN_ID"
VITE_TOKEN_B_CONTRACT_ID="$TOKEN_B_ID"
VITE_VERIFIER_CONTRACT_ID="$VERIFIER_ID"
VITE_WHISPER_CONTRACT_ID="$WHISPER_ID"
EOF

mv frontend/.env.tmp frontend/.env

echo "=== Deployment Completed Successfully! ==="
