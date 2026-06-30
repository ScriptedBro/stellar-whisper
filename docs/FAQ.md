# Frequently Asked Questions

## General

### What is Stellar Whisper?
A compliance-first, fully shielded wallet for stablecoin transfers on Stellar. It uses zero-knowledge proofs to hide transaction amounts and identities while maintaining on-chain compliance screening.

### Is this production-ready?
No. This is a hackathon prototype. All cryptographic pipelines, smart contracts, and proof circuits require professional security audit before any production deployment.

### What makes this different from Tornado Cash?
Tornado Cash is non-compliant and has no audit mechanism. Stellar Whisper is designed with compliance as a first-class feature — on-chain sanctions screening, oracle-based updates, and viewing key audit trails.

## Privacy & Security

### Where are my private keys stored?
ZK Spending Keys are derived deterministically from your Freighter wallet signature and stored in browser `sessionStorage`. They are wiped when you close the tab. Private keys **never** leave your device or touch any server.

### Can the government see my transactions?
Only if you share your Viewing Key. The Viewing Key decrypts your note metadata (amounts, nonces) from the on-chain event log. Without it, transactions appear as opaque hashes in the Merkle tree.

### What happens if I lose my keys?
Since keys are derived from your Stellar wallet (Freighter), you can recover by reconnecting and re-signing the authorization message. Your notes remain encrypted on-chain and can be re-discovered via scan-and-decrypt.

### Is double-spending possible?
No. Each note has a deterministic nullifier hash derived from your secret key and the note's nonce. Once spent, the nullifier is recorded on-chain and any second attempt is rejected.

## Technology

### Why Noir + UltraHonk instead of Circom + Groth16?
- Noir provides a higher-level DSL with easier circuit development
- UltraHonk supports custom gates and lookups for more efficient constraint systems
- UltraHonk uses sumcheck + Shplemini which is more flexible for recursive proofs
- Both produce KZG-based proofs over BN254

### What is the Three-Key Model?
A design that separates spending authority from audit access:
- **ZK Spending Key** — controls funds (never shared)
- **ZK Public Key** — public identity in the shielded pool (on-chain)
- **Viewing Key** — decrypts transaction history (shareable with auditors)

### How does the Merkle tree work?
Depth 16 Poseidon-based Merkle tree with capacity for 65,536 notes. The contract maintains filled subtrees and zero hashes for efficient incremental updates. Roots are validated against a rolling window of the last 100 valid roots.

### How does the hybrid AMM work?
Liquidity providers deposit publicly using standard `add_liquidity`. Traders spend a private note of token A with a ZK proof, the contract executes a constant-product swap against public reserves, and mints a new private note of token B.

## Compliance

### How is OFAC screening implemented?
The contract maintains a `Sanctioned(Address) -> bool` mapping. Deposits check the sender; withdrawals check the recipient. The admin can update directly, or an oracle can submit Ed25519-signed updates.

### What is a ZK Compliance Report?
A cryptographic attestation generated client-side that proves:
- Your address is not on the sanctions list
- Your transaction history (decrypted via viewing key) is consistent
- The attestation is bound to a specific Merkle root

### Can auditors steal my funds?
No. Auditors only receive your Viewing Key, which provides read-only access to decrypt note metadata. The ZK Spending Key remains private and is required for any transfer.

## Setup & Usage

### I get "Merkle Tree Desync" — what do I do?
This means the local commitment list doesn't match the on-chain Merkle root. Click the sync button in the vault dashboard. If that fails, clear site data and reconnect your wallet to trigger a full re-scan.

### Why is proof generation slow?
First-time proof generation requires WASM compilation (~10-30s). The proving itself involves multi-scalar multiplication (MSM) which is computationally intensive in the browser. Subsequent proofs are faster due to WASM caching.

### The indexer shows no events
- Wait for the next 5-second polling cycle
- Verify the contract ID matches the deployed contract
- Try resetting: `curl -X POST http://localhost:8123/api/reset`
- Check the indexer console for error messages

### Do I need XLM for gas?
Not if you use the OpenZeppelin Channels relayer. The relayer sponsors fee-bump transactions, making shielded transfers completely gasless. Without the relayer, you need a minimal XLM balance for Soroban transaction fees.

## Development

### How do I add a new asset?
1. Deploy a new token contract to Stellar testnet/mainnet
2. The contract uses dynamic token addresses — users can deposit any asset by specifying the token contract ID
3. Update the frontend config with the new token contract ID

### How do I upgrade the ZK circuit?
1. Modify `circuits/whisper/src/main.nr`
2. Recompile: `nargo compile`
3. Rebuild verifier contract (VK embedded at compile time)
4. Deploy new verifier
5. Call `set_verifier_for_version(2, new_verifier_address)`
6. Frontend uses `circuit_version: 2`

### Can I run a local testnet?
Yes. Use `stellar network start` or Stellar Quickstart Docker image for a local Soroban RPC. Point the frontend's `RPC_URL` to your local endpoint.

## Troubleshooting

### "Freighter not found"
Install the Freighter Wallet browser extension from https://freighter.app

### "HostError" in contract calls
Check the error code and message. Common causes:
- Insufficient token balance
- Sanctioned address
- Invalid proof format
- Merkle root not found in recent roots

### Build errors
- Ensure Rust toolchain is up to date: `rustup update`
- Ensure Soroban CLI matches protocol version: `stellar version`
- For frontend, check Node.js version >= 24: `node --version`

### "OPENZEPPELIN_CHANNELS_API_KEY is not set"
Gasless relaying is disabled. Transactions will be submitted directly (requires XLM for gas). To enable, get a free API key from https://channels.openzeppelin.com/testnet/gen
