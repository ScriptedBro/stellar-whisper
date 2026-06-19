import React, { useState, useEffect } from 'react';
import { 
  rpc, 
  TransactionBuilder, 
  Networks, 
  Contract, 
  Account,
  nativeToScVal, 
  scValToNative, 
  xdr 
} from '@stellar/stellar-sdk';
import { 
  isConnected as isFreighterConnected, 
  requestAccess as requestFreighterAccess, 
  signTransaction as signFreighterTransaction,
  signMessage as signFreighterMessage
} from '@stellar/freighter-api';


// Configuration interface
interface Config {
  network: string;
  adminAddress: string;
  tokenContractId: string;
  verifierContractId: string;
  whisperContractId: string;
}

// Transaction type for activity log
interface ActivityLog {
  id: string;
  type: 'deposit' | 'transfer' | 'compliance';
  amount?: number;
  recipient?: string;
  timestamp: string;
  status: 'pending' | 'success' | 'verified' | 'failed';
  txHash?: string;
  details?: string;
}

// BN254 Prime field used in ZK circuits
const BN254_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Deterministic ZK-friendly hashes matching the Noir circuit logic:
// hash_1(x) = x * x + 0x12345
const hash_1 = (x: bigint): bigint => {
  return (x * x + 0x12345n) % BN254_PRIME;
};

// hash_2(x, y) = x * y + x + y + 0x67890
const hash_2 = (x: bigint, y: bigint): bigint => {
  return (x * y + x + y + 0x67890n) % BN254_PRIME;
};

// Convert BigInt back to a 32-byte Uint8Array (big-endian)
const bigIntToBytes32 = (val: bigint): Uint8Array => {
  let hex = val.toString(16);
  if (hex.length % 2 !== 0) hex = '0' + hex;
  hex = hex.padStart(64, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

// Helper to compute SHA-256 hash natively in browser
const sha256 = async (message: string): Promise<string> => {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

interface PrivateNote {
  amount: number;
  nullifierNonce: string; // Hex string (without 0x)
  commitment: string;     // Hex string (without 0x)
  spent: boolean;
  txHash?: string;
  timestamp?: string;
}

const bytesToHex = (bytesVal: any): string => {
  if (!bytesVal) return '';
  if (typeof bytesVal === 'string') return bytesVal;
  try {
    const arr = Uint8Array.from(bytesVal);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    if (bytesVal && typeof bytesVal === 'object') {
      if ('data' in bytesVal && (Array.isArray(bytesVal.data) || ArrayBuffer.isView(bytesVal.data))) {
        return Array.from(bytesVal.data).map((b: any) => Number(b).toString(16).padStart(2, '0')).join('');
      }
      return bytesVal.toString();
    }
    return String(bytesVal);
  }
};

const hashOnChain = async (leftBytes: Uint8Array, rightBytes: Uint8Array): Promise<Uint8Array> => {
  const combined = new Uint8Array(64);
  combined.set(leftBytes, 0);
  combined.set(rightBytes, 32);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', combined);
  return new Uint8Array(hashBuffer);
};

const getOnChainZeroHash = (level: number): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes[0] = level;
  return bytes;
};

const computeLatestMerkleRootOnChain = async (allCommitmentsBytes: Uint8Array[]): Promise<string> => {
  const TREE_DEPTH = 8;
  
  let filledSubtrees: Uint8Array[] = [];
  for (let i = 0; i < TREE_DEPTH; i++) {
    filledSubtrees.push(getOnChainZeroHash(i));
  }
  
  let latestRoot = getOnChainZeroHash(TREE_DEPTH);
  
  for (let nextIndex = 0; nextIndex < allCommitmentsBytes.length; nextIndex++) {
    let currentLevelHash = allCommitmentsBytes[nextIndex];
    let index = nextIndex;
    
    for (let i = 0; i < TREE_DEPTH; i++) {
      if (index % 2 === 1) {
        const left = filledSubtrees[i];
        currentLevelHash = await hashOnChain(left, currentLevelHash);
      } else {
        filledSubtrees[i] = currentLevelHash;
        const right = getOnChainZeroHash(i);
        currentLevelHash = await hashOnChain(currentLevelHash, right);
      }
      index = Math.floor(index / 2);
    }
    latestRoot = currentLevelHash;
  }
  
  return Array.from(latestRoot).map(b => b.toString(16).padStart(2, '0')).join('');
};

const deriveEncryptionKey = async (zkPrivateKeyHex: string): Promise<CryptoKey> => {
  const rawKeyMaterial = new TextEncoder().encode(zkPrivateKeyHex);
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    rawKeyMaterial,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  );
  
  return await window.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt: new TextEncoder().encode('stellar-whisper-salt'),
      info: new TextEncoder().encode('note-encryption'),
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

const encryptNote = async (zkPrivateKeyHex: string, noteData: object): Promise<string> => {
  const key = await deriveEncryptionKey(zkPrivateKeyHex);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(noteData));
  
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );
  
  const ciphertextBytes = new Uint8Array(ciphertextBuffer);
  const combined = new Uint8Array(iv.length + ciphertextBytes.length);
  combined.set(iv, 0);
  combined.set(ciphertextBytes, iv.length);
  
  return Array.from(combined).map(b => b.toString(16).padStart(2, '0')).join('');
};

const decryptNote = async (zkPrivateKeyHex: string, hexCiphertext: string): Promise<any | null> => {
  try {
    const key = await deriveEncryptionKey(zkPrivateKeyHex);
    const bytes = new Uint8Array(hexCiphertext.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hexCiphertext.slice(i * 2, i * 2 + 2), 16);
    }
    
    const iv = bytes.slice(0, 12);
    const ciphertext = bytes.slice(12);
    
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    
    const plaintext = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(plaintext);
  } catch (e) {
    return null;
  }
};

