import { useState, useEffect } from 'react';
import { useNotification } from '../../context/NotificationContext';
import type { PrivateNote } from '../../types';
import { scValToNative, rpc, Contract, Account, TransactionBuilder, Networks, Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { DEFAULT_CONFIG, RPC_URL } from '../../config/constants';
import { Noir } from '@noir-lang/noir_js';
import { UltraHonkBackend } from '@aztec/bb.js';
import circuitJson from '../../config/whisper.json';
import { Buffer } from 'buffer';
import { 
  derivePubkey, 
  deriveCommitment, 
  bytesToHexDirect, 
  encryptNote, 
  bytesToHex, 
  hexToBytes,
  deriveNullifier,
  bigIntToBytes32,
  getAssetId
} from '../../lib/crypto';
import { constructMerklePath } from '../../lib/merkle';

async function fetchOnChainReserves(whisperContractId: string): Promise<[number, number]> {
  try {
    const server = new rpc.Server(RPC_URL);
    const simAccount = new Account(Keypair.random().publicKey(), "0");
    const contract = new Contract(whisperContractId);
    const tx = new TransactionBuilder(simAccount, {
      fee: "100",
      networkPassphrase: Networks.TESTNET
    })
    .addOperation(
      contract.call("get_reserves")
    )
    .setTimeout(30)
    .build();

    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
      const nativeTuple = scValToNative(sim.result.retval);
      if (Array.isArray(nativeTuple) && nativeTuple.length === 2) {
        return [Number(BigInt(nativeTuple[0])), Number(BigInt(nativeTuple[1]))];
      }
    }
  } catch (err) {
    console.error("Error fetching on-chain reserves in SwapPanel:", err);
  }
  return [0, 0]; // No reserves available
}

