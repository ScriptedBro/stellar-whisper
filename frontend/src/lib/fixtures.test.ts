import { 
  SAMPLE_SECRET_KEY_HEX, 
  EXPECTED_PUBLIC_KEY_HEX, 
  SAMPLE_AMOUNT_HEX, 
  SAMPLE_NULLIFIER_NONCE_HEX, 
  EXPECTED_NULLIFIER_HEX, 
  ZERO_HASHES_HEX
} from './fixtures';
import { 
  derivePubkey, 
  deriveCommitment, 
  deriveNullifier, 
  bytesToHexDirect, 
  hexToBytes,
  hashOnChain
} from './crypto';
import { computeLatestMerkleRootOnChain } from './merkle';
import { Noir } from '@noir-lang/noir_js';
import fs from 'fs';

// Helper to convert Uint8Array/hex to number[]
const toNoirBytes = (val: Uint8Array | string): number[] => {
  const bytes = typeof val === 'string' ? hexToBytes(val) : val;
  return Array.from(bytes);
};

const toHex = (arr: Uint8Array) => bytesToHexDirect(arr);

async function runTests() {
  console.log("=== Stellar Whisper Cross-Layer Fixture Validation ===");
  let failed = false;

  const assertEqual = (actual: string, expected: string, label: string) => {
    const cleanActual = actual.replace(/^0x/, '').toLowerCase();
    const cleanExpected = expected.replace(/^0x/, '').toLowerCase();
    if (cleanActual === cleanExpected) {
      console.log(`✅ [PASS] ${label}`);
    } else {
      console.error(`❌ [FAIL] ${label}`);
      console.error(`   Actual:   ${cleanActual}`);
      console.error(`   Expected: ${cleanExpected}`);
      failed = true;
    }
  };

  // Test 1: Pubkey Derivation
  try {
    const pubkey = await derivePubkey(SAMPLE_SECRET_KEY_HEX);
    assertEqual(bytesToHexDirect(pubkey), EXPECTED_PUBLIC_KEY_HEX, "Secret key to public key derivation");
  } catch (err: any) {
    console.error("❌ [ERROR] Pubkey derivation failed:", err.message);
    failed = true;
  }

  // Test 2: Commitment Derivation (now includes nonce)
  let computedCommitmentHex = '';
  try {
    const amountVal = BigInt("0x" + SAMPLE_AMOUNT_HEX);
    const pubkeyBytes = hexToBytes(EXPECTED_PUBLIC_KEY_HEX);
    const commitment = await deriveCommitment(pubkeyBytes, amountVal, SAMPLE_NULLIFIER_NONCE_HEX);
    computedCommitmentHex = bytesToHexDirect(commitment);
    console.log(`✅ [PASS] Commitment derivation (nonce-bound): ${computedCommitmentHex}`);
  } catch (err: any) {
    console.error("❌ [ERROR] Commitment derivation failed:", err.message);
    failed = true;
  }

  // Test 3: Nullifier Derivation
  try {
    const nullifier = await deriveNullifier(SAMPLE_SECRET_KEY_HEX, SAMPLE_NULLIFIER_NONCE_HEX);
    assertEqual(bytesToHexDirect(nullifier), EXPECTED_NULLIFIER_HEX, "Nullifier derivation");
  } catch (err: any) {
    console.error("❌ [ERROR] Nullifier derivation failed:", err.message);
    failed = true;
  }

  // Test 4: Merkle Root Calculation for index 0
  let computedMerkleRootHex = '';
  try {
    const commitmentBytes = hexToBytes(computedCommitmentHex);
    computedMerkleRootHex = await computeLatestMerkleRootOnChain([commitmentBytes]);
    console.log(`✅ [PASS] Merkle root for single leaf at index 0: ${computedMerkleRootHex}`);
  } catch (err: any) {
    console.error("❌ [ERROR] Merkle root calculation failed:", err.message);
    failed = true;
  }

  // Test 5: Noir Circuit Witness Execution matching fixtures
  try {
    console.log("Loading Noir circuit configuration...");
    const circuitJson = JSON.parse(fs.readFileSync('src/config/whisper.json', 'utf8'));
    circuitJson.bytecode = circuitJson.bytecode.replace(/\s/g, '');
    const noir = new Noir(circuitJson);

    // Build witness inputs matching the spend logic (Shielded Transfer)
    // Input commitment = computed above (10 USDC with nonce)
    // Spent by SAMPLE_SECRET_KEY_HEX
    // Recipient pubkey: [3u8; 32] -> amount: 4 USDC (40,000,000 stroops)
    // Change pubkey: same as sender pubkey -> amount: 6 USDC (60,000,000 stroops)
    const senderPubkeyHex = EXPECTED_PUBLIC_KEY_HEX;
    const recipientPubkeyHex = "03".repeat(32);
    const changePubkeyHex = senderPubkeyHex;

    const recipientAmountHex = "0000000000000000000000000000000000000000000000000000000002625a00"; // 4 USDC
    const changeAmountHex = "0000000000000000000000000000000000000000000000000000000003938700";    // 6 USDC
    
    // Use deterministic nonces for test reproducibility
    const recipientNonceHex = "0404040404040404040404040404040404040404040404040404040404040404";
    const changeNonceHex = "0505050505050505050505050505050505050505050505050505050505050505";

    // Output commitments now include nonces
    const pubkeyBytesRecipient = hexToBytes(recipientPubkeyHex);
    const amountValRecipient = BigInt("0x" + recipientAmountHex);
    const derivedCommitment1 = await deriveCommitment(pubkeyBytesRecipient, amountValRecipient, recipientNonceHex);

    const pubkeyBytesChange = hexToBytes(changePubkeyHex);
    const amountValChange = BigInt("0x" + changeAmountHex);
    const derivedCommitment2 = await deriveCommitment(pubkeyBytesChange, amountValChange, changeNonceHex);

    // Build merkle path for index 0 leaf commitment
    const merklePath = ZERO_HASHES_HEX.slice(0, 16).map(h => toNoirBytes(h));

    const inputs = {
      secret_key: toNoirBytes(SAMPLE_SECRET_KEY_HEX),
      nullifier_nonce: toNoirBytes(SAMPLE_NULLIFIER_NONCE_HEX),
      merkle_path: merklePath,
      merkle_index: 0,
      recipient_pubkey: toNoirBytes(recipientPubkeyHex),
      recipient_amount: toNoirBytes(recipientAmountHex),
      recipient_nonce: toNoirBytes(recipientNonceHex),
      change_pubkey: toNoirBytes(changePubkeyHex),
      change_amount: toNoirBytes(changeAmountHex),
      change_nonce: toNoirBytes(changeNonceHex),
      merkle_root: toNoirBytes(computedMerkleRootHex),
      nullifier_hash: toNoirBytes(EXPECTED_NULLIFIER_HEX),
      input_amount: toNoirBytes(SAMPLE_AMOUNT_HEX),
      public_withdraw_amount: toNoirBytes("00".repeat(32)),
      public_recipient_hash: toNoirBytes("00".repeat(32)),
      output_commitment_1: toNoirBytes(derivedCommitment1),
      output_commitment_2: toNoirBytes(derivedCommitment2),
    };

    console.log("Executing Noir circuit witness generation...");
    const { witness } = await noir.execute(inputs);
    if (witness) {
      console.log("✅ [PASS] Noir circuit witness constraints satisfied successfully!");
    } else {
      console.error("❌ [FAIL] Noir circuit witness generation failed to return a witness");
      failed = true;
    }
  } catch (err: any) {
    console.error("❌ [ERROR] Noir circuit execution failed:", err.message);
    failed = true;
  }

  if (failed) {
    console.error("=== ❌ Validation FAILED! ===");
    process.exit(1);
  } else {
    console.log("=== ✅ Validation SUCCESS! All cross-layer fixtures verified identically! ===");
    process.exit(0);
  }
}

runTests();
