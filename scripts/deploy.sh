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

# 6. Deploy the main whisper contract
echo "Step 3c: Deploying Whisper Contract..."
WHISPER_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/whisper.wasm \
  --source $ADMIN_KEY \
  --network $NETWORK)
echo "✅ Whisper Contract Deployed! ID: $WHISPER_ID"

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

echo "✅ Whisper Contract Initialized successfully!"

# 8. Write config to frontend
echo "Step 4: Writing deployment details to frontend configuration..."
mkdir -p frontend/src/config
cat << EOF > frontend/src/config/deployed.json
{
  "network": "$NETWORK",
  "adminAddress": "$ADMIN_ADDRESS",
  "tokenContractId": "$TOKEN_ID",
  "verifierContractId": "$VERIFIER_ID",
  "whisperContractId": "$WHISPER_ID"
}
EOF

cat << EOF > frontend/.env
VITE_NETWORK="$NETWORK"
VITE_ADMIN_ADDRESS="$ADMIN_ADDRESS"
VITE_TOKEN_CONTRACT_ID="$TOKEN_ID"
VITE_VERIFIER_CONTRACT_ID="$VERIFIER_ID"
VITE_WHISPER_CONTRACT_ID="$WHISPER_ID"
EOF

echo "=== Deployment Completed Successfully! ==="
