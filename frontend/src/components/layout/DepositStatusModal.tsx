import { useState } from 'react';

interface DepositStatusModalProps {
  status: 'idle' | 'success' | 'failed';
  amount?: number;
  txHash?: string;
  commitment?: string;
  error?: string;
  onClose: () => void;
}

export function DepositStatusModal({
  status,
  amount,
  txHash,
  commitment,
  error,
  onClose
}: DepositStatusModalProps) {
  const [copiedCommitment, setCopiedCommitment] = useState(false);
  const [copiedTx, setCopiedTx] = useState(false);

  if (status === 'idle') return null;

  const copyToClipboard = (text: string, type: 'commitment' | 'tx') => {
    navigator.clipboard.writeText(text);
    if (type === 'commitment') {
      setCopiedCommitment(true);
      setTimeout(() => setCopiedCommitment(false), 2000);
    } else {
      setCopiedTx(true);
      setTimeout(() => setCopiedTx(false), 2000);
    }
  };

  const truncateHex = (hex: string) => {
    if (!hex) return '';
    return hex.slice(0, 10) + '...' + hex.slice(-10);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content max-w-[500px]" onClick={(e) => e.stopPropagation()}>
        {status === 'success' ? (
          <div className="text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center text-green-400">
              <span className="material-symbols-outlined text-3xl animate-pulse">check_circle</span>
            </div>
            
            <h2 className="text-xl font-bold text-white">Shielding Deposit Successful!</h2>
            <p className="text-xs text-[#cfc2d7] leading-relaxed">
              Your assets have been successfully shielded and deposited into the private pool.
            </p>

            <div className="bg-black/40 border border-white/5 rounded-lg p-4 text-left space-y-3 font-sans text-xs mt-4">
              <div className="flex justify-between items-center border-b border-white/5 pb-2">
                <span className="text-[#cfc2d7]/70">Amount Shielded:</span>
                <span className="text-[#00f4fe] font-bold font-mono">{amount} USDC</span>
              </div>

              {commitment && (
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                  <span className="text-[#cfc2d7]/70">Poseidon Commitment:</span>
                  <div className="flex items-center gap-1.5 font-mono">
                    <span className="text-white">{truncateHex(commitment)}</span>
                    <button
                      onClick={() => copyToClipboard(commitment, 'commitment')}
                      className="text-[#cfc2d7]/70 hover:text-white transition-colors bg-transparent border-none p-0 flex cursor-pointer"
                      title="Copy commitment hash"
                    >
                      <span className="material-symbols-outlined text-sm">
                        {copiedCommitment ? 'check' : 'content_copy'}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {txHash && (
                <div className="flex justify-between items-center">
                  <span className="text-[#cfc2d7]/70">Transaction Hash:</span>
                  <div className="flex items-center gap-1.5 font-mono">
                    <span className="text-white">{truncateHex(txHash)}</span>
                    <button
                      onClick={() => copyToClipboard(txHash, 'tx')}
                      className="text-[#cfc2d7]/70 hover:text-white transition-colors bg-transparent border-none p-0 flex cursor-pointer"
                      title="Copy tx hash"
                    >
                      <span className="material-symbols-outlined text-sm">
                        {copiedTx ? 'check' : 'content_copy'}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-4">
              {txHash && (
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-center py-2.5 rounded text-xs transition-all font-bold border border-[#00f4fe]/30 hover:border-[#00f4fe]/60 text-[#00f4fe] bg-transparent hover:bg-[#00f4fe]/5 flex items-center justify-center"
                >
                  View on Explorer
                </a>
              )}
              <button
                onClick={onClose}
                className="flex-1 btn-primary py-2.5 rounded text-xs transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400">
              <span className="material-symbols-outlined text-3xl">warning</span>
            </div>
            
            <h2 className="text-xl font-bold text-white">Shielding Deposit Failed</h2>
            <p className="text-xs text-[#cfc2d7] leading-relaxed">
              An error occurred while attempting to shield and deposit your assets.
            </p>

            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-left font-mono text-[11px] text-red-400 max-h-[120px] overflow-y-auto mt-4 break-words">
              {error || 'Unknown error occurred'}
            </div>

            <div className="pt-4">
              <button
                onClick={onClose}
                className="w-full btn-primary py-2.5 rounded text-xs transition-all cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
