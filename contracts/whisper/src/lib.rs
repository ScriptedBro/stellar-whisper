#![no_std]
#![allow(deprecated)]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, Address, Bytes, BytesN, Env, Symbol, Vec, Val, IntoVal,
    xdr::ToXdr
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DepositEvent {
    pub commitment: BytesN<32>,
    pub amount: i128,
    pub encrypted_note: Bytes,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShieldedOutputEvent {
    pub commitment: BytesN<32>,
    pub encrypted_note: Bytes,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WithdrawalEvent {
    pub nullifier: BytesN<32>,
    pub amount: i128,
    pub recipient: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShieldedTransferEvent {
    pub nullifier: BytesN<32>,
}

#[contract]
pub struct Contract;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,
    Verifier,
    NextIndex,
    FilledSubtrees,
    Roots(BytesN<32>),
    Nullifiers(BytesN<32>),
    Commitments(BytesN<32>),
    Sanctioned(Address),
    Oracle,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    InvalidAmount = 4,
    NullifierAlreadySpent = 5,
    InvalidMerkleRoot = 6,
    ProofVerificationFailed = 7,
    CommitmentAlreadyExists = 8,
    TreeFull = 9,
    SanctionedAddress = 10,
    InvalidOracleSignature = 11,
    SignatureExpired = 12,
}

// Tree depth constant. Matching our Noir circuit depth of 16.
const TREE_DEPTH: u32 = 16;

// Helper to get zero hashes for the Merkle tree levels.
fn get_zero_hash(env: &Env, level: u32) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[0] = level as u8;
    BytesN::from_array(env, &bytes)
}

#[contractimpl]
impl Contract {
    /// Initialize the contract with admin, default token, and the ZK verifier contract address.
    pub fn initialize(env: Env, admin: Address, token: Address, verifier: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Verifier, &verifier);
        env.storage().instance().set(&DataKey::NextIndex, &0u32);

        // Initialize filled subtrees with default zero hashes
        let mut filled_subtrees: Vec<BytesN<32>> = Vec::new(&env);
        for i in 0..TREE_DEPTH {
            filled_subtrees.push_back(get_zero_hash(&env, i));
        }
        env.storage().instance().set(&DataKey::FilledSubtrees, &filled_subtrees);

        // Set initial empty root as valid
        let initial_root = get_zero_hash(&env, TREE_DEPTH);
        env.storage().persistent().set(&DataKey::Roots(initial_root.clone()), &true);

        Ok(())
    }

    /// Deposit public tokens (USDC or native XLM) into the pool and register the commitment.
    pub fn deposit(env: Env, from: Address, token: Address, commitment: BytesN<32>, amount: i128, encrypted_note: Bytes) -> Result<BytesN<32>, ContractError> {
        from.require_auth();

        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::NotInitialized);
        }
        // Enforce compliance: check if depositor is sanctioned
        if Self::is_sanctioned(env.clone(), from.clone()) {
            return Err(ContractError::SanctionedAddress);
        }
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        // Enforce tree capacity limit (depth 16 = max 65536 leaves)
        let next_index: u32 = env.storage().instance().get(&DataKey::NextIndex).unwrap();
        if next_index >= 65536 {
            return Err(ContractError::TreeFull);
        }

        // 1. Transfer tokens from depositor to this contract vault
        let token_client = soroban_sdk::token::Client::new(&env, &token);
        token_client.transfer(&from, &env.current_contract_address(), &amount);

        // Enforce duplicate commitment check (collision prevention) after token transfer
        if env.storage().persistent().has(&DataKey::Commitments(commitment.clone())) {
            return Err(ContractError::CommitmentAlreadyExists);
        }
        env.storage().persistent().set(&DataKey::Commitments(commitment.clone()), &true);

        // 2. Insert commitment into the Merkle tree
        let mut filled_subtrees: Vec<BytesN<32>> = env.storage().instance().get(&DataKey::FilledSubtrees).unwrap();

        let mut current_level_hash = commitment.clone();
        let mut index = next_index;

        for i in 0..TREE_DEPTH {
            if index % 2 == 1 {
                let left = filled_subtrees.get(i).unwrap();
                current_level_hash = hash_poseidon_2(&env, left, current_level_hash);
            } else {
                filled_subtrees.set(i, current_level_hash.clone());
                let right = get_zero_hash(&env, i);
                current_level_hash = hash_poseidon_2(&env, current_level_hash, right);
            }
            index /= 2;
        }

        // Save updated tree state
        env.storage().instance().set(&DataKey::NextIndex, &(next_index + 1));
        env.storage().instance().set(&DataKey::FilledSubtrees, &filled_subtrees);

        // Store new root in history
        let new_root = current_level_hash;
        env.storage().persistent().set(&DataKey::Roots(new_root.clone()), &true);

        // Publish deposit event with typed struct
        env.events().publish(
            (Symbol::new(&env, "deposit"),),
            DepositEvent {
                commitment: commitment.clone(),
                amount,
                encrypted_note,
            }
        );

        Ok(new_root)
    }

    /// Withdraw or transfer funds privately by verifying a ZK proof.
    pub fn transfer_or_withdraw(
        env: Env,
        token: Address,
        proof: Bytes,
        public_inputs: Vec<BytesN<32>>,
        recipient: Address,
        amount: i128,
        encrypted_notes: Vec<Bytes>,
        new_commitments: Vec<BytesN<32>>,
    ) -> Result<(), ContractError> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::NotInitialized);
        }
        
        let is_public_withdraw = recipient != env.current_contract_address();

        if is_public_withdraw {
            if amount <= 0 {
                return Err(ContractError::InvalidAmount);
            }
            // Enforce compliance: check if recipient is sanctioned
            if Self::is_sanctioned(env.clone(), recipient.clone()) {
                return Err(ContractError::SanctionedAddress);
            }
        } else {
            if amount != 0 {
                return Err(ContractError::InvalidAmount);
            }
        }

        // Public inputs index map (matching Noir main parameter ordering):
        // public_inputs[0]: merkle_root
        // public_inputs[1]: nullifier_hash
        // public_inputs[2]: input_amount
        // public_inputs[3]: public_withdraw_amount
        // public_inputs[4]: public_recipient_hash
        // public_inputs[5]: output_commitment_1
        // public_inputs[6]: output_commitment_2
        // public_inputs[7]: asset_id
        if public_inputs.len() < 8 {
            return Err(ContractError::ProofVerificationFailed);
        }

        let merkle_root = public_inputs.get(0).unwrap();
        let nullifier_hash = public_inputs.get(1).unwrap();
        let _input_amount_input = public_inputs.get(2).unwrap();
        let public_withdraw_amount_input = public_inputs.get(3).unwrap();
        let public_recipient_hash_input = public_inputs.get(4).unwrap();
        let output_commitment_1_input = public_inputs.get(5).unwrap();
        let output_commitment_2_input = public_inputs.get(6).unwrap();
        let asset_id_input = public_inputs.get(7).unwrap();

        // Verify that the token matches the public input asset_id
        let token_xdr = token.clone().to_xdr(&env);
        let token_hash = env.crypto().sha256(&token_xdr);
        let expected_asset_id = BytesN::from_array(&env, &token_hash.to_array());
        if asset_id_input != expected_asset_id {
            return Err(ContractError::ProofVerificationFailed);
        }

        // 1. Verify that the Merkle root is valid (i.e. has been created by a deposit/transfer)
        if !env.storage().persistent().has(&DataKey::Roots(merkle_root.clone())) {
            return Err(ContractError::InvalidMerkleRoot);
        }

        // 2. Verify that the nullifier hasn't been spent yet
        if env.storage().persistent().has(&DataKey::Nullifiers(nullifier_hash.clone())) {
            return Err(ContractError::NullifierAlreadySpent);
        }

        // Helper to convert i128 to 32-byte big-endian BytesN
        let val_to_bytes32 = |val: i128| -> BytesN<32> {
            let mut arr = [0u8; 32];
            let serialized = (val as u128).to_be_bytes();
            for i in 0..16 {
                arr[16 + i] = serialized[i];
            }
            BytesN::from_array(&env, &arr)
        };

        let zero_bytes = BytesN::from_array(&env, &[0u8; 32]);

        // 3. Perform bindings validation
        if is_public_withdraw {
            // Enforce that public withdraw amount matches the public input
            let expected_withdraw_input = val_to_bytes32(amount);
            if public_withdraw_amount_input != expected_withdraw_input {
                return Err(ContractError::InvalidAmount);
            }

            // Enforce that public recipient hash matches the public input
            let recipient_xdr = recipient.clone().to_xdr(&env);
            let recipient_hash = env.crypto().sha256(&recipient_xdr);
            let expected_recipient_hash = BytesN::from_array(&env, &recipient_hash.to_array());
            if public_recipient_hash_input != expected_recipient_hash {
                return Err(ContractError::ProofVerificationFailed);
            }

            // Enforce that output_commitment_1_input is zero (no private recipient)
            if output_commitment_1_input != zero_bytes {
                return Err(ContractError::ProofVerificationFailed);
            }

            // Verify that the new commitments passed to the contract match the verified public inputs of the proof
            let mut expected_commitments = Vec::new(&env);
            if output_commitment_2_input != zero_bytes {
                expected_commitments.push_back(output_commitment_2_input.clone());
            }

            // Match new_commitments to expected_commitments
            if new_commitments.len() != expected_commitments.len() {
                return Err(ContractError::ProofVerificationFailed);
            }
            for i in 0..new_commitments.len() {
                if new_commitments.get(i).unwrap() != expected_commitments.get(i).unwrap() {
                    return Err(ContractError::ProofVerificationFailed);
                }
            }
        } else {
            // Shielded transfer: public withdraw amount & recipient hash must be zero
            if public_withdraw_amount_input != zero_bytes || public_recipient_hash_input != zero_bytes {
                return Err(ContractError::ProofVerificationFailed);
            }

            // Verify that the output commitments passed to the contract match the verified public inputs of the proof
            let mut expected_commitments = Vec::new(&env);
            if output_commitment_1_input != zero_bytes {
                expected_commitments.push_back(output_commitment_1_input.clone());
            }
            if output_commitment_2_input != zero_bytes {
                expected_commitments.push_back(output_commitment_2_input.clone());
            }

            // Match new_commitments to expected_commitments
            if new_commitments.len() != expected_commitments.len() {
                return Err(ContractError::ProofVerificationFailed);
            }
            for i in 0..new_commitments.len() {
                if new_commitments.get(i).unwrap() != expected_commitments.get(i).unwrap() {
                    return Err(ContractError::ProofVerificationFailed);
                }
            }
        }

        // Verify that the number of encrypted notes matches the number of new commitments
        if encrypted_notes.len() != new_commitments.len() {
            return Err(ContractError::ProofVerificationFailed);
        }

        // 4. Verify the ZK proof using the verifier contract
        let verifier_addr: Address = env.storage().instance().get(&DataKey::Verifier).unwrap();
        
        let mut args: Vec<Val> = Vec::new(&env);
        args.push_back(proof.into_val(&env));
        args.push_back(public_inputs.into_val(&env));

        let verifier_call = env.try_invoke_contract::<Val, ContractError>(&verifier_addr, &Symbol::new(&env, "verify_proof"), args);
        match verifier_call {
            Ok(Ok(_)) => {}
            _ => return Err(ContractError::ProofVerificationFailed),
        }

        // 6. Mark the nullifier as spent
        env.storage().persistent().set(&DataKey::Nullifiers(nullifier_hash.clone()), &true);

        // 7. Insert new output commitments for shielded transfer / change notes if provided
        for i in 0..new_commitments.len() {
            let commitment = new_commitments.get(i).unwrap();
            let encrypted_note = encrypted_notes.get(i).unwrap();

            let next_index: u32 = env.storage().instance().get(&DataKey::NextIndex).unwrap();
            if next_index >= 65536 {
                return Err(ContractError::TreeFull);
            }
            
            // Enforce duplicate commitment check
            if env.storage().persistent().has(&DataKey::Commitments(commitment.clone())) {
                return Err(ContractError::CommitmentAlreadyExists);
            }
            env.storage().persistent().set(&DataKey::Commitments(commitment.clone()), &true);

            let mut filled_subtrees: Vec<BytesN<32>> = env.storage().instance().get(&DataKey::FilledSubtrees).unwrap();
            let mut current_level_hash = commitment.clone();
            let mut index = next_index;

            for level in 0..TREE_DEPTH {
                if index % 2 == 1 {
                    let left = filled_subtrees.get(level).unwrap();
                    current_level_hash = hash_poseidon_2(&env, left, current_level_hash);
                } else {
                    filled_subtrees.set(level, current_level_hash.clone());
                    let right = get_zero_hash(&env, level);
                    current_level_hash = hash_poseidon_2(&env, current_level_hash, right);
                }
                index /= 2;
            }

            env.storage().instance().set(&DataKey::NextIndex, &(next_index + 1));
            env.storage().instance().set(&DataKey::FilledSubtrees, &filled_subtrees);

            let new_root = current_level_hash;
            env.storage().persistent().set(&DataKey::Roots(new_root.clone()), &true);
            
            // Publish ShieldedOutputEvent for each new commitment
            env.events().publish(
                (Symbol::new(&env, "shielded_output"),),
                ShieldedOutputEvent {
                    commitment: commitment.clone(),
                    encrypted_note,
                }
            );
        }

        // 8. Transfer funds to the recipient if it is not the contract itself (internal shielded transfer/change)
        if recipient != env.current_contract_address() {
            let token_client = soroban_sdk::token::Client::new(&env, &token);
            token_client.transfer(&env.current_contract_address(), &recipient, &amount);
        }

        // Publish withdrawal or shielded transfer event with distinct shapes
        if is_public_withdraw {
            env.events().publish(
                (Symbol::new(&env, "withdrawal"),),
                WithdrawalEvent {
                    nullifier: nullifier_hash.clone(),
                    amount,
                    recipient,
                }
            );
        } else {
            env.events().publish(
                (Symbol::new(&env, "shielded_transfer"),),
                ShieldedTransferEvent {
                    nullifier: nullifier_hash,
                }
            );
        }

        Ok(())
    }

    /// Check if a commitment has been registered.
    pub fn has_commitment(env: Env, commitment: BytesN<32>) -> bool {
        env.storage().persistent().has(&DataKey::Commitments(commitment))
    }

    /// Check if a nullifier has been spent.
    pub fn has_nullifier(env: Env, nullifier: BytesN<32>) -> bool {
        env.storage().persistent().has(&DataKey::Nullifiers(nullifier))
    }

    /// Check if a Merkle root is in the historical roots set.
    pub fn is_root_valid(env: Env, root: BytesN<32>) -> bool {
        env.storage().persistent().has(&DataKey::Roots(root))
    }

    /// Set sanction status of an address (Admin only).
    pub fn set_sanctioned(env: Env, addr: Address, status: bool) -> Result<(), ContractError> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).ok_or(ContractError::NotInitialized)?;
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Sanctioned(addr), &status);
        Ok(())
    }

    /// Check if an address is sanctioned.
    pub fn is_sanctioned(env: Env, addr: Address) -> bool {
        env.storage().persistent().get(&DataKey::Sanctioned(addr)).unwrap_or(false)
    }

    /// Set oracle public key (Admin only).
    pub fn set_oracle(env: Env, oracle_pubkey: BytesN<32>) -> Result<(), ContractError> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).ok_or(ContractError::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Oracle, &oracle_pubkey);
        Ok(())
    }

    /// Get oracle public key.
    pub fn get_oracle(env: Env) -> Option<BytesN<32>> {
        env.storage().instance().get(&DataKey::Oracle)
    }

    /// Update sanctions list using a signed message from the oracle.
    pub fn update_sanctions_with_signature(
        env: Env,
        addr: Address,
        status: bool,
        expires: u64,
        signature: BytesN<64>,
    ) -> Result<(), ContractError> {
        let oracle_pubkey: BytesN<32> = env.storage().instance().get(&DataKey::Oracle).ok_or(ContractError::NotInitialized)?;

        let ledger_timestamp = env.ledger().timestamp();
        if ledger_timestamp > expires {
            return Err(ContractError::SignatureExpired);
        }

        let mut msg_bytes = Bytes::new(&env);
        msg_bytes.append(&env.current_contract_address().to_xdr(&env));
        msg_bytes.append(&addr.clone().to_xdr(&env));
        msg_bytes.append(&status.clone().to_xdr(&env));
        msg_bytes.append(&expires.clone().to_xdr(&env));

        // Verify signature (traps if signature is invalid)
        env.crypto().ed25519_verify(&oracle_pubkey, &msg_bytes, &signature);

        env.storage().persistent().set(&DataKey::Sanctioned(addr), &status);
        Ok(())
    }
}

