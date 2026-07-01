import { useState, useEffect } from 'react';
import { rpc, scValToNative, xdr, Contract, Account, TransactionBuilder, Networks, nativeToScVal } from '@stellar/stellar-sdk';
import type { PrivateNote, ActivityLog } from '../types';
import { XLM_CONTRACT_ID, RPC_URL, SUPABASE_URL, SUPABASE_ANON_KEY, INDEXER_URL } from '../config/constants';
import { createClient } from '@supabase/supabase-js';
import {
  deriveViewingKey, 
  deriveNullifier, 
  decryptNote, 
  bytesToHex, 
  bytesToHexDirect,
  hexToBytes
} from '../lib/crypto';
import {
  getOnChainZeroHash,
  computeLatestMerkleRootOnChain
} from '../lib/merkle';

async function checkNullifierOnChain(
  nullifierBytes: Uint8Array,
  contractId: string,
  sourceAddress: string
): Promise<boolean | null> {
  try {
    const server = new rpc.Server(RPC_URL);
    const simAccount = new Account(sourceAddress, "0");
    const contract = new Contract(contractId);
    const tx = new TransactionBuilder(simAccount, {
      fee: "100",
      networkPassphrase: Networks.TESTNET
    })
    .addOperation(contract.call("has_nullifier", nativeToScVal(nullifierBytes, { type: "bytes" })))
    .setTimeout(30)
    .build();

    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
      return Boolean(scValToNative(sim.result.retval));
    }
  } catch (e) {
    console.warn("On-chain nullifier check failed:", e);
  }
  return null;
}

const fetchContractEvents = async (
  server: rpc.Server,
  whisperContractId: string,
  startLedger: number
) => {
  const events: any[] = [];
  let cursor: string | undefined;
  let lastCursor: string | undefined;

  do {
    const request: any = {
      limit: 100,
      filters: [
        {
          contractIds: [whisperContractId],
          type: "contract"
        }
      ]
    };
    if (cursor) {
      request.cursor = cursor;
    } else {
      request.startLedger = startLedger;
    }

    const response = await server.getEvents(request);

    events.push(...(response.events || []));
    
    if (!response.cursor || response.cursor === lastCursor) {
      break;
    }

    lastCursor = response.cursor;
    cursor = response.cursor;
  } while (cursor);

  return events;
};

const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

function rowToEvent(row: any) {
  return {
    id: row.id,
    type: row.type,
    ledger: row.ledger,
    ledgerClosedAt: row.ledger_closed_at,
    contractId: row.contract_id,
    txHash: row.tx_hash,
    topic: typeof row.topic === 'string' ? JSON.parse(row.topic) : (row.topic || []),
    value: row.value,
    tokenAddress: row.token_address || ''
  };
}

// ScVal can be a base64 string (from indexer/Supabase) or an ScVal object (from direct RPC)
function parseScVal(input: any): any {
  if (input && typeof input === 'object' && typeof input.toXDR === 'function') {
    return scValToNative(input);
  }
  if (input && typeof input === 'object' && input.xdr) {
    return scValToNative(xdr.ScVal.fromXDR(input.xdr, "base64"));
  }
  return scValToNative(xdr.ScVal.fromXDR(input, "base64"));
}

async function fetchEventsFromSupabase(whisperContractId: string): Promise<any[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from('events')
    .select('*')
    .eq('contract_id', whisperContractId)
    .order('ledger', { ascending: true })
    .limit(10000);
  return (data || []).map(rowToEvent);
}

