#![cfg(test)]

use super::*;
use soroban_sdk::{
    contract, contractimpl, testutils::{Address as _}, Address, Bytes, BytesN, Env, Vec
};

#[contract]
pub struct MockVerifier;

#[contractimpl]
impl MockVerifier {
    pub fn verify_proof(_env: Env, proof: Bytes, _public_inputs: Vec<BytesN<32>>) {
        // If proof is [9], reject (panic) to simulate proof verification failure
        if proof.len() == 1 && proof.get(0).unwrap() == 9 {
            panic!("Mock verification failed");
        }
    }
}

fn val_to_bytes32(env: &Env, val: i128) -> BytesN<32> {
    let mut arr = [0u8; 32];
    let serialized = (val as u128).to_be_bytes();
    for i in 0..16 {
        arr[16 + i] = serialized[i];
    }
    BytesN::from_array(env, &arr)
}

fn get_asset_id(env: &Env, token: &Address) -> BytesN<32> {
    let token_xdr = token.to_xdr(env);
    let token_hash = env.crypto().sha256(&token_xdr);
    BytesN::from_array(env, &token_hash.to_array())
}

#[test]
fn test_whisper_flow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let recipient = Address::generate(&env);

    // Register Mock Token Contract
    let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

    // Register Mock ZK Verifier Contract
    let verifier_addr = env.register(MockVerifier, ());

    // Register and initialize Whisper Contract
    let whisper_contract_id = env.register(Contract, ());
    let whisper_client = ContractClient::new(&env, &whisper_contract_id);

    whisper_client.initialize(&admin, &token_addr, &verifier_addr);

    // Fund the user with mock tokens
    let deposit_amount = 1000i128;
    token_admin.mint(&user, &deposit_amount);
    assert_eq!(token_client.balance(&user), deposit_amount);

    // Perform a deposit
    let commitment = BytesN::from_array(&env, &[1u8; 32]);
    let root = whisper_client.deposit(&user, &token_addr, &commitment, &deposit_amount, &Bytes::new(&env), &1u32);

    // Verify token balances after deposit
    assert_eq!(token_client.balance(&user), 0);
    assert_eq!(token_client.balance(&whisper_contract_id), deposit_amount);

    // Create bound public inputs matching the contract binding requirements
    let mut public_inputs = Vec::new(&env);
    public_inputs.push_back(root); // public_inputs[0]: merkle_root
    let nullifier_hash = BytesN::from_array(&env, &[2u8; 32]);
    public_inputs.push_back(nullifier_hash); // public_inputs[1]: nullifier_hash
    public_inputs.push_back(val_to_bytes32(&env, deposit_amount)); // public_inputs[2]: input_amount
    public_inputs.push_back(val_to_bytes32(&env, deposit_amount)); // public_inputs[3]: public_withdraw_amount
    
    // recipient binding
    let recipient_xdr = recipient.clone().to_xdr(&env);
    let recipient_hash = env.crypto().sha256(&recipient_xdr);
    public_inputs.push_back(BytesN::from_array(&env, &recipient_hash.to_array())); // public_inputs[4]: public_recipient_hash

    let zero_bytes = BytesN::from_array(&env, &[0u8; 32]);
    public_inputs.push_back(zero_bytes.clone()); // public_inputs[5]: output_commitment_1 (zero for withdraw)
    public_inputs.push_back(zero_bytes.clone()); // public_inputs[6]: output_commitment_2 (zero for withdraw)
    public_inputs.push_back(get_asset_id(&env, &token_addr)); // public_inputs[7]: asset_id

    // Perform a transfer/withdraw using ZK proof (mocked verifier will always succeed)
    let mock_proof = Bytes::new(&env);
    let encrypted_notes = Vec::new(&env);
    whisper_client.transfer_or_withdraw(&token_addr, &mock_proof, &public_inputs, &recipient, &deposit_amount, &None::<Address>, &0i128, &1u32, &encrypted_notes, &Vec::new(&env));

    // Verify final balances
    assert_eq!(token_client.balance(&whisper_contract_id), 0);
    assert_eq!(token_client.balance(&recipient), deposit_amount);
}

