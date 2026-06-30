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

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShieldedSwapEvent {
    pub nullifier: BytesN<32>,
    pub token_in: Address,
    pub token_out: Address,
    pub amount_in: i128,
    pub amount_out: i128,
    pub new_commitment: BytesN<32>,
    pub encrypted_note: Bytes,
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
    ZeroHashes,
    Roots(BytesN<32>),
    Nullifiers(BytesN<32>),
    Commitments(BytesN<32>),
    Sanctioned(Address),
    Oracle,
    TokenA,
    TokenB,
    ReserveA,
    ReserveB,
    LpShares(Address),
    TotalLpShares,
    ProtocolFeeA,
    ProtocolFeeB,
    VerifierForVersion(u32),
    ReentrancyLock,
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
    DeadlineExpired = 13,
    SlippageExceeded = 14,
    ReentrancyGuardTriggered = 15,
}

// Tree depth constant. Matching our Noir circuit depth of 16.
const TREE_DEPTH: u32 = 16;

// Pre-computed zero hashes for the Merkle tree using recursive Poseidon:
// Z0 = [0u8; 32] (empty leaf)
// Z1 = Poseidon(Z0, Z0)
// Z2 = Poseidon(Z1, Z1)
// ...
// Z16 = Poseidon(Z15, Z15) (empty tree root)
fn compute_zero_hashes(env: &Env) -> Vec<BytesN<32>> {
    let mut zero_hashes: Vec<BytesN<32>> = Vec::new(env);
    let zero_leaf = BytesN::from_array(env, &[0u8; 32]);
    zero_hashes.push_back(zero_leaf);
    for level in 1..=TREE_DEPTH {
        let prev = zero_hashes.get(level - 1).unwrap();
        let zh = hash_poseidon_2(env, prev.clone(), prev.clone());
        zero_hashes.push_back(zh);
    }
    zero_hashes
}

fn val_to_bytes32(env: &Env, val: i128) -> BytesN<32> {
    let mut arr = [0u8; 32];
    let serialized = (val as u128).to_be_bytes();
    for i in 0..16 {
        arr[16 + i] = serialized[i];
    }
    BytesN::from_array(env, &arr)
}

fn derive_commitment_helper(
    env: &Env,
    pubkey: BytesN<32>,
    amount: i128,
    nonce: BytesN<32>,
    token: Address,
) -> BytesN<32> {
    let amount_bytes = val_to_bytes32(env, amount);
    let salted_amount = hash_poseidon_2(env, amount_bytes, nonce);
    
    let token_xdr = token.to_xdr(env);
    let token_hash = env.crypto().sha256(&token_xdr);
    let asset_id = BytesN::from_array(env, &token_hash.to_array());
    
    let asset_salted_amount = hash_poseidon_2(env, salted_amount, asset_id);
    hash_poseidon_2(env, pubkey, asset_salted_amount)
}

