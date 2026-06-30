export interface Config {
  network: string;
  adminAddress: string;
  tokenContractId: string;
  tokenBContractId?: string;
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
  nullifierNonce: string; // Hex string (without 0x)
  commitment: string;     // Hex string (without 0x)
  spent: boolean;
  txHash?: string;
  timestamp?: string;
  assetAddress?: string;  // Stellar token contract address (USDC vs native XLM)
}
