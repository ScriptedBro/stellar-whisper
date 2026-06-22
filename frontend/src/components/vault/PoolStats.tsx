

export function PoolStats() {
  return (
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
        className="mt-6 w-full py-2.5 text-xs font-bold text-[#00dce5] hover:text-white transition-colors flex items-center justify-center gap-1 cursor-pointer bg-transparent border-none"
      >
        View Detailed Metrics
        <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
      </button>
    </div>
  );
}