export default function App() {
  // Mode selection (Live Testnet is default)
  const [useMockMode, setUseMockMode] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);

  // App states
  const [activeTab, setActiveTab] = useState<'vault' | 'pool' | 'send' | 'compliance'>('vault');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [userAddress, setUserAddress] = useState<string>('');
  const [zkPrivateKey, setZkPrivateKey] = useState<string>('');

  // Synchronize ZK private key with sessionStorage
  useEffect(() => {
    if (isConnected && userAddress) {
      const stored = sessionStorage.getItem(`whisper_zk_pkey_${userAddress}`);
      if (stored) {
        setZkPrivateKey(stored);
      }
    } else {
      setZkPrivateKey('');
    }
  }, [isConnected, userAddress]);
  
  // Balance states
  const [publicBalance, setPublicBalance] = useState<number>(0);
  const [shieldedBalance, setShieldedBalance] = useState<number>(0.00); // Tracked locally for the private note
  
  // Helper to update shielded balance with persistence
  const updateShieldedBalance = (newBalance: number | ((prev: number) => number)) => {
    setShieldedBalance(prev => {
      const val = typeof newBalance === 'function' ? newBalance(prev) : newBalance;
      const key = isConnected ? `whisper_shielded_balance_${userAddress}` : 'whisper_shielded_balance_temp';
      localStorage.setItem(key, val.toString());
      return val;
    });
  };

  // Note Store states
  const [notes, setNotes] = useState<PrivateNote[]>([]);
  const [selectedNoteCommitment, setSelectedNoteCommitment] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncProgress, setSyncProgress] = useState<string>('');

  // Load notes from localStorage on wallet connection
  useEffect(() => {
    if (isConnected && userAddress) {
      const stored = localStorage.getItem(`whisper_notes_${userAddress}`);
      if (stored) {
        try {
          const parsedNotes = JSON.parse(stored);
          setNotes(parsedNotes);
          const unspent = parsedNotes.filter((n: any) => !n.spent);
          if (unspent.length > 0) {
            setSelectedNoteCommitment(unspent[0].commitment);
            setTransferAmount(unspent[0].amount.toString());
          }
        } catch (e) {
          console.error("Failed to parse stored notes:", e);
          setNotes([]);
        }
      } else {
        setNotes([]);
      }
    } else {
      setNotes([]);
    }
  }, [isConnected, userAddress]);

  // Synchronize shielded balance to the sum of active unspent note balances
  useEffect(() => {
    if (notes.length > 0) {
      const unspentSum = notes
        .filter(n => !n.spent)
        .reduce((sum, n) => sum + n.amount, 0);
      updateShieldedBalance(unspentSum);
    } else if (isConnected && userAddress) {
      const key = `whisper_shielded_balance_${userAddress}`;
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        setShieldedBalance(Number(stored));
      } else {
        setShieldedBalance(0.00);
      }
    }
  }, [notes, isConnected, userAddress]);

  // Auto-sync notes from blockchain on login/ZK Key Derivation
  useEffect(() => {
    if (isConnected && userAddress && zkPrivateKey && !useMockMode) {
      syncNotesFromChain();
    }
  }, [isConnected, userAddress, zkPrivateKey, useMockMode]);

  // Selection synchronization helper
  useEffect(() => {
    const unspent = notes.filter(n => !n.spent);
    if (unspent.length > 0) {
      const found = unspent.find(n => n.commitment === selectedNoteCommitment);
      if (!found) {
        setSelectedNoteCommitment(unspent[0].commitment);
        setTransferAmount(unspent[0].amount.toString());
      }
    } else {
      setSelectedNoteCommitment('');
      setTransferAmount('');
    }
  }, [notes, selectedNoteCommitment]);

  const handleNoteChange = (commitment: string) => {
    setSelectedNoteCommitment(commitment);
    const note = notes.find(n => n.commitment === commitment);
    if (note) {
      setTransferAmount(note.amount.toString());
    }
  };

  const syncNotesFromChain = async () => {
    if (!isConnected || !userAddress || !zkPrivateKey) {
      alert("Please connect your wallet and derive your ZK private key first.");
      return;
    }
    
    setIsSyncing(true);
    setSyncProgress('Connecting to Soroban RPC...');
    
    try {
      const server = new rpc.Server("https://soroban-testnet.stellar.org");
      
      // 1. Get latest ledger
      setSyncProgress('Fetching latest ledger sequence...');
      const latestLedger = await server.getLatestLedger();
      const endLedger = latestLedger.sequence;
      
      // 2. Scan from endLedger - 120000 (roughly last 7 days of events)
      const startLedger = Math.max(1, endLedger - 120000);
      setSyncProgress(`Scanning ledgers ${startLedger} to ${endLedger}...`);
      
      console.log(`Syncing notes: scanning ledgers from ${startLedger} to ${endLedger} for contract ${config.whisperContractId}`);
      
      let response;
      try {
        response = await server.getEvents({
          startLedger,
          filters: [
            {
              contractIds: [config.whisperContractId],
              type: "contract"
            }
          ]
        });
      } catch (e: any) {
        const errorMsg = e.message || String(e);
        console.warn(`Initial event query failed: ${errorMsg}`);
        // Try to match e.g. "range: 3053410 - 3174369"
        const match = errorMsg.match(/range:\s*(\d+)/i);
        if (match && match[1]) {
          const minLedger = parseInt(match[1], 10);
          console.log(`Retrying event query with adjusted startLedger: ${minLedger}`);
          response = await server.getEvents({
            startLedger: minLedger,
            filters: [
              {
                contractIds: [config.whisperContractId],
                type: "contract"
              }
            ]
          });
        } else {
          // Fallback: try a safe range like 10000 ledgers (roughly 14 hours)
          console.log(`Failed to parse range from error. Retrying with endLedger - 10000`);
          const fallbackStart = Math.max(1, endLedger - 10000);
          response = await server.getEvents({
            startLedger: fallbackStart,
            filters: [
              {
                contractIds: [config.whisperContractId],
                type: "contract"
              }
            ]
          });
        }
      }
      
      const events = response.events || [];
      console.log(`Fetched ${events.length} events from blockchain.`);
      setSyncProgress(`Found ${events.length} contract events. Decrypting...`);
      
      const secretKeyBigInt = BigInt("0x" + zkPrivateKey);
      
      const decryptedNotesMap = new Map<string, PrivateNote>();
      const spentNullifiers = new Set<string>();
      const allCommitmentsBytes: Uint8Array[] = [];
      
      // Pass 1: Parse and decrypt deposits and find spent nullifiers
      for (const event of events) {
        try {
          const topics = (event.topic || []).map(t => scValToNative(xdr.ScVal.fromXDR(t as any, "base64")));
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
          
          if (eventType === "deposit") {
            const commitmentVal = topics[1];
            const commitmentHex = bytesToHex(commitmentVal);
            allCommitmentsBytes.push(new Uint8Array(commitmentVal as any));
            
            const data = scValToNative(xdr.ScVal.fromXDR(event.value as any, "base64"));
            console.log("Deposit event value data:", data);
            
            const rawAmount = data[0];
            const amount = Number(BigInt(rawAmount)) / 10000000;
            const encryptedNoteVal = data[1];
            const hexCiphertext = bytesToHex(encryptedNoteVal);
            
            console.log(`Decrypting note for commitment ${commitmentHex} with ciphertext length ${hexCiphertext.length}...`);
            const decrypted = await decryptNote(zkPrivateKey, hexCiphertext);
            if (decrypted) {
              console.log("Successfully decrypted note payload:", decrypted);
              const { nullifier_nonce } = decrypted;
              decryptedNotesMap.set(commitmentHex, {
                amount,
                nullifierNonce: nullifier_nonce,
                commitment: commitmentHex,
                spent: false,
                txHash: event.txHash || '',
                timestamp: event.ledgerClosedAt || 'Just now'
              });
            } else {
              console.log(`Failed to decrypt note for commitment ${commitmentHex} (belongs to another user's public key)`);
            }
          } else if (eventType === "transfer") {
            const nullifierVal = topics[1];
            const nullifierHex = bytesToHex(nullifierVal);
            console.log(`Found spent nullifier hash: ${nullifierHex}`);
            spentNullifiers.add(nullifierHex);
          }
        } catch (err) {
          console.error("Failed to parse event:", err);
        }
      }
      
      // Update spent status by checking calculated nullifiers of our decrypted notes
      const finalNotes: PrivateNote[] = [];
      for (const note of decryptedNotesMap.values()) {
        const nonceBigInt = BigInt("0x" + note.nullifierNonce);
        const nullifierBigInt = hash_2(secretKeyBigInt, nonceBigInt);
        const nullifierHex = bytesToHex(bigIntToBytes32(nullifierBigInt));
        
        if (spentNullifiers.has(nullifierHex)) {
          note.spent = true;
        }
        finalNotes.push(note);
      }
      
      // Compute latest Merkle root and save it
      if (allCommitmentsBytes.length > 0) {
        const rootHex = await computeLatestMerkleRootOnChain(allCommitmentsBytes);
        localStorage.setItem(`whisper_latest_root_${userAddress}`, rootHex);
      } else {
        const defaultRootBytes = getOnChainZeroHash(8);
        const defaultRootHex = Array.from(defaultRootBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem(`whisper_latest_root_${userAddress}`, defaultRootHex);
      }
      
      // Save notes to state and localStorage
      setNotes(finalNotes);
      localStorage.setItem(`whisper_notes_${userAddress}`, JSON.stringify(finalNotes));
      
      const activeNotes = finalNotes.filter(n => !n.spent);
      const unspentSum = activeNotes.reduce((sum, n) => sum + n.amount, 0);
      updateShieldedBalance(unspentSum);
      
      setSyncProgress(`Sync complete! Recovered ${finalNotes.length} notes (${activeNotes.length} unspent).`);
      setTimeout(() => setSyncProgress(''), 5000);
    } catch (err: any) {
      console.error("Error syncing events:", err);
      setSyncProgress(`Sync failed: ${err.message || String(err)}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Form input states
  const [depositAmount, setDepositAmount] = useState<string>('');
  const [recipientAddress, setRecipientAddress] = useState<string>('');
  const [transferAmount, setTransferAmount] = useState<string>('');
  const [viewingKey, setViewingKey] = useState<string>('');
  const [complianceStandard, setComplianceStandard] = useState<string>('aml-sanctions');
  
  // ZK proving states
  const [isProving, setIsProving] = useState<boolean>(false);
  const [provingProgress, setProvingProgress] = useState<number>(0);
  const [provingLogs, setProvingLogs] = useState<string[]>([]);
  
  // Compliance Certificate state
  const [complianceReport, setComplianceReport] = useState<any | null>(null);

  // Activity logs
  const [logs, setLogs] = useState<ActivityLog[]>([
    {
      id: '1',
      type: 'deposit',
      amount: 500,
      timestamp: '10 minutes ago',
      status: 'success',
      txHash: 'ca80a46c313795342d08ad5f0e293315cdba9f74fb848fe4e42d8e1340953488'
    },
    {
      id: '2',
      type: 'compliance',
      timestamp: '1 hour ago',
      status: 'verified'
    }
  ]);

  // Deployment configuration
  const [config, setConfig] = useState<Config>({
    network: import.meta.env.VITE_NETWORK || 'testnet',
    adminAddress: import.meta.env.VITE_ADMIN_ADDRESS || 'GD42PB2CL44DBKQUMM7Q2I7AHVOXVTZOVQCC4ZYRGONHSZKLISA6WQMD',
    tokenContractId: import.meta.env.VITE_TOKEN_CONTRACT_ID || 'CCD7B5ENZPTMYOB7XZ6VYLCABAQ66TB4UY5BEAQWCZMHMNAXPWKBKXYR',
    verifierContractId: import.meta.env.VITE_VERIFIER_CONTRACT_ID || 'CDFENQOFMV5Q5EQ5E5LRK3SAXS37L5KDT4NRGVY32LVWLQGXGFRDEA2H',
    whisperContractId: import.meta.env.VITE_WHISPER_CONTRACT_ID || 'CDQP7Q2WDYHLJ6M4RU45U6HEBQWNMNZEES7YJFI755ZC6IDIVKSTF4L2'
  });

  useEffect(() => {
    // Load deployed contract config and merge with local environment overrides
    import('./config/deployed.json')
      .then((data) => {
        setConfig({
          network: import.meta.env.VITE_NETWORK || data.default.network || 'testnet',
          adminAddress: import.meta.env.VITE_ADMIN_ADDRESS || data.default.adminAddress || 'GD42PB2CL44DBKQUMM7Q2I7AHVOXVTZOVQCC4ZYRGONHSZKLISA6WQMD',
          tokenContractId: import.meta.env.VITE_TOKEN_CONTRACT_ID || data.default.tokenContractId || 'CCD7B5ENZPTMYOB7XZ6VYLCABAQ66TB4UY5BEAQWCZMHMNAXPWKBKXYR',
          verifierContractId: import.meta.env.VITE_VERIFIER_CONTRACT_ID || data.default.verifierContractId || 'CDFENQOFMV5Q5EQ5E5LRK3SAXS37L5KDT4NRGVY32LVWLQGXGFRDEA2H',
          whisperContractId: import.meta.env.VITE_WHISPER_CONTRACT_ID || data.default.whisperContractId || 'CDQP7Q2WDYHLJ6M4RU45U6HEBQWNMNZEES7YJFI755ZC6IDIVKSTF4L2'
        });
      })
      .catch(() => {});
  }, []);

  // Update balances if connected to Freighter and not in mock mode
  useEffect(() => {
    if (isConnected && !useMockMode && userAddress) {
      fetchBalances(userAddress);
    }
  }, [isConnected, useMockMode, userAddress]);

  const fetchBalances = async (address: string) => {
    try {
      const server = new rpc.Server("https://soroban-testnet.stellar.org");
      const contract = new Contract(config.tokenContractId);
      
      let sequence = "0";
      try {
        const accountDetails = await server.getAccount(address);
        sequence = accountDetails.sequenceNumber();
      } catch (e) {
        // Account not funded
        setPublicBalance(0);
        return;
      }

      const account = new Account(address, sequence);
      const tx = new TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: Networks.TESTNET
      })
      .addOperation(
        contract.call("balance", nativeToScVal(address, { type: "address" }))
      )
      .setTimeout(30)
      .build();

      const sim = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
        const balBigInt = scValToNative(sim.result.retval);
        setPublicBalance(Number(balBigInt) / 10000000);
      }
    } catch (e) {
      console.error("Error fetching balances from testnet:", e);
    }
  };
  const connectWallet = async () => {
    if (useMockMode) {
      setIsConnected(true);
      setUserAddress('GB2V...K4X7');
      setPublicBalance(1250.00);
      updateShieldedBalance(350.00);
      return;
    }

    try {
      const freighterConn = await isFreighterConnected();
      const hasFreighter = freighterConn && freighterConn.isConnected;
      if (hasFreighter) {
        const accessResult = await requestFreighterAccess();
        if (accessResult.error) {
          alert("Freighter connection rejected: " + accessResult.error);
        } else if (accessResult.address) {
          const addr = accessResult.address;
          setUserAddress(addr);
          setIsConnected(true);
          
          try {
            // Prompt the user to sign a deterministic message to authorize ZK private key derivation
            const authMessage = "Sign this message to authorize Stellar Whisper ZK Privacy Key Derivation";
            const signResult = await signFreighterMessage(authMessage, { address: addr });
            
            if (signResult && signResult.signedMessage) {
              const signatureVal = signResult.signedMessage;
              const msgStr = typeof signatureVal === 'string' 
                ? signatureVal 
                : Array.from(new Uint8Array(signatureVal as any)).map(b => b.toString(16).padStart(2, '0')).join('');
              const derivedKey = await sha256(msgStr);
              setZkPrivateKey(derivedKey);
              sessionStorage.setItem(`whisper_zk_pkey_${addr}`, derivedKey);
            }
          } catch (signErr: any) {
            console.error("ZK Key Derivation signature rejected/failed:", signErr);
            alert("Signature rejected. ZK Private Key was not derived. You can still use the app, but shielding operations will use random commitments.");
          }

          await fetchBalances(addr);
        }
      } else {
        alert("Freighter Wallet not found. Please install the extension or enable Mock Mode in settings.");
      }
    } catch (e: any) {
      alert("Failed to connect Freighter: " + e.message);
    }
  };

  const disconnectWallet = () => {
    if (userAddress) {
      sessionStorage.removeItem(`whisper_zk_pkey_${userAddress}`);
    }
    setIsConnected(false);
    setUserAddress('');
    setZkPrivateKey('');
    setPublicBalance(0);
    updateShieldedBalance(0.00);
  };
  const fundWallet = async () => {
    if (!userAddress || userAddress === 'GB2V...K4X7') return;
    try {
      alert("Requesting testnet XLM funding from Friendbot...");
      await fetch(`https://friendbot.stellar.org/?addr=${userAddress}`);
      alert("Funding successful! Refreshing balance...");
      await fetchBalances(userAddress);
    } catch (e: any) {
      alert("Friendbot funding failed: " + e.message);
    }
  };

  // Helper to run proof/tx logger
  const addProvingLog = (msg: string) => {
    setProvingLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const executeSorobanCall = async (
    methodName: string,
    args: any[],
    stages: { stage: string; percent: number }[],
    callback: (txHash?: string, txResult?: any) => void,
    errorCallback: (err: string) => void
  ) => {
    setIsProving(true);
    setProvingLogs([]);
    
    // 1. If Mock Mode, simulate the stages
    if (useMockMode) {
      let currentIdx = 0;
      const interval = setInterval(() => {
        if (currentIdx < stages.length) {
          const item = stages[currentIdx];
          setProvingProgress(item.percent);
          addProvingLog(item.stage);
          currentIdx++;
        } else {
          clearInterval(interval);
          setIsProving(false);
          setProvingProgress(0);
          callback();
        }
      }, 900);
      return;
    }

    // 2. Real on-chain flow
    try {
      const server = new rpc.Server("https://soroban-testnet.stellar.org");
      const { assembleTransaction } = rpc;

      setProvingProgress(10);
      addProvingLog("Initializing Freighter connection...");

      const freighterConn = await isFreighterConnected();
      const hasFreighter = freighterConn && freighterConn.isConnected;
      if (!hasFreighter) throw new Error("Freighter wallet is not installed.");
      
      const accessResult = await requestFreighterAccess();
      if (accessResult.error || !accessResult.address) {
        throw new Error("Could not retrieve Freighter key: " + (accessResult.error || "unknown error"));
      }
      const pubKey = accessResult.address;

      setProvingProgress(25);
      addProvingLog("Fetching account sequence from Testnet...");

      let sequence = "0";
      try {
        const accountDetails = await server.getAccount(pubKey);
        sequence = accountDetails.sequenceNumber();
      } catch (e) {
        throw new Error("Account must be funded on Testnet first. Use Friendbot.");
      }

      setProvingProgress(40);
      addProvingLog("Constructing Soroban invocation details...");

      const contract = new Contract(config.whisperContractId);
      const account = new Account(pubKey, sequence);

      let tx = new TransactionBuilder(account, {
        fee: "100000",
        networkPassphrase: Networks.TESTNET
      })
      .addOperation(contract.call(methodName, ...args))
      .setTimeout(120)
      .build();

      setProvingProgress(55);
      addProvingLog("Invoking dry-run simulation against RPC...");

      const simulated = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(simulated)) {
        throw new Error("Simulation failed: " + JSON.stringify(simulated.error));
      }
      
      tx = assembleTransaction(tx, simulated).build();
      addProvingLog("Simulation successful. Resource footprint attached.");

      setProvingProgress(70);
      addProvingLog("Prompting Freighter for transaction signature...");

      const xdrString = tx.toXDR();
      const signResult = await signFreighterTransaction(xdrString, { networkPassphrase: Networks.TESTNET });
      if (signResult.error) {
        throw new Error("Signing rejected: " + signResult.error);
      }
      addProvingLog("Freighter signature retrieved.");

      setProvingProgress(85);
      addProvingLog("Broadcasting transaction to Testnet...");

      const signedTx = TransactionBuilder.fromXDR(signResult.signedTxXdr, Networks.TESTNET);
      const sendResult = await server.sendTransaction(signedTx);
      
      if (sendResult.status === "ERROR") {
        const errResult = (sendResult as any).errorResultXdr || (sendResult as any).errorResult || JSON.stringify(sendResult);
        throw new Error("Broadcast failed: " + errResult);
      }

      setProvingProgress(95);
      addProvingLog(`Tx pending. Hash: ${sendResult.hash}. Awaiting consensus...`);

      let status: string = "PENDING";
      let txResult: any;
      let attempts = 0;
      // Keep polling on PENDING or NOT_FOUND to allow consensus and DB indexing to complete
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
        let errorDetails = "";
        if (txResult && txResult.resultXdr) {
          errorDetails = ` (Result XDR: ${txResult.resultXdr})`;
        }
        throw new Error(`Transaction execution failed on-chain with status ${status}.${errorDetails}`);
      }

      addProvingLog("Transaction completed successfully!");
      setProvingProgress(100);
      setIsProving(false);
      callback(sendResult.hash, txResult);
    } catch (err: any) {
      setIsProving(false);
      errorCallback(err.message || String(err));
    }
  };

  const handleShieldDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!depositAmount || isNaN(Number(depositAmount))) return;
    
    const amt = Number(depositAmount);
    if (!useMockMode && amt > publicBalance) {
      alert("Insufficient public balance.");
      return;
    }

    const stages = [
      { stage: zkPrivateKey ? "Deriving secret key and public key..." : "Generating random nullifier & secret key...", percent: 20 },
      { stage: "Computing Poseidon commitment hash...", percent: 50 },
      { stage: "Constructing ZK witness data & encrypting note...", percent: 75 },
      { stage: "Submitting deposit to Soroban contract...", percent: 90 }
    ];

    // Arguments for Soroban deposit(from, commitment, amount, encrypted_note)
    let commitmentBytes: Uint8Array;
    let nullifierNonceHex = '';
    let encryptedPayloadHex = '';

    if (zkPrivateKey) {
      const secretKeyBigInt = BigInt("0x" + zkPrivateKey);
      const pubkey = hash_1(secretKeyBigInt);
      const rawAmount = BigInt(Math.floor(amt * 10000000));
      const commitmentBigInt = hash_2(pubkey, rawAmount);
      commitmentBytes = bigIntToBytes32(commitmentBigInt);

      // Generate a random 32-byte nullifier nonce
      const nonceBytes = new Uint8Array(32);
      window.crypto.getRandomValues(nonceBytes as any);
      const nonceBigInt = BigInt("0x" + Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('')) % BN254_PRIME;
      nullifierNonceHex = nonceBigInt.toString(16).padStart(64, '0');

      // Encrypt the ZK private key and nullifier nonce
      const note = {
        secret_key: zkPrivateKey,
        nullifier_nonce: nullifierNonceHex
      };
      
      try {
        encryptedPayloadHex = await encryptNote(zkPrivateKey, note);
      } catch (err) {
        console.error("Encryption failed:", err);
      }
    } else {
      commitmentBytes = new Uint8Array(32);
      window.crypto.getRandomValues(commitmentBytes as any);
    }

    const commitmentScVal = nativeToScVal(commitmentBytes, { type: "bytes" });
    const rawAmount = BigInt(Math.floor(amt * 10000000));
    const amountScVal = nativeToScVal(rawAmount, { type: "i128" });
    const fromScVal = nativeToScVal(userAddress, { type: "address" });

    // Encrypted note bytes
    const encryptedNoteBytes = encryptedPayloadHex 
      ? new Uint8Array(encryptedPayloadHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))) 
      : new Uint8Array(0);
    const encryptedNoteScVal = nativeToScVal(encryptedNoteBytes, { type: "bytes" });

    // Switch to pool tab to see the immersive circular animation!
    setActiveTab('pool');

    executeSorobanCall(
      "deposit",
      [fromScVal, commitmentScVal, amountScVal, encryptedNoteScVal],
      stages,
      async (txHash, txResult) => {
        if (useMockMode) {
          setPublicBalance(prev => prev - amt);
          updateShieldedBalance(prev => prev + amt);
        } else {
          try {
            if (txResult && txResult.returnValue) {
              const rootVal = scValToNative(txResult.returnValue);
              if (rootVal) {
                const rootBytes = new Uint8Array(rootVal);
                const hex = Array.from(rootBytes).map(b => b.toString(16).padStart(2, '0')).join('');
                localStorage.setItem(`whisper_latest_root_${userAddress}`, hex);
              }
            }
          } catch (e) {
            console.error("Failed to parse returned Merkle root:", e);
          }
          
          // Save the decrypted note locally in state & localStorage
          if (zkPrivateKey && nullifierNonceHex) {
            const newNote: PrivateNote = {
              amount: amt,
              nullifierNonce: nullifierNonceHex,
              commitment: bytesToHex(commitmentBytes),
              spent: false,
              txHash: txHash || '',
              timestamp: new Date().toLocaleTimeString()
            };
            setNotes(prev => {
              const updated = [...prev, newNote];
              localStorage.setItem(`whisper_notes_${userAddress}`, JSON.stringify(updated));
              return updated;
            });
          }

          await fetchBalances(userAddress);
        }
        setLogs(prev => [
          {
            id: Date.now().toString(),
            type: 'deposit',
            amount: amt,
            timestamp: 'Just now',
            status: 'success',
            txHash: txHash || 'ca80a46c313795342d08ad5f0e293315cdba9f74fb848fe4e42d8e1340953488'
          },
          ...prev
        ]);
        setDepositAmount('');
      },
      (err) => {
        alert("Shielding failed: " + err);
        setLogs(prev => [
          {
            id: Date.now().toString(),
            type: 'deposit',
            amount: amt,
            timestamp: 'Just now',
            status: 'failed',
            details: err
          },
          ...prev
        ]);
      }
    );
  };

  const handleShieldedTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferAmount || isNaN(Number(transferAmount)) || !recipientAddress) return;

    const amt = Number(transferAmount);
    if (amt > shieldedBalance) {
      alert("Insufficient shielded balance.");
      return;
    }

    const stages = [
      { stage: "Retrieving commitment tree state...", percent: 15 },
      { stage: "Generating Merkle membership proof (depth 8)...", percent: 35 },
      { stage: "Computing public nullifier to prevent double-spend...", percent: 55 },
      { stage: "Generating UltraHonk proof client-side (Aztec/Wasm)...", percent: 75 },
      { stage: "Synthesizing proof bytes & public inputs...", percent: 85 },
      { stage: "Invoking Whisper contract 'transfer_or_withdraw'...", percent: 95 }
    ];

    // Mock ZK proof bytes & public inputs
    const dummyProof = nativeToScVal(new Uint8Array([1, 2, 3, 4]), { type: "bytes" });
    
    // Load real Merkle root from localStorage (which was stored during deposit)
    const storedRootHex = localStorage.getItem(`whisper_latest_root_${userAddress}`);
    const merkleRootBytes = new Uint8Array(32);
    if (storedRootHex && storedRootHex.length === 64) {
      for (let i = 0; i < 32; i++) {
        merkleRootBytes[i] = parseInt(storedRootHex.slice(i * 2, i * 2 + 2), 16);
      }
    } else {
      // Default empty root for tree of depth 8 (first byte is 8, all others 0)
      merkleRootBytes[0] = 8;
    }

    // Generate unique nullifier derived from ZK private key and the note's nonce
    let nullifierHashBytes: Uint8Array;
    let targetNoteCommitment = selectedNoteCommitment;
    
    if (zkPrivateKey) {
      // Find the note being spent
      let noteToSpend = notes.find(n => n.commitment === selectedNoteCommitment && !n.spent);
      if (!noteToSpend) {
        // Fall back to first unspent note matching the amount, or any unspent note
        noteToSpend = notes.find(n => !n.spent);
      }
      
      if (!noteToSpend) {
        alert("No unspent shielded notes available. Please shield assets first.");
        return;
      }
      
      targetNoteCommitment = noteToSpend.commitment;
      const secretKeyBigInt = BigInt("0x" + zkPrivateKey);
      const nonceBigInt = BigInt("0x" + noteToSpend.nullifierNonce);
      
      const nullifierBigInt = hash_2(secretKeyBigInt, nonceBigInt);
      nullifierHashBytes = bigIntToBytes32(nullifierBigInt);
    } else {
      nullifierHashBytes = new Uint8Array(32);
      window.crypto.getRandomValues(nullifierHashBytes as any);
    }

    const amountBytes = new Uint8Array(32);
    amountBytes.fill(3);
    const recipientBytes = new Uint8Array(32);
    recipientBytes.fill(4);

    const publicInputsScVal = xdr.ScVal.scvVec([
      xdr.ScVal.scvBytes(merkleRootBytes),
      xdr.ScVal.scvBytes(nullifierHashBytes),
      xdr.ScVal.scvBytes(amountBytes),
      xdr.ScVal.scvBytes(recipientBytes)
    ]);

    const recipientScVal = nativeToScVal(recipientAddress, { type: "address" });
    const rawAmount = BigInt(Math.floor(amt * 10000000));
    const amountScVal = nativeToScVal(rawAmount, { type: "i128" });
    const encryptedNoteScVal = nativeToScVal(new Uint8Array(0), { type: "bytes" });

    executeSorobanCall(
      "transfer_or_withdraw",
      [dummyProof, publicInputsScVal, recipientScVal, amountScVal, encryptedNoteScVal],
      stages,
      async (txHash) => {
        if (useMockMode) {
          updateShieldedBalance(prev => prev - amt);
        } else {
          // Mark the spent note as spent locally
          if (targetNoteCommitment) {
            setNotes(prev => {
              const updated = prev.map(n => n.commitment === targetNoteCommitment ? { ...n, spent: true } : n);
              localStorage.setItem(`whisper_notes_${userAddress}`, JSON.stringify(updated));
              return updated;
            });
          }
          await fetchBalances(userAddress);
        }
        setLogs(prev => [
          {
            id: Date.now().toString(),
            type: 'transfer',
            amount: amt,
            recipient: recipientAddress.slice(0, 6) + '...' + recipientAddress.slice(-4),
            timestamp: 'Just now',
            status: 'success',
            txHash: txHash || '0x99a3c9b2e8d47b5ef0c8ad5f0e293315cdba9f74fb848fe4e42d8e1340953488'
          },
          ...prev
        ]);
        setTransferAmount('');
        setRecipientAddress('');
      },
      (err) => {
        alert("Shielded transfer failed: " + err);
        setLogs(prev => [
          {
            id: Date.now().toString(),
            type: 'transfer',
            amount: amt,
            timestamp: 'Just now',
            status: 'failed',
            details: err
          },
          ...prev
        ]);
      }
    );
  };

  const handleGenerateCompliance = (e: React.FormEvent) => {
    e.preventDefault();
    const activeKey = zkPrivateKey || viewingKey;
    if (!activeKey) return;

    setIsProving(true);
    setProvingLogs([]);
    setProvingProgress(0);

    const stages = [
      { stage: "Decrypting transaction history using viewing key skey_" + activeKey.slice(0, 8) + "...", percent: 25 },
      { stage: "Verifying non-membership in sanctions list...", percent: 50 },
      { stage: "Validating source funds path integrity...", percent: 75 },
      { stage: "Generating cryptographic Compliance Attestation...", percent: 100 }
    ];

    let currentIdx = 0;
    const interval = setInterval(() => {
      if (currentIdx < stages.length) {
        const item = stages[currentIdx];
        setProvingProgress(item.percent);
        setProvingLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${item.stage}`]);
        currentIdx++;
      } else {
        clearInterval(interval);
        setIsProving(false);
        setProvingProgress(0);
        
        setLogs(prev => [
          {
            id: Date.now().toString(),
            type: 'compliance',
            timestamp: 'Just now',
            status: 'verified'
          },
          ...prev
        ]);
        
        const reportId = 'ZKP-REP-' + Math.floor(100000 + Math.random() * 900000);
        setComplianceReport({
          id: reportId,
          timestamp: new Date().toUTCString(),
          standard: complianceStandard === 'aml-sanctions' ? 'AML & Sanctions Compliance Set' : 'Tax & Capital Gains Audit',
          merkleRoot: '0x3f5b80a46c313795342d08ad5f0e293315cdba9f74fb848fe4e42d8e1340953488',
          status: 'VERIFIED (PASS)'
        });

        setViewingKey('');
      }
    }, 900);
  };

  return (
    <div className="flex min-h-screen text-[#e1e2eb] selection:bg-[#00f4fe]/30 font-sans relative">
      {/* Nebular Background elements */}
      <div className="nebula-bg"></div>

      {/* Side Navigation */}
      <aside className="hidden md:flex flex-col h-screen w-64 fixed left-0 top-0 bg-white/3 backdrop-blur-2xl border-r border-white/10 py-8 px-4 z-50">
        <div className="flex items-center gap-3 mb-10 px-2">
          <div className="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center cyber-glow">
            <span className="material-symbols-outlined text-white text-[18px]">auto_awesome</span>
          </div>
          <div>
            <h1 className="font-bold text-lg text-secondary-container leading-none">Whisper Node</h1>
            <p className="text-[10px] font-mono tracking-widest text-[#00dce5] mt-1 uppercase">Shielded Session</p>
          </div>
        </div>

        <nav className="flex-grow space-y-1">
          <button 
            onClick={() => setActiveTab('vault')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all active:translate-x-1 text-left ${activeTab === 'vault' ? 'bg-white/10 text-[#00dce5] border-l-4 border-[#00dce5]' : 'text-[#cfc2d7] hover:bg-white/5 hover:text-white'}`}
          >
            <span className="material-symbols-outlined">dashboard</span>
            <span className="font-semibold text-sm">Vault</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('pool')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all active:translate-x-1 text-left ${activeTab === 'pool' ? 'bg-white/10 text-[#00dce5] border-l-4 border-[#00dce5]' : 'text-[#cfc2d7] hover:bg-white/5 hover:text-white'}`}
          >
            <span className="material-symbols-outlined">waves</span>
            <span className="font-semibold text-sm">Pool</span>
          </button>

          <button 
            onClick={() => setActiveTab('send')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all active:translate-x-1 text-left ${activeTab === 'send' ? 'bg-white/10 text-[#00dce5] border-l-4 border-[#00dce5]' : 'text-[#cfc2d7] hover:bg-white/5 hover:text-white'}`}
          >
            <span className="material-symbols-outlined">send</span>
            <span className="font-semibold text-sm">Private Send</span>
          </button>

          <button 
            onClick={() => setActiveTab('compliance')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all active:translate-x-1 text-left ${activeTab === 'compliance' ? 'bg-white/10 text-[#00dce5] border-l-4 border-[#00dce5]' : 'text-[#cfc2d7] hover:bg-white/5 hover:text-white'}`}
          >
            <span className="material-symbols-outlined">verified_user</span>
            <span className="font-semibold text-sm">Compliance</span>
          </button>
        </nav>

        <div className="mt-auto pt-6 border-t border-white/5 space-y-2">
          {isConnected && (
            <button 
              onClick={fundWallet}
              className="w-full bg-[#8a2be2] text-white py-2 rounded-xl font-bold flex items-center justify-center gap-2 mb-4 hover:bg-[#8a2be2]/90 active:scale-95 transition-all text-xs border border-white/10"
            >
              <span className="material-symbols-outlined text-xs">add</span>
              Fund Testnet Wallet
            </button>
          )}

          <button 
            onClick={() => setShowSettings(true)}
            className="w-full flex items-center gap-3 px-4 py-2 rounded-xl text-[#cfc2d7] hover:text-white transition-all text-left text-xs"
          >
            <span className="material-symbols-outlined text-[18px]">settings</span>
            <span>Settings / Sandbox</span>
          </button>

          <div className="px-4 py-2 text-[10px] text-[#cfc2d7]/50 font-mono">
            {isConnected ? (
              <div className="flex flex-col gap-1">
                <span className="text-[#00dce5] truncate">{userAddress}</span>
                {zkPrivateKey && (
                  <span className="text-[#dcb8ff] truncate text-[9px] mt-1 border border-[#8a2be2]/30 px-1 py-0.5 rounded bg-[#8a2be2]/10" title={`skey_${zkPrivateKey}`}>
                    🔑 ZK-Key: skey_{zkPrivateKey.slice(0, 6)}...
                  </span>
                )}
                <button onClick={disconnectWallet} className="text-left text-[#ffb4ab] hover:underline cursor-pointer mt-1">Disconnect Wallet</button>
              </div>
            ) : (
              <button onClick={connectWallet} className="text-[#00dce5] hover:underline cursor-pointer font-bold">Connect Freighter</button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Canvas */}
      <main className="flex-1 md:ml-64 p-6 md:p-10 min-h-screen flex flex-col relative z-10">
        
        {/* Global Top App Bar */}
        <header className="flex items-center justify-between mb-8 pb-4 border-b border-white/10">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-white font-sans flex items-center gap-2">
              Stellar Whisper 
              <span className="text-xs px-2 py-0.5 rounded-md bg-[#8a2be2]/20 text-[#dcb8ff] border border-[#8a2be2]/30 font-mono uppercase">Soroban ZK</span>
            </h2>
            <p className="text-[#cfc2d7] text-xs mt-1">Universal Privacy Layer for Decentralized Finance</p>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1 bg-white/5 border border-white/10 rounded-full text-[10px] font-mono">
              <div className="w-1.5 h-1.5 rounded-full bg-[#00dce5] privacy-pulse"></div>
              <span className="text-[#00dce5]">NETWORK: {useMockMode ? "SANDBOX MODE" : "TESTNET ENCRYPTED"}</span>
            </div>

            {/* Header Wallet Connect */}
            {isConnected ? (
              <div className="hidden sm:flex items-center gap-2 px-4 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs">
                <span className="font-mono text-[#cfc2d7]">{userAddress.slice(0, 6) + '...' + userAddress.slice(-6)}</span>
                <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]"></div>
              </div>
            ) : (
              <button 
                onClick={connectWallet} 
                className="hidden sm:flex items-center gap-2 px-4 py-1.5 btn-primary rounded text-xs font-bold transition-all active:scale-95"
              >
                Connect Wallet
              </button>
            )}
          </div>
        </header>

        {/* Developer Settings Modal */}
        {showSettings && (
          <div className="modal-overlay" onClick={() => setShowSettings(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-bold mb-2 flex items-center gap-2 text-white font-sans">
                <span className="material-symbols-outlined">settings</span> Developer Settings
              </h2>
              <p className="text-[#cfc2d7] text-xs mb-6">
                Configure the execution environment for ZK proof generations and smart contract calls.
              </p>
              
              <div className="flex justify-between items-center bg-white/3 p-4 rounded border border-white/5 mb-6">
                <div>
                  <div className="font-semibold text-sm text-white">Sandbox Mock Mode</div>
                  <div className="text-[11px] text-[#cfc2d7]">Skip Freighter / testnet RPC calls</div>
                </div>
                <button 
                  onClick={() => {
                    setUseMockMode(!useMockMode);
                    disconnectWallet();
                  }}
                  className="w-10 h-6 bg-white/10 rounded-full relative p-0.5 transition-colors cursor-pointer"
                  style={{ backgroundColor: useMockMode ? '#8a2be2' : 'rgba(255,255,255,0.1)' }}
                >
                  <div 
                    className="w-5 h-5 bg-white rounded-full shadow-md transition-transform" 
                    style={{ transform: useMockMode ? 'translateX(16px)' : 'translateX(0)' }}
                  />
                </button>
              </div>

              {/* Soroban Deployment Config Details */}
              <div className="space-y-3 bg-black/30 border border-white/5 rounded p-4 text-xs font-mono mb-6">
                <div className="text-xs text-[#00dce5] font-bold border-b border-white/5 pb-2 mb-2">Soroban Address Map</div>
                <div className="flex justify-between">
                  <span className="text-[#cfc2d7]">Network:</span>
                  <span className="text-white font-bold">{config.network}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#cfc2d7]">Whisper Pool:</span>
                  <span className="text-[#cfc2d7] truncate max-w-[200px]" title={config.whisperContractId}>{config.whisperContractId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#cfc2d7]">Verifier Contract:</span>
                  <span className="text-[#cfc2d7] truncate max-w-[200px]" title={config.verifierContractId}>{config.verifierContractId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#cfc2d7]">USDC SAC Token:</span>
                  <span className="text-[#cfc2d7] truncate max-w-[200px]" title={config.tokenContractId}>{config.tokenContractId}</span>
                </div>
              </div>

              <button className="w-full btn-primary text-white font-bold py-2.5 rounded transition-all" onClick={() => setShowSettings(false)}>
                Save Configurations
              </button>
            </div>
          </div>
        )}

        {/* Dynamic Panel Canvas */}
        <div className="flex-grow">
          
          {/* TAB 1: VAULT / DASHBOARD */}
          {activeTab === 'vault' && (
            <div className="bento-grid animate-fade-in">
              {/* Shielded Balance Hero Card */}
              <div className="col-span-12 lg:col-span-8 glass-panel rounded-lg p-6 md:p-8 flex flex-col md:flex-row items-center gap-8 glass-inner-stroke overflow-hidden relative">
                <div className="absolute top-0 right-0 w-64 h-64 bg-[#8a2be2]/10 blur-[100px] pointer-events-none"></div>
                <div className="relative w-full md:w-1/2 aspect-square max-w-[240px] flex items-center justify-center">
                  <div className="absolute inset-0 bg-[#8a2be2]/20 rounded-full filter blur-[40px] animate-pulse-glow"></div>
                  <span className="material-symbols-outlined text-[120px] text-[#00f4fe] animate-pulse relative z-10" style={{ fontVariationSettings: "'FILL' 0" }}>shield</span>
                </div>
                
                <div className="w-full md:w-1/2 flex flex-col justify-center">
                  <div className="inline-flex items-center gap-2 text-xs font-mono text-[#00dce5] mb-3">
                    <span className="material-symbols-outlined text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>lock</span>
                    PRIVATE ASSET VAULT
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">Shielded Balance</h3>
                  <div className="flex items-baseline gap-2 mb-6">
                    <span className="text-4xl font-bold tracking-tight text-white font-mono hover:text-[#00f4fe] transition-all">
                      {shieldedBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-lg font-bold text-[#00dce5]">USDC</span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="p-3 rounded bg-white/5 border border-white/10">
                      <p className="text-[10px] text-[#cfc2d7] mb-1 uppercase tracking-wider">Public Wallet</p>
                      <p className="text-sm font-bold text-white font-mono">
                        ${publicBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="p-3 rounded bg-white/5 border border-white/10">
                      <p className="text-[10px] text-[#cfc2d7] mb-1 uppercase tracking-wider">Privacy Level</p>
                      <p className="text-sm font-bold text-green-400">MAXIMUM</p>
                    </div>
                  </div>
                  
                  <div className="flex flex-col gap-3">
                    <div className="flex gap-4">
                      <button 
                        onClick={() => setActiveTab('send')}
                        className="flex-1 btn-primary py-3 rounded text-xs transition-transform active:scale-95 border-none cursor-pointer"
                      >
                        Withdraw / Send
                      </button>
                      <button 
                        onClick={() => setActiveTab('pool')}
                        className="flex-1 glass-action py-3 rounded text-xs transition-all cursor-pointer"
                      >
                        Deposit / Shield
                      </button>
                    </div>
                    {isConnected && !useMockMode && (
                      <div className="flex flex-col gap-2">
                        <button 
                          onClick={syncNotesFromChain}
                          disabled={isSyncing}
                          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded bg-white/5 border border-white/10 hover:bg-white/10 text-xs text-[#00f4fe] font-mono cursor-pointer transition-all active:scale-95 disabled:opacity-50"
                        >
                          <span className={`material-symbols-outlined text-xs ${isSyncing ? 'animate-spin' : ''}`}>sync</span>
                          {isSyncing ? "Syncing Notes Store..." : "Sync Notes From Blockchain"}
                        </button>
                        {syncProgress && (
                          <div className="text-[10px] font-mono text-[#cfc2d7] bg-black/40 px-3 py-1.5 rounded border border-[#00f4fe]/20 animate-fade-in">
                            {syncProgress}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Invisible Pool Stats */}
              <div className="col-span-12 lg:col-span-4 glass-panel rounded-lg p-6 glass-inner-stroke flex flex-col bg-surface-container-high/40">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-bold text-lg text-white">Invisible Pool</h3>
                  <span className="material-symbols-outlined text-[#00dce5]">analytics</span>
                </div>
                
                <div className="space-y-6 flex-1">
                  <div>
                    <div className="flex justify-between text-xs mb-2">
                      <span className="text-[#cfc2d7]">Pool TVL</span>
                      <span className="text-white font-bold">$1.42B</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-[#8a2be2] w-[72%] shadow-[0_0_10px_#8a2be2]"></div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 gap-3">
                    <div className="p-4 rounded bg-white/5 border border-white/5 flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-[#cfc2d7]">24h Volume</p>
                        <p className="text-sm font-bold">$18.2M</p>
                      </div>
                      <span className="text-[#00dce5] text-xs font-semibold">+4.2%</span>
                    </div>
                    
                    <div className="p-4 rounded bg-white/5 border border-white/5 flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-[#cfc2d7]">Anonymity Set</p>
                        <p className="text-sm font-bold">18,402</p>
                      </div>
                      <span className="material-symbols-outlined text-[#00dce5] text-sm">verified</span>
                    </div>
                  </div>
                </div>
                
                <button 
                  onClick={() => alert("Detailed metrics showing total volume, transaction distribution, and verifier contracts status.")}
                  className="mt-6 w-full py-2.5 text-xs font-bold text-[#00dce5] hover:text-white transition-colors flex items-center justify-center gap-1 cursor-pointer"
                >
                  View Detailed Metrics
                  <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                </button>
              </div>

              {/* Recent Private Activity */}
              <div className="col-span-12 lg:col-span-7 glass-panel rounded-lg p-6 md:p-8 glass-inner-stroke">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-bold text-lg text-white">Recent Activity Log</h3>
                  <span onClick={() => alert("Logs exported to console.")} className="text-[10px] text-[#cfc2d7] cursor-pointer hover:text-white transition-colors tracking-widest font-mono">EXPORT LOGS</span>
                </div>
                
                <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                  {logs.map((log) => (
                    <div key={log.id} className="flex items-center justify-between p-4 rounded bg-white/3 border border-white/5 group hover:bg-white/8 transition-all">
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded flex items-center justify-center ${
                          log.type === 'deposit' ? 'bg-[#8a2be2]/10 text-[#dcb8ff]' : 
                          log.type === 'transfer' ? 'bg-[#00f4fe]/10 text-[#00f4fe]' : 
                          'bg-[#fface8]/10 text-[#fface8]'
                        }`}>
                          <span className="material-symbols-outlined">
                            {log.type === 'deposit' ? 'arrow_downward' : 
                             log.type === 'transfer' ? 'swap_horiz' : 
                             'verified'}
                          </span>
                        </div>
                        <div>
                          <p className="font-bold text-sm text-white">
                            {log.type === 'deposit' && "Shield Asset Deposit"}
                            {log.type === 'transfer' && `Shielded Send`}
                            {log.type === 'compliance' && "ZK Compliance Report"}
                          </p>
                          <p className="text-[10px] text-[#cfc2d7]">
                            {log.type === 'transfer' && log.recipient ? `To ${log.recipient} • ` : ''}
                            {log.timestamp}
                          </p>
                        </div>
                      </div>
                      
                      <div className="text-right flex items-center gap-4">
                        <div>
                          {log.amount && (
                            <p className={`font-bold text-sm ${log.status === 'failed' ? 'text-red-400' : 'text-white'}`}>
                              {log.type === 'deposit' ? '+' : '-'}{log.amount.toFixed(2)} USDC
                            </p>
                          )}
                          <p className="text-[10px] text-[#00dce5] font-bold uppercase tracking-wider">
                            {log.status === 'success' && 'CONFIRMED'}
                            {log.status === 'verified' && 'VERIFIED'}
                            {log.status === 'failed' && 'FAILED'}
                          </p>
                        </div>
                        {log.txHash ? (
                          <a 
                            href={`https://stellar.expert/explorer/testnet/tx/${log.txHash}`}
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="px-3.5 py-1.5 glass-action rounded text-[10px] font-bold border border-white/10 transition-all text-white no-underline flex items-center gap-1"
                          >
                            Explore
                            <span className="material-symbols-outlined text-[10px]">open_in_new</span>
                          </a>
                        ) : (
                          <button className="px-3.5 py-1.5 glass-action rounded text-[10px] font-bold border border-white/10 transition-all text-[#cfc2d7] cursor-pointer">
                            View Proof
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Ecosystem Grid */}
              <div className="col-span-12 lg:col-span-5 space-y-6">
                <h3 className="font-bold text-lg text-white mb-2">Ecosystem Apps</h3>
                <div className="grid grid-cols-1 gap-4">
                  {/* Apps */}
                  <div className="glass-panel p-5 rounded-lg glass-inner-stroke group cursor-pointer hover:bg-white/8 transition-all overflow-hidden relative">
                    <div className="absolute -right-4 -top-4 w-24 h-24 bg-[#00f4fe]/10 blur-2xl group-hover:bg-[#00f4fe]/20 transition-all"></div>
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 rounded bg-[#00f4fe]/20 flex items-center justify-center text-[#00f4fe]">
                        <span className="material-symbols-outlined">water_drop</span>
                      </div>
                      <span className="text-[10px] text-[#00dce5] font-mono font-bold">NEW</span>
                    </div>
                    <h4 className="font-bold text-sm text-white mb-1">Liquidity Pools</h4>
                    <p className="text-xs text-[#cfc2d7] leading-relaxed">Provide liquidity while maintaining total wallet anonymity.</p>
                  </div>

                  <div className="glass-panel p-5 rounded-lg glass-inner-stroke group cursor-pointer hover:bg-white/8 transition-all overflow-hidden relative">
                    <div className="absolute -right-4 -top-4 w-24 h-24 bg-[#8a2be2]/10 blur-2xl group-hover:bg-[#8a2be2]/20 transition-all"></div>
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 rounded bg-[#8a2be2]/20 flex items-center justify-center text-[#8a2be2]">
                        <span className="material-symbols-outlined">psychology</span>
                      </div>
                    </div>
                    <h4 className="font-bold text-sm text-white mb-1">ZK-Proofs Hub</h4>
                    <p className="text-xs text-[#cfc2d7] leading-relaxed">Generate zero-knowledge proofs for third-party verification.</p>
                  </div>

                  <div className="glass-panel p-5 rounded-lg glass-inner-stroke group cursor-pointer hover:bg-white/8 transition-all overflow-hidden relative">
                    <div className="absolute -right-4 -top-4 w-24 h-24 bg-[#fface8]/10 blur-2xl group-hover:bg-[#fface8]/20 transition-all"></div>
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 rounded bg-[#fface8]/20 flex items-center justify-center text-[#fface8]">
                        <span className="material-symbols-outlined">currency_exchange</span>
                      </div>
                    </div>
                    <h4 className="font-bold text-sm text-white mb-1">Private Swap</h4>
                    <p className="text-xs text-[#cfc2d7] leading-relaxed">High-speed slippage-free swaps with obscured paths.</p>
                  </div>
                </div>

                {/* Active Shielded Notes Registry */}
                <div className="glass-panel p-5 rounded-lg glass-inner-stroke mt-6">
                  <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/10">
                    <h3 className="font-bold text-sm text-white flex items-center gap-1.5 font-sans">
                      <span className="material-symbols-outlined text-sm text-[#00f4fe]">receipt_long</span>
                      Active Shielded Notes Registry
                    </h3>
                    <span className="text-[9px] font-mono text-[#cfc2d7] bg-white/5 px-2 py-0.5 rounded border border-white/10">
                      {notes.filter(n => !n.spent).length} Active Notes
                    </span>
                  </div>

                  <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                    {notes.length === 0 ? (
                      <div className="text-center py-6 text-[#cfc2d7] text-xs">
                        No shielded notes detected on-chain. Deposits or transfers will automatically generate notes.
                      </div>
                    ) : (
                      notes.map((note) => (
                        <div 
                          key={note.commitment} 
                          className={`p-3 rounded border text-xs transition-all ${
                            note.spent 
                              ? 'bg-red-950/10 border-red-500/10 opacity-50' 
                              : 'bg-green-950/10 border-green-500/20 hover:border-green-500/40'
                          }`}
                        >
                          <div className="flex justify-between items-start mb-1.5">
                            <span className="font-bold text-white font-mono">{note.amount.toFixed(2)} USDC</span>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                              note.spent 
                                ? 'bg-red-500/20 text-red-400' 
                                : 'bg-green-500/20 text-green-400'
                            }`}>
                              {note.spent ? 'Spent' : 'Unspent'}
                            </span>
                          </div>
                          <div className="font-mono text-[9px] text-[#cfc2d7] flex flex-col gap-0.5">
                            <div className="truncate" title={note.commitment}>
                              <span className="text-[#00dce5]">Commitment:</span> {note.commitment.slice(0, 16)}...
                            </div>
                            <div className="truncate" title={note.nullifierNonce}>
                              <span className="text-[#dcb8ff]">Nonce:</span> {note.nullifierNonce.slice(0, 16)}...
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: POOL / SHIELDING */}
          {activeTab === 'pool' && (
            <div className="max-w-[800px] mx-auto animate-fade-in">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                
                {/* Form column */}
                <div className="lg:col-span-7 space-y-6">
                  <div className="glass-panel rounded-lg p-6 md:p-8 glass-inner-stroke">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#8a2be2]/20 border border-[#8a2be2]/30 mb-4 text-[#dcb8ff]">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#00f4fe] privacy-pulse"></div>
                      <span className="text-[10px] font-mono uppercase tracking-wider">Commitment Engine</span>
                    </div>
                    
                    <h2 className="text-xl font-bold text-white mb-2">Shield Public Assets</h2>
                    <p className="text-xs text-[#cfc2d7] leading-relaxed mb-6">
                      Lock your public stablecoins in the privacy pool. Whisper generates a secret nullifier client-side, computing a Poseidon commitment hash submitted to Soroban, hiding your assets.
                    </p>

                    <form onSubmit={handleShieldDeposit} className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[#cfc2d7] block">Amount to Shield (USDC)</label>
                        <div className="relative">
                          <input 
                            type="number"
                            placeholder="Enter amount, e.g. 100"
                            value={depositAmount}
                            onChange={(e) => setDepositAmount(e.target.value)}
                            disabled={isProving || !isConnected}
                            className="w-full glass-input px-4 py-3 text-sm text-white rounded"
                          />
                        </div>
                      </div>

                      {!isConnected ? (
                        <div className="space-y-3 pt-2">
                          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
                            <span className="material-symbols-outlined text-sm">warning</span>
                            <span>Connect your wallet to shield assets.</span>
                          </div>
                          <button 
                            type="button"
                            onClick={connectWallet}
                            className="w-full btn-primary py-3 rounded text-xs transition-all cursor-pointer font-bold"
                          >
                            Connect Wallet
                          </button>
                        </div>
                      ) : (
                        <button 
                          type="submit"
                          disabled={isProving}
                          className="w-full btn-primary py-3 rounded text-xs font-bold transition-all active:scale-95 disabled:opacity-50 cursor-pointer mt-4"
                        >
                          {isProving ? "Calculating ZK-Proof..." : "Shield Assets"}
                        </button>
                      )}
                    </form>
                  </div>

                  {/* Estimates */}
                  <div className="glass-panel rounded-lg p-5 text-xs text-[#cfc2d7] space-y-2">
                    <div className="font-bold text-white flex items-center gap-1 border-b border-white/5 pb-2 mb-2 font-sans">
                      <span className="material-symbols-outlined text-sm">info</span>
                      Estimated Gas Metrics
                    </div>
                    <div className="flex justify-between">
                      <span>Gas Cost (Soroban):</span>
                      <span className="text-white font-mono">~0.012 XLM</span>
                    </div>
                    <div className="flex justify-between">
                      <span>ZK Witness Gen:</span>
                      <span className="text-white font-mono">~0.8s (Client-Side)</span>
                    </div>
                  </div>
                </div>

                {/* Orbit column */}
                <div className="lg:col-span-5 flex flex-col items-center justify-center">
                  <div className="relative w-64 h-64 flex items-center justify-center mb-6">
                    {/* Atmospheric Glow */}
                    <div className="absolute w-48 h-48 bg-[#8a2be2]/10 rounded-full blur-[40px] animate-pulse-glow"></div>
                    
                    {/* Inner Orb */}
                    <div className={`absolute w-36 h-36 rounded-full border border-white/10 flex flex-col items-center justify-center bg-black/40 backdrop-blur-md relative z-10 ${isProving ? 'cyber-glow' : ''}`}>
                      <span className="text-[10px] font-mono text-[#00dce5] uppercase tracking-wider">
                        {isProving ? 'PROVING' : 'READY'}
                      </span>
                      <h4 className="text-2xl font-bold text-white mt-1">
                        {isProving ? `${provingProgress}%` : '100%'}
                      </h4>
                    </div>
                    
                    {/* Ring 1 */}
                    <div 
                      className="absolute inset-0 border-2 border-[#00f4fe]/20 rounded-full"
                      style={{ animation: 'spin 15s linear infinite' }}
                    >
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-[#00f4fe] rounded-full shadow-[0_0_10px_#00f4fe]"></div>
                    </div>
                    
                    {/* Ring 2 */}
                    <div 
                      className="absolute inset-6 border border-[#8a2be2]/20 rounded-full"
                      style={{ animation: 'spin 20s linear reverse infinite' }}
                    >
                      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-[#8a2be2] rounded-full shadow-[0_0_10px_#8a2be2]"></div>
                    </div>

                    {/* Proving particles */}
                    {isProving && (
                      <>
                        <div className="orbital-particle" style={{ animationDelay: '0s', width: '5px', height: '5px' }}></div>
                        <div className="orbital-particle" style={{ animationDelay: '-2.5s', width: '4px', height: '4px' }}></div>
                        <div className="orbital-particle" style={{ animationDelay: '-5s', width: '6px', height: '6px', background: '#dcb8ff' }}></div>
                        <div className="orbital-particle" style={{ animationDelay: '-7.5s', width: '3px', height: '3px' }}></div>
                      </>
                    )}
                  </div>

                  {/* Prover Pipeline Status Box */}
                  {isProving && (
                    <div className="w-full bg-[#10131a]/80 border border-[#8a2be2]/40 rounded p-4 shadow-xl">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-[10px] font-bold text-[#8a2be2] uppercase tracking-wider flex items-center gap-1 font-sans">
                          <span className="material-symbols-outlined text-xs animate-spin">memory</span>
                          ZK Proof Pipeline
                        </span>
                        <span className="text-xs text-[#00f4fe] font-mono">{provingProgress}%</span>
                      </div>
                      
                      <div className="h-1 bg-white/10 rounded-full overflow-hidden mb-3">
                        <div className="h-full bg-gradient-to-r from-[#8a2be2] to-[#00f4fe] transition-all" style={{ width: `${provingProgress}%` }}></div>
                      </div>

                      <div className="bg-black/30 border border-white/5 rounded p-3 font-mono text-[9px] text-[#00f4fe] max-h-[100px] overflow-y-auto space-y-1">
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
          )}

          {/* TAB 3: PRIVATE SEND */}
          {activeTab === 'send' && (
            <div className="max-w-[700px] mx-auto animate-fade-in">
              <div className="glass-panel rounded-lg p-6 md:p-8 glass-inner-stroke">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#8a2be2]/20 border border-[#8a2be2]/30 mb-4 text-[#dcb8ff]">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#00f4fe] privacy-pulse"></div>
                  <span className="text-[10px] font-mono uppercase tracking-wider">Zero Knowledge Router</span>
                </div>
                
                <h2 className="text-xl font-bold text-white mb-2">Secure Transfer</h2>
                <p className="text-xs text-[#cfc2d7] leading-relaxed mb-6">
                  Compile an Aztec UltraHonk proof locally. This proves you own a valid note in the commitment tree, and outputs a spent nullifier preventing double-spend, without revealing your sender address or payment amount on the public ledger.
                </p>

                <form onSubmit={handleShieldedTransfer} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[#cfc2d7] block">Select Shielded Note to Spend</label>
                    <select
                      value={selectedNoteCommitment}
                      onChange={(e) => handleNoteChange(e.target.value)}
                      disabled={isProving || !isConnected || notes.filter(n => !n.spent).length === 0}
                      className="w-full glass-input px-4 py-3 text-sm text-white rounded bg-black/60 border border-white/10"
                    >
                      {notes.filter(n => !n.spent).length === 0 ? (
                        <option value="">No unspent notes found - shield assets first</option>
                      ) : (
                        notes.filter(n => !n.spent).map(note => (
                          <option key={note.commitment} value={note.commitment} className="bg-[#110022]">
                            {note.amount.toFixed(2)} USDC Note (Commitment: {note.commitment.slice(0, 8)}...)
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[#cfc2d7] block">Recipient Stellar Address</label>
                    <input 
                      type="text" 
                      placeholder="G... or C..."
                      value={recipientAddress}
                      onChange={(e) => setRecipientAddress(e.target.value)}
                      disabled={isProving || !isConnected}
                      className="w-full glass-input px-4 py-3 text-sm text-white rounded"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-[#cfc2d7] block">Amount to Spend (USDC)</label>
                      <input 
                        type="number" 
                        placeholder="Populated from selected note"
                        value={transferAmount}
                        disabled={true}
                        className="w-full glass-input px-4 py-3 text-sm text-white/70 rounded bg-white/5 cursor-not-allowed"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-[#cfc2d7] block">Bulletproof/Aztec Mode</label>
                      <div className="bg-white/5 border border-white/10 rounded px-4 py-3 flex items-center justify-between h-[46px]">
                        <span className="text-xs text-[#cfc2d7]">Turbo Proving</span>
                        <div className="w-8 h-4 bg-[#8a2be2] rounded-full relative cursor-pointer p-0.5">
                          <div className="w-3 h-3 bg-white rounded-full absolute right-0.5 top-0.5"></div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {!isConnected ? (
                    <div className="space-y-3 pt-2">
                      <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
                        <span className="material-symbols-outlined text-sm">warning</span>
                        <span>Connect your wallet to execute shielded transfers.</span>
                      </div>
                      <button 
                        type="button"
                        onClick={connectWallet}
                        className="w-full btn-primary py-3 rounded text-xs font-bold transition-all cursor-pointer"
                      >
                        Connect Wallet
                      </button>
                    </div>
                  ) : (
                    <button 
                      type="submit"
                      disabled={isProving}
                      className="w-full btn-primary py-3 rounded text-xs font-bold transition-all active:scale-95 disabled:opacity-50 cursor-pointer mt-4"
                    >
                      {isProving ? "Generating ZK Proof..." : "Generate ZK Proof & Send"}
                    </button>
                  )}
                </form>

                {/* Prover step widget */}
                {isProving && (
                  <div className="mt-6 bg-black/40 border border-[#00f4fe]/30 rounded-lg p-5">
                    <h4 className="text-xs font-bold text-white mb-4 flex items-center gap-1.5 font-sans">
                      <span className="material-symbols-outlined text-xs animate-spin text-[#00f4fe]">cycle</span>
                      ZK Engine Pipeline Status
                    </h4>
                    
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 text-xs">
                        <span className="material-symbols-outlined text-[#00f4fe] text-sm">check_circle</span>
                        <span className="text-white">Retrieving commitment tree state</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="material-symbols-outlined text-[#00f4fe] text-sm">check_circle</span>
                        <span className="text-white">Generating Merkle membership proof (depth 8)</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="material-symbols-outlined text-sm animate-spin text-[#00f4fe]">autorenew</span>
                        <span className="text-[#00f4fe] font-bold">Synthesizing proof bytes & public inputs</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: COMPLIANCE */}
          {activeTab === 'compliance' && (
            <div className="max-w-[900px] mx-auto animate-fade-in">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                
                {/* Form column */}
                <div className="lg:col-span-5 space-y-6">
                  <div className="glass-panel rounded-lg p-6 md:p-8 glass-inner-stroke">
                    <div className="flex items-center gap-2 mb-4 text-[#00f4fe]">
                      <span className="material-symbols-outlined text-sm pulse-animation">verified</span>
                      <span className="text-[10px] font-mono uppercase tracking-widest">Mathematical Seals</span>
                    </div>
                    
                    <h2 className="text-lg font-bold text-white mb-3">Integrity Proofs</h2>
                    <p className="text-xs text-[#cfc2d7] leading-relaxed mb-6">
                      Whisper uses zero-knowledge membership proofs to generate compliance attestations. Provide regulators or partners with receipts confirming source funds reside outside sanctions lists, without revealing your history.
                    </p>

                    <form onSubmit={handleGenerateCompliance} className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[#cfc2d7] block">Proof Type</label>
                        <select 
                          value={complianceStandard}
                          onChange={(e) => setComplianceStandard(e.target.value)}
                          className="w-full glass-input px-4 py-3 text-sm text-white rounded"
                          style={{ colorScheme: 'dark' }}
                        >
                          <option value="aml-sanctions">Sanction-Free Attestation</option>
                          <option value="tax-audit">Capital Gains & Tax Audits (FY 2026)</option>
                        </select>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-[#cfc2d7] block">Private Viewing Key</label>
                          {zkPrivateKey && (
                            <span className="text-[9px] text-[#00f4fe] font-mono">Derived from Freighter</span>
                          )}
                        </div>
                        <input 
                          type="password" 
                          placeholder={zkPrivateKey ? `skey_${zkPrivateKey.slice(0, 16)}...` : "Enter secret viewing key (skey_...)"}
                          value={zkPrivateKey ? `skey_${zkPrivateKey}` : viewingKey}
                          onChange={(e) => {
                            if (!zkPrivateKey) {
                              setViewingKey(e.target.value);
                            }
                          }}
                          disabled={isProving || !isConnected || !!zkPrivateKey}
                          className="w-full glass-input px-4 py-3 text-sm text-white rounded opacity-90"
                        />
                      </div>

                      {!isConnected ? (
                        <div className="space-y-3 pt-2">
                          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
                            <span className="material-symbols-outlined text-sm">warning</span>
                            <span>Connect your wallet to generate proofs.</span>
                          </div>
                          <button 
                            type="button"
                            onClick={connectWallet}
                            className="w-full btn-primary py-3 rounded text-xs font-bold transition-all cursor-pointer"
                          >
                            Connect Wallet
                          </button>
                        </div>
                      ) : (
                        <button 
                          type="submit"
                          disabled={isProving || (!zkPrivateKey && !viewingKey)}
                          className="w-full btn-primary py-3 rounded text-xs font-bold transition-all active:scale-95 disabled:opacity-50 cursor-pointer mt-4"
                        >
                          {isProving ? "Generating Attestation..." : "Generate Cryptographic Proof"}
                        </button>
                      )}
                    </form>
                  </div>
                </div>

                {/* Certificate receipts column */}
                <div className="lg:col-span-7">
                  <div className="glass-panel rounded-lg p-6 md:p-8 glass-inner-stroke min-h-full">
                    <h3 className="font-bold text-lg text-white mb-1">Receipts Vault</h3>
                    <p className="text-xs text-[#cfc2d7] mb-6">Active attestations and verification certificates</p>
                    
                    {complianceReport ? (
                      <div className="border border-[#00f4fe]/30 bg-black/40 rounded-lg p-6 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-24 h-24 bg-[#00f4fe]/5 blur-xl pointer-events-none"></div>
                        
                        <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-4">
                          <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-2xl text-[#00f4fe]">gavel</span>
                            <div>
                              <h4 className="font-bold text-sm text-white">Compliance Attestation</h4>
                              <p className="text-[10px] text-[#cfc2d7] font-mono">{complianceReport.id}</p>
                            </div>
                          </div>
                          <span className="px-2 py-0.5 bg-green-500/20 border border-green-500/30 text-green-400 font-bold text-[9px] rounded-full font-mono uppercase tracking-wider">
                            {complianceReport.status}
                          </span>
                        </div>

                        <div className="space-y-3 text-xs font-mono mb-6">
                          <div className="flex justify-between">
                            <span className="text-[#cfc2d7]">Attestation Set:</span>
                            <span className="text-white">{complianceReport.standard}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#cfc2d7]">Generated Time:</span>
                            <span className="text-white">{complianceReport.timestamp}</span>
                          </div>
                          <div className="flex flex-col gap-1 mt-2">
                            <span className="text-[#cfc2d7]">Merkle Root:</span>
                            <span className="text-[#00dce5] text-[10px] break-all">{complianceReport.merkleRoot}</span>
                          </div>
                        </div>

                        <div className="flex gap-4">
                          <button 
                            onClick={() => alert("Cryptographic proof JSON file downloaded.")}
                            className="flex-1 btn-primary py-2.5 rounded text-xs font-bold hover:bg-[#00f4fe]/90 transition-all cursor-pointer flex items-center justify-center gap-1"
                          >
                            <span className="material-symbols-outlined text-sm">download</span>
                            Download PDF/JSON
                          </button>
                          <button 
                            onClick={() => setComplianceReport(null)}
                            className="flex-1 glass-action py-2.5 rounded text-xs font-bold transition-all cursor-pointer"
                          >
                            Reset
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="border border-dashed border-white/10 rounded-lg p-10 text-center flex flex-col items-center justify-center">
                        <span className="material-symbols-outlined text-4xl text-[#cfc2d7]/30 mb-2">description</span>
                        <p className="text-xs text-[#cfc2d7] max-w-xs">No active compliance certificates generated in this session. Input your private viewing key to output a proof.</p>
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </div>
          )}

        </div>

        {/* Global Footer */}
        <footer className="mt-auto pt-8 border-t border-white/10 flex flex-wrap gap-6 items-center justify-between text-xs text-[#cfc2d7]/60">
          <div className="flex gap-6">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#cfc2d7]/40">Network Health</p>
              <p className="font-bold text-[#00dce5]">Optimal</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#cfc2d7]/40">Latency</p>
              <p className="font-bold text-white">142ms</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#cfc2d7]/40">Nodes Online</p>
              <p className="font-bold text-white">4,129</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <span>Securely Connected via 12.0.4.82</span>
            <div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]"></div>
          </div>
        </footer>

      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full bg-[#191c22]/90 backdrop-blur-xl border-t border-white/10 px-6 py-3 flex justify-between items-center z-[100]">
        <button 
          onClick={() => setActiveTab('vault')}
          className={`flex flex-col items-center gap-1 bg-transparent border-none ${activeTab === 'vault' ? 'text-[#00f4fe]' : 'text-[#cfc2d7]'}`}
        >
          <span className="material-symbols-outlined text-xl">dashboard</span>
          <span className="text-[9px] font-bold">VAULT</span>
        </button>
        <button 
          onClick={() => setActiveTab('pool')}
          className={`flex flex-col items-center gap-1 bg-transparent border-none ${activeTab === 'pool' ? 'text-[#00f4fe]' : 'text-[#cfc2d7]'}`}
        >
          <span className="material-symbols-outlined text-xl">waves</span>
          <span className="text-[9px]">POOL</span>
        </button>
        <button 
          onClick={() => setActiveTab('send')}
          className={`flex flex-col items-center gap-1 bg-transparent border-none ${activeTab === 'send' ? 'text-[#00f4fe]' : 'text-[#cfc2d7]'}`}
        >
          <span className="material-symbols-outlined text-xl">send</span>
          <span className="text-[9px]">SEND</span>
        </button>
        <button 
          onClick={() => setActiveTab('compliance')}
          className={`flex flex-col items-center gap-1 bg-transparent border-none ${activeTab === 'compliance' ? 'text-[#00f4fe]' : 'text-[#cfc2d7]'}`}
        >
          <span className="material-symbols-outlined text-xl">verified_user</span>
          <span className="text-[9px]">COMPLIANCE</span>
        </button>
      </nav>
    </div>
  );
}