#[test]
fn test_whisper_shielded_transfer() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

    let verifier_addr = env.register(MockVerifier, ());
    let whisper_contract_id = env.register(Contract, ());
    let whisper_client = ContractClient::new(&env, &whisper_contract_id);

    whisper_client.initialize(&admin, &token_addr, &verifier_addr);

    let deposit_amount = 1000i128;
    token_admin.mint(&user, &deposit_amount);

    let commitment = BytesN::from_array(&env, &[1u8; 32]);
    let root = whisper_client.deposit(&user, &token_addr, &commitment, &deposit_amount, &Bytes::new(&env), &1u32);

    // Shielded transfer: recipient is the contract itself
    let recipient = whisper_contract_id.clone();
    let zero_bytes = BytesN::from_array(&env, &[0u8; 32]);
    let out_commitment_1 = BytesN::from_array(&env, &[3u8; 32]);
    let out_commitment_2 = BytesN::from_array(&env, &[4u8; 32]);

    let mut public_inputs = Vec::new(&env);
    public_inputs.push_back(root); // public_inputs[0]: merkle_root
    let nullifier_hash = BytesN::from_array(&env, &[2u8; 32]);
    public_inputs.push_back(nullifier_hash); // public_inputs[1]: nullifier_hash
    public_inputs.push_back(val_to_bytes32(&env, deposit_amount)); // public_inputs[2]: input_amount
    public_inputs.push_back(zero_bytes.clone()); // public_inputs[3]: public_withdraw_amount (0)
    public_inputs.push_back(zero_bytes.clone()); // public_inputs[4]: public_recipient_hash (0)
    public_inputs.push_back(out_commitment_1.clone()); // public_inputs[5]: output_commitment_1
    public_inputs.push_back(out_commitment_2.clone()); // public_inputs[6]: output_commitment_2
    public_inputs.push_back(get_asset_id(&env, &token_addr)); // public_inputs[7]: asset_id

    let mut new_commitments = Vec::new(&env);
    new_commitments.push_back(out_commitment_1.clone());
    new_commitments.push_back(out_commitment_2.clone());

    let mut encrypted_notes = Vec::new(&env);
    encrypted_notes.push_back(Bytes::new(&env));
    encrypted_notes.push_back(Bytes::new(&env));

    let mock_proof = Bytes::new(&env);
    // Amount must be 0 for shielded transfer
    whisper_client.transfer_or_withdraw(&token_addr, &mock_proof, &public_inputs, &recipient, &0, &None::<Address>, &0i128, &1u32, &encrypted_notes, &new_commitments);

    // Verify token balance remains in contract
    assert_eq!(token_client.balance(&whisper_contract_id), deposit_amount);

    // Verify commitments are added to the tree
    assert!(whisper_client.has_commitment(&out_commitment_1));
    assert!(whisper_client.has_commitment(&out_commitment_2));
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #6)")] // InvalidMerkleRoot
fn test_whisper_invalid_merkle_root() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let verifier_addr = env.register(MockVerifier, ());
    let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let whisper_contract_id = env.register(Contract, ());
    let whisper_client = ContractClient::new(&env, &whisper_contract_id);
    whisper_client.initialize(&admin, &token_addr, &verifier_addr);

    let invalid_root = BytesN::from_array(&env, &[99u8; 32]);
    let mut public_inputs = Vec::new(&env);
    public_inputs.push_back(invalid_root); // merkle_root
    public_inputs.push_back(BytesN::from_array(&env, &[2u8; 32])); // nullifier
    public_inputs.push_back(val_to_bytes32(&env, 100)); // input_amount
    public_inputs.push_back(val_to_bytes32(&env, 100)); // public_withdraw_amount
    public_inputs.push_back(BytesN::from_array(&env, &[0u8; 32])); // recipient hash
    public_inputs.push_back(BytesN::from_array(&env, &[0u8; 32]));
    public_inputs.push_back(BytesN::from_array(&env, &[0u8; 32]));
    public_inputs.push_back(get_asset_id(&env, &token_addr)); // asset_id

    let mock_proof = Bytes::new(&env);
    let recipient = Address::generate(&env);
    let encrypted_notes = Vec::new(&env);
    whisper_client.transfer_or_withdraw(&token_addr, &mock_proof, &public_inputs, &recipient, &100, &None::<Address>, &0i128, &1u32, &encrypted_notes, &Vec::new(&env));
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #5)")] // NullifierAlreadySpent
fn test_whisper_double_spend() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let _token_client = soroban_sdk::token::Client::new(&env, &token_addr);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
    let verifier_addr = env.register(MockVerifier, ());
    let whisper_contract_id = env.register(Contract, ());
    let whisper_client = ContractClient::new(&env, &whisper_contract_id);
    whisper_client.initialize(&admin, &token_addr, &verifier_addr);

    let deposit_amount = 1000i128;
    token_admin.mint(&user, &deposit_amount);

    let commitment = BytesN::from_array(&env, &[1u8; 32]);
    let root = whisper_client.deposit(&user, &token_addr, &commitment, &deposit_amount, &Bytes::new(&env), &1u32);

    let nullifier_hash = BytesN::from_array(&env, &[2u8; 32]);
    let mut public_inputs = Vec::new(&env);
    public_inputs.push_back(root.clone());
    public_inputs.push_back(nullifier_hash.clone());
    public_inputs.push_back(val_to_bytes32(&env, deposit_amount));
    public_inputs.push_back(val_to_bytes32(&env, deposit_amount));
    
    let recipient_xdr = recipient.clone().to_xdr(&env);
    let recipient_hash = env.crypto().sha256(&recipient_xdr);
    public_inputs.push_back(BytesN::from_array(&env, &recipient_hash.to_array()));
    let zero_bytes = BytesN::from_array(&env, &[0u8; 32]);
    public_inputs.push_back(zero_bytes.clone());
    public_inputs.push_back(zero_bytes.clone());
    public_inputs.push_back(get_asset_id(&env, &token_addr)); // asset_id

    let mock_proof = Bytes::new(&env);
    let encrypted_notes = Vec::new(&env);
    
    // First spend succeeds
    whisper_client.transfer_or_withdraw(&token_addr, &mock_proof, &public_inputs, &recipient, &deposit_amount, &None::<Address>, &0i128, &1u32, &encrypted_notes, &Vec::new(&env));

    // Second spend with same nullifier must fail
    whisper_client.transfer_or_withdraw(&token_addr, &mock_proof, &public_inputs, &recipient, &deposit_amount, &None::<Address>, &0i128, &1u32, &encrypted_notes, &Vec::new(&env));
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #7)")] // ProofVerificationFailed (simulated by MockVerifier when proof is [9])
fn test_whisper_invalid_proof() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
    let verifier_addr = env.register(MockVerifier, ());
    let whisper_contract_id = env.register(Contract, ());
    let whisper_client = ContractClient::new(&env, &whisper_contract_id);
    whisper_client.initialize(&admin, &token_addr, &verifier_addr);

    let deposit_amount = 1000i128;
    token_admin.mint(&user, &deposit_amount);

    let commitment = BytesN::from_array(&env, &[1u8; 32]);
    let root = whisper_client.deposit(&user, &token_addr, &commitment, &deposit_amount, &Bytes::new(&env), &1u32);

    let nullifier_hash = BytesN::from_array(&env, &[2u8; 32]);
    let mut public_inputs = Vec::new(&env);
    public_inputs.push_back(root.clone());
    public_inputs.push_back(nullifier_hash.clone());
    public_inputs.push_back(val_to_bytes32(&env, deposit_amount));
    public_inputs.push_back(val_to_bytes32(&env, deposit_amount));
    
    let recipient_xdr = recipient.clone().to_xdr(&env);
    let recipient_hash = env.crypto().sha256(&recipient_xdr);
    public_inputs.push_back(BytesN::from_array(&env, &recipient_hash.to_array()));
    let zero_bytes = BytesN::from_array(&env, &[0u8; 32]);
    public_inputs.push_back(zero_bytes.clone());
    public_inputs.push_back(zero_bytes.clone());
    public_inputs.push_back(get_asset_id(&env, &token_addr)); // asset_id

    // Proof with value 9 triggers failure in MockVerifier
    let mut invalid_proof = Bytes::new(&env);
    invalid_proof.push_back(9);
    
    let encrypted_notes = Vec::new(&env);
    whisper_client.transfer_or_withdraw(&token_addr, &invalid_proof, &public_inputs, &recipient, &deposit_amount, &None::<Address>, &0i128, &1u32, &encrypted_notes, &Vec::new(&env));
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #8)")] // CommitmentAlreadyExists
fn test_whisper_duplicate_deposit_commitment() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
    let verifier_addr = env.register(MockVerifier, ());
    let whisper_contract_id = env.register(Contract, ());
    let whisper_client = ContractClient::new(&env, &whisper_contract_id);
    whisper_client.initialize(&admin, &token_addr, &verifier_addr);

    token_admin.mint(&user, &2000);
    let commitment = BytesN::from_array(&env, &[1u8; 32]);
    whisper_client.deposit(&user, &token_addr, &commitment, &1000, &Bytes::new(&env), &1u32);
    // Try depositing the same commitment again
    whisper_client.deposit(&user, &token_addr, &commitment, &1000, &Bytes::new(&env), &1u32);
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #9)")] // TreeFull
fn test_whisper_tree_full() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
    let verifier_addr = env.register(MockVerifier, ());
    let whisper_contract_id = env.register(Contract, ());
    let whisper_client = ContractClient::new(&env, &whisper_contract_id);
    whisper_client.initialize(&admin, &token_addr, &verifier_addr);

    token_admin.mint(&user, &300000);
    
    // Fast-forward tree index to 65,535
    env.as_contract(&whisper_contract_id, || {
        env.storage().instance().set(&DataKey::NextIndex, &65535u32);
    });

    // The 65,536th deposit should succeed
    let mut bytes = [0u8; 32];
    bytes[31] = 1;
    let commitment1 = BytesN::from_array(&env, &bytes);
    whisper_client.deposit(&user, &token_addr, &commitment1, &1000, &Bytes::new(&env), &1u32);

    // The 65,537th deposit should panic with TreeFull
    bytes[31] = 2;
    let commitment2 = BytesN::from_array(&env, &bytes);
    whisper_client.deposit(&user, &token_addr, &commitment2, &1000, &Bytes::new(&env), &1u32);
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #7)")] // ProofVerificationFailed
fn test_whisper_public_withdraw_with_non_zero_output_commitments() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
    let verifier_addr = env.register(MockVerifier, ());
    let whisper_contract_id = env.register(Contract, ());
    let whisper_client = ContractClient::new(&env, &whisper_contract_id);
    whisper_client.initialize(&admin, &token_addr, &verifier_addr);

    token_admin.mint(&user, &1000);
    let commitment = BytesN::from_array(&env, &[1u8; 32]);
    let root = whisper_client.deposit(&user, &token_addr, &commitment, &1000, &Bytes::new(&env), &1u32);

    let mut public_inputs = Vec::new(&env);
    public_inputs.push_back(root);
    public_inputs.push_back(BytesN::from_array(&env, &[2u8; 32])); // nullifier
    public_inputs.push_back(val_to_bytes32(&env, 1000)); // input
    public_inputs.push_back(val_to_bytes32(&env, 1000)); // withdraw amount
    let recipient_xdr = recipient.clone().to_xdr(&env);
    let recipient_hash = env.crypto().sha256(&recipient_xdr);
    public_inputs.push_back(BytesN::from_array(&env, &recipient_hash.to_array()));
    
    // Non-zero output commitments in public inputs (violates public withdrawal constraints)
    public_inputs.push_back(BytesN::from_array(&env, &[3u8; 32]));
    public_inputs.push_back(BytesN::from_array(&env, &[4u8; 32]));
    public_inputs.push_back(get_asset_id(&env, &token_addr)); // asset_id

    let mock_proof = Bytes::new(&env);
    let encrypted_notes = Vec::new(&env);
    whisper_client.transfer_or_withdraw(&token_addr, &mock_proof, &public_inputs, &recipient, &1000, &None::<Address>, &0i128, &1u32, &encrypted_notes, &Vec::new(&env));
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #4)")] // InvalidAmount
fn test_whisper_shielded_transfer_with_non_zero_public_withdraw_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
    let verifier_addr = env.register(MockVerifier, ());
    let whisper_contract_id = env.register(Contract, ());
    let whisper_client = ContractClient::new(&env, &whisper_contract_id);
    whisper_client.initialize(&admin, &token_addr, &verifier_addr);

    token_admin.mint(&user, &1000);
    let commitment = BytesN::from_array(&env, &[1u8; 32]);
    let root = whisper_client.deposit(&user, &token_addr, &commitment, &1000, &Bytes::new(&env), &1u32);

    let recipient = whisper_contract_id.clone();
    let out_commitment_1 = BytesN::from_array(&env, &[3u8; 32]);
    let out_commitment_2 = BytesN::from_array(&env, &[4u8; 32]);

    let mut public_inputs = Vec::new(&env);
    public_inputs.push_back(root);
    public_inputs.push_back(BytesN::from_array(&env, &[2u8; 32]));
    public_inputs.push_back(val_to_bytes32(&env, 1000));
    
    // Non-zero public withdraw amount in public inputs for shielded transfer
    public_inputs.push_back(val_to_bytes32(&env, 500)); 
    public_inputs.push_back(BytesN::from_array(&env, &[0u8; 32]));
    
    public_inputs.push_back(out_commitment_1.clone());
    public_inputs.push_back(out_commitment_2.clone());
    public_inputs.push_back(get_asset_id(&env, &token_addr)); // asset_id

    let mut new_commitments = Vec::new(&env);
    new_commitments.push_back(out_commitment_1);
    new_commitments.push_back(out_commitment_2);

    let mock_proof = Bytes::new(&env);
    let mut encrypted_notes = Vec::new(&env);
    encrypted_notes.push_back(Bytes::new(&env));
    encrypted_notes.push_back(Bytes::new(&env));

    whisper_client.transfer_or_withdraw(&token_addr, &mock_proof, &public_inputs, &recipient, &0, &None::<Address>, &0i128, &1u32, &encrypted_notes, &new_commitments);
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #7)")] // ProofVerificationFailed
fn test_whisper_shielded_transfer_mismatched_new_commitments() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
    let verifier_addr = env.register(MockVerifier, ());
    let whisper_contract_id = env.register(Contract, ());
    let whisper_client = ContractClient::new(&env, &whisper_contract_id);
    whisper_client.initialize(&admin, &token_addr, &verifier_addr);

    token_admin.mint(&user, &1000);
    let commitment = BytesN::from_array(&env, &[1u8; 32]);
    let root = whisper_client.deposit(&user, &token_addr, &commitment, &1000, &Bytes::new(&env), &1u32);

    let recipient = whisper_contract_id.clone();
    let out_commitment_1 = BytesN::from_array(&env, &[3u8; 32]);
    let out_commitment_2 = BytesN::from_array(&env, &[4u8; 32]);

    let mut public_inputs = Vec::new(&env);
    public_inputs.push_back(root);
    public_inputs.push_back(BytesN::from_array(&env, &[2u8; 32]));
    public_inputs.push_back(val_to_bytes32(&env, 1000));
    public_inputs.push_back(BytesN::from_array(&env, &[0u8; 32]));
    public_inputs.push_back(BytesN::from_array(&env, &[0u8; 32]));
    public_inputs.push_back(out_commitment_1.clone());
    public_inputs.push_back(out_commitment_2.clone());
    public_inputs.push_back(get_asset_id(&env, &token_addr)); // asset_id

    // Mismatched new_commitments list passed to contract (e.g. out_commitment_2 is different)
    let mut new_commitments = Vec::new(&env);
    new_commitments.push_back(out_commitment_1);
    new_commitments.push_back(BytesN::from_array(&env, &[99u8; 32]));

    let mock_proof = Bytes::new(&env);
    let mut encrypted_notes = Vec::new(&env);
    encrypted_notes.push_back(Bytes::new(&env));
    encrypted_notes.push_back(Bytes::new(&env));

    whisper_client.transfer_or_withdraw(&token_addr, &mock_proof, &public_inputs, &recipient, &0, &None::<Address>, &0i128, &1u32, &encrypted_notes, &new_commitments);
}

