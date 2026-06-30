import { useState } from 'react';

interface TransactionStatusModalProps {
  type: 'deposit' | 'transfer' | 'withdraw' | 'swap';
  status: 'idle' | 'success' | 'failed';
  amount?: number;
  txHash?: string;
  commitment?: string;
  nullifier?: string;
  error?: string;
  onClose: () => void;
  assetSymbol?: string;
  toAssetSymbol?: string;
  toAmount?: number;
}

export function TransactionStatusModal({
  type,
  status,
  amount,
  txHash,
  commitment,
  nullifier,
  error,
  onClose,
  assetSymbol,
  toAssetSymbol,
  toAmount
}: TransactionStatusModalProps) {
  const [copiedCommitment, setCopiedCommitment] = useState(false);
  const [copiedNullifier, setCopiedNullifier] = useState(false);
  const [copiedTx, setCopiedTx] = useState(false);

  if (status === 'idle') return null;

  const copyToClipboard = (text: string, field: 'commitment' | 'nullifier' | 'tx') => {
    navigator.clipboard.writeText(text);
    if (field === 'commitment') {
      setCopiedCommitment(true);
      setTimeout(() => setCopiedCommitment(false), 2000);
    } else if (field === 'nullifier') {
      setCopiedNullifier(true);
      setTimeout(() => setCopiedNullifier(false), 2000);
    } else {
      setCopiedTx(true);
      setTimeout(() => setCopiedTx(false), 2000);
    }
  };

  const truncateHex = (hex: string) => {
    if (!hex) return '';
    return hex.slice(0, 10) + '...' + hex.slice(-10);
  };

  const getTitles = () => {
    switch (type) {
      case 'deposit':
        return {
          successTitle: 'Shielding Deposit Successful!',
          successDesc: 'Your assets have been successfully shielded and deposited into the private pool.',
          failTitle: 'Shielding Deposit Failed',
          failDesc: 'An error occurred while attempting to shield and deposit your assets.',
          amountLabel: 'Amount Shielded:'
        };
      case 'transfer':
        return {
          successTitle: 'Shielded Transfer Successful!',
          successDesc: "Your private note has been successfully transferred to the recipient's shielded address.",
          failTitle: 'Shielded Transfer Failed',
          failDesc: 'An error occurred while executing the zero-knowledge shielded transfer.',
          amountLabel: 'Amount Transferred:'
        };
      case 'withdraw':
        return {
          successTitle: 'Shielded Withdrawal Successful!',
          successDesc: 'Your shielded assets have been successfully unshielded and withdrawn to your public address.',
          failTitle: 'Shielded Withdrawal Failed',
          failDesc: 'An error occurred while verifying the ZK proof and executing the withdrawal.',
          amountLabel: 'Amount Withdrawn:'
        };
      case 'swap':
        return {
          successTitle: 'Private Swap Successful!',
          successDesc: 'Your shielded assets have been successfully swapped within the private pool using a ZK proof.',
          failTitle: 'Private Swap Failed',
          failDesc: 'An error occurred while attempting to verify the ZK proof and execute the private swap.',
          amountLabel: 'Amount Swapped:'
        };
    }
  };

  const { successTitle, successDesc, failTitle, failDesc, amountLabel } = getTitles();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content max-w-[500px]" onClick={(e) => e.stopPropagation()}>
        {status === 'success' ? (
          <div className="text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center text-green-400">
              <span className="material-symbols-outlined text-3xl animate-pulse">check_circle</span>
            </div>
            
            <h2 className="text-xl font-bold text-white">{successTitle}</h2>
            <p className="text-xs text-[#cfc2d7] leading-relaxed">
              {successDesc}
            </p>

            <div className="bg-black/40 border border-white/5 rounded-lg p-4 text-left space-y-3 font-sans text-xs mt-4">
              <div className="flex justify-between items-center border-b border-white/5 pb-2">
                <span className="text-[#cfc2d7]/70">{amountLabel}</span>
                {type === 'swap' ? (
                  <span className="text-[#00f4fe] font-bold font-mono">
                    {amount} {assetSymbol || 'USDC'} ➔ {toAmount} {toAssetSymbol || 'XLM'}
                  </span>
                ) : (
                  <span className="text-[#00f4fe] font-bold font-mono">{amount} {assetSymbol || 'USDC'}</span>
                )}
              </div>

              {commitment && (
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                  <span className="text-[#cfc2d7]/70">Recipient Note Commitment:</span>
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

              {nullifier && (
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                  <span className="text-[#cfc2d7]/70">Spent Note Nullifier:</span>
                  <div className="flex items-center gap-1.5 font-mono">
                    <span className="text-white">{truncateHex(nullifier)}</span>
                    <button
                      onClick={() => copyToClipboard(nullifier, 'nullifier')}
                      className="text-[#cfc2d7]/70 hover:text-white transition-colors bg-transparent border-none p-0 flex cursor-pointer"
                      title="Copy nullifier hash"
                    >
                      <span className="material-symbols-outlined text-sm">
                        {copiedNullifier ? 'check' : 'content_copy'}
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
            
            <h2 className="text-xl font-bold text-white">{failTitle}</h2>
            <p className="text-xs text-[#cfc2d7] leading-relaxed">
              {failDesc}
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
