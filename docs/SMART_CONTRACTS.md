# Smart Contracts Reference

## Architecture

Two decoupled Soroban contracts:

```
Whisper Contract (Shielded Pool) ──calls──► Verifier Contract (UltraHonk)
     │                                         │
     │ Manages:                                │ Manages:
     │  - Merkle tree state                   │  - Verification key (VK)
     │  - Nullifier spent list                │  - UltraHonk verification pipeline
     │  - Token vault (USDC/XLM)              │  - Sumcheck + Shplemini + KZG
     │  - AMM reserves                        │
     │  - Sanctions list                      │
     │  - Protocol fees                       │
```

---

## Whisper Contract (`contracts/whisper`)

### Storage Layout

| DataKey | Type | Description |
|---------|------|-------------|
| `Admin` | `Address` | Contract administrator |
| `Token` | `Address` | Default token (USDC) |
| `Verifier` | `Address` | Default verifier contract (v1) |
| `NextIndex` | `u32` | Next leaf index for Merkle tree |
| `FilledSubtrees` | `Vec<BytesN<32>>` | Boundary nodes at each tree level |
| `ZeroHashes` | `Vec<BytesN<32>>` | Precomputed Poseidon zero hashes (depth 16) |
| `RecentRoots` | `Vec<BytesN<32>>` | Last 100 valid Merkle roots |
| `Nullifiers(hash)` | `bool` | Spent nullifier registry |
| `Commitments(hash)` | `bool` | Registered commitment registry |
| `Sanctioned(addr)` | `bool` | Sanctions list |
| `Oracle` | `BytesN<32>` | Oracle Ed25519 public key |
| `TokenA` | `Address` | AMM token A (USDC) |
| `TokenB` | `Address` | AMM token B (XLM) |
| `ReserveA` | `i128` | AMM reserve A |
| `ReserveB` | `i128` | AMM reserve B |
| `LpShares(addr)` | `i128` | LP shares per address |
| `TotalLpShares` | `i128` | Total LP shares minted |
| `ProtocolFeeA` | `i128` | Accumulated protocol fees (token A) |
| `ProtocolFeeB` | `i128` | Accumulated protocol fees (token B) |
| `VerifierForVersion(v)` | `Address` | Versioned verifier contract |

### Public Functions

#### `initialize(admin, token, verifier)`
Sets admin, token, and verifier. Precomputes zero hashes and initializes Merkle tree. Callable once.

#### `init_amm(token_a, token_b) -> Result`
Initializes AMM pool with two token addresses. Admin only.

#### `deposit(from, token, commitment, amount, encrypted_note, circuit_version) -> Result<BytesN<32>>`
Shields public tokens into a private note.
1. Checks compliance: rejects if `from` is sanctioned
2. Transfers tokens from `from` to contract vault
3. Inserts `commitment` into Merkle tree
4. Emits `deposit` event with encrypted note
Returns the new Merkle root.

#### `transfer_or_withdraw(token, proof, public_inputs, recipient, amount, relayer, relayer_fee, circuit_version, encrypted_notes, new_commitments) -> Result`
Spends a private note via ZK proof:
1. Verifies Merkle root is valid (in `RecentRoots`)
2. Checks nullifier not already spent
3. Validates public inputs match contract parameters (amount, recipient hash, asset ID, output commitments)
4. Calls verifier contract to verify UltraHonk proof
5. Inserts new output commitments into Merkle tree
6. Marks nullifier as spent
7. Transfers tokens to recipient (if public withdrawal)
8. Emits `withdrawal` or `shielded_transfer` event

**Public Input Layout (8 inputs):**
| Index | Field | Description |
|-------|-------|-------------|
| 0 | `merkle_root` | Current valid Merkle root |
| 1 | `nullifier_hash` | Deterministic nullifier of spent note |
| 2 | `input_amount` | Value of the note being spent |
| 3 | `public_withdraw_amount` | Amount to withdraw publicly (0 for shielded transfer) |
| 4 | `public_recipient_hash` | SHA-256 of recipient address XDR (0 for shielded) |
| 5 | `output_commitment_1` | First output commitment |
| 6 | `output_commitment_2` | Second output commitment (change) |
| 7 | `asset_id` | SHA-256 hash of token contract XDR |

#### `swap_shielded(token_in, token_out, proof, public_inputs, amount_in, min_amount_out, recipient_pubkey, recipient_nonce, circuit_version, deadline, encrypted_note) -> Result<(i128, BytesN<32>)>`
Private swap against public AMM reserves:
1. Verifies ZK proof spending input note of `token_in`
2. Executes constant-product swap with 0.35% total fee (0.3% LP + 0.05% protocol)
3. Derives output commitment for `token_out` on-chain
4. Inserts output commitment into Merkle tree
5. Emits `shielded_swap` event

#### `add_liquidity(from, amount_a, amount_b, min_shares, deadline) -> Result<i128>`
Public LP provision. Transfers tokens, mints LP shares (Uniswap V2 style). Reentrancy-guarded.

