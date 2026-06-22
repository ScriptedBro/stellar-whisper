/**
 * Cross-Layer Cryptographic Fixtures
 * 
 * This file defines the shared sample values and test fixtures used to verify that:
 * 1. Frontend Poseidon derivations,
 * 2. Noir circuit constraints, and
 * 3. Soroban contract hashes/Merkle tree state updates
 * produce identical results for the same sample inputs.
 * 
 * Commitment formula: poseidon_2(pubkey, poseidon_2(amount, nonce))
 */

// Sample Secret Key (32 bytes)
export const SAMPLE_SECRET_KEY_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

// Expected Derived Public Key (Poseidon of Secret Key)
export const EXPECTED_PUBLIC_KEY_HEX = "2d1faf6cf358763421511eb637adf7b6609443d38edc4ed2b042dfbf834b03f5";

// Sample Deposit Amount: 10 USDC (100,000,000 stroops/stroop decimals, which is 10^7 factor)
// Amount: 100000000 -> Hex: 05f5e100 -> Padded to 32 bytes (big endian)
export const SAMPLE_AMOUNT_HEX = "0000000000000000000000000000000000000000000000000000000005f5e100";

// Expected Commitment: poseidon_2(sender_pubkey, poseidon_2(amount, nonce))
// This value depends on the nonce, so it is computed dynamically in tests.
// The old hardcoded value was for the nonce-less formula and is no longer valid.

// Sample Nullifier Nonce (32 bytes)
export const SAMPLE_NULLIFIER_NONCE_HEX = "0202020202020202020202020202020202020202020202020202020202020202";

// Expected Nullifier Hash: poseidon_2(secret_key, nullifier_nonce)
export const EXPECTED_NULLIFIER_HEX = "14c7002e6a647950f653fdb60360b2aba5cba8d1e608f51fda87f16db4f5f343";

// Merkle Tree Level Zero Hashes (as computed by the contract get_zero_hash(level))
// get_zero_hash(level) creates a 32-byte array with bytes[0] = level, rest 0
export const ZERO_HASHES_HEX = [
  "0000000000000000000000000000000000000000000000000000000000000000", // Level 0
  "0100000000000000000000000000000000000000000000000000000000000000", // Level 1
  "0200000000000000000000000000000000000000000000000000000000000000", // Level 2
  "0300000000000000000000000000000000000000000000000000000000000000", // Level 3
  "0400000000000000000000000000000000000000000000000000000000000000", // Level 4
  "0500000000000000000000000000000000000000000000000000000000000000", // Level 5
  "0600000000000000000000000000000000000000000000000000000000000000", // Level 6
  "0700000000000000000000000000000000000000000000000000000000000000", // Level 7
  "0800000000000000000000000000000000000000000000000000000000000000", // Level 8
  "0900000000000000000000000000000000000000000000000000000000000000", // Level 9
  "0a00000000000000000000000000000000000000000000000000000000000000", // Level 10
  "0b00000000000000000000000000000000000000000000000000000000000000", // Level 11
  "0c00000000000000000000000000000000000000000000000000000000000000", // Level 12
  "0d00000000000000000000000000000000000000000000000000000000000000", // Level 13
  "0e00000000000000000000000000000000000000000000000000000000000000", // Level 14
  "0f00000000000000000000000000000000000000000000000000000000000000", // Level 15
  "1000000000000000000000000000000000000000000000000000000000000000", // Root Level (initial empty root)
];

// Expected Merkle Root depends on the commitment, which now includes the nonce.
// It is computed dynamically in tests.
