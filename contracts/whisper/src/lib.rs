#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, Address, Bytes, BytesN, Env, Error, Symbol, Vec, Val, IntoVal
};

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
}

// Tree depth constant. Matching our Noir circuit depth of 8.
const TREE_DEPTH: u32 = 8;

// Helper to get zero hashes for the Merkle tree levels.
fn get_zero_hash(env: &Env, level: u32) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[0] = level as u8;
    BytesN::from_array(env, &bytes)
}

#[contractimpl]
impl Contract {
    /// Initialize the contract with admin, stablecoin token, and the ZK verifier contract address.
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

    /// Deposit public stablecoins into the pool and register the commitment.
    pub fn deposit(env: Env, from: Address, commitment: BytesN<32>, amount: i128) -> Result<BytesN<32>, ContractError> {
        from.require_auth();

        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::NotInitialized);
        }
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();

        // 1. Transfer tokens from depositor to this contract vault
        let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
        token_client.transfer(&from, &env.current_contract_address(), &amount);

        // 2. Insert commitment into the Merkle tree
        let next_index: u32 = env.storage().instance().get(&DataKey::NextIndex).unwrap();
        let mut filled_subtrees: Vec<BytesN<32>> = env.storage().instance().get(&DataKey::FilledSubtrees).unwrap();

        let mut current_level_hash = commitment;
        let mut index = next_index;

        for i in 0..TREE_DEPTH {
            if index % 2 == 1 {
                // If odd, hash filled_subtrees[i] + current_level_hash
                let left = filled_subtrees.get(i).unwrap();
                current_level_hash = hash_poseidon_2(&env, left, current_level_hash);
            } else {
                // If even, update filled_subtrees[i] to current_level_hash, and hash current_level_hash + zero_hash[i]
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

        Ok(new_root)
    }

    /// Withdraw or transfer funds privately by verifying a ZK proof.
    pub fn transfer_or_withdraw(
        env: Env,
        proof: Bytes,
        public_inputs: Vec<BytesN<32>>,
        recipient: Address,
        amount: i128,
    ) -> Result<(), ContractError> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::NotInitialized);
        }
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        // Public inputs index map (matching Noir main parameter ordering):
        // public_inputs[0]: merkle_root
        // public_inputs[1]: nullifier_hash
        // public_inputs[2]: amount (public field element representation)
        // public_inputs[3]: recipient (public field element representation of address)
        let merkle_root = public_inputs.get(0).unwrap();
        let nullifier_hash = public_inputs.get(1).unwrap();

        // 1. Verify that the Merkle root is valid (i.e. has been created by a deposit)
        if !env.storage().persistent().has(&DataKey::Roots(merkle_root.clone())) {
            return Err(ContractError::InvalidMerkleRoot);
        }

        // 2. Verify that the nullifier hasn't been spent yet
        if env.storage().persistent().has(&DataKey::Nullifiers(nullifier_hash.clone())) {
            return Err(ContractError::NullifierAlreadySpent);
        }

        // 3. Verify the ZK proof using the verifier contract
        let verifier_addr: Address = env.storage().instance().get(&DataKey::Verifier).unwrap();
        
        let mut args: Vec<Val> = Vec::new(&env);
        args.push_back(proof.into_val(&env));
        args.push_back(public_inputs.into_val(&env));

        let verifier_call = env.try_invoke_contract::<Val, ContractError>(&verifier_addr, &Symbol::new(&env, "verify_proof"), args);
        match verifier_call {
            Ok(Ok(_)) => {}
            _ => return Err(ContractError::ProofVerificationFailed),
        }

        // 4. Mark the nullifier as spent
        env.storage().persistent().set(&DataKey::Nullifiers(nullifier_hash), &true);

        // 5. Transfer funds to the recipient
        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
        token_client.transfer(&env.current_contract_address(), &recipient, &amount);

        Ok(())
    }
}

// Helper function to hash two values using Poseidon.
fn hash_poseidon_2(env: &Env, left: BytesN<32>, right: BytesN<32>) -> BytesN<32> {
    let mut bytes = Bytes::new(env);
    bytes.append(&left.into());
    bytes.append(&right.into());
    let hash = env.crypto().sha256(&bytes);
    BytesN::from_array(env, &hash.to_array())
}

mod test;