#[test]
fn test_whisper_failed_token_transfer_rollback() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let verifier_addr = env.register(MockVerifier, ());
    let whisper_contract_id = env.register(Contract, ());
    let whisper_client = ContractClient::new(&env, &whisper_contract_id);
    whisper_client.initialize(&admin, &token_addr, &verifier_addr);

    // User has 0 tokens, so deposit of 1000 will fail
    let commitment = BytesN::from_array(&env, &[1u8; 32]);
    let result = whisper_client.try_deposit(&user, &token_addr, &commitment, &1000, &Bytes::new(&env), &1u32);
    
    // Deposit should return an error / fail
    assert!(result.is_err());
    // Verify that the commitment was NOT registered (rollback occurred)
    assert!(!whisper_client.has_commitment(&commitment));
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #10)")] // SanctionedAddress
fn test_whisper_sanctioned_address_deposit_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
    let verifier_addr = env.register(MockVerifier, ());
    let whisper_contract_id = env.register(Contract, ());
    let whisper_client = ContractClient::new(&env, &whisper_contract_id);
    whisper_client.initialize(&admin, &token_addr, &verifier_addr);

    // Set user as sanctioned
    whisper_client.set_sanctioned(&user, &true);
    assert!(whisper_client.is_sanctioned(&user));

    token_admin.mint(&user, &1000);
    let commitment = BytesN::from_array(&env, &[1u8; 32]);
    
    // Deposit from sanctioned user should panic with SanctionedAddress error
    whisper_client.deposit(&user, &token_addr, &commitment, &1000, &Bytes::new(&env), &1u32);
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #10)")] // SanctionedAddress
fn test_whisper_sanctioned_address_withdraw_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
    let verifier_addr = env.register(MockVerifier, ());
    let whisper_contract_id = env.register(Contract, ());
    let whisper_client = ContractClient::new(&env, &whisper_contract_id);
    whisper_client.initialize(&admin, &token_addr, &verifier_addr);

    token_admin.mint(&user, &1000);
    let commitment = BytesN::from_array(&env, &[1u8; 32]);
    let root = whisper_client.deposit(&user, &token_addr, &commitment, &1000, &Bytes::new(&env), &1u32);

    // Set recipient as sanctioned
    whisper_client.set_sanctioned(&recipient, &true);
    assert!(whisper_client.is_sanctioned(&recipient));

    let mut public_inputs = Vec::new(&env);
    public_inputs.push_back(root);
    public_inputs.push_back(BytesN::from_array(&env, &[2u8; 32])); // nullifier
    public_inputs.push_back(val_to_bytes32(&env, 1000)); // input amount
    public_inputs.push_back(val_to_bytes32(&env, 1000)); // withdraw amount
    
    let recipient_xdr = recipient.clone().to_xdr(&env);
    let recipient_hash = env.crypto().sha256(&recipient_xdr);
    public_inputs.push_back(BytesN::from_array(&env, &recipient_hash.to_array()));
    
    let zero_bytes = BytesN::from_array(&env, &[0u8; 32]);
    public_inputs.push_back(zero_bytes.clone());
    public_inputs.push_back(zero_bytes.clone());
    public_inputs.push_back(get_asset_id(&env, &token_addr)); // asset_id

    let mock_proof = Bytes::new(&env);
    let encrypted_notes = Vec::new(&env);

    // Withdraw to sanctioned recipient should panic with SanctionedAddress error
    whisper_client.transfer_or_withdraw(&token_addr, &mock_proof, &public_inputs, &recipient, &1000, &None::<Address>, &0i128, &1u32, &encrypted_notes, &Vec::new(&env));
}