fn insert_commitment(env: &Env, commitment: BytesN<32>) -> Result<BytesN<32>, ContractError> {
    let next_index: u32 = env.storage().instance().get(&DataKey::NextIndex).ok_or(ContractError::NotInitialized)?;
    if next_index >= 65536 {
        return Err(ContractError::TreeFull);
    }
    
    // Enforce duplicate commitment check
    if env.storage().persistent().has(&DataKey::Commitments(commitment.clone())) {
        return Err(ContractError::CommitmentAlreadyExists);
    }
    env.storage().persistent().set(&DataKey::Commitments(commitment.clone()), &true);

    let mut filled_subtrees: Vec<BytesN<32>> = env.storage().instance().get(&DataKey::FilledSubtrees).ok_or(ContractError::NotInitialized)?;
    let zero_hashes: Vec<BytesN<32>> = env.storage().instance().get(&DataKey::ZeroHashes).ok_or(ContractError::NotInitialized)?;
    let mut current_level_hash = commitment.clone();
    let mut index = next_index;

    for level in 0..TREE_DEPTH {
        if index % 2 == 1 {
            let left = filled_subtrees.get(level).unwrap();
            current_level_hash = hash_poseidon_2(env, left, current_level_hash);
        } else {
            filled_subtrees.set(level, current_level_hash.clone());
            let right = zero_hashes.get(level).unwrap();
            current_level_hash = hash_poseidon_2(env, current_level_hash, right);
        }
        index /= 2;
    }

    env.storage().instance().set(&DataKey::NextIndex, &(next_index + 1));
    env.storage().instance().set(&DataKey::FilledSubtrees, &filled_subtrees);

    let new_root = current_level_hash;
    env.storage().persistent().set(&DataKey::Roots(new_root.clone()), &true);
    
    Ok(new_root)
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

        // Pre-compute Poseidon-based zero hashes: Z0 = [0;32], Z1 = Poseidon(Z0,Z0), ...
        let zero_hashes = compute_zero_hashes(&env);
        env.storage().instance().set(&DataKey::ZeroHashes, &zero_hashes);

        // Initialize filled subtrees (all empty)
        let mut filled_subtrees: Vec<BytesN<32>> = Vec::new(&env);
        for i in 0..TREE_DEPTH {
            filled_subtrees.push_back(zero_hashes.get(i).unwrap());
        }
        env.storage().instance().set(&DataKey::FilledSubtrees, &filled_subtrees);

        // Set initial empty root as valid
        let initial_root = zero_hashes.get(TREE_DEPTH).unwrap();
        env.storage().persistent().set(&DataKey::Roots(initial_root), &true);

        Ok(())
    }

    /// Initialize the public AMM pool reserves (Admin only).
    pub fn init_amm(
        env: Env,
        token_a: Address,
        token_b: Address,
    ) -> Result<(), ContractError> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).ok_or(ContractError::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::TokenA, &token_a);
        env.storage().instance().set(&DataKey::TokenB, &token_b);
        env.storage().instance().set(&DataKey::ReserveA, &0_i128);
        env.storage().instance().set(&DataKey::ReserveB, &0_i128);
        Ok(())
    }

    /// Retrieve the current public AMM pool reserves.
    pub fn get_reserves(env: Env) -> (i128, i128) {
        let reserve_a = env.storage().instance().get(&DataKey::ReserveA).unwrap_or(0_i128);
        let reserve_b = env.storage().instance().get(&DataKey::ReserveB).unwrap_or(0_i128);
        (reserve_a, reserve_b)
    }

    /// Add public liquidity to the AMM pool.
    pub fn add_liquidity(
        env: Env,
        from: Address,
        amount_a: i128,
        amount_b: i128,
        min_shares: i128,
        deadline: u64,
    ) -> Result<i128, ContractError> {
        from.require_auth();

        let lock_key = DataKey::ReentrancyLock;
        if env.storage().instance().has(&lock_key) {
            return Err(ContractError::ReentrancyGuardTriggered);
        }
        env.storage().instance().set(&lock_key, &true);

        if env.ledger().timestamp() > deadline {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::DeadlineExpired);
        }

        let token_a: Address = env.storage().instance().get(&DataKey::TokenA).ok_or(ContractError::NotInitialized)?;
        let token_b: Address = env.storage().instance().get(&DataKey::TokenB).ok_or(ContractError::NotInitialized)?;
        let mut reserve_a: i128 = env.storage().instance().get(&DataKey::ReserveA).unwrap_or(0);
        let mut reserve_b: i128 = env.storage().instance().get(&DataKey::ReserveB).unwrap_or(0);

        if amount_a <= 0 || amount_b <= 0 {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::InvalidAmount);
        }

        // Transfer tokens from user to contract
        let client_a = soroban_sdk::token::Client::new(&env, &token_a);
        let client_b = soroban_sdk::token::Client::new(&env, &token_b);
        client_a.transfer(&from, &env.current_contract_address(), &amount_a);
        client_b.transfer(&from, &env.current_contract_address(), &amount_b);

        // Calculate and mint LP shares (Uniswap V2 style)
        let total_shares: i128 = env.storage().instance().get(&DataKey::TotalLpShares).unwrap_or(0);
        let shares = if total_shares == 0 {
            // First liquidity provision
            amount_a
        } else {
            // Use the smaller proportional contribution to credit LP shares
            let shares_a = (amount_a * total_shares) / reserve_a;
            let shares_b = (amount_b * total_shares) / reserve_b;
            shares_a.min(shares_b)
        };

        if shares < min_shares {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::SlippageExceeded);
        }

        // Update reserves
        reserve_a += amount_a;
        reserve_b += amount_b;
        env.storage().instance().set(&DataKey::ReserveA, &reserve_a);
        env.storage().instance().set(&DataKey::ReserveB, &reserve_b);

        let lp_shares_key = DataKey::LpShares(from.clone());
        let current_shares: i128 = env.storage().persistent().get(&lp_shares_key).unwrap_or(0);
        env.storage().persistent().set(&lp_shares_key, &(current_shares + shares));
        env.storage().instance().set(&DataKey::TotalLpShares, &(total_shares + shares));

        // Publish LP Event
        env.events().publish(
            (Symbol::new(&env, "add_liquidity"),),
            (from, amount_a, amount_b, shares),
        );

        env.storage().instance().remove(&lock_key);
        Ok(shares)
    }

    /// Remove public liquidity from the AMM pool.
    pub fn remove_liquidity(
        env: Env,
        from: Address,
        shares: i128,
        min_amount_a: i128,
        min_amount_b: i128,
        deadline: u64,
    ) -> Result<(i128, i128), ContractError> {
        from.require_auth();

        let lock_key = DataKey::ReentrancyLock;
        if env.storage().instance().has(&lock_key) {
            return Err(ContractError::ReentrancyGuardTriggered);
        }
        env.storage().instance().set(&lock_key, &true);

        if env.ledger().timestamp() > deadline {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::DeadlineExpired);
        }

        let token_a: Address = env.storage().instance().get(&DataKey::TokenA).ok_or(ContractError::NotInitialized)?;
        let token_b: Address = env.storage().instance().get(&DataKey::TokenB).ok_or(ContractError::NotInitialized)?;
        let mut reserve_a: i128 = env.storage().instance().get(&DataKey::ReserveA).unwrap_or(0);
        let mut reserve_b: i128 = env.storage().instance().get(&DataKey::ReserveB).unwrap_or(0);
        let total_shares: i128 = env.storage().instance().get(&DataKey::TotalLpShares).unwrap_or(0);

        if shares <= 0 || total_shares <= 0 {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::InvalidAmount);
        }

        let lp_shares_key = DataKey::LpShares(from.clone());
        let current_shares: i128 = env.storage().persistent().get(&lp_shares_key).unwrap_or(0);
        if current_shares < shares {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::InvalidAmount);
        }

        // Calculate returned amounts
        let amount_a = (shares * reserve_a) / total_shares;
        let amount_b = (shares * reserve_b) / total_shares;

        if amount_a <= 0 || amount_b <= 0 {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::InvalidAmount);
        }

        if amount_a < min_amount_a || amount_b < min_amount_b {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::SlippageExceeded);
        }

        // Transfer tokens from contract back to user
        let client_a = soroban_sdk::token::Client::new(&env, &token_a);
        let client_b = soroban_sdk::token::Client::new(&env, &token_b);
        client_a.transfer(&env.current_contract_address(), &from, &amount_a);
        client_b.transfer(&env.current_contract_address(), &from, &amount_b);

        // Update reserves
        reserve_a -= amount_a;
        reserve_b -= amount_b;
        env.storage().instance().set(&DataKey::ReserveA, &reserve_a);
        env.storage().instance().set(&DataKey::ReserveB, &reserve_b);

        // Update shares
        env.storage().persistent().set(&lp_shares_key, &(current_shares - shares));
        env.storage().instance().set(&DataKey::TotalLpShares, &(total_shares - shares));

        // Publish LP Event
        env.events().publish(
            (Symbol::new(&env, "remove_liquidity"),),
            (from, amount_a, amount_b, shares),
        );

        env.storage().instance().remove(&lock_key);
        Ok((amount_a, amount_b))
    }

    /// Get the LP shares of an address.
    pub fn get_lp_shares(env: Env, from: Address) -> i128 {
        env.storage().persistent().get(&DataKey::LpShares(from)).unwrap_or(0_i128)
    }

    /// Get the total supply of LP shares.
    pub fn get_total_lp_shares(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalLpShares).unwrap_or(0_i128)
    }

    /// Derive note commitment utility endpoint.
    pub fn derive_commitment(
        env: Env,
        pubkey: BytesN<32>,
        amount: i128,
        nonce: BytesN<32>,
        token: Address,
    ) -> BytesN<32> {
        derive_commitment_helper(&env, pubkey, amount, nonce, token)
    }

    /// Deposit public tokens (USDC or native XLM) into the pool and register the commitment.
    pub fn deposit(
        env: Env,
        from: Address,
        token: Address,
        commitment: BytesN<32>,
        amount: i128,
        encrypted_note: Bytes,
        circuit_version: u32,
    ) -> Result<BytesN<32>, ContractError> {
        from.require_auth();

        let lock_key = DataKey::ReentrancyLock;
        if env.storage().instance().has(&lock_key) {
            return Err(ContractError::ReentrancyGuardTriggered);
        }
        env.storage().instance().set(&lock_key, &true);

        if circuit_version != 1 {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::Unauthorized);
        }

        if !env.storage().instance().has(&DataKey::Admin) {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::NotInitialized);
        }
        // Enforce compliance: check if depositor is sanctioned
        if Self::is_sanctioned(env.clone(), from.clone()) {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::SanctionedAddress);
        }
        if amount <= 0 {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::InvalidAmount);
        }

        // 1. Transfer tokens from depositor to this contract vault
        let token_client = soroban_sdk::token::Client::new(&env, &token);
        token_client.transfer(&from, &env.current_contract_address(), &amount);

        // 2. Insert commitment into the Merkle tree
        let new_root = insert_commitment(&env, commitment.clone())?;

        // Publish deposit event with typed struct
        env.events().publish(
            (Symbol::new(&env, "deposit"),),
            DepositEvent {
                commitment: commitment.clone(),
                amount,
                encrypted_note,
            }
        );

        env.storage().instance().remove(&lock_key);
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
        relayer: Option<Address>,
        relayer_fee: i128,
        circuit_version: u32,
        encrypted_notes: Vec<Bytes>,
        new_commitments: Vec<BytesN<32>>,
    ) -> Result<(), ContractError> {
        let lock_key = DataKey::ReentrancyLock;
        if env.storage().instance().has(&lock_key) {
            return Err(ContractError::ReentrancyGuardTriggered);
        }
        env.storage().instance().set(&lock_key, &true);

        if !env.storage().instance().has(&DataKey::Admin) {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::NotInitialized);
        }

        let verifier_key = DataKey::VerifierForVersion(circuit_version);
        let verifier_addr = if env.storage().persistent().has(&verifier_key) {
            env.storage().persistent().get(&verifier_key).unwrap()
        } else if circuit_version == 1 {
            env.storage().instance().get(&DataKey::Verifier).ok_or(ContractError::NotInitialized)?
        } else {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::Unauthorized);
        };
        
        let is_public_withdraw = recipient != env.current_contract_address();

        if is_public_withdraw {
            if amount <= 0 {
                env.storage().instance().remove(&lock_key);
                return Err(ContractError::InvalidAmount);
            }
            if relayer_fee < 0 {
                env.storage().instance().remove(&lock_key);
                return Err(ContractError::InvalidAmount);
            }
            if relayer_fee > 0 {
                if amount < relayer_fee {
                    env.storage().instance().remove(&lock_key);
                    return Err(ContractError::InvalidAmount);
                }
                if relayer.is_none() {
                    env.storage().instance().remove(&lock_key);
                    return Err(ContractError::Unauthorized);
                }
            }
            // Enforce compliance: check if recipient is sanctioned
            if Self::is_sanctioned(env.clone(), recipient.clone()) {
                env.storage().instance().remove(&lock_key);
                return Err(ContractError::SanctionedAddress);
            }
        } else {
            if amount != 0 || relayer_fee != 0 {
                env.storage().instance().remove(&lock_key);
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
            env.storage().instance().remove(&lock_key);
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
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::ProofVerificationFailed);
        }

        // 1. Verify that the Merkle root is valid (i.e. has been created by a deposit/transfer)
        if !env.storage().persistent().has(&DataKey::Roots(merkle_root.clone())) {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::InvalidMerkleRoot);
        }

        // 2. Verify that the nullifier hasn't been spent already to prevent double spending
        if env.storage().persistent().has(&DataKey::Nullifiers(nullifier_hash.clone())) {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::NullifierAlreadySpent);
        }

        // 3. Verify that the public input for withdraw amount matches amount
        let expected_withdraw_input = val_to_bytes32(&env, amount);
        if public_withdraw_amount_input != expected_withdraw_input {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::InvalidAmount);
        }

        // Check if this is a zero-output transaction (standard public withdrawal)
        let zero_bytes = BytesN::from_array(&env, &[0u8; 32]);
        if is_public_withdraw {
            // Verify public recipient hash matches the sha256 hash of recipient address
            let recipient_xdr = recipient.clone().to_xdr(&env);
            let recipient_hash_raw = env.crypto().sha256(&recipient_xdr);
            let expected_recipient_hash = BytesN::from_array(&env, &recipient_hash_raw.to_array());
            if public_recipient_hash_input != expected_recipient_hash {
                env.storage().instance().remove(&lock_key);
                return Err(ContractError::ProofVerificationFailed);
            }

            if output_commitment_1_input != zero_bytes || public_recipient_hash_input == zero_bytes {
                env.storage().instance().remove(&lock_key);
                return Err(ContractError::ProofVerificationFailed);
            }
            
            // Match new_commitments to expected_commitments (e.g. change commitment)
            let mut expected_commitments = Vec::new(&env);
            if output_commitment_2_input != zero_bytes {
                expected_commitments.push_back(output_commitment_2_input.clone());
            }

            if new_commitments.len() != expected_commitments.len() {
                env.storage().instance().remove(&lock_key);
                return Err(ContractError::ProofVerificationFailed);
            }
            for i in 0..new_commitments.len() {
                if new_commitments.get(i).unwrap() != expected_commitments.get(i).unwrap() {
                    env.storage().instance().remove(&lock_key);
                    return Err(ContractError::ProofVerificationFailed);
                }
            }
        } else {
            // Internal shielded transfer
            if public_withdraw_amount_input != zero_bytes || public_recipient_hash_input != zero_bytes {
                env.storage().instance().remove(&lock_key);
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
                env.storage().instance().remove(&lock_key);
                return Err(ContractError::ProofVerificationFailed);
            }
            for i in 0..new_commitments.len() {
                if new_commitments.get(i).unwrap() != expected_commitments.get(i).unwrap() {
                    env.storage().instance().remove(&lock_key);
                    return Err(ContractError::ProofVerificationFailed);
                }
            }
        }

        // Verify that the number of encrypted notes matches the number of new commitments
        if encrypted_notes.len() != new_commitments.len() {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::ProofVerificationFailed);
        }

        // 4. Verify the ZK proof using the verifier contract
        let mut args: Vec<Val> = Vec::new(&env);
        args.push_back(proof.into_val(&env));
        args.push_back(public_inputs.into_val(&env));

        let verifier_call = env.try_invoke_contract::<Val, ContractError>(&verifier_addr, &Symbol::new(&env, "verify_proof"), args);
        match verifier_call {
            Ok(Ok(_)) => {}
            _ => {
                env.storage().instance().remove(&lock_key);
                return Err(ContractError::ProofVerificationFailed);
            }
        }

        // 6. Mark the nullifier as spent
        env.storage().persistent().set(&DataKey::Nullifiers(nullifier_hash.clone()), &true);

        // 7. Insert new output commitments for shielded transfer / change notes if provided
        for i in 0..new_commitments.len() {
            let commitment = new_commitments.get(i).unwrap();
            let encrypted_note = encrypted_notes.get(i).unwrap();

            let _new_root = insert_commitment(&env, commitment.clone())?;
            
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
            if relayer_fee > 0 {
                let relayer_unwrap = relayer.unwrap();
                token_client.transfer(&env.current_contract_address(), &relayer_unwrap, &relayer_fee);
                token_client.transfer(&env.current_contract_address(), &recipient, &(amount - relayer_fee));
            } else {
                token_client.transfer(&env.current_contract_address(), &recipient, &amount);
            }
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

        env.storage().instance().remove(&lock_key);
        Ok(())
    }

    /// Perform a private ZK swap against the public AMM pool reserves.
    pub fn swap_shielded(
        env: Env,
        token_in: Address,
        token_out: Address,
        proof: Bytes,
        public_inputs: Vec<BytesN<32>>,
        amount_in: i128,
        min_amount_out: i128,
        recipient_pubkey: BytesN<32>,
        recipient_nonce: BytesN<32>,
        circuit_version: u32,
        deadline: u64,
        encrypted_note: Bytes,
    ) -> Result<(i128, BytesN<32>), ContractError> {
        let lock_key = DataKey::ReentrancyLock;
        if env.storage().instance().has(&lock_key) {
            return Err(ContractError::ReentrancyGuardTriggered);
        }
        env.storage().instance().set(&lock_key, &true);

        if env.ledger().timestamp() > deadline {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::DeadlineExpired);
        }

        if !env.storage().instance().has(&DataKey::Admin) {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::NotInitialized);
        }

        if amount_in <= 0 {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::InvalidAmount);
        }

        // Verify that token_in is one of the AMM tokens and token_out is the other
        let token_a: Address = env.storage().instance().get(&DataKey::TokenA).ok_or(ContractError::NotInitialized)?;
        let token_b: Address = env.storage().instance().get(&DataKey::TokenB).ok_or(ContractError::NotInitialized)?;

        let is_in_a = token_in == token_a;
        let is_in_b = token_in == token_b;
        let is_out_a = token_out == token_a;
        let is_out_b = token_out == token_b;

        if !((is_in_a && is_out_b) || (is_in_b && is_out_a)) {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::Unauthorized);
        }

        let verifier_key = DataKey::VerifierForVersion(circuit_version);
        let verifier_addr = if env.storage().persistent().has(&verifier_key) {
            env.storage().persistent().get(&verifier_key).unwrap()
        } else if circuit_version == 1 {
            env.storage().instance().get(&DataKey::Verifier).ok_or(ContractError::NotInitialized)?
        } else {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::Unauthorized);
        };

        // 1. ZK Proof verification (spending the input note)
        if public_inputs.len() < 8 {
            env.storage().instance().remove(&lock_key);
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

        // Verify that token_in matches asset_id
        let token_xdr = token_in.clone().to_xdr(&env);
        let token_hash = env.crypto().sha256(&token_xdr);
        let expected_asset_id = BytesN::from_array(&env, &token_hash.to_array());
        if asset_id_input != expected_asset_id {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::ProofVerificationFailed);
        }

        // Verify Merkle root is valid
        if !env.storage().persistent().has(&DataKey::Roots(merkle_root.clone())) {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::InvalidMerkleRoot);
        }

        // Verify nullifier hasn't been spent
        if env.storage().persistent().has(&DataKey::Nullifiers(nullifier_hash.clone())) {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::NullifierAlreadySpent);
        }

        // Verify amount matches public withdraw input
        let expected_withdraw_input = val_to_bytes32(&env, amount_in);
        if public_withdraw_amount_input != expected_withdraw_input {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::InvalidAmount);
        }

        // Verify recipient hash matches contract address hash
        let recipient_xdr = env.current_contract_address().to_xdr(&env);
        let recipient_hash = env.crypto().sha256(&recipient_xdr);
        let expected_recipient_hash = BytesN::from_array(&env, &recipient_hash.to_array());
        if public_recipient_hash_input != expected_recipient_hash {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::ProofVerificationFailed);
        }

        // Enforce that output commitments from ZK proof are zero (entire amount withdrawn to AMM)
        let zero_bytes = BytesN::from_array(&env, &[0u8; 32]);
        if output_commitment_1_input != zero_bytes || output_commitment_2_input != zero_bytes {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::ProofVerificationFailed);
        }

        // Verify proof using verifier
        let mut args: Vec<Val> = Vec::new(&env);
        args.push_back(proof.into_val(&env));
        args.push_back(public_inputs.into_val(&env));

        let verifier_call = env.try_invoke_contract::<Val, ContractError>(&verifier_addr, &Symbol::new(&env, "verify_proof"), args);
        match verifier_call {
            Ok(Ok(_)) => {}
            _ => {
                env.storage().instance().remove(&lock_key);
                return Err(ContractError::ProofVerificationFailed);
            }
        }

        // Mark nullifier as spent
        env.storage().persistent().set(&DataKey::Nullifiers(nullifier_hash.clone()), &true);

        // 2. Perform Swap AMM logic
        let mut reserve_a: i128 = env.storage().instance().get(&DataKey::ReserveA).unwrap_or(0);
        let mut reserve_b: i128 = env.storage().instance().get(&DataKey::ReserveB).unwrap_or(0);

        let (reserve_in, reserve_out) = if is_in_a {
            (reserve_a, reserve_b)
        } else {
            (reserve_b, reserve_a)
        };

        if reserve_in <= 0 || reserve_out <= 0 {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::InvalidAmount);
        }

        // constant product swap formula with 0.3% LP fee + 0.05% Protocol fee = 0.35% total fee:
        // amount_in_with_fee = amount_in * 9965 / 10000
        // amount_out = (reserve_out * amount_in_with_fee) / (reserve_in * 10000 + amount_in_with_fee)
        let amount_in_with_fee = amount_in * 9965;
        let numerator = reserve_out * amount_in_with_fee;
        let denominator = reserve_in * 10000 + amount_in_with_fee;
        let amount_out = numerator / denominator;

        if amount_out < min_amount_out {
            env.storage().instance().remove(&lock_key);
            return Err(ContractError::SlippageExceeded);
        }

        // Calculate fees
        let protocol_fee = (amount_in * 5) / 10000;

        // Update protocol fee counter in storage
        if is_in_a {
            let current_fee_a: i128 = env.storage().instance().get(&DataKey::ProtocolFeeA).unwrap_or(0);
            env.storage().instance().set(&DataKey::ProtocolFeeA, &(current_fee_a + protocol_fee));
        } else {
            let current_fee_b: i128 = env.storage().instance().get(&DataKey::ProtocolFeeB).unwrap_or(0);
            env.storage().instance().set(&DataKey::ProtocolFeeB, &(current_fee_b + protocol_fee));
        }

        // Update reserves (excluding protocol fee, which is collected outside reserves)
        let adjusted_in = amount_in - protocol_fee;
        if is_in_a {
            reserve_a += adjusted_in;
            reserve_b -= amount_out;
        } else {
            reserve_b += adjusted_in;
            reserve_a -= amount_out;
        }

        env.storage().instance().set(&DataKey::ReserveA, &reserve_a);
        env.storage().instance().set(&DataKey::ReserveB, &reserve_b);

        // 3. Insert new output commitment for token_out
        let commitment = Self::derive_commitment(
            env.clone(),
            recipient_pubkey.clone(),
            amount_out,
            recipient_nonce.clone(),
            token_out.clone(),
        );

        let new_root = insert_commitment(&env, commitment.clone())?;

        // Publish ShieldedSwapEvent
        env.events().publish(
            (Symbol::new(&env, "shielded_swap"),),
            ShieldedSwapEvent {
                nullifier: nullifier_hash.clone(),
                token_in,
                token_out,
                amount_in,
                amount_out,
                new_commitment: commitment.clone(),
                encrypted_note,
            }
        );

        env.storage().instance().remove(&lock_key);
        Ok((amount_out, new_root))
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

    /// Set a verifier contract address for a specific circuit version (Admin only).
    pub fn set_verifier_for_version(env: Env, version: u32, verifier: Address) -> Result<(), ContractError> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).ok_or(ContractError::NotInitialized)?;
        admin.require_auth();
        env.storage().persistent().set(&DataKey::VerifierForVersion(version), &verifier);
        Ok(())
    }

    /// Claim collected protocol fees (Admin only).
    pub fn claim_protocol_fees(env: Env, token: Address, recipient: Address, amount: i128) -> Result<(), ContractError> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).ok_or(ContractError::NotInitialized)?;
        admin.require_auth();

        let token_a: Address = env.storage().instance().get(&DataKey::TokenA).ok_or(ContractError::NotInitialized)?;
        let token_b: Address = env.storage().instance().get(&DataKey::TokenB).ok_or(ContractError::NotInitialized)?;

        let is_a = token == token_a;
        let is_b = token == token_b;
        if !is_a && !is_b {
            return Err(ContractError::Unauthorized);
        }

        let fee_key = if is_a { DataKey::ProtocolFeeA } else { DataKey::ProtocolFeeB };
        let mut current_fee: i128 = env.storage().instance().get(&fee_key).unwrap_or(0);
        if current_fee < amount || amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        current_fee -= amount;
        env.storage().instance().set(&fee_key, &current_fee);

        let token_client = soroban_sdk::token::Client::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &recipient, &amount);

        Ok(())
    }

    /// Get current collected protocol fees for TokenA and TokenB.
    pub fn get_protocol_fees(env: Env) -> (i128, i128) {
        let fee_a = env.storage().instance().get(&DataKey::ProtocolFeeA).unwrap_or(0);
        let fee_b = env.storage().instance().get(&DataKey::ProtocolFeeB).unwrap_or(0);
        (fee_a, fee_b)
    }
}

