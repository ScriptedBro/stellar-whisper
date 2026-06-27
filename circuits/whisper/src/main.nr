use dep::std::hash::poseidon::bn254;

fn bytes_32_to_field(bytes: [u8; 32]) -> Field {
    let mut val: Field = 0;
    for i in 0..32 {
        val = val * 256 + (bytes[i] as Field);
    }
    val
}

fn field_to_u8_32(f: Field) -> [u8; 32] {
    f.to_be_bytes()
}

fn u8_32_to_field(bytes: [u8; 32]) -> Field {
    let mut val: Field = 0;
    // We only unpack the lower 16 bytes of the 32-byte representation (e.g. up to 128-bit amount)
    for i in 0..16 {
        val = val * 256 + (bytes[16 + i] as Field);
    }
    val
}

fn main(
    secret_key: [u8; 32],
    nullifier_nonce: [u8; 32],
    merkle_path: [[u8; 32]; 16],
    merkle_index: u32,
    
    // Private output note parameters
    recipient_pubkey: [u8; 32],
    recipient_amount: [u8; 32],
    recipient_nonce: [u8; 32],
    change_pubkey: [u8; 32],
    change_amount: [u8; 32],
    change_nonce: [u8; 32],
    
    // Public inputs
    merkle_root: pub [u8; 32],
    nullifier_hash: pub [u8; 32],
    input_amount: pub [u8; 32],
    public_withdraw_amount: pub [u8; 32],
    public_recipient_hash: pub [u8; 32],
    output_commitment_1: pub [u8; 32],
    output_commitment_2: pub [u8; 32],
    asset_id: pub [u8; 32]
) {
    // 1. Derive sender public key from secret key
    let secret_key_field = bytes_32_to_field(secret_key);
    let sender_pubkey_field = bn254::hash_1([secret_key_field]);

    // 2. Verify the spent leaf commitment: poseidon(sender_pubkey, poseidon(poseidon(input_amount, nullifier_nonce), asset_id))
    let asset_id_field = bytes_32_to_field(asset_id);
    let input_amount_field = bytes_32_to_field(input_amount);
    let nullifier_nonce_field = bytes_32_to_field(nullifier_nonce);
    let salted_amount_field = bn254::hash_2([input_amount_field, nullifier_nonce_field]);
    let asset_salted_amount_field = bn254::hash_2([salted_amount_field, asset_id_field]);
    let commitment_field = bn254::hash_2([sender_pubkey_field, asset_salted_amount_field]);

    // 3. Verify the nullifier hash: poseidon(secret_key + nullifier_nonce)
    let calculated_nullifier_field = bn254::hash_2([secret_key_field, nullifier_nonce_field]);
    let calculated_nullifier = field_to_u8_32(calculated_nullifier_field);
    assert(calculated_nullifier == nullifier_hash);

    // 4. Verify the Merkle membership proof
    let mut current = commitment_field;
    let mut index = merkle_index;
    for i in 0..16 {
        let bit = index % 2;
        let path_field = bytes_32_to_field(merkle_path[i]);
        if bit == 1 {
            current = bn254::hash_2([path_field, current]);
        } else {
            current = bn254::hash_2([current, path_field]);
        }
        index = index / 2;
    }
    let computed_root = field_to_u8_32(current);
    assert(computed_root == merkle_root);

    // 5. Verify value conservation: input_amount = public_withdraw_amount + recipient_amount + change_amount
    let input_val = u8_32_to_field(input_amount);
    let withdraw_val = u8_32_to_field(public_withdraw_amount);
    let recipient_val = u8_32_to_field(recipient_amount);
    let change_val = u8_32_to_field(change_amount);
    assert(input_val == withdraw_val + recipient_val + change_val);

    // 6. If public withdrawal amount is non-zero, assert public_recipient_hash is also non-zero
    if withdraw_val != 0 {
        let mut is_nonzero = false;
        for i in 0..32 {
            if public_recipient_hash[i] != 0 {
                is_nonzero = true;
            }
        }
        assert(is_nonzero);
    }

    // 7. Verify output commitments matching the private outputs
    if recipient_val != 0 {
        let recipient_pubkey_field = bytes_32_to_field(recipient_pubkey);
        let recipient_amount_field = bytes_32_to_field(recipient_amount);
        let recipient_nonce_field = bytes_32_to_field(recipient_nonce);
        let recipient_salted_amount = bn254::hash_2([recipient_amount_field, recipient_nonce_field]);
        let recipient_asset_salted_amount = bn254::hash_2([recipient_salted_amount, asset_id_field]);
        let derived_commitment_1_field = bn254::hash_2([recipient_pubkey_field, recipient_asset_salted_amount]);
        let derived_commitment_1 = field_to_u8_32(derived_commitment_1_field);
        assert(derived_commitment_1 == output_commitment_1);
    } else {
        // Enforce output_commitment_1 is zero if recipient_val is zero
        let mut is_zero = true;
        for i in 0..32 {
            if output_commitment_1[i] != 0 {
                is_zero = false;
            }
        }
        assert(is_zero);
    }

    if change_val != 0 {
        let change_pubkey_field = bytes_32_to_field(change_pubkey);
        let change_amount_field = bytes_32_to_field(change_amount);
        let change_nonce_field = bytes_32_to_field(change_nonce);
        let change_salted_amount = bn254::hash_2([change_amount_field, change_nonce_field]);
        let change_asset_salted_amount = bn254::hash_2([change_salted_amount, asset_id_field]);
        let derived_commitment_2_field = bn254::hash_2([change_pubkey_field, change_asset_salted_amount]);
        let derived_commitment_2 = field_to_u8_32(derived_commitment_2_field);
        assert(derived_commitment_2 == output_commitment_2);
    } else {
        // Enforce output_commitment_2 is zero if change_val is zero
        let mut is_zero = true;
        for i in 0..32 {
            if output_commitment_2[i] != 0 {
                is_zero = false;
            }
        }
        assert(is_zero);
    }
}