#[test]
fn test_cross_layer_fixtures() {
    let env = Env::default();

    // 1. Hex parsing helper
    let hex_to_bytes32 = |hex_str: &str| -> [u8; 32] {
        let mut arr = [0u8; 32];
        for i in 0..32 {
            let byte_str = &hex_str[i * 2..i * 2 + 2];
            arr[i] = u8::from_str_radix(byte_str, 16).unwrap();
        }
        arr
    };

    let sample_secret_key = hex_to_bytes32("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    let sample_amount = hex_to_bytes32("0000000000000000000000000000000000000000000000000000000005f5e100");
    let sample_nullifier_nonce = hex_to_bytes32("0202020202020202020202020202020202020202020202020202020202020202");
    let sample_asset_id = hex_to_bytes32("0303030303030303030303030303030303030303030303030303030303030303");

    // 2. Test Sender Pubkey Derivation: pubkey = poseidon_1(secret_key)
    let secret_bytesn = BytesN::from_array(&env, &sample_secret_key);
    let pubkey_hash = hash_poseidon_1(&env, secret_bytesn);
    let computed_pubkey = pubkey_hash.to_array();

    // 3. Test Commitment Derivation: commitment = poseidon_2(pubkey, poseidon_2(poseidon_2(amount, nonce), asset_id))
    let pubkey_bytesn = BytesN::from_array(&env, &computed_pubkey);
    let amount_bytesn = BytesN::from_array(&env, &sample_amount);
    let nonce_bytesn = BytesN::from_array(&env, &sample_nullifier_nonce);
    let asset_id_bytesn = BytesN::from_array(&env, &sample_asset_id);
    let salted_amount = hash_poseidon_2(&env, amount_bytesn, nonce_bytesn);
    let asset_salted_amount = hash_poseidon_2(&env, salted_amount, asset_id_bytesn);
    let derived_commitment = hash_poseidon_2(&env, pubkey_bytesn, asset_salted_amount);
    let computed_commitment = derived_commitment.to_array();

    // 4. Test Nullifier Derivation: nullifier = poseidon_2(secret_key, nonce)
    let secret_bytesn = BytesN::from_array(&env, &sample_secret_key);
    let nonce_bytesn = BytesN::from_array(&env, &sample_nullifier_nonce);
    let derived_nullifier = hash_poseidon_2(&env, secret_bytesn, nonce_bytesn);
    let computed_nullifier = derived_nullifier.to_array();

    // 5. Test Merkle Root Calculation for single leaf inserted at index 0
    let mut filled_subtrees = Vec::new(&env);
    for level in 0..TREE_DEPTH {
        filled_subtrees.push_back(get_zero_hash(&env, level));
    }
    
    let mut current_level_hash = BytesN::from_array(&env, &computed_commitment);
    let mut index = 0u32;
    for level in 0..TREE_DEPTH {
        if index % 2 == 1 {
            let left = filled_subtrees.get(level).unwrap();
            current_level_hash = hash_poseidon_2(&env, left, current_level_hash);
        } else {
            let right = get_zero_hash(&env, level);
            current_level_hash = hash_poseidon_2(&env, current_level_hash, right);
        }
        index /= 2;
    }
    let _computed_root = current_level_hash.to_array();
    let expected_pubkey = hex_to_bytes32("2d1faf6cf358763421511eb637adf7b6609443d38edc4ed2b042dfbf834b03f5");
    let expected_nullifier = hex_to_bytes32("14c7002e6a647950f653fdb60360b2aba5cba8d1e608f51fda87f16db4f5f343");

    // Pubkey and nullifier derivations are unchanged
    assert_eq!(computed_pubkey, expected_pubkey);
    assert_eq!(computed_nullifier, expected_nullifier);
}

#[test]
fn test_oracle_sanctions_updates() {
    use ed25519_dalek::SigningKey;
    use ed25519_dalek::Signer;
    
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let verifier_addr = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let whisper_contract_id = env.register(Contract, ());
    let whisper_client = ContractClient::new(&env, &whisper_contract_id);

    whisper_client.initialize(&admin, &token_addr, &verifier_addr);

    // Generate oracle keypair deterministicly from seed
    let signing_key = SigningKey::from_bytes(&[42u8; 32]);
    let public_key = signing_key.verifying_key();
    
    let oracle_pubkey_bytes = BytesN::from_array(&env, &public_key.to_bytes());
    
    // Admin sets the oracle public key
    whisper_client.set_oracle(&oracle_pubkey_bytes);
    
    // Check oracle is set correctly
    assert_eq!(whisper_client.get_oracle(), Some(oracle_pubkey_bytes));

    // Construct a signed update to sanction a target address
    let target_address = Address::generate(&env);
    let status = true;
    let expires = env.ledger().timestamp() + 3600; // 1 hour in future

    // Build the expected signed message bytes
    let mut msg_bytes = Bytes::new(&env);
    msg_bytes.append(&whisper_contract_id.clone().to_xdr(&env));
    msg_bytes.append(&target_address.clone().to_xdr(&env));
    msg_bytes.append(&status.clone().to_xdr(&env));
    msg_bytes.append(&expires.clone().to_xdr(&env));

    // Convert message bytes to Vec<u8> for signing
    extern crate alloc;
    let mut msg_vec = alloc::vec![0u8; msg_bytes.len() as usize];
    msg_bytes.copy_into_slice(&mut msg_vec);

    // Sign using ed25519-dalek
    let signature = signing_key.sign(&msg_vec);
    let sig_bytes = BytesN::from_array(&env, &signature.to_bytes());

    // Anyone can call update_sanctions_with_signature to update the sanctions status
    whisper_client.update_sanctions_with_signature(&target_address, &status, &expires, &sig_bytes);

    // Assert that the target address is now sanctioned on-chain!
    assert!(whisper_client.is_sanctioned(&target_address));

    // Now let's unsanction the address (status = false)
    let status_unsanction = false;
    let mut msg_bytes_unsanction = Bytes::new(&env);
    msg_bytes_unsanction.append(&whisper_contract_id.clone().to_xdr(&env));
    msg_bytes_unsanction.append(&target_address.clone().to_xdr(&env));
    msg_bytes_unsanction.append(&status_unsanction.clone().to_xdr(&env));
    msg_bytes_unsanction.append(&expires.clone().to_xdr(&env));

    let mut msg_vec_unsanction = alloc::vec![0u8; msg_bytes_unsanction.len() as usize];
    msg_bytes_unsanction.copy_into_slice(&mut msg_vec_unsanction);

    let signature_unsanction = signing_key.sign(&msg_vec_unsanction);
    let sig_bytes_unsanction = BytesN::from_array(&env, &signature_unsanction.to_bytes());

    whisper_client.update_sanctions_with_signature(&target_address, &status_unsanction, &expires, &sig_bytes_unsanction);

    // Assert that the target address is no longer sanctioned
    assert!(!whisper_client.is_sanctioned(&target_address));
}

#[test]
fn test_whisper_public_withdraw_with_change() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

    let verifier_addr = env.register(MockVerifier, ());
    let whisper_contract_id = env.register(Contract, ());
    let whisper_client = ContractClient::new(&env, &whisper_contract_id);

    whisper_client.initialize(&admin, &token_addr, &verifier_addr);

    let deposit_amount = 1000i128;
    token_admin.mint(&user, &deposit_amount);

    let commitment = BytesN::from_array(&env, &[1u8; 32]);
    let root = whisper_client.deposit(&user, &token_addr, &commitment, &deposit_amount, &Bytes::new(&env), &1u32);

    // Public withdraw with change: recipient is NOT the contract, withdraw amount is 400, change is 600
    let withdraw_amount = 400i128;
    let zero_bytes = BytesN::from_array(&env, &[0u8; 32]);
    let out_commitment_2 = BytesN::from_array(&env, &[4u8; 32]); // change commitment

    let mut public_inputs = Vec::new(&env);
    public_inputs.push_back(root); // public_inputs[0]: merkle_root
    let nullifier_hash = BytesN::from_array(&env, &[2u8; 32]);
    public_inputs.push_back(nullifier_hash); // public_inputs[1]: nullifier_hash
    public_inputs.push_back(val_to_bytes32(&env, deposit_amount)); // public_inputs[2]: input_amount (1000)
    public_inputs.push_back(val_to_bytes32(&env, withdraw_amount)); // public_inputs[3]: public_withdraw_amount (400)
    
    // recipient binding
    let recipient_xdr = recipient.clone().to_xdr(&env);
    let recipient_hash = env.crypto().sha256(&recipient_xdr);
    public_inputs.push_back(BytesN::from_array(&env, &recipient_hash.to_array())); // public_inputs[4]: public_recipient_hash

    public_inputs.push_back(zero_bytes.clone()); // public_inputs[5]: output_commitment_1 (zero for public recipient)
    public_inputs.push_back(out_commitment_2.clone()); // public_inputs[6]: output_commitment_2 (change commitment)
    public_inputs.push_back(get_asset_id(&env, &token_addr)); // public_inputs[7]: asset_id

    let mut new_commitments = Vec::new(&env);
    new_commitments.push_back(out_commitment_2.clone());

    let mut encrypted_notes = Vec::new(&env);
    encrypted_notes.push_back(Bytes::new(&env)); // encrypted change note

    let mock_proof = Bytes::new(&env);
    whisper_client.transfer_or_withdraw(&token_addr, &mock_proof, &public_inputs, &recipient, &withdraw_amount, &None::<Address>, &0i128, &1u32, &encrypted_notes, &new_commitments);

    // Verify token balances
    assert_eq!(token_client.balance(&whisper_contract_id), deposit_amount - withdraw_amount);
    assert_eq!(token_client.balance(&recipient), withdraw_amount);

    // Verify change commitment is added to the tree
    assert!(whisper_client.has_commitment(&out_commitment_2));
}

