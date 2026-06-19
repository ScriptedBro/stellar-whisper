#![cfg(test)]

use super::*;
use soroban_sdk::{
    contract, contractimpl, testutils::{Address as _, Ledger}, Address, Bytes, BytesN, Env, Vec
};

#[contract]
pub struct MockVerifier;

#[contractimpl]
impl MockVerifier {
    pub fn verify_proof(_env: Env, _proof: Bytes, _public_inputs: Vec<BytesN<32>>) {
        // Mock success
    }
}

#[test]
fn test_whisper_flow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let recipient = Address::generate(&env);

    // Register Mock Token Contract
    let token_addr = env.register_stellar_asset_contract(admin.clone());
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
    let root = whisper_client.deposit(&user, &commitment, &deposit_amount, &Bytes::new(&env));

    // Verify token balances after deposit
    assert_eq!(token_client.balance(&user), 0);
    assert_eq!(token_client.balance(&whisper_contract_id), deposit_amount);

    // Perform a transfer/withdraw using ZK proof (mocked verifier will always succeed)
    let mock_proof = Bytes::new(&env);
    let mut public_inputs = Vec::new(&env);
    public_inputs.push_back(root); // public_inputs[0]: merkle_root
    let nullifier_hash = BytesN::from_array(&env, &[2u8; 32]);
    public_inputs.push_back(nullifier_hash); // public_inputs[1]: nullifier_hash
    public_inputs.push_back(BytesN::from_array(&env, &[0u8; 32])); // public_inputs[2]: amount dummy
    public_inputs.push_back(BytesN::from_array(&env, &[0u8; 32])); // public_inputs[3]: recipient dummy

    whisper_client.transfer_or_withdraw(&mock_proof, &public_inputs, &recipient, &deposit_amount, &Bytes::new(&env));

    // Verify final balances
    assert_eq!(token_client.balance(&whisper_contract_id), 0);
    assert_eq!(token_client.balance(&recipient), deposit_amount);
}
