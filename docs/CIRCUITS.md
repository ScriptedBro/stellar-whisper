# ZK Circuits

## Overview

The ZK circuit is written in Noir DSL and compiled to the UltraHonk proving system (Aztec Barretenberg). It validates the correctness of private note spending without revealing any private information.

**Location:** `circuits/whisper/src/main.nr`

## Proving System: UltraHonk

UltraHonk is a custom proving system that combines:

- **UltraPlonk-style custom gates**: Efficient constraint representation for range checks, lookups, and arithmetic
- **Sumcheck protocol**: Multivariate polynomial relation verification
- **Shplemini polynomial commitment**: Batch opening scheme (Gemini + Shplonk)
- **KZG polynomial commitment**: Pairing-based commitments over BN254

The circuit is compiled using `nargo` (Noir compiler v0.32.0+) which outputs:

| Artifact | Path | Description |
|----------|------|-------------|
| `target/whisper.json` | Compiled circuit bytecode | Used by frontend for witness generation |
| `target/proof` | Proof bytes | Serialized UltraHonk proof |
| `target/vk` | Verification key | Embedded in verifier contract |
| `target/public_inputs` | Formatted public inputs | Used in contract verification |
| `target/public_inputs_raw` | Raw 32-byte public inputs | 8 × 32-byte chunks |

## Circuit Specification

### Private Inputs

| Parameter | Type | Size | Description |
|-----------|------|------|-------------|
| `secret_key` | `[u8; 32]` | 32 B | Sender's ZK spending key (sk) |
| `nullifier_nonce` | `[u8; 32]` | 32 B | Nonce of the note being spent |
| `merkle_path` | `[[u8; 32]; 16]` | 512 B | Sibling hashes up the Merkle tree |
| `merkle_index` | `u32` | 4 B | Binary index of leaf in tree |
| `recipient_pubkey` | `[u8; 32]` | 32 B | Target ZK public key (if private transfer) |
| `recipient_amount` | `[u8; 32]` | 32 B | Amount sent to recipient |
| `recipient_nonce` | `[u8; 32]` | 32 B | Nonce for recipient's new note |
| `change_pubkey` | `[u8; 32]` | 32 B | Sender's ZK public key (if change) |
| `change_amount` | `[u8; 32]` | 32 B | Change amount returned to sender |
| `change_nonce` | `[u8; 32]` | 32 B | Nonce for change note |

### Public Inputs

| Index | Parameter | Description |
|-------|-----------|-------------|
| 0 | `merkle_root` | Current state root of the pool |
| 1 | `nullifier_hash` | Deterministic nullifier hash (marks note spent) |
| 2 | `input_amount` | Value of the note being spent |
| 3 | `public_withdraw_amount` | Value withdrawn to public address |
| 4 | `public_recipient_hash` | SHA-256 hash of public recipient address |
| 5 | `output_commitment_1` | Commitment hash of recipient's new note |
| 6 | `output_commitment_2` | Commitment hash of change note |
| 7 | `asset_id` | SHA-256 hash of token contract XDR |

### Constraints & Assertions

The circuit enforces 7 constraints:

#### 1. Ownership Check
Derives the sender's public key from the secret key and validates that the spent note commitment matches:
```
pk = Poseidon(sk)
commitment = Poseidon(pk, Poseidon(Poseidon(input_amount, nullifier_nonce), asset_id))
```

#### 2. Nullifier Integrity
Asserts the public nullifier hash equals the private derivation:
```
assert(Poseidon(sk, nullifier_nonce) == nullifier_hash)
```

#### 3. Merkle Membership
Reconstructs the Merkle path from the spent commitment to the root:
```
computed_root = MerklePathVerify(commitment, merkle_path, merkle_index)
assert(computed_root == merkle_root)
```

#### 4. Value Conservation
Ensures no funds are created or destroyed:
```
assert(input_amount == public_withdraw_amount + recipient_amount + change_amount)
```

#### 5-6. Output Commitment Verification
If amounts are non-zero, verifies output commitments match the private values:
```
if recipient_amount > 0:
    assert(output_commitment_1 == Poseidon(recipient_pubkey, Poseidon(Poseidon(recipient_amount, recipient_nonce), asset_id)))
if change_amount > 0:
    assert(output_commitment_2 == Poseidon(change_pubkey, Poseidon(Poseidon(change_amount, change_nonce), asset_id)))
```

If amounts are zero, asserts corresponding output commitment is all zeros.

#### 7. Withdrawal Recipient Binding
If public withdrawal amount is non-zero, asserts the public recipient hash is also non-zero.

### Helper Functions

- `bytes_32_to_field(bytes)` — Converts 32-byte array to `Field` element
- `field_to_u8_32(f)` — Converts `Field` back to 32-byte array
- `u8_32_to_field(bytes)` — Unpacks lower 16 bytes only (for 128-bit amounts)

## Cryptographic Primitives

### Poseidon Hash

Used throughout the circuit for:
- 1-to-1 hashing: key derivation
- 2-to-1 hashing: commitment derivation, Merkle tree nodes

Implementation: `dep::std::hash::poseidon::bn254`

### BN254 Scalar Field

All field elements are modulo the BN254 scalar field prime:
```
0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001
```

## Compilation

```bash
cd circuits/whisper
$HOME/.nargo/bin/nargo compile
```

The compilation outputs the circuit artifacts to `circuits/whisper/target/`.

## Integration with Smart Contract

The contract verifier (`contracts/verifier`) loads the VK from `circuits/whisper/target/vk` at compile time via `include_bytes!`. This means:

- The VK is embedded in the WASM binary
- Each circuit version produces a unique VK
- Version upgrades require deploying a new verifier contract (or using `set_verifier_for_version`)

## Integration with Frontend

The frontend uses two artifacts:
- `whisper.json` (compiled circuit bytecode) — loaded by `@noir-lang/noir_js` for witness generation
- `@aztec/bb.js` UltraHonk backend — generates the actual proof from the witness

The proving pipeline:
1. Load compiled circuit ABI (`whisper.json`)
2. Execute Noir circuit with private inputs to generate witness
3. Feed witness to UltraHonk backend for proof generation
4. Serialize proof and submit to contract

## Security Considerations

- **Private inputs** (secret key, amounts, nonces) never leave the browser
- **Asset ID binding** prevents cross-asset replay attacks
- **Merkle depth of 16** limits tree to 65,536 leaves (sufficient for prototype; increase for production)
- **Poseidon hash** chosen over SHA-256 for ZK efficiency (~200 vs ~20,000 constraints per hash)
- **Value conservation** uses 128-bit arithmetic (u8_32_to_field unpacks only lower 16 bytes)