pub(crate) fn hash_poseidon_1(env: &Env, value: BytesN<32>) -> BytesN<32> {
    use soroban_poseidon::poseidon_hash;
    use soroban_sdk::{crypto::bn254::Fr, vec, Bytes, U256};

    let val_bytes: Bytes = value.into();
    let val_u256 = U256::from_be_bytes(env, &val_bytes);

    let inputs = vec![env, val_u256];
    let hash_u256 = poseidon_hash::<2, Fr>(env, &inputs);

    let mut bytes = [0u8; 32];
    hash_u256.to_be_bytes().copy_into_slice(&mut bytes);
    BytesN::from_array(env, &bytes)
}

pub(crate) fn hash_poseidon_2(env: &Env, left: BytesN<32>, right: BytesN<32>) -> BytesN<32> {
    use soroban_poseidon::poseidon_hash;
    use soroban_sdk::{crypto::bn254::Fr, vec, Bytes, U256};

    let left_bytes: Bytes = left.into();
    let right_bytes: Bytes = right.into();
    let left_u256 = U256::from_be_bytes(env, &left_bytes);
    let right_u256 = U256::from_be_bytes(env, &right_bytes);

    let inputs = vec![env, left_u256, right_u256];
    let hash_u256 = poseidon_hash::<3, Fr>(env, &inputs);

    let mut bytes = [0u8; 32];
    hash_u256.to_be_bytes().copy_into_slice(&mut bytes);
    BytesN::from_array(env, &bytes)
}

mod test;
