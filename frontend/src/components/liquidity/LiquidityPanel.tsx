import { useState } from 'react';
import { useNotification } from '../../context/NotificationContext';

interface LiquidityPanelProps {
  isConnected: boolean;
  connectWallet: () => Promise<void>;
  publicXlmBalance: number;
  publicUsdcBalance: number;
}

export function LiquidityPanel({
  isConnected,
  connectWallet,
  publicXlmBalance,
  publicUsdcBalance
}: LiquidityPanelProps) {
  const { showToast } = useNotification();
  const [activeSubTab, setActiveSubTab] = useState<'add' | 'remove'>('add');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processingLogs, setProcessingLogs] = useState<string[]>([]);
  
  // Input fields for Add Liquidity
  const [addXlmAmount, setAddXlmAmount] = useState('');
  const [addUsdcAmount, setAddUsdcAmount] = useState('');
  
  // Input fields for Remove Liquidity
  const [removePercent, setRemovePercent] = useState<number>(50);

  // Mock Pool State
  const [xlmReserve, setXlmReserve] = useState(325480);
  const [usdcReserve, setUsdcReserve] = useState(80194);
  const [userLpBalance, setUserLpBalance] = useState(12.5); // Initial mock LP tokens

  const xlmPrice = 0.25; // 1 XLM = $0.25
  const poolTvl = (xlmReserve * xlmPrice) + usdcReserve;
  const userLpValue = userLpBalance * 40; // Mock LP value rate
  
  // Calculate relative amounts when user enters one
  const handleXlmChange = (val: string) => {
    setAddXlmAmount(val);
    if (val === '') {
      setAddUsdcAmount('');
    } else {
      const xlmVal = parseFloat(val);
      if (!isNaN(xlmVal)) {
        // Maintain equal value pool ratio: 1 XLM = 0.25 USDC
        setAddUsdcAmount((xlmVal * xlmPrice).toFixed(2));
      }
    }
  };

  const handleUsdcChange = (val: string) => {
    setAddUsdcAmount(val);
    if (val === '') {
      setAddXlmAmount('');
    } else {
      const usdcVal = parseFloat(val);
      if (!isNaN(usdcVal)) {
        setAddXlmAmount((usdcVal / xlmPrice).toFixed(2));
      }
    }
  };

  const handleAddLiquiditySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addXlmAmount || !addUsdcAmount) return;
    
    const xlmToDeposit = parseFloat(addXlmAmount);
    const usdcToDeposit = parseFloat(addUsdcAmount);

    if (xlmToDeposit > publicXlmBalance) {
      showToast(`Insufficient Balance: You don't have enough XLM to add this liquidity.`, "error");
      return;
    }

    if (usdcToDeposit > publicUsdcBalance) {
      showToast(`Insufficient Balance: You don't have enough USDC to add this liquidity.`, "error");
      return;
    }

    setIsProcessing(true);
    setProgress(10);
    setProcessingLogs(["1. Connecting to Soroban liquidity contract...", "2. Estimating resource fee bounds..."]);

    const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
    
    await delay(1200);
    setProgress(40);
    setProcessingLogs(prev => [...prev, "3. Initiating dual-token multi-auth flow...", "4. Approving XLM and USDC transfer spending caps..."]);
    
    await delay(1500);
    setProgress(75);
    setProcessingLogs(prev => [...prev, "5. Submitting LP deposit transaction to Soroban ledger...", "6. Minting pool share token (XLM-USDC LP)..."]);
    
    await delay(1200);
    setProgress(100);
    
    // Update local state
    setXlmReserve(prev => prev + xlmToDeposit);
    setUsdcReserve(prev => prev + usdcToDeposit);
    const newLpMinted = (xlmToDeposit * xlmPrice + usdcToDeposit) / 40;
    setUserLpBalance(prev => prev + newLpMinted);
    
    setIsProcessing(false);
    setAddXlmAmount('');
    setAddUsdcAmount('');
    
    showToast(`Liquidity Deposited: Added ${xlmToDeposit} XLM & ${usdcToDeposit} USDC to the pool. Minted ${newLpMinted.toFixed(4)} LP tokens.`, "success");
  };

  const handleRemoveLiquiditySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userLpBalance <= 0) return;

    setIsProcessing(true);
    setProgress(15);
    setProcessingLogs(["1. Querying active LP notes/shares...", "2. Constructing redeem proof..."]);

    const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
    
    await delay(1000);
    setProgress(50);
    setProcessingLogs(prev => [...prev, "3. Redeeming LP tokens from pool reserve...", "4. Preparing withdrawal payouts..."]);
    
    await delay(1200);
    setProgress(85);
    setProcessingLogs(prev => [...prev, "5. Broadcasting withdrawal transaction to Soroban...", "6. Processing final asset payout..."]);
    
    await delay(1000);
    setProgress(100);
    
    const lpToRemove = (userLpBalance * removePercent) / 100;
    const xlmReturned = lpToRemove * 20 * (1 / xlmPrice);
    const usdcReturned = lpToRemove * 20;

    setXlmReserve(prev => Math.max(0, prev - xlmReturned));
    setUsdcReserve(prev => Math.max(0, prev - usdcReturned));
    setUserLpBalance(prev => Math.max(0, prev - lpToRemove));
    
    setIsProcessing(false);
    
    showToast(`Liquidity Removed: Burned ${lpToRemove.toFixed(4)} LP tokens. Received ${xlmReturned.toFixed(2)} XLM and ${usdcReturned.toFixed(2)} USDC.`, "success");
  };

  return (
    <div className="max-w-[850px] mx-auto animate-fade-in pb-12">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Column: Pool Stats & Reserves */}
        <div className="lg:col-span-5 space-y-6">
          <div className="glass-panel rounded-lg p-6 glass-inner-stroke relative overflow-hidden">
            <div className="absolute -right-12 -top-12 w-32 h-32 bg-[#00f4fe]/5 blur-3xl"></div>
            <h3 className="font-bold text-base text-white mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-[#00f4fe]">analytics</span>
              XLM-USDC Pool Details
            </h3>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                <span className="text-[10px] text-[#cfc2d7] uppercase tracking-wider block mb-1">Total TVL</span>
                <span className="text-xl font-bold text-white font-mono">${poolTvl.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                <span className="text-[10px] text-[#cfc2d7] uppercase tracking-wider block mb-1">Pool APR</span>
                <span className="text-xl font-bold text-[#00ff87] font-mono">18.5% APR</span>
              </div>
            </div>

            <div className="space-y-3 font-mono text-xs border-t border-white/10 pt-4">
              <div className="flex justify-between items-center text-[#cfc2d7]">
                <span>XLM Reserves:</span>
                <span className="text-white font-bold">{xlmReserve.toLocaleString()} XLM</span>
              </div>
              <div className="flex justify-between items-center text-[#cfc2d7]">
                <span>USDC Reserves:</span>
                <span className="text-white font-bold">${usdcReserve.toLocaleString()} USDC</span>
              </div>
              <div className="flex justify-between items-center text-[#cfc2d7]">
                <span>Trading Fee:</span>
                <span className="text-white font-bold">0.30%</span>
              </div>
              <div className="flex justify-between items-center text-[#cfc2d7]">
                <span>24h Swap Volume:</span>
                <span className="text-[#00f4fe] font-bold">$12,450 USD</span>
              </div>
            </div>
          </div>

          {/* User's LP Position */}
          <div className="glass-panel rounded-lg p-6 glass-inner-stroke relative overflow-hidden">
            <div className="absolute -right-12 -top-12 w-32 h-32 bg-[#8a2be2]/5 blur-3xl"></div>
            <h3 className="font-bold text-base text-white mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-[#8a2be2]">account_balance_wallet</span>
              Your Liquidity Position
            </h3>

            {userLpBalance > 0 ? (
              <div className="space-y-4">
                <div className="bg-[#8a2be2]/10 border border-[#8a2be2]/30 p-4 rounded-xl flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-[#dcb8ff] uppercase tracking-wider block mb-0.5">LP Tokens</span>
                    <span className="text-lg font-bold text-white font-mono">{userLpBalance.toFixed(4)} XLM-USDC LP</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-[#dcb8ff] uppercase tracking-wider block mb-0.5">Value Est.</span>
                    <span className="text-lg font-bold text-[#00f4fe] font-mono">${userLpValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>

                <div className="text-xs text-[#cfc2d7] space-y-1.5 font-mono">
                  <div className="flex justify-between">
                    <span>Pool Share:</span>
                    <span className="text-white font-bold">{((userLpBalance / (poolTvl / 40)) * 100).toFixed(4)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Underlying XLM:</span>
                    <span className="text-white font-bold">{(userLpBalance * 20 * 4).toFixed(2)} XLM</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Underlying USDC:</span>
                    <span className="text-white font-bold">${(userLpBalance * 20).toFixed(2)} USDC</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-[#cfc2d7]">
                <span className="material-symbols-outlined text-4xl text-white/20 mb-2">water_drop</span>
                <p className="text-xs">No active liquidity provided yet.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Interaction Form */}
        <div className="lg:col-span-7 space-y-6">
          <div className="glass-panel rounded-lg p-6 md:p-8 glass-inner-stroke">
            <div className="flex items-center justify-between w-full mb-6 border-b border-white/10 pb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-[#00f4fe]">waves</span>
                Liquidity Management
              </h2>

              {/* Sub-tabs: Add/Remove */}
              <div className="flex bg-white/5 p-1 rounded-full border border-white/10 font-sans">
                <button
                  type="button"
                  onClick={() => setActiveSubTab('add')}
                  className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer border-none ${
                    activeSubTab === 'add' 
                      ? 'bg-[#00f4fe] text-black shadow-[0_0_8px_rgba(0,244,254,0.4)]' 
                      : 'text-[#cfc2d7] hover:text-white bg-transparent'
                  }`}
                >
                  Add LP
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSubTab('remove')}
                  className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer border-none ${
                    activeSubTab === 'remove' 
                      ? 'bg-[#00f4fe] text-black shadow-[0_0_8px_rgba(0,244,254,0.4)]' 
                      : 'text-[#cfc2d7] hover:text-white bg-transparent'
                  }`}
                >
                  Remove LP
                </button>
              </div>
            </div>

            {activeSubTab === 'add' ? (
              <form onSubmit={handleAddLiquiditySubmit} className="space-y-4">
                <p className="text-xs text-[#cfc2d7] leading-relaxed mb-4">
                  Add equal values of XLM and USDC. This pool uses the constant product AMM formula on Soroban. The pool contract acts as the anonymous custodian for your shares if routed via Whisper.
                </p>

                {/* XLM input */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[#cfc2d7]">Deposit XLM</label>
                    <span className="text-[10px] font-mono text-[#cfc2d7]">Balance: {publicXlmBalance.toLocaleString()} XLM</span>
                  </div>
                  <div className="relative">
                    <input 
                      type="number"
                      placeholder="0.00"
                      value={addXlmAmount}
                      onChange={(e) => handleXlmChange(e.target.value)}
                      disabled={isProcessing || !isConnected}
                      className="w-full glass-input px-4 py-3 text-sm text-white rounded pr-16"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-white">XLM</span>
                      <button
                        type="button"
                        onClick={() => handleXlmChange(publicXlmBalance.toString())}
                        className="text-[#00f4fe] hover:underline cursor-pointer bg-transparent border-none p-0 text-[10px] font-bold"
                      >
                        MAX
                      </button>
                    </div>
                  </div>
                </div>

                {/* Addition Indicator */}
                <div className="flex justify-center my-1 text-[#00f4fe]">
                  <span className="material-symbols-outlined">add</span>
                </div>

                {/* USDC input */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[#cfc2d7]">Deposit USDC</label>
                    <span className="text-[10px] font-mono text-[#cfc2d7]">Balance: ${publicUsdcBalance.toLocaleString()} USDC</span>
                  </div>
                  <div className="relative">
                    <input 
                      type="number"
                      placeholder="0.00"
                      value={addUsdcAmount}
                      onChange={(e) => handleUsdcChange(e.target.value)}
                      disabled={isProcessing || !isConnected}
                      className="w-full glass-input px-4 py-3 text-sm text-white rounded pr-16"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-white">USDC</span>
                      <button
                        type="button"
                        onClick={() => handleUsdcChange(publicUsdcBalance.toString())}
                        className="text-[#00f4fe] hover:underline cursor-pointer bg-transparent border-none p-0 text-[10px] font-bold"
                      >
                        MAX
                      </button>
                    </div>
                  </div>
                </div>

                {!isConnected ? (
                  <button 
                    type="button"
                    onClick={connectWallet}
                    className="w-full btn-primary py-3 rounded text-xs font-bold transition-all cursor-pointer mt-4"
                  >
                    Connect Wallet to Deposit LP
                  </button>
                ) : (
                  <button 
                    type="submit"
                    disabled={isProcessing || !addXlmAmount}
                    className="w-full btn-primary py-3 rounded text-xs font-bold transition-all active:scale-95 disabled:opacity-50 cursor-pointer mt-4"
                  >
                    {isProcessing ? "Processing LP Deposit..." : "Supply Liquidity"}
                  </button>
                )}
              </form>
            ) : (
              <form onSubmit={handleRemoveLiquiditySubmit} className="space-y-5">
                <p className="text-xs text-[#cfc2d7] leading-relaxed mb-2">
                  Choose the percentage of your LP tokens to withdraw. The smart contract will return equal values of XLM and USDC representing your shares + accrued fee earnings.
                </p>

                {userLpBalance > 0 ? (
                  <>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[#cfc2d7]">Remove Percentage</label>
                        <span className="text-base font-bold text-white font-mono">{removePercent}%</span>
                      </div>
                      <input 
                        type="range"
                        min="1"
                        max="100"
                        value={removePercent}
                        onChange={(e) => setRemovePercent(parseInt(e.target.value))}
                        disabled={isProcessing}
                        className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#00f4fe]"
                      />
                      <div className="flex justify-between text-[10px] font-mono text-[#cfc2d7]">
                        <button type="button" onClick={() => setRemovePercent(25)} className="hover:text-white cursor-pointer bg-transparent border-none">25%</button>
                        <button type="button" onClick={() => setRemovePercent(50)} className="hover:text-white cursor-pointer bg-transparent border-none">50%</button>
                        <button type="button" onClick={() => setRemovePercent(75)} className="hover:text-white cursor-pointer bg-transparent border-none">75%</button>
                        <button type="button" onClick={() => setRemovePercent(100)} className="hover:text-white cursor-pointer bg-transparent border-none font-bold text-[#00f4fe]">100% (MAX)</button>
                      </div>
                    </div>

                    <div className="bg-white/5 border border-white/5 p-4 rounded-xl space-y-2 text-xs">
                      <span className="font-bold text-white block">Est. Payout Summary:</span>
                      <div className="flex justify-between font-mono text-[#cfc2d7]">
                        <span>Returning XLM:</span>
                        <span className="text-white font-bold">{((userLpBalance * removePercent / 100) * 20 * 4).toFixed(2)} XLM</span>
                      </div>
                      <div className="flex justify-between font-mono text-[#cfc2d7]">
                        <span>Returning USDC:</span>
                        <span className="text-white font-bold">${((userLpBalance * removePercent / 100) * 20).toFixed(2)} USDC</span>
                      </div>
                    </div>

                    <button 
                      type="submit"
                      disabled={isProcessing}
                      className="w-full btn-secondary py-3 rounded text-xs font-bold transition-all active:scale-95 disabled:opacity-50 cursor-pointer border border-[#ffb4ab]/30 text-[#ffb4ab] bg-[#ffb4ab]/5 hover:bg-[#ffb4ab]/10"
                    >
                      {isProcessing ? "Processing LP Withdrawal..." : `Remove ${removePercent}% of Liquidity`}
                    </button>
                  </>
                ) : (
                  <div className="text-center py-8 text-[#cfc2d7]">
                    <span className="material-symbols-outlined text-4xl text-white/20 mb-2">error</span>
                    <p className="text-xs mb-4">You do not have any active LP tokens to withdraw.</p>
                    <button 
                      type="button" 
                      onClick={() => setActiveSubTab('add')}
                      className="btn-primary py-2 px-6 rounded text-xs font-bold cursor-pointer"
                    >
                      Go to Add Liquidity
                    </button>
                  </div>
                )}
              </form>
            )}

            {/* Pipeline progress box */}
            {isProcessing && (
              <div className="w-full bg-[#10131a]/80 border border-[#00f4fe]/40 rounded p-4 shadow-xl mt-6">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-[10px] font-bold text-[#00f4fe] uppercase tracking-wider flex items-center gap-1 font-sans">
                    <span className="material-symbols-outlined text-xs animate-spin">memory</span>
                    Soroban Execution Pipeline
                  </span>
                  <span className="text-xs text-[#00f4fe] font-mono">{progress}%</span>
                </div>
                
                <div className="h-1 bg-white/10 rounded-full overflow-hidden mb-3">
                  <div className="h-full bg-gradient-to-r from-[#8a2be2] to-[#00f4fe] transition-all" style={{ width: `${progress}%` }}></div>
                </div>

                <div className="bg-black/30 border border-white/5 rounded p-3 font-mono text-[9px] text-[#00f4fe] max-h-[100px] overflow-y-auto space-y-1">
                  {processingLogs.map((log, index) => (
                    <div key={index} className={index === processingLogs.length - 1 ? 'text-white font-bold' : ''}>
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
