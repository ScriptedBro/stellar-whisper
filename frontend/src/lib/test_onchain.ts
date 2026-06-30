import { 
  rpc, 
  Contract, 
  TransactionBuilder, 
  Networks, 
  Keypair,
  nativeToScVal,
  scValToNative,
  xdr
} from '@stellar/stellar-sdk';
import { UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import circuitJson from '../config/whisper.json';
import deployedJson from '../config/deployed.json';
import { 
  derivePubkey,
  deriveCommitment, 
  deriveNullifier,
  hexToBytes,
  bytesToHex,
  bigIntToBytes32,
  getAssetId
} from './crypto';
import { constructMerklePath } from './merkle';
import crypto from 'crypto';

// Setup RPC server
const server = new rpc.Server("https://soroban-testnet.stellar.org");

// Load alice (funded admin account)
const aliceSecret = "SCQK3YU3VYRPVQ3NEKL4CSAAQYWCLDGPAPTJ2M562O3TJZKTUFBW6RVP";
const aliceKeypair = Keypair.fromSecret(aliceSecret);
const aliceAddress = aliceKeypair.publicKey();

const whisperContractId = deployedJson.whisperContractId;
const tokenContractId = deployedJson.tokenContractId;

async function sendTx(tx: any) {
  const simulated = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulated)) {
    console.error("SIMULATION ERROR DETAILS:", JSON.stringify(simulated, null, 2));
    throw new Error("Simulation failed: " + JSON.stringify(simulated.error));
  }
  const assembledTx = rpc.assembleTransaction(tx, simulated).build();
  assembledTx.sign(aliceKeypair);
  
  const sendResult = await server.sendTransaction(assembledTx);
  if (sendResult.status === "ERROR") {
    throw new Error("Broadcast failed: " + JSON.stringify(sendResult));
  }
  
  console.log(`Pending Tx Hash: ${sendResult.hash}. Awaiting consensus...`);
  let status: string = "PENDING";
  let txResult: any;
  let attempts = 0;
  while ((status === "PENDING" || status === "NOT_FOUND") && attempts < 30) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    try {
      txResult = await server.getTransaction(sendResult.hash);
      status = txResult.status;
    } catch (e) {
      status = "NOT_FOUND";
    }
    attempts++;
  }
  
  if (status !== "SUCCESS") {
    throw new Error(`Transaction execution failed with status ${status}. Result XDR: ${txResult?.resultXdr}`);
  }
  
  console.log("Transaction completed successfully!");
  return txResult;
}

