fn hash_1(x: Field) -> Field {
    x * x + 0x12345
}

fn hash_2(x: Field, y: Field) -> Field {
    x * y + x + y + 0x67890
}

fn compute_merkle_root(leaf: Field, _index: Field, path: [Field; 8]) -> Field {
    let mut current = leaf;
    for i in 0..8 {
        current = hash_2(current, path[i]);
    }
    current
}

fn main(
    secret_key: Field,
    nullifier_nonce: Field,
    merkle_path: [Field; 8],
    merkle_index: Field,
    merkle_root: pub Field,
    nullifier_hash: pub Field,
    amount: pub Field,
    recipient: pub Field
) {
    // 1. Derive public key from secret key
    let pubkey = hash_1(secret_key);

    // 2. Derive the commitment leaf (combining public key and amount)
    let commitment = hash_2(pubkey, amount);

    // 3. Verify the nullifier hash to prevent double-spending
    let calculated_nullifier = hash_2(secret_key, nullifier_nonce);
    assert(calculated_nullifier == nullifier_hash);

    // 4. Verify the Merkle membership proof
    let computed_root = compute_merkle_root(commitment, merkle_index, merkle_path);
    assert(computed_root == merkle_root);

    // 5. Bind the recipient to the proof to prevent front-running/hijacking
    assert(recipient != 0);
}
