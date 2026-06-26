import { useState, useEffect } from 'react';
import { rpc, scValToNative, xdr, Contract, Account, TransactionBuilder, Networks, nativeToScVal } from '@stellar/stellar-sdk';
import type { PrivateNote, ActivityLog } from '../types';
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
): Promise<boolean> {
  try {
    const server = new rpc.Server("https://soroban-testnet.stellar.org");
    const dummyAccount = new Account(sourceAddress, "0");
    const contract = new Contract(contractId);
    const tx = new TransactionBuilder(dummyAccount, {
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
  return false;
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

export function useNotes(
  userAddress: string, 
  zkPrivateKey: string, 
  whisperContractId: string,
  updateShieldedBalances?: (usdcBal: number, xlmBal: number) => void,
  usdcContractId: string = 'CCD7B5ENZPTMYOB7XZ6VYLCABAQ66TB4UY5BEAQWCZMHMNAXPWKBKXYR'
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
      console.log(`Detected contract redeployment (from ${storedContractId} to ${whisperContractId}). Clearing local storage keys to avoid desync.`);
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
        .filter(n => n.assetAddress !== 'CDLZ436FHGO726A56A3L77Z6IAGY7TKVIFH67IHX63D5KIL4S4NMM6SG')
        .reduce((sum, n) => sum + n.amount, 0);
      const unspentXlmSum = activeNotes
        .filter(n => n.assetAddress === 'CDLZ436FHGO726A56A3L77Z6IAGY7TKVIFH67IHX63D5KIL4S4NMM6SG')
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
      const server = new rpc.Server("https://soroban-testnet.stellar.org");
      
      setSyncProgress('Fetching latest ledger sequence...');
      const latestLedger = await server.getLatestLedger();
      const endLedger = latestLedger.sequence;
      
      const startLedger = 1;
      let events: any[] = [];
      let usedIndexer = false;

      try {
        console.log("Attempting to sync events from local indexer...");
        setSyncProgress("Querying local indexer...");
        const indexerResponse = await fetch("http://localhost:8123/api/events");
        if (indexerResponse.ok) {
          const indexerData = await indexerResponse.json();
          if (indexerData.contractId === whisperContractId) {
            events = indexerData.events || [];
            usedIndexer = true;
            console.log(`Successfully fetched ${events.length} events from local indexer.`);
          } else {
            console.warn(`Local indexer is running for a different contract: ${indexerData.contractId} vs current ${whisperContractId}`);
          }
        }
      } catch (err) {
        console.log("Local indexer is not running or unreachable. Falling back to direct blockchain scan.");
      }

      if (!usedIndexer) {
        if (!isSilent) setSyncProgress(`Scanning blockchain history...`);
        console.log(`Syncing notes: querying contract ${whisperContractId} from ledger ${startLedger} to ${endLedger}`);
        try {
          events = await fetchContractEvents(server, whisperContractId, startLedger);
        } catch (e: any) {
          const errorMsg = e.message || String(e);
          console.warn(`Initial event query failed: ${errorMsg}`);
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
          const topics = (event.topic || []).map((t: any) => scValToNative(xdr.ScVal.fromXDR(t as any, "base64")));
          console.log("Raw event topics from blockchain:", topics);
          
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
          
          console.log(`Parsed event type: "${eventType}"`);
          
          const data = scValToNative(xdr.ScVal.fromXDR(event.value as any, "base64"));
          console.log(`${eventType} event value data:`, data);
          
          if (eventType === "deposit" || eventType === "shielded_output") {
            console.log("=== Processing deposit/shielded_output event ===");
            console.log("  - event:", event);
            const commitmentVal = data && typeof data === 'object' 
              ? (data.commitment || data.Commitment || (Array.isArray(data) ? data[0] : undefined)) 
              : undefined;
            console.log("  - commitmentVal:", commitmentVal);
            if (!commitmentVal) {
              console.warn("Event is missing commitment field:", data);
              continue;
            }
            const commitmentHex = bytesToHex(commitmentVal);
            console.log("  - commitmentHex:", commitmentHex);
            allCommitmentsBytes.push(new Uint8Array(commitmentVal as any));
            
            const tokenVal = data && typeof data === 'object' 
              ? (data.token || data.Token) 
              : undefined;
            const eventTokenAddress = tokenVal ? tokenVal.toString() : usdcContractId;

            const rawAmount = data && typeof data === 'object' 
              ? (data.amount || data.Amount || 0n) 
              : 0n;
            const encryptedNoteVal = data && typeof data === 'object' 
              ? (data.encrypted_note || data.encryptedNote || data.EncryptedNote || (Array.isArray(data) ? data[2] : undefined)) 
              : undefined;
            const hexCiphertext = encryptedNoteVal ? bytesToHex(encryptedNoteVal) : "";
            
            if (hexCiphertext) {
              console.log(`Decrypting note for commitment ${commitmentHex} with ciphertext length ${hexCiphertext.length}...`);
              const decrypted = await decryptNote(scanViewingKey, hexCiphertext);
              if (decrypted) {
                console.log("Successfully decrypted note payload:", decrypted);
                const { nullifier_nonce, amount: decryptedAmount } = decrypted;
                
                // Use decrypted amount if available (for shielded transfer), or fall back to event's public amount (for deposit)
                const noteAmount = decryptedAmount !== undefined ? decryptedAmount : (Number(BigInt(rawAmount)) / 10000000);
                
                decryptedNotesMap.set(commitmentHex, {
                  amount: noteAmount,
                  nullifierNonce: nullifier_nonce,
                  commitment: commitmentHex,
                  spent: false,
                  txHash: event.txHash || '',
                  timestamp: event.ledgerClosedAt || 'Just now',
                  assetAddress: eventTokenAddress
                });
              } else {
                console.log(`Failed to decrypt note for commitment ${commitmentHex} (belongs to another user's public key)`);
              }
            }
          } else if (eventType === "withdrawal" || eventType === "shielded_transfer") {
            const nullifierVal = data && typeof data === 'object' 
              ? (data.nullifier || data.Nullifier || (Array.isArray(data) ? data[0] : undefined)) 
              : undefined;
            if (nullifierVal) {
              const nullifierHex = bytesToHex(nullifierVal);
              console.log(`Found spent nullifier hash from ${eventType}: ${nullifierHex}`);
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
      console.log("=== useNotes commitmentHexes ===", commitmentHexes);
      
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
          
          // If locally marked spent but not in the event scan, double-check on-chain status
          if (note.spent && !isSpent) {
            const simulationSource = userAddress;
            isSpent = await checkNullifierOnChain(
              nullifierBytes,
              whisperContractId,
              simulationSource
            );
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
      
      console.log("=== useNotes finalCommitmentsList ===", finalCommitmentsList);

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
      const unspentSum = activeNotes.reduce((sum, n) => sum + n.amount, 0);
      if (updateShieldedBalance) {
        updateShieldedBalance(unspentSum);
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
        let depositAmount = 0;
        let depositCommitment = "";
        let eventTimestamp = "Just now";

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
            const topics = (event.topic || []).map((t: any) => scValToNative(xdr.ScVal.fromXDR(t as any, "base64")));
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

            const valData = scValToNative(xdr.ScVal.fromXDR(event.value as any, "base64"));

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

        if (isDeposit && depositCommitment && decryptedNotesMap.has(depositCommitment)) {
          reconstructed.push({
            id: txHash + "-deposit",
            type: 'deposit',
            amount: depositAmount,
            timestamp: eventTimestamp,
            status: 'success',
            txHash: txHash
          });
        } else if (weSpent && isWithdrawal && spentNote) {
          reconstructed.push({
            id: txHash + "-withdrawal",
            type: 'transfer',
            amount: spentNote.amount,
            recipient: 'Public Account (Withdrawn)',
            timestamp: eventTimestamp,
            status: 'success',
            txHash: txHash,
            details: 'Withdrawal from shielded pool'
          });
        } else if (weSpent && spentNote) {
          const changeNote = weReceivedNotes.find(n => n.commitment !== spentNote!.commitment);
          const changeAmount = changeNote ? changeNote.amount : 0;
          const sentAmount = spentNote.amount - changeAmount;

          if (sentAmount > 0) {
            reconstructed.push({
              id: txHash + "-transfer-send",
              type: 'transfer',
              amount: sentAmount,
              recipient: 'Shielded Account (Sent)',
              timestamp: eventTimestamp,
              status: 'success',
              txHash: txHash,
              details: 'Shielded transfer sent'
            });
          }
        } else if (weReceivedNotes.length > 0 && !isDeposit) {
          for (const note of weReceivedNotes) {
            reconstructed.push({
              id: txHash + "-transfer-receive-" + note.commitment.slice(0, 6),
              type: 'transfer',
              amount: note.amount,
              recipient: 'Received (Shielded)',
              timestamp: eventTimestamp,
              status: 'success',
              txHash: txHash,
              details: 'Shielded transfer received'
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
      
      const unspentSum = updated.filter(n => !n.spent).reduce((sum, n) => sum + n.amount, 0);
      if (updateShieldedBalance) {
        updateShieldedBalance(unspentSum);
      }
      return updated;
    });
  };

  // Background polling for real-time updates (every 5 seconds)
  useEffect(() => {
    if (!userAddress || !zkPrivateKey) return;

    const interval = setInterval(() => {
      if (!isSyncing) {
        syncNotesFromChain(true);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [userAddress, zkPrivateKey, isSyncing]);

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