// Fetch all on-chain commitments by querying events
async function fetchAllOnChainCommitments(): Promise<Uint8Array[]> {
  const latestLedger = await server.getLatestLedger();
  const endLedger = latestLedger.sequence;
  const startLedger = Math.max(1, endLedger - 10000);
  
  let response;
  try {
    console.log(`Querying events from ledger ${startLedger} to ${endLedger}...`);
    response = await server.getEvents({
      startLedger,
      filters: [
        {
          contractIds: [whisperContractId],
          type: "contract"
        }
      ]
    });
  } catch (e: any) {
    const errorMsg = e.message || String(e);
    console.warn(`Initial event query failed: ${errorMsg}`);
    const match = errorMsg.match(/range:\s*(\d+)/i);
    if (match && match[1]) {
      const minLedger = parseInt(match[1], 10);
      console.log(`Retrying event query with adjusted startLedger: ${minLedger}`);
      response = await server.getEvents({
        startLedger: minLedger,
        filters: [
          {
            contractIds: [whisperContractId],
            type: "contract"
          }
        ]
      });
    } else {
      console.log(`Failed to parse range from error. Retrying with endLedger - 10000`);
      const fallbackStart = Math.max(1, endLedger - 10000);
      response = await server.getEvents({
        startLedger: fallbackStart,
        filters: [
          {
            contractIds: [whisperContractId],
            type: "contract"
          }
        ]
      });
    }
  }
  
  const commitments: Uint8Array[] = [];
  const events = response?.events || [];
  console.log(`Fetched ${events.length} events total from Soroban RPC.`);
  
  for (const event of events) {
    try {
      const topics = (event.topic || []).map(t => {
        if (typeof t === 'string') {
          return scValToNative(xdr.ScVal.fromXDR(t, "base64"));
        }
        return scValToNative(t as any);
      });
      const rawEventType = topics[0];
      let eventType = "";
      if (typeof rawEventType === 'string') {
        eventType = rawEventType;
      } else if (rawEventType && (rawEventType instanceof Uint8Array)) {
        eventType = new TextDecoder().decode(rawEventType);
      } else if (rawEventType && typeof rawEventType === 'object') {
        if (rawEventType.constructor?.name === 'Buffer' || rawEventType.constructor?.name === 'Uint8Array') {
          eventType = new TextDecoder().decode(Uint8Array.from(rawEventType as any));
        } else {
          eventType = rawEventType.toString();
        }
      } else if (rawEventType) {
        eventType = String(rawEventType);
      }
      
      console.log(`- Received event type: "${eventType}"`);
      
      if (eventType === "deposit" || eventType === "shielded_output") {
        let data;
        if (typeof event.value === 'string') {
          data = scValToNative(xdr.ScVal.fromXDR(event.value, "base64"));
        } else {
          data = scValToNative(event.value as any);
        }
        const commitmentVal = data && typeof data === 'object'
          ? (data.commitment || data.Commitment || (Array.isArray(data) ? data[0] : undefined))
          : undefined;
        if (commitmentVal) {
          console.log(`  Found commitment in event: ${bytesToHex(commitmentVal)}`);
          commitments.push(new Uint8Array(commitmentVal as any));
        }
      }
    } catch (err) {
      console.error("Failed to parse event:", err);
    }
  }
  return commitments;
}