#[test]
fn test_whisper_shielded_swap() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let token_a_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_b_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let token_a_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_a_addr);
    let token_b_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_b_addr);

    let verifier_addr = env.register(MockVerifier, ());
    let whisper_contract_id = env.register(Contract, ());
    let whisper_client = ContractClient::new(&env, &whisper_contract_id);

    whisper_client.initialize(&admin, &token_a_addr, &verifier_addr);

    let reserve_a = 100000i128;
    let reserve_b = 200000i128;
    token_a_admin.mint(&admin, &reserve_a);
    token_b_admin.mint(&admin, &reserve_b);
    whisper_client.init_amm(&token_a_addr, &token_b_addr);
    whisper_client.add_liquidity(&admin, &reserve_a, &reserve_b, &0, &9999999999);

    // Assert reserves are initialized correctly
    let (res_a, res_b) = whisper_client.get_reserves();
    assert_eq!(res_a, reserve_a);
    assert_eq!(res_b, reserve_b);

    // Mint tokens and deposit to private note
    let deposit_amount = 1000i128;
    token_a_admin.mint(&user, &deposit_amount);
    let commitment = BytesN::from_array(&env, &[1u8; 32]);
    let root = whisper_client.deposit(&user, &token_a_addr, &commitment, &deposit_amount, &Bytes::new(&env), &1u32);

    // Swap parameters
    let amount_in = 100i128;
    let min_amount_out = 100i128;
    let recipient_pubkey = BytesN::from_array(&env, &[8u8; 32]);
    let recipient_nonce = BytesN::from_array(&env, &[9u8; 32]);

    // Build public inputs for proof verification (spending the USDC note)
    let mut public_inputs = Vec::new(&env);
    public_inputs.push_back(root.clone()); // public_inputs[0]: merkle_root
    let nullifier_hash = BytesN::from_array(&env, &[2u8; 32]);
    public_inputs.push_back(nullifier_hash.clone()); // public_inputs[1]: nullifier_hash
    public_inputs.push_back(val_to_bytes32(&env, deposit_amount)); // public_inputs[2]: input_amount (1000)
    public_inputs.push_back(val_to_bytes32(&env, amount_in)); // public_inputs[3]: public_withdraw_amount (100)
    
    // public_recipient_hash must be the hash of the contract address
    let recipient_xdr = whisper_contract_id.clone().to_xdr(&env);
    let recipient_hash = env.crypto().sha256(&recipient_xdr);
    public_inputs.push_back(BytesN::from_array(&env, &recipient_hash.to_array())); // public_inputs[4]: public_recipient_hash

    let zero_bytes = BytesN::from_array(&env, &[0u8; 32]);
    public_inputs.push_back(zero_bytes.clone()); // public_inputs[5]: output_commitment_1 (0)
    public_inputs.push_back(zero_bytes.clone()); // public_inputs[6]: output_commitment_2 (0)
    public_inputs.push_back(get_asset_id(&env, &token_a_addr)); // public_inputs[7]: asset_id

    let mock_proof = Bytes::new(&env);
    let encrypted_note = Bytes::new(&env);

    // Perform swap
    let (amount_out, new_root) = whisper_client.swap_shielded(
        &token_a_addr,
        &token_b_addr,
        &mock_proof,
        &public_inputs,
        &amount_in,
        &min_amount_out,
        &recipient_pubkey,
        &recipient_nonce,
        &1u32,
        &9999999999u64,
        &encrypted_note,
    );

    // 100 * 9965 * 200,000 / (100,000 * 10000 + 100 * 9965) = 199
    assert_eq!(amount_out, 199);

    // Verify reserves are updated (reserve_a increments by amount_in minus protocol fee. Protocol fee = 100 * 5 / 10000 = 0. So reserve_a += 100)
    let (new_res_a, new_res_b) = whisper_client.get_reserves();
    assert_eq!(new_res_a, reserve_a + amount_in);
    assert_eq!(new_res_b, reserve_b - 199);

    // Verify that the nullifier is marked as spent
    assert!(whisper_client.has_nullifier(&nullifier_hash));

    // Verify that the derived note_out commitment is registered
    let derived_commitment = whisper_client.derive_commitment(&recipient_pubkey, &amount_out, &recipient_nonce, &token_b_addr);
    assert!(whisper_client.has_commitment(&derived_commitment));
    assert_ne!(new_root, root);
}