#### `remove_liquidity(from, shares, min_amount_a, min_amount_b, deadline) -> Result<(i128, i128)>`
Burns LP shares, returns proportional underlying tokens.

#### `set_sanctioned(addr, status)`
Admin-only. Updates sanctions list.

#### `update_sanctions_with_signature(addr, status, expires, signature)`
Oracle-signed sanctions update. Verifies Ed25519 signature from registered oracle key.

#### `set_verifier_for_version(version, verifier)`
Admin-only. Supports circuit version upgrades.

#### `claim_protocol_fees(token, recipient, amount)`
Admin-only. Collects accumulated protocol fees from swaps.

### View Functions

- `get_reserves()` → `(i128, i128)` — AMM pool reserves
- `get_lp_shares(address)` → `i128` — LP shares for address
- `get_total_lp_shares()` → `i128` — Total LP shares
- `has_commitment(commitment)` → `bool` — Commitment exists
- `has_nullifier(nullifier)` → `bool` — Nullifier spent
- `is_root_valid(root)` → `bool` — Root in recent roots set
- `is_sanctioned(addr)` → `bool` — Address sanctioned
- `get_oracle()` → `Option<BytesN<32>>` — Oracle public key
- `derive_commitment(pubkey, amount, nonce, token)` → `BytesN<32>` — Commitment derivation helper
- `get_protocol_fees()` → `(i128, i128)` — Accumulated fees

### Events

| Event | Topics | Data |
|-------|--------|------|
| `deposit` | `["deposit"]` | `DepositEvent { commitment, amount, encrypted_note }` |
| `shielded_output` | `["shielded_output"]` | `ShieldedOutputEvent { commitment, encrypted_note }` |
| `withdrawal` | `["withdrawal"]` | `WithdrawalEvent { nullifier, amount, recipient }` |
| `shielded_transfer` | `["shielded_transfer"]` | `ShieldedTransferEvent { nullifier }` |
| `shielded_swap` | `["shielded_swap"]` | `ShieldedSwapEvent { nullifier, token_in, token_out, amount_in, amount_out, new_commitment, encrypted_note }` |
| `add_liquidity` | `["add_liquidity"]` | `(from, amount_a, amount_b, shares)` |
| `remove_liquidity` | `["remove_liquidity"]` | `(from, amount_a, amount_b, shares)` |

### Error Codes

| Code | Constant | Description |
|------|----------|-------------|
| 1 | `NotInitialized` | Contract not yet initialized |
| 2 | `AlreadyInitialized` | Contract already initialized |
| 3 | `Unauthorized` | Caller lacks permission |
| 4 | `InvalidAmount` | Amount out of bounds |
| 5 | `NullifierAlreadySpent` | Double-spend attempt |
| 6 | `InvalidMerkleRoot` | Root not in recent roots |
| 7 | `ProofVerificationFailed` | ZK proof invalid |
| 8 | `CommitmentAlreadyExists` | Duplicate commitment |
| 9 | `TreeFull` | Merkle tree at capacity (65,536) |
| 10 | `SanctionedAddress` | Address on sanctions list |
| 11 | `InvalidOracleSignature` | Ed25519 signature invalid |
| 12 | `SignatureExpired` | Oracle signature past deadline |
| 13 | `DeadlineExpired` | AMM deadline passed |
| 14 | `SlippageExceeded` | Price moved beyond tolerance |
| 15 | `ReentrancyGuardTriggered` | Reentrant call detected |

---

## Verifier Contract (`contracts/verifier`)

### `verify_proof(proof, public_inputs) -> Result`

The verifier performs the complete UltraHonk verification pipeline:

1. **Proof Parsing**: Validates size (200–16,000 bytes), rejects known mock sizes (64, 128, 452)
2. **Public Inputs Validation**: Ensures exactly 8 public inputs
3. **VK Loading**: Loads embedded verification key from `circuits/whisper/target/vk`
4. **UltraHonk Verification**:
   - Fiat-Shamir transcript generation
   - Sumcheck protocol verification
   - Shplemini (Gemini + Shplonk) polynomial opening
   - KZG pairing check over BN254 curve

The verification key (`vk` file) is compiled from the Noir circuit and embedded directly into the contract binary via `include_bytes!`.

### UltraHonk Module Structure (`contracts/verifier/src/ultrahonk/`)

| File | Purpose |
|------|---------|
| `types.rs` | VK/proof type definitions, constants |
| `field.rs` | BN254 Fr field operations |
| `ec.rs` | BN254 elliptic curve operations |
| `hash.rs` | Poseidon hash integration |
| `transcript.rs` | Fiat-Shamir transcript generation |
| `relations.rs` | Circuit relation definitions |
| `sumcheck.rs` | Sumcheck protocol verification |
| `shplemini.rs` | Gemini + Shplonk polynomial opening |
| `verifier.rs` | UltraHonkVerifier orchestration (Oink + Decider) |
| `utils.rs` | VK/proof loading utilities |
| `debug.rs` | Debug helpers |
