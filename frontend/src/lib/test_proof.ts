import { UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import circuitJson from '../config/whisper.json';
import fs from 'fs';
import path from 'path';
import { 
  SAMPLE_SECRET_KEY_HEX, 
  EXPECTED_PUBLIC_KEY_HEX, 
  SAMPLE_AMOUNT_HEX, 
  SAMPLE_NULLIFIER_NONCE_HEX, 
  EXPECTED_NULLIFIER_HEX, 
  ZERO_HASHES_HEX
} from './fixtures';
import { 
  deriveCommitment, 
  hexToBytes
} from './crypto';
import { computeLatestMerkleRootOnChain } from './merkle';

// Helper to convert Uint8Array/hex to number[]
const toNoirBytes = (val: Uint8Array | string): number[] => {
  const bytes = typeof val === 'string' ? hexToBytes(val) : val;
  return Array.from(bytes);
};

async function main() {
  const cleanBytecode = (circuitJson.bytecode as string).replace(/\s/g, '');
  const backend = new UltraHonkBackend(cleanBytecode);
  const noir = new Noir(circuitJson as any);

  const senderPubkeyHex = EXPECTED_PUBLIC_KEY_HEX;
  const recipientPubkeyHex = "03".repeat(32);
  const changePubkeyHex = senderPubkeyHex;

  const recipientAmountHex = "0000000000000000000000000000000000000000000000000000000002625a00"; // 4 USDC
  const changeAmountHex = "0000000000000000000000000000000000000000000000000000000003938700";    // 6 USDC
  
  // Deterministic nonces for output commitments
  const recipientNonceHex = "0404040404040404040404040404040404040404040404040404040404040404";
  const changeNonceHex = "0505050505050505050505050505050505050505050505050505050505050505";

  const pubkeyBytesRecipient = hexToBytes(recipientPubkeyHex);
  const amountValRecipient = BigInt("0x" + recipientAmountHex);
  const derivedCommitment1 = await deriveCommitment(pubkeyBytesRecipient, amountValRecipient, recipientNonceHex);

  const pubkeyBytesChange = hexToBytes(changePubkeyHex);
  const amountValChange = BigInt("0x" + changeAmountHex);
  const derivedCommitment2 = await deriveCommitment(pubkeyBytesChange, amountValChange, changeNonceHex);

  // Compute input commitment and merkle root dynamically
  const pubkeyBytesInput = hexToBytes(EXPECTED_PUBLIC_KEY_HEX);
  const amountValInput = BigInt("0x" + SAMPLE_AMOUNT_HEX);
  const inputCommitment = await deriveCommitment(pubkeyBytesInput, amountValInput, SAMPLE_NULLIFIER_NONCE_HEX);
  const merkleRootHex = await computeLatestMerkleRootOnChain([inputCommitment]);

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
    merkle_root: toNoirBytes(merkleRootHex),
    nullifier_hash: toNoirBytes(EXPECTED_NULLIFIER_HEX),
    input_amount: toNoirBytes(SAMPLE_AMOUNT_HEX),
    public_withdraw_amount: toNoirBytes("00".repeat(32)),
    public_recipient_hash: toNoirBytes("00".repeat(32)),
    output_commitment_1: toNoirBytes(derivedCommitment1),
    output_commitment_2: toNoirBytes(derivedCommitment2),
  };

  console.log("Generating witness...");
  const { witness } = await noir.execute(inputs);
  console.log("Witness generated, size:", witness.length);

  console.log("Generating ZK proof (recursive)...");
  const generatedProof = await backend.generateProofForRecursiveAggregation(witness, { keccak: true });
  console.log("ZK proof generated successfully!");
  console.log("Proof elements count:", generatedProof.proof.length);

  // Convert hex strings to a single Uint8Array
  const proofBytes = new Uint8Array(generatedProof.proof.length * 32);
  for (let i = 0; i < generatedProof.proof.length; i++) {
    const hex = generatedProof.proof[i].replace('0x', '').padStart(64, '0');
    const bytes = hexToBytes(hex);
    proofBytes.set(bytes, i * 32);
  }
  console.log("Proof length:", proofBytes.length);
  console.log("Proof first 64 bytes (hex):", Buffer.from(proofBytes.slice(0, 64)).toString('hex'));

  if (generatedProof.publicInputs) {
    const pis = generatedProof.publicInputs;
    console.log("Public inputs elements count:", pis.length);
    console.log("Public inputs type:", pis.constructor.name);
  }

  console.log("Generating verification key...");
  const vk = await backend.getVerificationKey({ keccak: true });
  console.log("Verification key generated successfully! Size:", vk.byteLength || vk.length);
  console.log("VK type:", vk.constructor.name);
  console.log("VK first 64 bytes (hex):", Buffer.from(vk.slice(0, 64)).toString('hex'));



  const targetDir = path.resolve('../circuits/whisper/target');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  fs.writeFileSync(path.join(targetDir, 'proof'), Buffer.from(proofBytes));
  fs.writeFileSync(path.join(targetDir, 'vk'), Buffer.from(vk));
  
  if (generatedProof.publicInputs) {
    const pis = generatedProof.publicInputs;
    const pisBytes = new Uint8Array(pis.length * 32);
    for (let i = 0; i < pis.length; i++) {
      const hex = pis[i].replace('0x', '').padStart(64, '0');
      const bytes = hexToBytes(hex);
      pisBytes.set(bytes, i * 32);
    }
    fs.writeFileSync(path.join(targetDir, 'public_inputs'), Buffer.from(pisBytes));
    console.log("Wrote public_inputs file of size:", pisBytes.length);
  }

  const rawInputs = new Uint8Array(224);
  rawInputs.set(inputs.merkle_root, 0);
  rawInputs.set(inputs.nullifier_hash, 32);
  rawInputs.set(inputs.input_amount, 64);
  rawInputs.set(inputs.public_withdraw_amount, 96);
  rawInputs.set(inputs.public_recipient_hash, 128);
  rawInputs.set(inputs.output_commitment_1, 160);
  rawInputs.set(inputs.output_commitment_2, 192);
  fs.writeFileSync(path.join(targetDir, 'public_inputs_raw'), Buffer.from(rawInputs));

  const isValid = await backend.verifyProof({
    proof: proofBytes,
    publicInputs: generatedProof.publicInputs
  });
  console.log("Is proof valid in JS?", isValid);

  console.log("Wrote proof, vk, and public_inputs_raw files to:", targetDir);
  await backend.destroy();
}

main().catch(console.error);