export function useNotes(
  userAddress: string, 
  zkPrivateKey: string, 
  whisperContractId: string,
  updateShieldedBalances?: (usdcBal: number, xlmBal: number) => void,
  usdcContractId: string = ''
) {
  const [notes, setNotes] = useState<PrivateNote[]>([]);
  const [selectedNoteCommitment, setSelectedNoteCommitment] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncProgress, setSyncProgress] = useState<string>('');
  const [allCommitments, setAllCommitments] = useState<string[]>([]);
  const commitmentsStorageKey = userAddress ? `whisper_commitments_${userAddress}` : '';
  
  const [reconstructedLogs, setReconstructedLogs] = useState<ActivityLog[]>([]);
  const logsStorageKey = userAddress ? `whisper_activity_logs_${userAddress}` : '';

  // Load activity logs from localStorage on connection
  useEffect(() => {
    if (!userAddress) {
      setReconstructedLogs([]);
      return;
    }
    const storedLogs = localStorage.getItem(logsStorageKey);
    if (storedLogs) {
      try {
        setReconstructedLogs(JSON.parse(storedLogs));
      } catch (e) {
        console.error("Failed to parse stored logs:", e);
      }
    } else {
      setReconstructedLogs([]);
    }
  }, [userAddress, logsStorageKey]);

  // Reset notes if contract ID changed (redeployment check) or load from localStorage on connection
  useEffect(() => {
    if (!userAddress) {
      setNotes([]);
      setSelectedNoteCommitment('');
      setAllCommitments([]);
      if (updateShieldedBalances) {
        updateShieldedBalances(0, 0);
      }
      return;
    }

    const storedContractId = localStorage.getItem(`whisper_active_contract_${userAddress}`);
    if (!storedContractId || storedContractId !== whisperContractId) {
      localStorage.removeItem(`whisper_notes_${userAddress}`);
      localStorage.removeItem(`whisper_shielded_balance_${userAddress}`);
      localStorage.removeItem(`whisper_shielded_balance_usdc_${userAddress}`);
      localStorage.removeItem(`whisper_shielded_balance_xlm_${userAddress}`);
      localStorage.removeItem(`whisper_latest_root_${userAddress}`);
      localStorage.removeItem(`whisper_commitments_${userAddress}`);
      setNotes([]);
      setSelectedNoteCommitment('');
      setAllCommitments([]);
      if (updateShieldedBalances) {
        updateShieldedBalances(0, 0);
      }
    } else {
      const stored = localStorage.getItem(`whisper_notes_${userAddress}`);
      let parsedNotes: PrivateNote[] = [];
      if (stored) {
        try {
          parsedNotes = JSON.parse(stored);
          setNotes(parsedNotes);
          const unspent = parsedNotes.filter((n: any) => !n.spent);
          if (unspent.length > 0) {
            setSelectedNoteCommitment(unspent[0].commitment);
          }
        } catch (e) {
          console.error("Failed to parse stored notes:", e);
          setNotes([]);
        }
      } else {
        setNotes([]);
      }

      const storedCommitments = localStorage.getItem(`whisper_commitments_${userAddress}`);
      if (storedCommitments) {
        try {
          setAllCommitments(JSON.parse(storedCommitments));
        } catch (e) {
          console.error("Failed to parse stored commitments:", e);
          setAllCommitments([]);
        }
      } else {
        setAllCommitments(
          parsedNotes.map((note: PrivateNote) => note.commitment)
        );
      }
    }
    
    localStorage.setItem(`whisper_active_contract_${userAddress}`, whisperContractId);
  }, [userAddress, whisperContractId]);

  useEffect(() => {
    if (userAddress) {
      localStorage.setItem(commitmentsStorageKey, JSON.stringify(allCommitments));
    }
  }, [userAddress, commitmentsStorageKey, allCommitments]);

  // Synchronize shielded balance to the sum of active unspent note balances
  useEffect(() => {
    if (notes.length > 0) {
      const activeNotes = notes.filter(n => !n.spent);
      const unspentUsdcSum = activeNotes
        .filter(n => n.assetAddress !== XLM_CONTRACT_ID)
        .reduce((sum, n) => sum + n.amount, 0);
      const unspentXlmSum = activeNotes
        .filter(n => n.assetAddress === XLM_CONTRACT_ID)
        .reduce((sum, n) => sum + n.amount, 0);
      if (updateShieldedBalances) {
        updateShieldedBalances(unspentUsdcSum, unspentXlmSum);
      }
    } else if (userAddress) {
      const storedUsdc = localStorage.getItem(`whisper_shielded_balance_usdc_${userAddress}`);
      const storedXlm = localStorage.getItem(`whisper_shielded_balance_xlm_${userAddress}`);
      if (updateShieldedBalances) {
        updateShieldedBalances(Number(storedUsdc || 0), Number(storedXlm || 0));
      }
    }
  }, [notes, userAddress, updateShieldedBalances]);

  // Auto-sync notes from blockchain on login/ZK Key Derivation
  useEffect(() => {
    if (userAddress && zkPrivateKey) {
      syncNotesFromChain();
    }
  }, [userAddress, zkPrivateKey]);

  // Selection synchronization helper
  useEffect(() => {
    const unspent = notes.filter(n => !n.spent);
    if (unspent.length > 0) {
      const found = unspent.find(n => n.commitment === selectedNoteCommitment);
      if (!found) {
        setSelectedNoteCommitment(unspent[0].commitment);
      }
    } else {
      setSelectedNoteCommitment('');
    }
  }, [notes, selectedNoteCommitment]);

  const syncNotesFromChain = async (isSilent: boolean = false) => {
    if (!userAddress || !zkPrivateKey) {
      return;
    }
    
    if (!isSilent) {
      setIsSyncing(true);
      setSyncProgress('Connecting to Soroban RPC...');
    }
    
    try {
      const scanViewingKey = await deriveViewingKey(zkPrivateKey);
    const server = new rpc.Server(RPC_URL);
      
      if (!isSilent) setSyncProgress('Fetching latest ledger sequence...');
      const latestLedger = await server.getLatestLedger();
      const endLedger = latestLedger.sequence;
      
      const startLedger = 1;
      let events: any[] = [];
      let usedFallback = false;

      if (supabase) {
        try {
          if (!isSilent) setSyncProgress("Querying Supabase...");
          const supabaseEvents = await fetchEventsFromSupabase(whisperContractId);
          if (supabaseEvents.length > 0) {
            events = supabaseEvents;
            usedFallback = true;
            console.log(`Successfully fetched ${events.length} events from Supabase.`);
          }
        } catch (err) {
          console.log("Supabase query failed.", err);
        }
      }

      if (!usedFallback) {
        try {
          if (!isSilent) setSyncProgress("Querying local indexer...");
          const indexerResponse = await fetch(`${INDEXER_URL}/api/events`);
          if (indexerResponse.ok) {
            const indexerData = await indexerResponse.json();
            if (indexerData.contractId === whisperContractId) {
              events = indexerData.events || [];
              usedFallback = true;
              console.log(`Successfully fetched ${events.length} events from local indexer.`);
            } else {
              console.warn(`Indexer contract mismatch: ${indexerData.contractId} vs ${whisperContractId}`);
            }
          }
        } catch (err) {
          console.log("Local indexer is not running or unreachable.");
        }
      }

      if (!usedFallback) {
        if (!isSilent) setSyncProgress(`Scanning blockchain history...`);
        try {
          events = await fetchContractEvents(server, whisperContractId, startLedger);
        } catch (e: any) {
          const errorMsg = e.message || String(e);
          const match = errorMsg.match(/range:\s*(\d+)/i) || errorMsg.match(/(\d+)\s*-\s*(\d+)/);
          if (match && match[1]) {
            const minLedger = parseInt(match[1], 10);
            console.log(`Retrying event query with adjusted startLedger: ${minLedger}`);
            events = await fetchContractEvents(server, whisperContractId, minLedger);
          } else {
            console.log(`Failed to parse range from error. Retrying with endLedger - 120000`);
            const fallbackStart = Math.max(1, endLedger - 120000);
            events = await fetchContractEvents(server, whisperContractId, fallbackStart);
          }
        }
      }
      
      console.log(`Fetched ${events.length} events.`);
      if (!isSilent) setSyncProgress(`Found ${events.length} contract events. Decrypting...`);
      
      const decryptedNotesMap = new Map<string, PrivateNote>();
      const spentNullifiers = new Set<string>();
      const allCommitmentsBytes: Uint8Array[] = [];
      
      for (const event of events) {
        try {
          const topics = (event.topic || []).map((t: any) => parseScVal(t));
          
          const rawEventType = topics[0];
          let eventType = "";
          if (typeof rawEventType === 'string') {
            eventType = rawEventType;
          } else if (rawEventType && (rawEventType instanceof Uint8Array)) {
            eventType = new TextDecoder().decode(rawEventType);
          } else if (rawEventType && typeof rawEventType === 'object') {
            eventType = rawEventType.toString();
          } else if (rawEventType) {
            eventType = String(rawEventType);
          }
          
          const data = parseScVal(event.value);

          if (eventType === "deposit" || eventType === "shielded_output" || eventType === "shielded_swap") {
            
            const isSwap = eventType === "shielded_swap";
            const commitmentVal = data && typeof data === 'object'
              ? (isSwap
                  ? (data.new_commitment || data.newCommitment || (Array.isArray(data) ? data[5] : undefined))
                  : (data.commitment || data.Commitment || (Array.isArray(data) ? data[0] : undefined)))
              : undefined;

            if (!commitmentVal) {
              continue;
            }
            const commitmentHex = bytesToHex(commitmentVal);
            allCommitmentsBytes.push(new Uint8Array(commitmentVal as any));
            
            const tokenVal = data && typeof data === 'object'
              ? (isSwap
                  ? (data.token_out || data.tokenOut || (Array.isArray(data) ? data[2] : undefined))
                  : (data.token || data.Token || (Array.isArray(data) ? data[1] : undefined)))
              : undefined;
            const eventTokenAddress = tokenVal ? tokenVal.toString() : usdcContractId;

            const rawAmount = data && typeof data === 'object'
              ? (isSwap
                  ? (data.amount_out || data.amountOut || (Array.isArray(data) ? data[4] : undefined))
                  : (data.amount || data.Amount || (Array.isArray(data) ? data[3] : 0n)))
              : 0n;
            
            const encryptedNoteVal = data && typeof data === 'object'
              ? (isSwap
                  ? (data.encrypted_note || data.encryptedNote || data.EncryptedNote || (Array.isArray(data) ? data[6] : undefined))
                  : (data.encrypted_note || data.encryptedNote || data.EncryptedNote || (Array.isArray(data) ? data[2] : undefined)))
              : undefined;
            const hexCiphertext = encryptedNoteVal ? bytesToHex(encryptedNoteVal) : "";
            
            if (hexCiphertext) {
              const decrypted = await decryptNote(scanViewingKey, hexCiphertext);
              if (decrypted) {
                const { nullifier_nonce, amount: decryptedAmount, assetAddress: decryptedAssetAddress } = decrypted;
                
                const rawHuman = Number(BigInt(rawAmount)) / 10000000;
                const noteAmount = decryptedAmount !== undefined ? Math.round(decryptedAmount * 10000000) / 10000000 : Math.round(rawHuman * 10000000) / 10000000;
                const finalAssetAddress = decryptedAssetAddress || eventTokenAddress;
                
                decryptedNotesMap.set(commitmentHex, {
                  amount: noteAmount,
                  nullifierNonce: nullifier_nonce,
                  commitment: commitmentHex,
                  spent: false,
                  txHash: event.txHash || '',
                  timestamp: event.ledgerClosedAt || 'Just now',
                  assetAddress: finalAssetAddress
                });
              }
            }
          } else if (eventType === "withdrawal" || eventType === "shielded_transfer" || eventType === "shielded_swap") {
            const nullifierVal = data && typeof data === 'object' 
              ? (data.nullifier || data.Nullifier || (Array.isArray(data) ? data[0] : undefined)) 
              : undefined;
            if (nullifierVal) {
              const nullifierHex = bytesToHex(nullifierVal);
              spentNullifiers.add(nullifierHex);
            }
          }
        } catch (err) {
          console.error("Failed to parse event:", err);
        }
      }
      
      const existingNotes: PrivateNote[] = [];
      const stored = localStorage.getItem(`whisper_notes_${userAddress}`);
      if (stored) {
        try {
          existingNotes.push(...JSON.parse(stored));
        } catch (e) {
          console.error("Failed to parse existing notes:", e);
        }
      }

      const notesMap = new Map<string, PrivateNote>();
      
      // Load all existing notes from localStorage first
      for (const note of existingNotes) {
        notesMap.set(note.commitment, note);
      }
      
      // Merge in any decrypted notes found from the chain events scan
      for (const note of decryptedNotesMap.values()) {
        notesMap.set(note.commitment, note);
      }
      
      const commitmentHexes = allCommitmentsBytes.map(bytes => bytesToHex(bytes));
      
      // Create a map of existing notes keyed by commitment for merging
      const existingNotesMap = new Map<string, PrivateNote>();
      for (const note of existingNotes) {
        existingNotesMap.set(note.commitment, note);
      }
      
      // Merge decrypted notes into existing notes map (overwriting if needed)
      for (const note of decryptedNotesMap.values()) {
        const existing = existingNotesMap.get(note.commitment);
        existingNotesMap.set(note.commitment, {
          ...note,
          spent: existing?.spent || note.spent
        });
      }
      
      // Now build finalNotes array from the merged map
      const existingNotesListRaw = Array.from(existingNotesMap.values());
      const finalNotesList = await Promise.all(
        existingNotesListRaw.map(async (note) => {
          const nullifierBytes = await deriveNullifier(zkPrivateKey, note.nullifierNonce);
          const nullifierHex = bytesToHexDirect(nullifierBytes);
          
          let isSpent = spentNullifiers.has(nullifierHex);
          
          // If not found in scanned events, query contract directly on-chain to check spent status
          if (!isSpent) {
            const simulationSource = userAddress;
            const onChainResult = await checkNullifierOnChain(
              nullifierBytes,
              whisperContractId,
              simulationSource
            );
            // null means the check failed — keep the existing spent status rather than defaulting to false
            if (onChainResult !== null) {
              isSpent = onChainResult;
            }
          }
          
          return {
            ...note,
            spent: isSpent
          };
        })
      );
      
      
      // Build the canonical commitment list.
      // The on-chain Merkle tree is built strictly in insertion order, so the
      // commitment list we use for root/path computation MUST mirror that order.
      // Event-sourced commitments (`commitmentHexes`) are already in ledger order
      // and represent the ground truth. We only fall back to localStorage when
      // the event scan returned nothing (e.g., events pruned beyond the RPC window).
      const mergedCommitmentsSet = new Set<string>();
      const finalCommitmentsList: string[] = [];

      if (commitmentHexes.length > 0) {
        // Events are available — use them as the canonical ordered list
        for (const commitment of commitmentHexes) {
          if (!mergedCommitmentsSet.has(commitment)) {
            mergedCommitmentsSet.add(commitment);
            finalCommitmentsList.push(commitment);
          }
        }
      } else {
        // No events found (pruned or empty) — fall back to localStorage
        const storedCommitmentsStr = localStorage.getItem(commitmentsStorageKey);
        let currentCommitments: string[] = [];
        if (storedCommitmentsStr) {
          try {
            currentCommitments = JSON.parse(storedCommitmentsStr);
          } catch (e) {
            console.error("Failed to parse stored commitments from localStorage:", e);
          }
        }
        if (currentCommitments.length === 0) {
          currentCommitments = Array.from(existingNotesMap.keys());
        }
        for (const commitment of currentCommitments) {
          if (!mergedCommitmentsSet.has(commitment)) {
            mergedCommitmentsSet.add(commitment);
            finalCommitmentsList.push(commitment);
          }
        }
      }

      // Self-healing: ensure all commitments from our own notes are also present
      // (covers edge cases where a note's deposit event fell outside the scan window)
      for (const note of finalNotesList) {
        if (!mergedCommitmentsSet.has(note.commitment)) {
          mergedCommitmentsSet.add(note.commitment);
          finalCommitmentsList.push(note.commitment);
        }
      }
      
      if (finalCommitmentsList.length > 0) {
        const combinedCommitmentsBytes = finalCommitmentsList.map(hex => hexToBytes(hex));
        const rootHex = await computeLatestMerkleRootOnChain(combinedCommitmentsBytes);
        localStorage.setItem(`whisper_latest_root_${userAddress}`, rootHex);
      } else {
        const defaultRootBytes = getOnChainZeroHash(16);
        const defaultRootHex = Array.from(defaultRootBytes).map((b: number) => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem(`whisper_latest_root_${userAddress}`, defaultRootHex);
      }
      
      setAllCommitments(finalCommitmentsList);
      setNotes(finalNotesList);
      localStorage.setItem(`whisper_notes_${userAddress}`, JSON.stringify(finalNotesList));
      localStorage.setItem(commitmentsStorageKey, JSON.stringify(finalCommitmentsList));
      
      const activeNotes = finalNotesList.filter(n => !n.spent);
      const usdcSum = activeNotes
        .filter(n => !n.assetAddress || n.assetAddress === usdcContractId)
        .reduce((sum, n) => sum + n.amount, 0);
      const xlmSum = activeNotes
        .filter(n => n.assetAddress && n.assetAddress !== usdcContractId)
        .reduce((sum, n) => sum + n.amount, 0);
      if (updateShieldedBalances) {
        updateShieldedBalances(usdcSum, xlmSum);
      }

      // --- CANONICAL TRANSACTION HISTORY RECONSTRUCTION ---
      const reconstructed: ActivityLog[] = [];
      const noteNullifierMap = new Map<string, string>(); // commitment -> nullifierHex
      const nullifierNoteMap = new Map<string, PrivateNote>(); // nullifierHex -> note
      
      for (const note of finalNotesList) {
        const nullifierBytes = await deriveNullifier(zkPrivateKey, note.nullifierNonce);
        const nullifierHex = bytesToHexDirect(nullifierBytes);
        noteNullifierMap.set(note.commitment, nullifierHex);
        nullifierNoteMap.set(nullifierHex, note);
      }

      // Group events by txHash
      const txEventsMap = new Map<string, any[]>();
      for (const event of events) {
        if (event.txHash) {
          if (!txEventsMap.has(event.txHash)) {
            txEventsMap.set(event.txHash, []);
          }
          txEventsMap.get(event.txHash)!.push(event);
        }
      }

      for (const [txHash, txEvents] of txEventsMap.entries()) {
        let weSpent = false;
        let spentNote: PrivateNote | undefined;
        let weReceivedNotes: PrivateNote[] = [];
        let isWithdrawal = false;
        let isDeposit = false;
        let isSwap = false;
        let depositAmount = 0;
        let depositCommitment = "";
        let eventTimestamp = "Just now";
        let swapInAmount = 0;
        let swapOutAmount = 0;
        let swapTokenOut = "";

        for (const event of txEvents) {
          if (event.ledgerClosedAt) {
            const d = new Date(event.ledgerClosedAt);
            eventTimestamp = d.toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            });
          }

          try {
            const topics = (event.topic || []).map((t: any) => parseScVal(t));
            const rawEventType = topics[0];
            let eventType = "";
            if (typeof rawEventType === 'string') {
              eventType = rawEventType;
            } else if (rawEventType && (rawEventType instanceof Uint8Array)) {
              eventType = new TextDecoder().decode(rawEventType);
            } else if (rawEventType && typeof rawEventType === 'object') {
              if (rawEventType.constructor?.name === 'Buffer' || rawEventType.constructor?.name === 'Uint8Array') {
                eventType = new TextDecoder().decode(Uint8Array.from(rawEventType));
              } else {
                eventType = rawEventType.toString();
              }
            } else if (rawEventType) {
              eventType = String(rawEventType);
            }

            const valData = parseScVal(event.value);

            if (eventType === "deposit") {
              isDeposit = true;
              const rawAmount = valData && typeof valData === 'object' ? (valData.amount || valData.Amount || 0n) : 0n;
              depositAmount = Number(BigInt(rawAmount)) / 10000000;
              const commitmentVal = valData && typeof valData === 'object' ? (valData.commitment || valData.Commitment) : undefined;
              if (commitmentVal) {
                depositCommitment = bytesToHex(commitmentVal);
              }
            } else if (eventType === "withdrawal") {
              isWithdrawal = true;
              const nullifierVal = valData && typeof valData === 'object' ? (valData.nullifier || valData.Nullifier) : undefined;
              if (nullifierVal) {
                const nullifierHex = bytesToHex(nullifierVal);
                if (nullifierNoteMap.has(nullifierHex)) {
                  weSpent = true;
                  spentNote = nullifierNoteMap.get(nullifierHex);
                }
              }
            } else if (eventType === "shielded_transfer") {
              const nullifierVal = valData && typeof valData === 'object' ? (valData.nullifier || valData.Nullifier) : undefined;
              if (nullifierVal) {
                const nullifierHex = bytesToHex(nullifierVal);
                if (nullifierNoteMap.has(nullifierHex)) {
                  weSpent = true;
                  spentNote = nullifierNoteMap.get(nullifierHex);
                }
              }
            } else if (eventType === "shielded_swap") {
              isSwap = true;
              const nullifierVal = valData && typeof valData === 'object' ? (valData.nullifier || valData.Nullifier) : undefined;
              if (nullifierVal) {
                const nullifierHex = bytesToHex(nullifierVal);
                if (nullifierNoteMap.has(nullifierHex)) {
                  weSpent = true;
                  spentNote = nullifierNoteMap.get(nullifierHex);
                }
              }
              const rawAmountIn = valData && typeof valData === 'object' ? (valData.amount_in || valData.amountIn || 0n) : 0n;
              const rawAmountOut = valData && typeof valData === 'object' ? (valData.amount_out || valData.amountOut || 0n) : 0n;
              swapInAmount = Number(BigInt(rawAmountIn)) / 10000000;
              swapOutAmount = Number(BigInt(rawAmountOut)) / 10000000;
              const tokenOutVal = valData && typeof valData === 'object' ? (valData.token_out || valData.tokenOut) : undefined;
              swapTokenOut = tokenOutVal ? tokenOutVal.toString() : "";
            }
          } catch (e) {
            console.warn("Error parsing event in log reconstruction:", e);
          }
        }

        // Check if we decrypted any received commitments in this tx
        for (const note of decryptedNotesMap.values()) {
          if (note.txHash === txHash) {
            weReceivedNotes.push(note);
          }
        }

        if (isSwap && weSpent && spentNote) {
          const assetIn = spentNote.assetAddress === XLM_CONTRACT_ID ? 'XLM' : 'USDC';
          const assetOut = swapTokenOut === XLM_CONTRACT_ID ? 'XLM' : 'USDC';
          reconstructed.push({
            id: txHash + "-swap",
            type: 'swap' as any,
            amount: swapInAmount,
            recipient: `${swapOutAmount.toFixed(2)} ${assetOut}`,
            timestamp: eventTimestamp,
            status: 'success',
            txHash: txHash,
            details: `Swapped ${swapInAmount} ${assetIn} for ${swapOutAmount.toFixed(2)} ${assetOut}`,
            asset: assetIn
          });
        } else if (isDeposit && depositCommitment && decryptedNotesMap.has(depositCommitment)) {
          const depNote = decryptedNotesMap.get(depositCommitment);
          const depAsset = depNote?.assetAddress === XLM_CONTRACT_ID ? 'XLM' : 'USDC';
          reconstructed.push({
            id: txHash + "-deposit",
            type: 'deposit',
            amount: depositAmount,
            timestamp: eventTimestamp,
            status: 'success',
            txHash: txHash,
            asset: depAsset
          });
        } else if (weSpent && isWithdrawal && spentNote) {
          const changeNote = weReceivedNotes.find(n => n.commitment !== spentNote!.commitment);
          const changeAmount = changeNote ? changeNote.amount : 0;
          const withdrawnAmount = spentNote.amount - changeAmount;
          const spentAsset = spentNote.assetAddress === XLM_CONTRACT_ID ? 'XLM' : 'USDC';
          reconstructed.push({
            id: txHash + "-withdrawal",
            type: 'transfer',
            amount: withdrawnAmount,
            recipient: 'Public Account (Withdrawn)',
            timestamp: eventTimestamp,
            status: 'success',
            txHash: txHash,
            details: 'Withdrawal from shielded pool',
            asset: spentAsset
          });
        } else if (weSpent && spentNote) {
          const changeNote = weReceivedNotes.find(n => n.commitment !== spentNote!.commitment);
          const changeAmount = changeNote ? changeNote.amount : 0;
          const sentAmount = spentNote.amount - changeAmount;
          const spentAsset = spentNote.assetAddress === XLM_CONTRACT_ID ? 'XLM' : 'USDC';

          if (sentAmount > 0) {
            reconstructed.push({
              id: txHash + "-transfer-send",
              type: 'transfer',
              amount: sentAmount,
              recipient: 'Shielded Account (Sent)',
              timestamp: eventTimestamp,
              status: 'success',
              txHash: txHash,
              details: 'Shielded transfer sent',
              asset: spentAsset
            });
          }
        } else if (weReceivedNotes.length > 0 && !isDeposit) {
          for (const note of weReceivedNotes) {
            const recvAsset = note.assetAddress === XLM_CONTRACT_ID ? 'XLM' : 'USDC';
            reconstructed.push({
              id: txHash + "-transfer-receive-" + note.commitment.slice(0, 6),
              type: 'transfer',
              amount: note.amount,
              recipient: 'Received (Shielded)',
              timestamp: eventTimestamp,
              status: 'success',
              txHash: txHash,
              details: 'Shielded transfer received',
              asset: recvAsset
            });
          }
        }
      }

      // Sort by ledger order descending
      const txLedgerMap = new Map<string, number>();
      for (const event of events) {
        if (event.txHash && event.ledger) {
          txLedgerMap.set(event.txHash, event.ledger);
        }
      }
      reconstructed.sort((a, b) => {
        const ledgerA = txLedgerMap.get(a.txHash || "") || 0;
        const ledgerB = txLedgerMap.get(b.txHash || "") || 0;
        return ledgerB - ledgerA;
      });

      setReconstructedLogs(reconstructed);
      localStorage.setItem(logsStorageKey, JSON.stringify(reconstructed));
      
      if (!isSilent) {
        setSyncProgress(`Sync complete! Recovered ${finalNotesList.length} notes (${activeNotes.length} unspent).`);
        setTimeout(() => setSyncProgress(''), 5000);
      }
    } catch (err: any) {
      console.error("Error syncing events:", err);
      if (!isSilent) setSyncProgress(`Sync failed: ${err.message || String(err)}`);
    } finally {
      if (!isSilent) {
        setIsSyncing(false);
      }
    }
  };

  const importNotes = (importedNotes: PrivateNote[]) => {
    if (!userAddress) return;
    setNotes(prev => {
      const existingCommitments = new Set(prev.map(n => n.commitment));
      const newUniqueNotes = importedNotes.filter(n => !existingCommitments.has(n.commitment));
      const updated = [...prev, ...newUniqueNotes];
      localStorage.setItem(`whisper_notes_${userAddress}`, JSON.stringify(updated));
      setAllCommitments(updated.map(n => n.commitment));
      
      const activeNotes = updated.filter(n => !n.spent);
      const usdcSum = activeNotes
        .filter(n => !n.assetAddress || n.assetAddress === usdcContractId)
        .reduce((sum, n) => sum + n.amount, 0);
      const xlmSum = activeNotes
        .filter(n => n.assetAddress && n.assetAddress !== usdcContractId)
        .reduce((sum, n) => sum + n.amount, 0);
      if (updateShieldedBalances) {
        updateShieldedBalances(usdcSum, xlmSum);
      }
      return updated;
    });
    // Trigger on-chain check immediately for newly imported notes
    syncNotesFromChain(true);
  };

  // Background polling for real-time updates (every 5 seconds)
  useEffect(() => {
    if (!userAddress || !zkPrivateKey) return;

    let syncPromise: Promise<void> | null = null;
    const interval = setInterval(async () => {
      if (!syncPromise) {
        syncPromise = syncNotesFromChain(true).finally(() => { syncPromise = null; });
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [userAddress, zkPrivateKey]);

  return {
    notes,
    setNotes,
    selectedNoteCommitment,
    setSelectedNoteCommitment,
    isSyncing,
    syncProgress,
    allCommitments,
    setAllCommitments,
    syncNotesFromChain,
    importNotes,
    logs: reconstructedLogs
  };
}