fn reduce_bn254_modulus(value: [u8; 32]) -> [u8; 32] {
    let modulus: [u8; 32] = [
        0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
        0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
        0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91,
        0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01
    ];
    let mut result = value;
    // At most 4 iterations needed for 256-bit input vs ~254-bit modulus
    for _ in 0..4 {
        let mut need_sub = true;
        for i in 0..32 {
            if result[i] < modulus[i] { need_sub = false; break; }
            if result[i] > modulus[i] { break; }
        }
        if !need_sub { break; }
        let mut borrow = 0i32;
        for i in (0..32).rev() {
            let diff = (result[i] as i32) - (modulus[i] as i32) - borrow;
            if diff < 0 {
                result[i] = (diff + 256) as u8;
                borrow = 1;
            } else {
                result[i] = diff as u8;
                borrow = 0;
            }
        }
    }
    result
}

#[allow(dead_code)]
pub(crate) fn hash_poseidon_1(env: &Env, value: BytesN<32>) -> BytesN<32> {
    use soroban_poseidon::poseidon_hash;
    use soroban_sdk::{crypto::bn254::Fr, vec, Bytes, U256};

    let mut arr = [0u8; 32];
    value.copy_into_slice(&mut arr);
    let reduced_arr = reduce_bn254_modulus(arr);
    let val_bytes = Bytes::from_slice(env, &reduced_arr);
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

    let mut left_arr = [0u8; 32];
    left.copy_into_slice(&mut left_arr);
    let left_reduced_arr = reduce_bn254_modulus(left_arr);
    let left_bytes = Bytes::from_slice(env, &left_reduced_arr);
    let left_u256 = U256::from_be_bytes(env, &left_bytes);

    let mut right_arr = [0u8; 32];
    right.copy_into_slice(&mut right_arr);
    let right_reduced_arr = reduce_bn254_modulus(right_arr);
    let right_bytes = Bytes::from_slice(env, &right_reduced_arr);
    let right_u256 = U256::from_be_bytes(env, &right_bytes);

    let inputs = vec![env, left_u256, right_u256];
    let hash_u256 = poseidon_hash::<3, Fr>(env, &inputs);

    let mut bytes = [0u8; 32];
    hash_u256.to_be_bytes().copy_into_slice(&mut bytes);
    BytesN::from_array(env, &bytes)
}

mod test;
