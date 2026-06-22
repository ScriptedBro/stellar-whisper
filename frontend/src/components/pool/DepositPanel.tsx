interface DepositPanelProps {
  depositAmount: string;
  setDepositAmount: (amount: string) => void;
  isProving: boolean;
  provingProgress: number;
  provingLogs: string[];
  isConnected: boolean;
  connectWallet: () => Promise<void>;
  handleShieldDeposit: (e: React.FormEvent) => Promise<void>;
}

export function DepositPanel({
  depositAmount,
  setDepositAmount,
  isProving,
  provingProgress,
  provingLogs,
  isConnected,
  connectWallet,
  handleShieldDeposit
}: DepositPanelProps) {
  return (
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
  );
}
