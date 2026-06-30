# Testing Guide

## Smart Contract Tests

All tests are in `contracts/whisper/src/test.rs`. They use Soroban's mock environment.

### Running Tests

```bash
# Run all tests
cargo test

# Run specific test
cargo test test_whisper_flow

# Run with output (println statements)
cargo test -- --nocapture
```

### Test Suite

#### Core Flow Tests

| Test | Description | Expected |
|------|-------------|----------|
| `test_whisper_flow` | Full deposit → transfer/withdraw cycle | Tokens moved from user → contract → recipient |
| `test_whisper_shielded_transfer` | Internal shielded transfer (no public withdrawal) | Commitments added, tokens stay in contract |
| `test_whisper_public_withdraw_with_change` | Partial withdrawal with change commitment | Split: tokens to recipient + change in tree |
| `test_whisper_shielded_swap` | Private swap against public AMM reserves | Correct amount_out, reserves updated, nullifier spent |

#### Error Handling Tests

| Test | Description | Error |
|------|-------------|-------|
| `test_whisper_invalid_merkle_root` | Unknown root rejected | #6 InvalidMerkleRoot |
| `test_whisper_double_spend` | Same nullifier twice | #5 NullifierAlreadySpent |
| `test_whisper_invalid_proof` | Invalid proof bytes | #7 ProofVerificationFailed |
| `test_whisper_duplicate_deposit_commitment` | Same commitment deposited twice | #8 CommitmentAlreadyExists |
| `test_whisper_tree_full` | Exceed Merkle tree capacity | #9 TreeFull |
| `test_whisper_public_withdraw_with_non_zero_output_commitments` | Withdraw with non-zero commitments | #7 ProofVerificationFailed |
| `test_whisper_shielded_transfer_with_non_zero_public_withdraw_amount` | Shielded transfer with withdraw amount | #4 InvalidAmount |
| `test_whisper_shielded_transfer_mismatched_new_commitments` | Commitment mismatch in shielded transfer | #7 ProofVerificationFailed |

#### Security Tests

| Test | Description | Expected |
|------|-------------|----------|
| `test_whisper_sanctioned_address_deposit_rejected` | Sanctioned user tries to deposit | #10 SanctionedAddress |
| `test_whisper_sanctioned_address_withdraw_rejected` | Withdrawal to sanctioned address | #10 SanctionedAddress |
| `test_oracle_sanctions_updates` | Oracle-signed sanctions add/remove | Address sanctioned then unsanctioned |
| `test_whisper_failed_token_transfer_rollback` | Insufficient balance causes rollback | Commitment NOT registered |

#### Cryptographic Tests

| Test | Description | Expected |
|------|-------------|----------|
| `test_cross_layer_fixtures` | Verifies pubkey and nullifier derivation match JS | Deterministic fixtures pass |
| `test_reduce_bn254_modulus_edge_cases` | BN254 modulus reduction: <, ==, > | Correctly reduces to field |

#### Verifier Integration Tests

| Test | Description |
|------|-------------|
| `test_whisper_with_real_verifier` | End-to-end test with actual verifier contract + real proof/VK from compiled circuit |

### Mock Verifier

Tests use `MockVerifier` that always succeeds except when proof is `[9]` (simulates verification failure):

```rust
#[contractimpl]
impl MockVerifier {
    pub fn verify_proof(_env: Env, proof: Bytes, _public_inputs: Vec<BytesN<32>>) {
        if proof.len() == 1 && proof.get(0).unwrap() == 9 {
            panic!("Mock verification failed");
        }
    }
}
```

### Verifier Contract Tests

In `contracts/verifier/src/lib.rs`:

| Test | Description |
|------|-------------|
| `test_verifier_valid_proof` | Real proof + VK from compiled circuit |
| `test_verifier_rejects_mock_sizes` | 64, 128, 452 byte proofs rejected |
| `test_verifier_invalid_proof_size` | 10-byte proof rejected |
| `test_load_real_vk_and_proof` | Loads VK, prints parameters |

## Frontend Tests

### Cryptographic Fixture Tests

In `frontend/src/lib/fixtures.test.ts`:

```bash
cd frontend
npm test
```

Tests that Poseidon hash derivations on the frontend match expected values (cross-referenced with Noir circuit outputs).

### Running All Tests

```bash
# Smart contracts (Rust)
cargo test

# Frontend (TypeScript/Jest or Vitest)
cd frontend && npm test

# Indexer
cd indexer && npm test
```

## Test Coverage Notes

- **18 Rust tests** cover the complete contract lifecycle
- **Mock verifier** allows testing proof verification failure paths without real proofs
- **Cross-layer fixtures** ensure JS and Rust Poseidon hashes produce identical results
- **Real verifier test** confirms the compiled VK + proof pass verification end-to-end
- **Edge case coverage** includes modulus reduction, tree capacity, sanctions both sides

## Writing New Tests

### Pattern for Contract Tests

```rust
#[test]
fn test_my_feature() {
    let env = Env::default();
    env.mock_all_auths(); // Auto-approve all auths

    // Setup accounts
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    // Setup tokens
    let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

    // Deploy contracts
    let verifier_addr = env.register(MockVerifier, ());
    let whisper_id = env.register(Contract, ());
    let whisper = ContractClient::new(&env, &whisper_id);

    // Initialize
    whisper.initialize(&admin, &token_addr, &verifier_addr);

    // Test
    // ... (interact with contract, assert expected behavior)
}
```

### Pattern for Testing Panics

```rust
#[test]
#[should_panic(expected = "HostError: Error(Contract, #7)")]
fn test_expected_failure() {
    // ... setup ...

    // This call should panic with error code 7
    whisper_client.some_function(/* invalid args */);
}
```
