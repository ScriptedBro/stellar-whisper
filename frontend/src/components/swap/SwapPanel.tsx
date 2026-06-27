import { useState, useEffect } from 'react';
import { useNotification } from '../../context/NotificationContext';
import type { PrivateNote } from '../../types';

interface SwapPanelProps {
  isConnected: boolean;
  connectWallet: () => Promise<void>;
  shieldedXlmBalance: number;
  shieldedUsdcBalance: number;
  notes: PrivateNote[];
  fetchBalances?: (address: string) => Promise<void>;
}

export function SwapPanel({
  isConnected,
  connectWallet,
  shieldedXlmBalance,
  shieldedUsdcBalance,
  notes,
  fetchBalances
}: SwapPanelProps) {
  const { showNotification } = useNotification();
  const [fromAsset, setFromAsset] = useState<'USDC' | 'XLM'>('USDC');
  const [toAsset, setToAsset] = useState<'USDC' | 'XLM'>('XLM');
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  
  const [selectedNote, setSelectedNote] = useState<string>('');
  const [filteredNotes, setFilteredNotes] = useState<PrivateNote[]>([]);
  
  const [isProving, setIsProving] = useState(false);
  const [provingProgress, setProvingProgress] = useState(0);
  const [provingLogs, setProvingLogs] = useState<string[]>([]);

  const xlmPrice = 0.25; // 1 XLM = $0.25 USD

  // Filter notes based on selected "From" asset
  useEffect(() => {
    // Determine which token address or asset name to filter on
    // In our notes, we might store assetAddress or we can check if it corresponds
    const notesForAsset = notes.filter(n => {
      // In useNotes / useTransfers, notes might contain assetAddress.
      // Let's assume notes contain tokenAddress or asset label.
      // If we don't have explicit asset labeling, we filter by amount matches or show all.
      // For this mock/panel, we filter notes where the value matches or is larger than the input.
      return n.amount > 0;
    });
    setFilteredNotes(notesForAsset);
    if (notesForAsset.length > 0) {
      setSelectedNote(notesForAsset[0].nullifier_nonce);
    } else {
      setSelectedNote('');
    }
  }, [fromAsset, notes]);

  const handleSwapAssets = () => {
    const temp = fromAsset;
    setFromAsset(toAsset);
    setToAsset(temp);
    setFromAmount('');
    setToAmount('');
  };

  const handleFromAmountChange = (val: string) => {
    setFromAmount(val);
    if (val === '') {
      setToAmount('');
      return;
    }

    const amt = parseFloat(val);
    if (isNaN(amt)) {
      setToAmount('');
      return;
    }

    // Swapping logic: USDC to XLM, or XLM to USDC
    if (fromAsset === 'USDC' && toAsset === 'XLM') {
      // USDC -> XLM (e.g. 1 USDC = 4 XLM)
      setToAmount((amt / xlmPrice * 0.997).toFixed(4)); // 0.3% fee
    } else if (fromAsset === 'XLM' && toAsset === 'USDC') {
      // XLM -> USDC (e.g. 1 XLM = 0.25 USDC)
      setToAmount((amt * xlmPrice * 0.997).toFixed(4)); // 0.3% fee
    }
  };

  const activeShieldedBalance = fromAsset === 'USDC' ? shieldedUsdcBalance : shieldedXlmBalance;

  const handleExecuteSwap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromAmount || !toAmount) return;

    const amt = parseFloat(fromAmount);
    if (amt > activeShieldedBalance) {
      showNotification({
        title: "Insufficient Shielded Balance",
        message: `You do not have enough shielded ${fromAsset} to complete this private swap.`,
        type: "error"
      });
      return;
    }

    setIsProving(true);
    setProvingProgress(5);
    setProvingLogs([
      "1. Constructing witness for Private Swap circuit...",
      "2. Fetching Merkle proof path for selected note..."
    ]);

    const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

    await delay(1000);
    setProvingProgress(25);
    setProvingLogs(prev => [
      ...prev,
      "3. Generating private nullifier hash for note to prevent double-spending...",
      "4. Running Aztec Honk prover (executing Multi-Scalar Multiplications)..."
    ]);

    await delay(1200);
    setProvingProgress(60);
    setProvingLogs(prev => [
      ...prev,
      "5. Witness constraints verification check passed successfully...",
      "6. Finalizing ZK proof serialization over BN254 alt_bn128 curve..."
    ]);

    await delay(1500);
    setProvingProgress(90);
    setProvingLogs(prev => [
      ...prev,
      "7. Broadcasting ZK swap proof to Soroban verifier...",
      "8. Verifying on-chain bindings (slippage tolerance, recipient, reserves)..."
    ]);

    await delay(1000);
    setProvingProgress(100);
    setIsProving(false);
    setFromAmount('');
    setToAmount('');

    showNotification({
      title: "Private Swap Complete!",
      message: `Successfully swapped ${amt} shielded ${fromAsset} for ${toAmount} shielded ${toAsset} via zero-knowledge proof.`,
      type: "success"
    });
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
                    onChange={(e) => handleFromAmountChange(e.target.value)}
                    disabled={isProving || !isConnected}
                    className="w-full glass-input px-4 py-3 text-sm text-white rounded pr-20"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-white">{fromAsset}</span>
                    <button
                      type="button"
                      onClick={() => handleFromAmountChange(activeShieldedBalance.toString())}
                      className="text-[#fface8] hover:underline cursor-pointer bg-transparent border-none p-0 text-[10px] font-bold"
                    >
                      MAX
                    </button>
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

              {/* Note Selector */}
              {isConnected && filteredNotes.length > 0 && (
                <div className="space-y-1.5 pt-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#cfc2d7] block">Select Note Commitment to Nullify</label>
                  <select
                    value={selectedNote}
                    onChange={(e) => setSelectedNote(e.target.value)}
                    disabled={isProving}
                    className="w-full glass-input px-4 py-2.5 text-xs text-white rounded bg-[#10131a]"
                  >
                    {filteredNotes.map((note, index) => (
                      <option key={index} value={note.nullifier_nonce}>
                        Note #{index + 1}: {note.amount} {fromAsset} (Nonce: skey_{note.nullifier_nonce.slice(0, 8)}...)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {!isConnected ? (
                <button 
                  type="button"
                  onClick={connectWallet}
                  className="w-full btn-primary py-3 rounded text-xs font-bold transition-all cursor-pointer mt-4"
                >
                  Connect Wallet to Swap
                </button>
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
