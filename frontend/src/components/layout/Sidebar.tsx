import { useState } from 'react';
import { DEFAULT_CONFIG } from '../../config/constants';

interface CopyButtonProps {
  text: string;
  tooltip: string;
}

function CopyButton({ text, tooltip }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1 hover:bg-white/10 rounded transition-all text-[#cfc2d7] hover:text-white flex items-center justify-center cursor-pointer ml-1 border-none bg-transparent"
      title={`Copy ${tooltip}`}
    >
      <span className="material-symbols-outlined text-[12px] font-bold" style={{ fontSize: '12px' }}>
        {copied ? 'check' : 'content_copy'}
      </span>
    </button>
  );
}

interface SidebarProps {
  activeTab: 'vault' | 'pool' | 'send' | 'compliance' | 'liquidity' | 'swap';
  setActiveTab: (tab: 'vault' | 'pool' | 'send' | 'compliance' | 'liquidity' | 'swap') => void;
  isConnected: boolean;
  userAddress: string;
  zkPrivateKey: string;
  derivedPubkeyHex: string;
  derivedViewingKey: string;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  fundWallet: () => Promise<void>;
  fundUsdc?: () => Promise<void>;
  setShowSettings: (show: boolean) => void;
}

const USDC_ISSUER = DEFAULT_CONFIG.adminAddress;

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
  fundUsdc,
  setShowSettings
}: SidebarProps) {
  const [showFaucetModal, setShowFaucetModal] = useState(false);
  const [faucetLoading, setFaucetLoading] = useState(false);

  const handleFundUsdc = () => {
    if (fundUsdc) {
      setShowFaucetModal(true);
    }
  };

  return (<>
    <aside className="hidden md:flex flex-col h-screen w-64 fixed left-0 top-0 bg-white/3 backdrop-blur-2xl border-r border-white/10 py-5 px-3 z-50">
      <div className="flex items-center gap-3 mb-6 px-2">
        <div className="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center cyber-glow">
          <span className="material-symbols-outlined text-white text-[18px]">auto_awesome</span>
        </div>
        <div>
          <h1 className="font-bold text-base text-secondary-container leading-none">Whisper Node</h1>
          <p className="text-[9px] font-mono tracking-widest text-[#00dce5] mt-1 uppercase">Shielded Session</p>
        </div>
      </div>

      <nav className="flex-grow space-y-0.5">
        <button 
          onClick={() => setActiveTab('vault')}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all active:translate-x-1 text-left ${activeTab === 'vault' ? 'bg-white/10 text-[#00dce5] border-l-4 border-[#00dce5]' : 'text-[#cfc2d7] hover:bg-white/5 hover:text-white'}`}
        >
          <span className="material-symbols-outlined text-[20px]">dashboard</span>
          <span className="font-semibold text-xs">Vault</span>
        </button>
        
        <button 
          onClick={() => setActiveTab('pool')}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all active:translate-x-1 text-left ${activeTab === 'pool' ? 'bg-white/10 text-[#00dce5] border-l-4 border-[#00dce5]' : 'text-[#cfc2d7] hover:bg-white/5 hover:text-white'}`}
        >
          <span className="material-symbols-outlined text-[20px]">waves</span>
          <span className="font-semibold text-xs">Pool</span>
        </button>

        <button 
          onClick={() => setActiveTab('liquidity')}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all active:translate-x-1 text-left ${activeTab === 'liquidity' ? 'bg-white/10 text-[#00dce5] border-l-4 border-[#00dce5]' : 'text-[#cfc2d7] hover:bg-white/5 hover:text-white'}`}
        >
          <span className="material-symbols-outlined text-[20px]">water_drop</span>
          <span className="font-semibold text-xs">Liquidity Pools</span>
        </button>

        <button 
          onClick={() => setActiveTab('send')}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all active:translate-x-1 text-left ${activeTab === 'send' ? 'bg-white/10 text-[#00dce5] border-l-4 border-[#00dce5]' : 'text-[#cfc2d7] hover:bg-white/5 hover:text-white'}`}
        >
          <span className="material-symbols-outlined text-[20px]">send</span>
          <span className="font-semibold text-xs">Private Send</span>
        </button>

        <button 
          onClick={() => setActiveTab('swap')}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all active:translate-x-1 text-left ${activeTab === 'swap' ? 'bg-white/10 text-[#00dce5] border-l-4 border-[#00dce5]' : 'text-[#cfc2d7] hover:bg-white/5 hover:text-white'}`}
        >
          <span className="material-symbols-outlined text-[20px]">currency_exchange</span>
          <span className="font-semibold text-xs">Private Swap</span>
        </button>

        <button 
          onClick={() => setActiveTab('compliance')}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all active:translate-x-1 text-left ${activeTab === 'compliance' ? 'bg-white/10 text-[#00dce5] border-l-4 border-[#00dce5]' : 'text-[#cfc2d7] hover:bg-white/5 hover:text-white'}`}
        >
          <span className="material-symbols-outlined text-[20px]">verified_user</span>
          <span className="font-semibold text-xs">Compliance</span>
        </button>
      </nav>

      <div className="mt-auto pt-3 border-t border-white/5 space-y-1.5">
        {isConnected && (
          <>
            <button 
              onClick={fundWallet}
              className="w-full bg-[#8a2be2] text-white py-1.5 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-[#8a2be2]/90 active:scale-95 transition-all text-xs border border-white/10"
            >
              <span className="material-symbols-outlined text-xs">add</span>
              Fund XLM
            </button>
            {fundUsdc && (
              <button 
                onClick={handleFundUsdc}
                className="w-full bg-[#00dce5]/20 text-[#00dce5] py-1.5 rounded-xl font-bold flex items-center justify-center gap-2 mb-2 hover:bg-[#00dce5]/30 active:scale-95 transition-all text-xs border border-[#00dce5]/30"
              >
                <span className="material-symbols-outlined text-xs">monetization_on</span>
                Fund USDC
              </button>
            )}
          </>
        )}

        <button 
          onClick={() => setShowSettings(true)}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-[#cfc2d7] hover:text-white transition-all text-left text-xs"
        >
          <span className="material-symbols-outlined text-[16px]">settings</span>
          <span>Settings / Sandbox</span>
        </button>

        <div className="px-3 py-1 text-[10px] text-[#cfc2d7]/50 font-mono">
          {isConnected ? (
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between w-full mt-0.5">
                <span className="text-[#00dce5] truncate flex-grow text-[9px]" title={userAddress}>{userAddress}</span>
                <CopyButton text={userAddress} tooltip="Wallet Address" />
              </div>
              {zkPrivateKey && (
                <>
                  <div className="flex items-center justify-between w-full mt-0.5 border border-[#8a2be2]/30 px-1 py-0.5 rounded bg-[#8a2be2]/10">
                    <span className="text-[#dcb8ff] truncate text-[9px] flex-grow" title={`skey_${zkPrivateKey}`}>
                      🔑 ZK-Key: skey_{zkPrivateKey.slice(0, 6)}...
                    </span>
                    <CopyButton text={`skey_${zkPrivateKey}`} tooltip="ZK Private Key" />
                  </div>
                  <div className="flex items-center justify-between w-full mt-0.5 border border-[#00f4fe]/30 px-1 py-0.5 rounded bg-[#00f4fe]/10">
                    <span className="text-[#00f4fe] truncate text-[9px] flex-grow" title={derivedPubkeyHex}>
                      🛡️ ZK PubKey: {derivedPubkeyHex.slice(0, 6)}...
                    </span>
                    <CopyButton text={derivedPubkeyHex} tooltip="ZK Public Key" />
                  </div>
                  <div className="flex items-center justify-between w-full mt-0.5 border border-[#00ff87]/30 px-1 py-0.5 rounded bg-[#00ff87]/10">
                    <span className="text-[#00ff87] truncate text-[9px] flex-grow" title={derivedViewingKey}>
                      👁️ Viewing Key: {derivedViewingKey.slice(0, 6)}...
                    </span>
                    <CopyButton text={derivedViewingKey} tooltip="Viewing Key" />
                  </div>
                </>
              )}
              <button onClick={disconnectWallet} className="text-left text-[#ffb4ab] hover:underline cursor-pointer mt-0.5 bg-transparent border-none text-[9px]">Disconnect Wallet</button>
            </div>
          ) : (
            <button onClick={connectWallet} className="text-[#00dce5] hover:underline cursor-pointer font-bold bg-transparent border-none text-[9px]">Connect Freighter</button>
          )}
        </div>
      </div>
    </aside>

    {showFaucetModal && (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-md mx-4 rounded-2xl border border-[#00dce5]/30 bg-[#0a0a1a] p-6 shadow-2xl">
          <h2 className="text-lg font-bold text-white mb-4">Fund USDC</h2>

          <div className="space-y-3 text-sm text-[#cfc2d7]">
            <p>Before funding, make sure USDC is added to your Freighter wallet on <span className="text-[#00f4fe] font-bold">Stellar Testnet</span>:</p>

            <div className="rounded-lg bg-white/5 border border-white/10 p-3 space-y-2 text-xs font-mono">
              <div>
                <span className="text-[#00dce5]">Network:</span>{' '}
                <span className="text-white font-bold">Testnet</span>
              </div>
              <div>
                <span className="text-[#00dce5]">Asset Code:</span>{' '}
                <span className="text-white">USDC</span>
              </div>
              <div>
                <span className="text-[#00dce5]">Issuer:</span>{' '}
                <span className="text-white break-all">{USDC_ISSUER}</span>
              </div>
            </div>

            <p className="text-xs text-[#cfc2d7]/70">To add in Freighter: open the extension → Manage Assets → Add Asset → enter the details above.</p>
          </div>

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => setShowFaucetModal(false)}
              className="flex-1 py-2 rounded-xl border border-white/10 text-[#cfc2d7] font-bold text-xs hover:bg-white/5 transition-all"
              disabled={faucetLoading}
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                setFaucetLoading(true);
                if (fundUsdc) await fundUsdc();
                setFaucetLoading(false);
                setShowFaucetModal(false);
              }}
              className="flex-1 py-2 rounded-xl bg-[#00dce5] text-black font-bold text-xs hover:bg-[#00dce5]/90 transition-all flex items-center justify-center gap-2"
              disabled={faucetLoading}
            >
              {faucetLoading ? (
                <><span className="material-symbols-outlined text-xs animate-spin">sync</span> Funding...</>
              ) : (
                <><span className="material-symbols-outlined text-xs">monetization_on</span> Proceed with Funding</>
              )}
            </button>
          </div>
        </div>
      </div>
    )}
  </>);
}
