#!/bin/bash
set -e

if [ -z "$1" ]; then
    echo "Usage: ./scripts/fund_usdc.sh <RECIPIENT_ADDRESS>"
    exit 1
fi

RECIPIENT_ADDRESS="$1"
CONFIG_FILE="frontend/src/config/deployed.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: Configuration file not found at $CONFIG_FILE. Run deploy.sh first."
    exit 1
fi

# Extract tokenContractId and adminAddress from deployed.json
TOKEN_CONTRACT_ID=$(grep -o '"tokenContractId": "[^"]*' $CONFIG_FILE | grep -o '[^"]*$')
ADMIN_ADDRESS=$(grep -o '"adminAddress": "[^"]*' $CONFIG_FILE | grep -o '[^"]*$')

echo "USDC Token Contract ID: $TOKEN_CONTRACT_ID"
echo "Admin/Issuer Address: $ADMIN_ADDRESS"
echo "Recipient Address: $RECIPIENT_ADDRESS"

echo "Minting/transferring 1,000 mock USDC to recipient..."
stellar contract invoke \
  --id "$TOKEN_CONTRACT_ID" \
  --source alice \
  --network testnet \
  -- \
  transfer \
  --from "$ADMIN_ADDRESS" \
  --to "$RECIPIENT_ADDRESS" \
  --amount 10000000000

echo "✅ Success! Funded $RECIPIENT_ADDRESS with 1,000 USDC."
echo "Please make sure you have added the trustline in Freighter first if the transaction failed."
