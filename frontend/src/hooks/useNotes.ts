import { useState, useEffect } from 'react';
import { rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import type { PrivateNote } from '../types';
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

const fetchContractEvents = async (
  server: rpc.Server,
  whisperContractId: string,
  startLedger: number
) => {
  const events: any[] = [];
  let cursor: string | undefined;

  do {
    const request: any = {
      startLedger,
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
    }

    const response = await server.getEvents(request);

    events.push(...(response.events || []));
    cursor = response.cursor || undefined;

    if (!response.events || response.events.length === 0) {
      break;
    }
  } while (cursor);

  return events;
};

export function useNotes(
  userAddress: string, 
  zkPrivateKey: string, 
  whisperContractId: string,
  updateShieldedBalance?: (bal: number) => void
) {
  const [notes, setNotes] = useState<PrivateNote[]>([]);
  const [selectedNoteCommitment, setSelectedNoteCommitment] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncProgress, setSyncProgress] = useState<string>('');
  const [allCommitments, setAllCommitments] = useState<string[]>([]);
  const commitmentsStorageKey = userAddress ? `whisper_commitments_${userAddress}` : '';

  // Reset notes if contract ID changed (redeployment check) or load from localStorage on connection
  useEffect(() => {
    if (!userAddress) {
      setNotes([]);
      setSelectedNoteCommitment('');
      setAllCommitments([]);
      if (updateShieldedBalance) {
        updateShieldedBalance(0);
      }
      return;
    }

    const storedContractId = localStorage.getItem(`whisper_active_contract_${userAddress}`);
    if (!storedContractId || storedContractId !== whisperContractId) {
      console.log(`Detected contract redeployment (from ${storedContractId} to ${whisperContractId}). Clearing local storage keys to avoid desync.`);
      localStorage.removeItem(`whisper_notes_${userAddress}`);
      localStorage.removeItem(`whisper_shielded_balance_${userAddress}`);
      localStorage.removeItem(`whisper_latest_root_${userAddress}`);
      localStorage.removeItem(`whisper_commitments_${userAddress}`);
      setNotes([]);
      setSelectedNoteCommitment('');
      setAllCommitments([]);
      if (updateShieldedBalance) {
        updateShieldedBalance(0);
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
      const unspentSum = notes
        .filter(n => !n.spent)
        .reduce((sum, n) => sum + n.amount, 0);
      if (updateShieldedBalance) {
        updateShieldedBalance(unspentSum);
      }
    } else if (userAddress) {
      const key = `whisper_shielded_balance_${userAddress}`;
      const stored = localStorage.getItem(key);
      if (stored !== null && updateShieldedBalance) {
        updateShieldedBalance(Number(stored));
      }
    }
  }, [notes, userAddress, updateShieldedBalance]);

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

  const syncNotesFromChain = async () => {
    if (!userAddress || !zkPrivateKey) {
      return;
    }
    
    setIsSyncing(true);
    setSyncProgress('Connecting to Soroban RPC...');
    
    try {
      const scanViewingKey = await deriveViewingKey(zkPrivateKey);
      const server = new rpc.Server("https://soroban-testnet.stellar.org");
      
      setSyncProgress('Fetching latest ledger sequence...');
      const latestLedger = await server.getLatestLedger();
      const endLedger = latestLedger.sequence;
      
      const startLedger = Math.max(1, endLedger - 120000);
      setSyncProgress(`Scanning ledgers ${startLedger} to ${endLedger}...`);
      
      console.log(`Syncing notes: scanning ledgers from ${startLedger} to ${endLedger} for contract ${whisperContractId}`);
      
      let events: any[] = [];
      try {
        events = await fetchContractEvents(server, whisperContractId, startLedger);
      } catch (e: any) {
        const errorMsg = e.message || String(e);
        console.warn(`Initial event query failed: ${errorMsg}`);
        const match = errorMsg.match(/range:\s*(\d+)/i);
        if (match && match[1]) {
          const minLedger = parseInt(match[1], 10);
          console.log(`Retrying event query with adjusted startLedger: ${minLedger}`);
          events = await fetchContractEvents(server, whisperContractId, minLedger);
        } else {
          console.log(`Failed to parse range from error. Retrying with endLedger - 10000`);
          const fallbackStart = Math.max(1, endLedger - 10000);
          events = await fetchContractEvents(server, whisperContractId, fallbackStart);
        }
      }
      
      console.log(`Fetched ${events.length} events from blockchain.`);
      setSyncProgress(`Found ${events.length} contract events. Decrypting...`);
      
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
                  timestamp: event.ledgerClosedAt || 'Just now'
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
        existingNotesMap.set(note.commitment, note);
      }
      
      // Now build finalNotes array from the merged map
      const finalNotesList: PrivateNote[] = [];
      for (const [, note] of existingNotesMap.entries()) {
        // Check if this note is spent
        const nullifierBytes = await deriveNullifier(zkPrivateKey, note.nullifierNonce);
        const nullifierHex = bytesToHexDirect(nullifierBytes);
        finalNotesList.push({
          ...note,
          spent: spentNullifiers.has(nullifierHex)
        });
      }
      
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
      
      setSyncProgress(`Sync complete! Recovered ${finalNotesList.length} notes (${activeNotes.length} unspent).`);
      setTimeout(() => setSyncProgress(''), 5000);
    } catch (err: any) {
      console.error("Error syncing events:", err);
      setSyncProgress(`Sync failed: ${err.message || String(err)}`);
    } finally {
      setIsSyncing(false);
    }
  };

  return {
    notes,
    setNotes,
    selectedNoteCommitment,
    setSelectedNoteCommitment,
    isSyncing,
    syncProgress,
    allCommitments,
    setAllCommitments,
    syncNotesFromChain
  };
}
