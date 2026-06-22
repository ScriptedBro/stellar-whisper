

interface SidebarProps {
  activeTab: 'vault' | 'pool' | 'send' | 'compliance';
  setActiveTab: (tab: 'vault' | 'pool' | 'send' | 'compliance') => void;
  isConnected: boolean;
  userAddress: string;
  zkPrivateKey: string;
  derivedPubkeyHex: string;
  derivedViewingKey: string;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  fundWallet: () => Promise<void>;
  setShowSettings: (show: boolean) => void;
}

export function Sidebar({
  activeTab,
  setActiveTab,
  isConnected,
  userAddress,
  zkPrivateKey,
  derivedPubkeyHex,
  derivedViewingKey,
  connectWallet,
  disconnectWallet,
  fundWallet,
  setShowSettings
}: SidebarProps) {
  return (
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
                <>
                  <span className="text-[#dcb8ff] truncate text-[9px] mt-1 border border-[#8a2be2]/30 px-1 py-0.5 rounded bg-[#8a2be2]/10" title={`skey_${zkPrivateKey}`}>
                    🔑 ZK-Key: skey_{zkPrivateKey.slice(0, 6)}...
                  </span>
                  <span className="text-[#00f4fe] truncate text-[9px] mt-1 border border-[#00f4fe]/30 px-1 py-0.5 rounded bg-[#00f4fe]/10" title={derivedPubkeyHex}>
                    🛡️ ZK PubKey: {derivedPubkeyHex.slice(0, 6)}...
                  </span>
                  <span className="text-[#00ff87] truncate text-[9px] mt-1 border border-[#00ff87]/30 px-1 py-0.5 rounded bg-[#00ff87]/10" title={derivedViewingKey}>
                    👁️ Viewing Key: {derivedViewingKey.slice(0, 6)}...
                  </span>
                </>
              )}
              <button onClick={disconnectWallet} className="text-left text-[#ffb4ab] hover:underline cursor-pointer mt-1 bg-transparent border-none">Disconnect Wallet</button>
            </div>
          ) : (
            <button onClick={connectWallet} className="text-[#00dce5] hover:underline cursor-pointer font-bold bg-transparent border-none">Connect Freighter</button>
          )}
        </div>
      </div>
    </aside>
  );
}