const calculateExactAmountOut = (amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint => {
  const amountInWithFee = amountIn * 9965n;
  const numerator = reserveOut * amountInWithFee;
  const denominator = reserveIn * 10000n + amountInWithFee;
  return numerator / denominator;
};

interface SwapPanelProps {
  isConnected: boolean;
  connectWallet: () => Promise<void>;
  shieldedXlmBalance: number;
  shieldedUsdcBalance: number;
  notes: PrivateNote[];
  setNotes: React.Dispatch<React.SetStateAction<PrivateNote[]>>;
  zkPrivateKey: string;
  derivedViewingKey: string;
  allCommitments: string[];
  setAllCommitments: React.Dispatch<React.SetStateAction<string[]>>;
  executeSorobanCall: (
    methodName: string,
    args: any[],
    callback: (txHash?: string, txResult?: any) => void,
    errorCallback: (err: string) => void,
    useRelayer?: boolean
  ) => Promise<void>;
  config: any;
  fetchBalances: (addr: string) => Promise<void>;
  userAddress: string;
  syncNotesFromChain: () => Promise<void>;
  isProving: boolean;
  provingProgress: number;
  provingLogs: string[];
  setIsProving: (proving: boolean) => void;
  setProvingProgress: (progress: number) => void;
  setProvingLogs: React.Dispatch<React.SetStateAction<string[]>>;
  addProvingLog: (msg: string) => void;
  setTransferStatus: React.Dispatch<React.SetStateAction<{
    status: 'idle' | 'success' | 'failed';
    type: 'transfer' | 'withdraw' | 'swap';
    amount?: number;
    txHash?: string;
    nullifier?: string;
    error?: string;
    assetSymbol?: string;
    toAssetSymbol?: string;
    toAmount?: number;
  }>>;
  setLogs: React.Dispatch<React.SetStateAction<import('../../types').ActivityLog[]>>;
}

export function SwapPanel({
  isConnected,
  connectWallet,
  shieldedXlmBalance,
  shieldedUsdcBalance,
  notes,
  setNotes,
  zkPrivateKey,
  derivedViewingKey,
  allCommitments,
  setAllCommitments,
  executeSorobanCall,
  config,
  fetchBalances,
  userAddress,
  syncNotesFromChain,
  isProving,
  provingProgress,
  provingLogs,
  setIsProving,
  setProvingProgress,
  setProvingLogs,
  addProvingLog,
  setTransferStatus,
  setLogs
}: SwapPanelProps) {
  const { showToast } = useNotification();
  const [fromAsset, setFromAsset] = useState<'USDC' | 'XLM'>('USDC');
  const [toAsset, setToAsset] = useState<'USDC' | 'XLM'>('XLM');
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  
  const [selectedNote, setSelectedNote] = useState<string>('');
  const [filteredNotes, setFilteredNotes] = useState<PrivateNote[]>([]);
  
  const [reserves, setReserves] = useState<{ reserveA: number; reserveB: number }>({
    reserveA: 0,
    reserveB: 0
  });

  // Filter notes based on selected "From" asset and ensure they are not spent
  useEffect(() => {
    const targetAssetAddress = fromAsset === 'USDC' ? config?.tokenContractId : config?.tokenBContractId;
    const notesForAsset = notes.filter(n => {
      const noteAsset = n.assetAddress || config?.tokenContractId;
      return !n.spent && noteAsset === targetAssetAddress;
    });
    setFilteredNotes(notesForAsset);
    if (notesForAsset.length > 0) {
      setSelectedNote(notesForAsset[0].nullifierNonce);
      setFromAmount(notesForAsset[0].amount.toString());
    } else {
      setSelectedNote('');
      setFromAmount('');
    }
  }, [fromAsset, notes, config]);

  useEffect(() => {
    let active = true;
    const updateReserves = async () => {
      try {
        const [a, b] = await fetchOnChainReserves(config?.whisperContractId || DEFAULT_CONFIG.whisperContractId);
        if (active) {
          setReserves({ reserveA: a, reserveB: b });
        }
      } catch (err) {
        console.warn("Could not load reserves in SwapPanel:", err);
      }
    };
    updateReserves();
    const timer = setInterval(updateReserves, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [config]);

  const getAmountOut = (amtStr: string): string => {
    if (!amtStr) return '';
    const amt = parseFloat(amtStr);
    if (isNaN(amt) || amt <= 0) return '';

    const isUsdcToXlm = fromAsset === 'USDC';
    const reserveIn = isUsdcToXlm ? reserves.reserveA : reserves.reserveB;
    const reserveOut = isUsdcToXlm ? reserves.reserveB : reserves.reserveA;

    if (reserveIn <= 0 || reserveOut <= 0) return '0.0000';

    try {
      const amountInRaw = BigInt(Math.floor(amt * 10000000));
      const amountOutRaw = calculateExactAmountOut(amountInRaw, BigInt(reserveIn), BigInt(reserveOut));
      return (Number(amountOutRaw) / 10000000).toFixed(4);
    } catch (e) {
      return '0.0000';
    }
  };

  useEffect(() => {
    setToAmount(getAmountOut(fromAmount));
  }, [reserves, fromAsset, toAsset, fromAmount]);

  const handleSwapAssets = () => {
    const temp = fromAsset;
    setFromAsset(toAsset);
    setToAsset(temp);
    setFromAmount('');
    setToAmount('');
  };

  const handleSelectedNoteChange = (nonce: string) => {
    setSelectedNote(nonce);
    const note = filteredNotes.find(n => n.nullifierNonce === nonce);
    if (note) {
      setFromAmount(note.amount.toString());
    }
  };

  const activeShieldedBalance = fromAsset === 'USDC' ? shieldedUsdcBalance : shieldedXlmBalance;

  const handleExecuteSwap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromAmount || !toAmount || !selectedNote) return;

    const noteToSpend = notes.find(n => n.nullifierNonce === selectedNote);
    if (!noteToSpend) {
      showToast("Selected note not found.", "error");
      return;
    }

    const amt = Math.round(parseFloat(fromAmount) * 10000000) / 10000000;
    const roundedBalance = Math.round(activeShieldedBalance * 10000000) / 10000000;
    if (amt > roundedBalance) {
      showToast(`Insufficient Shielded Balance: You do not have enough shielded ${fromAsset} to complete this private swap.`, "error");
      return;
    }

    const tokenInAddress = fromAsset === 'USDC' ? config.tokenContractId : config.tokenBContractId;
    const tokenOutAddress = fromAsset === 'USDC' ? config.tokenBContractId : config.tokenContractId;

    setIsProving(true);
    setProvingLogs([]);
    setProvingProgress(5);
    addProvingLog("1. Constructing witness for Private Swap circuit...");
    addProvingLog("2. Fetching Merkle proof path for selected note...");

    try {
      // 1. Calculate Merkle path
      const leafIndex = allCommitments.indexOf(noteToSpend.commitment);
      if (leafIndex === -1) {
        throw new Error("Selected note commitment not found in local commitment list.");
      }

      setProvingProgress(15);
      addProvingLog(`Found note at index ${leafIndex}. Generating Merkle path...`);
      const commitmentsUint8 = allCommitments.map(hex => hexToBytes(hex));
      const { merklePath } = await constructMerklePath(commitmentsUint8, leafIndex);

      // 2. Fetch fresh reserves
      setProvingProgress(25);
      addProvingLog("Fetching latest pool reserves...");
      const [resA, resB] = await fetchOnChainReserves(config.whisperContractId);
      const isUsdcToXlm = fromAsset === 'USDC';
      const reserveIn = isUsdcToXlm ? BigInt(resA) : BigInt(resB);
      const reserveOut = isUsdcToXlm ? BigInt(resB) : BigInt(resA);

      // 3. Compute exact amount out
      const amtInRaw = BigInt(Math.floor(noteToSpend.amount * 10000000));
      const exactAmtOutRaw = calculateExactAmountOut(amtInRaw, reserveIn, reserveOut);
      const exactAmtOut = Number(exactAmtOutRaw) / 10000000;
      addProvingLog(`Exact swap output calculated: ${exactAmtOut.toFixed(4)} ${toAsset}`);

      // 4. Derive recipient credentials and new commitment/encrypted payload
      setProvingProgress(35);
      addProvingLog("Deriving ZK credentials for swap output note...");
      const recipientPubkeyBytes = await derivePubkey(zkPrivateKey);
      
      const recipientNonceBytes = new Uint8Array(32);
      globalThis.crypto.getRandomValues(recipientNonceBytes as any);
      const recipientNonceHex = bytesToHexDirect(recipientNonceBytes);

      const recipientNoteData = {
        amount: exactAmtOut,
        nullifier_nonce: recipientNonceHex,
        assetAddress: tokenOutAddress
      };
      
      const encryptedNoteHex = await encryptNote(derivedViewingKey, recipientNoteData);
      const encryptedNoteBytes = new Uint8Array(encryptedNoteHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));

      // 5. Generate ZK spend proof for the input note
      setProvingProgress(45);
      addProvingLog("Executing BN254 multi-scalar multiplication (MSM) in Aztec Honk...");
      
      const nullifierBytes = await deriveNullifier(zkPrivateKey, noteToSpend.nullifierNonce);
      const assetIdBytes = await getAssetId(tokenInAddress);

      // Compute Merkle root
      const { computeLatestMerkleRootOnChain } = await import('../../lib/merkle');
      const commitmentsUint8ForRoot = allCommitments.map(hex => hexToBytes(hex));
      const computedRootHex = await computeLatestMerkleRootOnChain(commitmentsUint8ForRoot);
      const merkleRootBytes = hexToBytes(computedRootHex);

      // Validate Merkle root on-chain
      const simulationSource = userAddress || config.adminAddress;
    const server = new rpc.Server(RPC_URL);
      const simAccount = new Account(simulationSource, "0");
      const whisperContract = new Contract(config.whisperContractId);
      
      const rootTx = new TransactionBuilder(simAccount, {
        fee: "100",
        networkPassphrase: Networks.TESTNET
      })
      .addOperation(whisperContract.call("is_root_valid", nativeToScVal(merkleRootBytes, { type: "bytes" })))
      .setTimeout(30)
      .build();

      const rootSim = await server.simulateTransaction(rootTx);
      if (!rpc.Api.isSimulationSuccess(rootSim) || !rootSim.result) {
        throw new Error("Could not validate local Merkle root against Whisper contract.");
      }
      const isRootValid = Boolean(scValToNative(rootSim.result.retval));
      if (!isRootValid) {
        throw new Error("Local Merkle root is out of sync with contract state. Please sync notes again.");
      }

      // Recipient Hash (Whisper contract itself for withdrawals/swaps)
      const recipientScVal = nativeToScVal(config.whisperContractId, { type: "address" });
      const recipientXdrBytes = recipientScVal.toXDR();
      const recipientHashBuf = await globalThis.crypto.subtle.digest("SHA-256", recipientXdrBytes as any);
      const publicRecipientHashBytes = new Uint8Array(recipientHashBuf);

      const hexToArray = (hexStr: string) => {
        const clean = hexStr.startsWith('0x') ? hexStr.slice(2) : hexStr;
        const arr = [];
        for (let i = 0; i < clean.length; i += 2) {
          arr.push(parseInt(clean.slice(i, i + 2), 16));
        }
        return arr;
      };

      const merklePathHex = merklePath.map((bytes: Uint8Array) => bytesToHex(bytes));
      const merklePathNoir = merklePathHex.map((h: string) => hexToArray(h));

      const noirInputs = {
        secret_key: hexToArray(zkPrivateKey),
        nullifier_nonce: hexToArray(noteToSpend.nullifierNonce),
        merkle_path: merklePathNoir,
        merkle_index: leafIndex,
        recipient_pubkey: hexToArray("00".repeat(32)),
        recipient_amount: hexToArray("00".repeat(32)),
        recipient_nonce: hexToArray("00".repeat(32)),
        change_pubkey: hexToArray("00".repeat(32)),
        change_amount: hexToArray("00".repeat(32)),
        change_nonce: hexToArray("00".repeat(32)),
        merkle_root: hexToArray(computedRootHex),
        nullifier_hash: hexToArray(bytesToHex(nullifierBytes)),
        input_amount: hexToArray(bytesToHex(bigIntToBytes32(amtInRaw))),
        public_withdraw_amount: hexToArray(bytesToHex(bigIntToBytes32(amtInRaw))),
        public_recipient_hash: hexToArray(bytesToHex(publicRecipientHashBytes)),
        output_commitment_1: hexToArray("00".repeat(32)),
        output_commitment_2: hexToArray("00".repeat(32)),
        asset_id: hexToArray(bytesToHex(assetIdBytes)),
      };

      setProvingProgress(55);
      addProvingLog("Running Noir witness compiler and backend Honk prover...");

      const cleanBytecode = (circuitJson.bytecode as string).replace(/\s/g, '');
      const whisperCircuit = {
        ...circuitJson,
        bytecode: cleanBytecode
      };

      const backend = new UltraHonkBackend(whisperCircuit.bytecode);
      const noir = new Noir(whisperCircuit as any);
      const { witness: noirWitness } = await noir.execute(noirInputs as any);
      const generatedProof = await backend.generateProofForRecursiveAggregation(noirWitness, { keccak: true });

      const serializedProofBytes = new Uint8Array(generatedProof.proof.length * 32);
      for (let i = 0; i < generatedProof.proof.length; i++) {
        const hex = generatedProof.proof[i].replace('0x', '').padStart(64, '0');
        const bytes = hexToBytes(hex);
        serializedProofBytes.set(bytes, i * 32);
      }
      await backend.destroy();

      setProvingProgress(75);
      addProvingLog("ZK Proof generated successfully! Packaging transaction...");

      // 6. Submit Soroban Transaction
      const tokenInScVal = nativeToScVal(tokenInAddress, { type: "address" });
      const tokenOutScVal = nativeToScVal(tokenOutAddress, { type: "address" });
      const proofScVal = nativeToScVal(serializedProofBytes, { type: "bytes" });
      
      const publicInputsScVal = xdr.ScVal.scvVec([
        xdr.ScVal.scvBytes(Buffer.from(merkleRootBytes)),
        xdr.ScVal.scvBytes(Buffer.from(nullifierBytes)),
        xdr.ScVal.scvBytes(Buffer.from(bigIntToBytes32(amtInRaw))),
        xdr.ScVal.scvBytes(Buffer.from(bigIntToBytes32(amtInRaw))),
        xdr.ScVal.scvBytes(Buffer.from(publicRecipientHashBytes)),
        xdr.ScVal.scvBytes(Buffer.from(new Uint8Array(32))),
        xdr.ScVal.scvBytes(Buffer.from(new Uint8Array(32))),
        xdr.ScVal.scvBytes(Buffer.from(assetIdBytes))
      ]);

      const amountInScVal = nativeToScVal(amtInRaw, { type: "i128" });
      const minAmountOutScVal = nativeToScVal((exactAmtOutRaw * 99n) / 100n, { type: "i128" });
      const recipientPubkeyScVal = xdr.ScVal.scvBytes(Buffer.from(recipientPubkeyBytes));
      const recipientNonceScVal = xdr.ScVal.scvBytes(Buffer.from(hexToBytes(recipientNonceHex)));
      const circuitVersionScVal = nativeToScVal(1, { type: "u32" });
      
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const deadlineScVal = nativeToScVal(deadline, { type: "u64" });
      const encryptedNoteScVal = xdr.ScVal.scvBytes(Buffer.from(encryptedNoteBytes));

      setProvingProgress(80);
      addProvingLog("Initiating Soroban transaction submission...");

      await executeSorobanCall(
        "swap_shielded",
        [
          tokenInScVal,
          tokenOutScVal,
          proofScVal,
          publicInputsScVal,
          amountInScVal,
          minAmountOutScVal,
          recipientPubkeyScVal,
          recipientNonceScVal,
          circuitVersionScVal,
          deadlineScVal,
          encryptedNoteScVal
        ],
        async (txHash) => {
          const tokenOutAssetIdBytes = await getAssetId(tokenOutAddress);
          const commitmentBytes = await deriveCommitment(recipientPubkeyBytes, exactAmtOutRaw, recipientNonceHex, tokenOutAssetIdBytes);
          const commitmentHex = bytesToHex(commitmentBytes);

          const newSwapNote: PrivateNote = {
            amount: exactAmtOut,
            nullifierNonce: recipientNonceHex,
            commitment: commitmentHex,
            spent: false,
            txHash: txHash || '',
            timestamp: new Date().toISOString(),
            assetAddress: tokenOutAddress
          };

          setNotes(prev => {
            const updated = prev.map(n => n.nullifierNonce === noteToSpend.nullifierNonce ? { ...n, spent: true } : n);
            const merged = [...updated, newSwapNote];
            localStorage.setItem(`whisper_notes_${userAddress}`, JSON.stringify(merged));
            return merged;
          });

          setAllCommitments(prev => [...prev, commitmentHex]);

          setProvingProgress(100);
          setIsProving(false);
          setFromAmount('');
          setToAmount('');
          
          showToast(`Private Swap Complete! Successfully swapped ${amt} shielded ${fromAsset} for ${exactAmtOut.toFixed(4)} shielded ${toAsset} via ZK proof.`, "success");
          
          setTransferStatus({
            status: 'success',
            type: 'swap',
            amount: amt,
            txHash: txHash || '',
            nullifier: bytesToHex(nullifierBytes),
            assetSymbol: fromAsset,
            toAssetSymbol: toAsset,
            toAmount: exactAmtOut
          });

          setLogs(prev => [
            {
              id: Date.now().toString(),
              type: 'swap',
              amount: amt,
              recipient: toAsset,
              timestamp: 'Just now',
              status: 'success',
              txHash: txHash || '',
              asset: fromAsset,
              details: `Swapped ${amt} ${fromAsset} ➔ ${exactAmtOut.toFixed(4)} ${toAsset}`
            },
            ...prev
          ]);

          setTimeout(() => {
            syncNotesFromChain();
            fetchBalances(userAddress);
          }, 3000);
        },
        (err) => {
          console.error("Soroban contract call failed during swap:", err);
          addProvingLog(`❌ Error: ${err}`);
          showToast(`Swap transaction failed: ${err}`, "error");
          setIsProving(false);

          setTransferStatus({
            status: 'failed',
            type: 'swap',
            amount: amt,
            error: err,
            assetSymbol: fromAsset,
            toAssetSymbol: toAsset,
            toAmount: exactAmtOut
          });

          setLogs(prev => [
            {
              id: Date.now().toString(),
              type: 'swap',
              amount: amt,
              recipient: toAsset,
              timestamp: 'Just now',
              status: 'failed',
              details: `Swap failed: ${err}`,
              asset: fromAsset
            },
            ...prev
          ]);
        },
        true
      );
    } catch (err: any) {
      console.error("Error executing private swap:", err);
      addProvingLog(`❌ Proving failure: ${err.message || String(err)}`);
      showToast(`Private Swap Failed: ${err.message || String(err)}`, "error");
      setIsProving(false);

      setTransferStatus({
        status: 'failed',
        type: 'swap',
        amount: amt,
        error: err.message || String(err),
        assetSymbol: fromAsset,
        toAssetSymbol: toAsset
      });

      setLogs(prev => [
        {
          id: Date.now().toString(),
          type: 'swap',
          amount: amt,
          recipient: toAsset,
          timestamp: 'Just now',
          status: 'failed',
          details: `Proving failed: ${err.message || String(err)}`,
          asset: fromAsset
        },
        ...prev
      ]);
    }
  };

  return (
    <div className="max-w-[800px] mx-auto animate-fade-in pb-12">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Form Column */}
        <div className="lg:col-span-7 space-y-6">
          <div className="glass-panel rounded-lg p-6 md:p-8 glass-inner-stroke relative">
            <div className="absolute -right-12 -top-12 w-32 h-32 bg-[#fface8]/5 blur-3xl"></div>
            
            <div className="flex items-center justify-between w-full mb-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#fface8]/10 border border-[#fface8]/20 text-[#fface8]">
                <div className="w-1.5 h-1.5 rounded-full bg-[#fface8] privacy-pulse"></div>
                <span className="text-[10px] font-mono uppercase tracking-wider">ZK Shielded AMM</span>
              </div>
            </div>

            <h2 className="text-xl font-bold text-white mb-2">Private Swap</h2>
            <p className="text-xs text-[#cfc2d7] leading-relaxed mb-6">
              Trade between assets completely privately inside the pool. Your trade amounts, routes, and address remain hidden from the blockchain ledger.
            </p>

            <form onSubmit={handleExecuteSwap} className="space-y-4">
              
              {/* Note Selector */}
              {isConnected && filteredNotes.length > 0 && (
                <div className="space-y-1.5 pt-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#cfc2d7] block">Select Note Commitment to Nullify</label>
                  <select
                    value={selectedNote}
                    onChange={(e) => handleSelectedNoteChange(e.target.value)}
                    disabled={isProving}
                    className="w-full glass-input px-4 py-2.5 text-xs text-white rounded bg-[#0b0e14] border border-white/10 focus:border-[#fface8]"
                  >
                    {filteredNotes.map((note, index) => (
                      <option key={index} value={note.nullifierNonce} className="bg-[#0b0e14] text-white font-mono">
                        Note #{index + 1}: {note.amount} {fromAsset} (Commitment: {note.commitment ? note.commitment.slice(0, 10) : ''}...)
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px] text-[#cfc2d7]/60 block leading-normal mt-1">
                    💡 ZK Swap private trades consume the entire selected shielded note to ensure zero-change commitments are output to the public AMM, satisfying ZK privacy constraints.
                  </span>
                </div>
              )}

              {/* From Input */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider text-[#cfc2d7]">
                  <span>Pay (Shielded)</span>
                  <span className="font-mono">Balance: {activeShieldedBalance.toLocaleString()} {fromAsset}</span>
                </div>
                
                <div className="relative">
                  <input 
                    type="number"
                    placeholder="0.00"
                    value={fromAmount}
                    readOnly
                    disabled={isProving || !isConnected}
                    className="w-full glass-input px-4 py-3 text-sm text-white/50 rounded bg-white/2 cursor-not-allowed pr-20"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-white/50">{fromAsset}</span>
                  </div>
                </div>
              </div>

              {/* Flip Button */}
              <div className="flex justify-center my-2">
                <button
                  type="button"
                  onClick={handleSwapAssets}
                  disabled={isProving}
                  className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer"
                  title="Swap assets direction"
                >
                  <span className="material-symbols-outlined text-lg">swap_vert</span>
                </button>
              </div>

              {/* To Input */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider text-[#cfc2d7]">
                  <span>Receive (Shielded Est.)</span>
                </div>
                
                <div className="relative font-mono">
                  <input 
                    type="text"
                    placeholder="0.00"
                    value={toAmount}
                    readOnly
                    className="w-full glass-input px-4 py-3 text-sm text-white/50 rounded bg-white/2 cursor-not-allowed pr-16"
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-mono font-bold text-white/50">
                    {toAsset}
                  </div>
                </div>
              </div>

              {!isConnected ? (
                <button 
                  type="button"
                  onClick={connectWallet}
                  className="w-full btn-primary py-3 rounded text-xs font-bold transition-all cursor-pointer mt-4"
                >
                  Connect Wallet to Swap
                </button>
              ) : filteredNotes.length === 0 ? (
                <div className="text-center p-3 text-xs text-[#cfc2d7]/60 border border-dashed border-white/10 rounded mt-4">
                  No shielded {fromAsset} notes available to swap.
                </div>
              ) : (
                <button 
                  type="submit"
                  disabled={isProving || !fromAmount}
                  className="w-full btn-primary py-3 rounded text-xs font-bold transition-all active:scale-95 disabled:opacity-50 cursor-pointer mt-4 bg-gradient-to-r from-[#fface8] to-[#8a2be2] text-white"
                >
                  {isProving ? "Calculating ZK-Proof..." : `Execute Private Swap`}
                </button>
              )}
            </form>
          </div>
        </div>

        {/* Orbit Visualization Column */}
        <div className="lg:col-span-5 flex flex-col items-center justify-center">
          <div className="relative w-64 h-64 flex items-center justify-center mb-6">
            <div className="absolute w-48 h-48 bg-[#fface8]/5 rounded-full blur-[40px] animate-pulse-glow"></div>
            
            <div className={`absolute w-36 h-36 rounded-full border border-white/10 flex flex-col items-center justify-center bg-black/40 backdrop-blur-md relative z-10 ${isProving ? 'cyber-glow' : ''}`}>
              <span className="text-[10px] font-mono text-[#fface8] uppercase tracking-wider">
                {isProving ? 'PROVING' : 'READY'}
              </span>
              <h4 className="text-2xl font-bold text-white mt-1">
                {isProving ? `${provingProgress}%` : '100%'}
              </h4>
            </div>
            
            {/* Spinning Ring 1 */}
            <div 
              className="absolute inset-0 border border-[#fface8]/30 rounded-full"
              style={{ animation: 'spin 12s linear infinite' }}
            >
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-[#fface8] rounded-full shadow-[0_0_10px_#fface8]"></div>
            </div>
            
            {/* Spinning Ring 2 */}
            <div 
              className="absolute inset-8 border border-[#8a2be2]/30 rounded-full"
              style={{ animation: 'spin 18s linear reverse infinite' }}
            >
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-[#8a2be2] rounded-full shadow-[0_0_10px_#8a2be2]"></div>
            </div>
          </div>

          {/* Prover Pipeline Box */}
          {isProving && (
            <div className="w-full bg-[#10131a]/80 border border-[#fface8]/40 rounded p-4 shadow-xl">
              <div className="flex justify-between items-center mb-3">
                <span className="text-[10px] font-bold text-[#fface8] uppercase tracking-wider flex items-center gap-1 font-sans">
                  <span className="material-symbols-outlined text-xs animate-spin">memory</span>
                  ZK Proof Pipeline
                </span>
                <span className="text-xs text-[#fface8] font-mono">{provingProgress}%</span>
              </div>
              
              <div className="h-1 bg-white/10 rounded-full overflow-hidden mb-3">
                <div className="h-full bg-gradient-to-r from-[#fface8] to-[#8a2be2] transition-all" style={{ width: `${provingProgress}%` }}></div>
              </div>

              <div className="bg-black/30 border border-white/5 rounded p-3 font-mono text-[9px] text-[#fface8] max-h-[100px] overflow-y-auto space-y-1">
                {provingLogs.map((log, index) => (
                  <div key={index} className={index === provingLogs.length - 1 ? 'text-white font-bold' : ''}>
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