async function main() {
  console.log("=== Stellar Whisper On-chain ZK E2E Test ===");
  console.log("Admin/Alice Address:", aliceAddress);
  
  // 1. Generate private note details
  const secretKey = crypto.randomBytes(32);
  const nullifierNonce = crypto.randomBytes(32);
  const amount = 10_0000000n; // 10 USDC (7 decimals)
  
  const secretKeyHex = secretKey.toString('hex');
  const nullifierNonceHex = nullifierNonce.toString('hex');
  
  const pubkeyBytes = await derivePubkey(secretKeyHex);
  const assetIdBytes = await getAssetId(tokenContractId);
  const commitmentBytes = await deriveCommitment(pubkeyBytes, amount, nullifierNonceHex, assetIdBytes);
  const commitmentHex = bytesToHex(commitmentBytes);
  console.log(`Derived note commitment: ${commitmentHex}`);
  
  // 2. Approve whisper contract to spend 10 USDC from Alice
  console.log("Step 1: Approving whisper contract to spend USDC...");
  const latestLedger = await server.getLatestLedger();
  const accountDetails = await server.getAccount(aliceAddress);
  const tokenContract = new Contract(tokenContractId);
  const whisperContract = new Contract(whisperContractId);
  
  let txApprove = new TransactionBuilder(accountDetails, {
    fee: "100000",
    networkPassphrase: Networks.TESTNET
  })
  .addOperation(tokenContract.call(
    "approve",
    nativeToScVal(aliceAddress, { type: "address" }),
    nativeToScVal(whisperContractId, { type: "address" }),
    nativeToScVal(amount, { type: "i128" }),
    nativeToScVal(latestLedger.sequence + 1000, { type: "u32" })
  ))
  .setTimeout(120)
  .build();
  
  await sendTx(txApprove);
  
  // 3. Deposit to whisper contract
  console.log("Step 2: Depositing note into whisper contract...");
  const updatedAccountDetails = await server.getAccount(aliceAddress);
  
  const encryptedNoteBytes = new Uint8Array(100); // 100 dummy bytes is fine for the contract
  
  let txDeposit = new TransactionBuilder(updatedAccountDetails, {
    fee: "100000",
    networkPassphrase: Networks.TESTNET
  })
  .addOperation(whisperContract.call(
    "deposit",
    nativeToScVal(aliceAddress, { type: "address" }),
    nativeToScVal(Buffer.from(commitmentBytes), { type: "bytes" }),
    nativeToScVal(amount, { type: "i128" }),
    nativeToScVal(Buffer.from(encryptedNoteBytes), { type: "bytes" })
  ))
  .setTimeout(120)
  .build();
  
  await sendTx(txDeposit);
  console.log("Deposit confirmed on-chain.");
  
  // Wait 10 seconds for ledger/events to populate fully
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  // 4. Fetch all commitments and build Merkle tree/path
  console.log("Step 3: Fetching all on-chain commitments...");
  const commitments = await fetchAllOnChainCommitments();
  console.log(`Found ${commitments.length} commitments on-chain.`);
  
  const leafIndex = commitments.findIndex(c => bytesToHex(c) === commitmentHex);
  if (leafIndex === -1) {
    throw new Error(`Our commitment ${commitmentHex} was not found on-chain!`);
  }
  const { merklePath } = await constructMerklePath(commitments, leafIndex);
  
  // Calculate root to feed as input to circuit
  let rootHash = commitmentBytes;
  let tempIdx = leafIndex;
  for (let i = 0; i < merklePath.length; i++) {
    const isRight = tempIdx % 2 === 1;
    const left = isRight ? merklePath[i] : rootHash;
    const right = isRight ? rootHash : merklePath[i];
    
    // Hash left and right together
    const leftBigInt = BigInt('0x' + bytesToHex(left)) % BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
    const rightBigInt = BigInt('0x' + bytesToHex(right)) % BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
    
    const { poseidon } = await import('@iden3/js-crypto');
    const hashedVal = poseidon.hash([leftBigInt, rightBigInt]);
    rootHash = bigIntToBytes32(hashedVal);
    tempIdx = Math.floor(tempIdx / 2);
  }
  const rootHex = bytesToHex(rootHash);
  console.log(`Merkle path root calculated: ${rootHex}`);
  
  // 5. Generate witness and ZK proof for withdrawal
  console.log("Step 4: Generating zero-knowledge proof for withdrawal...");
  
  const nullifierHashBytes = await deriveNullifier(secretKeyHex, nullifierNonceHex);
  const nullifierHex = bytesToHex(nullifierHashBytes);
  console.log(`Derived nullifier hash: ${nullifierHex}`);
  
  // Public recipient: withdraw back to Alice
  const contractRecipientAddress = aliceAddress;
  const recipientScVal = nativeToScVal(contractRecipientAddress, { type: "address" });
  const recipientXdrBytes = recipientScVal.toXDR();
  
  // SHA-256 recipient hash for public input
  const recipientHashBytes = crypto.createHash('sha256').update(recipientXdrBytes).digest();
  
  const toNoirBytes = (val: Uint8Array | string): number[] => {
    const bytes = typeof val === 'string' ? hexToBytes(val) : val;
    return Array.from(bytes);
  };
  
  // Input fields for Noir
  const cleanBytecode = (circuitJson.bytecode as string).replace(/\s/g, '');
  const backend = new UltraHonkBackend(cleanBytecode);
  const noir = new Noir(circuitJson as any);
  
  const inputs = {
    secret_key: toNoirBytes(secretKeyHex),
    nullifier_nonce: toNoirBytes(nullifierNonceHex),
    merkle_path: merklePath.map(h => toNoirBytes(h)),
    merkle_index: leafIndex,
    recipient_pubkey: toNoirBytes("00".repeat(32)),
    recipient_amount: toNoirBytes("00".repeat(32)),
    recipient_nonce: toNoirBytes("00".repeat(32)),
    change_pubkey: toNoirBytes("00".repeat(32)),
    change_amount: toNoirBytes("00".repeat(32)),
    change_nonce: toNoirBytes("00".repeat(32)),
    merkle_root: toNoirBytes(rootHash),
    nullifier_hash: toNoirBytes(nullifierHashBytes),
    input_amount: toNoirBytes(bigIntToBytes32(amount)),
    public_withdraw_amount: toNoirBytes(bigIntToBytes32(amount)),
    public_recipient_hash: toNoirBytes(recipientHashBytes),
    output_commitment_1: toNoirBytes("00".repeat(32)),
    output_commitment_2: toNoirBytes("00".repeat(32)),
    asset_id: toNoirBytes(assetIdBytes)
  };
  
  console.log("Executing witness generation...");
  const { witness } = await noir.execute(inputs);
  console.log("Witness generated, size:", witness.length);
  
  console.log("Generating UltraHonk ZK proof (recursive, keccak)...");
  const generatedProof = await backend.generateProofForRecursiveAggregation(witness, { keccak: true });
  console.log("ZK proof generated successfully! Size:", generatedProof.proof.length * 32);
  
  const serializedProofBytes = new Uint8Array(generatedProof.proof.length * 32);
  for (let i = 0; i < generatedProof.proof.length; i++) {
    const hex = generatedProof.proof[i].replace('0x', '').padStart(64, '0');
    const bytes = hexToBytes(hex);
    serializedProofBytes.set(bytes, i * 32);
  }
  
  await backend.destroy();
  
  // 6. Submit transfer_or_withdraw transaction to whisper contract on-chain!
  console.log("Step 5: Invoking on-chain transfer_or_withdraw to verify ZK proof & withdraw...");
  const spendAccountDetails = await server.getAccount(aliceAddress);
  
  const proofScVal = nativeToScVal(serializedProofBytes, { type: "bytes" });
  
  const publicInputsScVal = xdr.ScVal.scvVec([
    xdr.ScVal.scvBytes(Buffer.from(rootHash)),
    xdr.ScVal.scvBytes(Buffer.from(nullifierHashBytes)),
    xdr.ScVal.scvBytes(Buffer.from(bigIntToBytes32(amount))), // inputAmountBytes
    xdr.ScVal.scvBytes(Buffer.from(bigIntToBytes32(amount))), // withdrawAmountBytes
    xdr.ScVal.scvBytes(Buffer.from(recipientHashBytes)),     // publicRecipientHashBytes
    xdr.ScVal.scvBytes(Buffer.from(new Uint8Array(32))),     // outputCommitment1Bytes (zero)
    xdr.ScVal.scvBytes(Buffer.from(new Uint8Array(32))),      // outputCommitment2Bytes (zero)
    xdr.ScVal.scvBytes(Buffer.from(assetIdBytes))            // asset_id public input
  ]);
  
  const tokenScVal = nativeToScVal(tokenContractId, { type: "address" });
  const amountScVal = nativeToScVal(amount, { type: "i128" });
  const relayerScVal = xdr.ScVal.scvVoid();
  const relayerFeeScVal = nativeToScVal(0n, { type: "i128" });
  const circuitVersionScVal = nativeToScVal(1, { type: "u32" });
  const encryptedNotesScVec = xdr.ScVal.scvVec([]);
  const newCommitmentsScVec = xdr.ScVal.scvVec([]);
  
  let txWithdraw = new TransactionBuilder(spendAccountDetails, {
    fee: "100000",
    networkPassphrase: Networks.TESTNET
  })
  .addOperation(whisperContract.call(
    "transfer_or_withdraw",
    tokenScVal,
    proofScVal,
    publicInputsScVal,
    recipientScVal,
    amountScVal,
    relayerScVal,
    relayerFeeScVal,
    circuitVersionScVal,
    encryptedNotesScVec,
    newCommitmentsScVec
  ))
  .setTimeout(120)
  .build();
  
  console.log("Simulating and sending withdraw transaction...");
  await sendTx(txWithdraw);
  console.log("🎉 E2E withdrawal and ZK proof verification SUCCEEDED on-chain!");
}

main().catch(console.error);
