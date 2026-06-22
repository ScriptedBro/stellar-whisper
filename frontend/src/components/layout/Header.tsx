

interface HeaderProps {
  isConnected: boolean;
  userAddress: string;
  connectWallet: () => Promise<void>;
}

export function Header({ isConnected, userAddress, connectWallet }: HeaderProps) {
  return (
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
          <span className="text-[#00dce5]">NETWORK: TESTNET ENCRYPTED</span>
        </div>

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
  );
}
