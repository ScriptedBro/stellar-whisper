export interface Config {
  network: string;
  adminAddress: string;
  tokenContractId: string;
  tokenBContractId?: string;
  xlmContractId: string;
  verifierContractId: string;
  whisperContractId: string;
}

export interface ActivityLog {
  id: string;
  type: 'deposit' | 'transfer' | 'compliance' | 'swap';
  amount?: number;
  recipient?: string;
  timestamp: string;
  status: 'pending' | 'success' | 'verified' | 'failed';
  txHash?: string;
  details?: string;
  asset?: 'USDC' | 'XLM';
}

export interface PrivateNote {
  amount: number;
  nullifierNonce: string;
  commitment: string;
  spent: boolean;
  txHash?: string;
  timestamp?: string;
  assetAddress?: string;
}

// Shared spec: Noir circuit public_inputs index mapping (must match contracts/whisper/src/lib.rs)
// These must match the circuit's `pub` parameter ordering in circuits/whisper/src/main.nr
// and the contract's parse ordering in transfer_or_withdraw / swap_shielded
export const PUBLIC_INPUTS = {
  MERKLE_ROOT: 0,
  NULLIFIER_HASH: 1,
  INPUT_AMOUNT: 2,
  PUBLIC_WITHDRAW_AMOUNT: 3,
  PUBLIC_RECIPIENT_HASH: 4,
  OUTPUT_COMMITMENT_1: 5,
  OUTPUT_COMMITMENT_2: 6,
  ASSET_ID: 7,
} as const;

export const CIRCUIT_VERSION = 1;
export const TREE_DEPTH = 16;