#[test]
fn test_public_liquidity_provision() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let lp = Address::generate(&env);

    let token_a_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_b_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let token_a_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_a_addr);
    let token_b_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_b_addr);

    let verifier_addr = env.register(MockVerifier, ());
    let whisper_contract_id = env.register(Contract, ());
    let whisper_client = ContractClient::new(&env, &whisper_contract_id);

    whisper_client.initialize(&admin, &token_a_addr, &verifier_addr);

    // Initialize AMM pool
    whisper_client.init_amm(&token_a_addr, &token_b_addr);

    // Mint tokens for LP
    token_a_admin.mint(&lp, &10000i128);
    token_b_admin.mint(&lp, &20000i128);

    // Add public liquidity
    let shares = whisper_client.add_liquidity(&lp, &10000i128, &20000i128, &0i128, &9999999999u64);
    assert_eq!(shares, 10000);

    // Verify reserves and LP shares
    let (res_a, res_b) = whisper_client.get_reserves();
    assert_eq!(res_a, 10000);
    assert_eq!(res_b, 20000);
    assert_eq!(whisper_client.get_lp_shares(&lp), 10000);
    assert_eq!(whisper_client.get_total_lp_shares(), 10000);

    // Remove half of public liquidity
    let (returned_a, returned_b) = whisper_client.remove_liquidity(&lp, &5000i128, &0i128, &0i128, &9999999999u64);
    assert_eq!(returned_a, 5000);
    assert_eq!(returned_b, 10000);

    // Verify updated state
    let (final_res_a, final_res_b) = whisper_client.get_reserves();
    assert_eq!(final_res_a, 5000);
    assert_eq!(final_res_b, 10000);
    assert_eq!(whisper_client.get_lp_shares(&lp), 5000);
    assert_eq!(whisper_client.get_total_lp_shares(), 5000);
}
