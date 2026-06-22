import { useState } from 'react';
import type { ActivityLog as ActivityLogType, PrivateNote } from '../../types';
import { PoolStats } from './PoolStats';
import { ActivityLog } from './ActivityLog';

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
      <span className="material-symbols-outlined text-[10px] font-bold" style={{ fontSize: '10px' }}>
        {copied ? 'check' : 'content_copy'}
      </span>
    </button>
  );
}

interface VaultDashboardProps {
  shieldedBalance: number;
  publicBalance: number;
  isConnected: boolean;
  isSyncing: boolean;
  syncProgress: string;
  syncNotesFromChain: () => Promise<void>;
  setActiveTab: (tab: 'vault' | 'pool' | 'send' | 'compliance') => void;
  logs: ActivityLogType[];
  notes: PrivateNote[];
}

export function VaultDashboard({ 
  shieldedBalance,
  publicBalance,
  isConnected,
  isSyncing,
  syncProgress,
  syncNotesFromChain,
  setActiveTab,
  logs,
  notes
}: VaultDashboardProps) {
  const activeNotes = notes.filter(n => !n.spent);

  return (
    <div className="bento-grid animate-fade-in">
      {/* Shielded Balance Hero Card */}
      <div className="col-span-12 lg:col-span-8 glass-panel rounded-lg p-6 md:p-8 flex flex-col md:flex-row items-center gap-8 glass-inner-stroke overflow-hidden relative">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#8a2be2]/10 blur-[100px] pointer-events-none"></div>
        <div className="relative w-full md:w-1/2 aspect-square max-w-[240px] flex items-center justify-center">
          <div className="absolute inset-0 bg-[#8a2be2]/20 rounded-full filter blur-[40px] animate-pulse-glow"></div>
          <span className="material-symbols-outlined text-[120px] text-[#00f4fe] animate-pulse relative z-10" style={{ fontVariationSettings: "'FILL' 0" }}>shield</span>
        </div>
        
        <div className="w-full md:w-1/2 flex flex-col justify-center">
          <div className="inline-flex items-center gap-2 text-xs font-mono text-[#00dce5] mb-3">
            <span className="material-symbols-outlined text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>lock</span>
            PRIVATE ASSET VAULT
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Shielded Balance</h3>
          <div className="flex items-baseline gap-2 mb-6">
            <span className="text-4xl font-bold tracking-tight text-white font-mono hover:text-[#00f4fe] transition-all">
              {shieldedBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-lg font-bold text-[#00dce5]">USDC</span>
          </div>
          
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="p-3 rounded bg-white/5 border border-white/10">
              <p className="text-[10px] text-[#cfc2d7] mb-1 uppercase tracking-wider">Public Wallet</p>
              <p className="text-sm font-bold text-white font-mono">
                ${publicBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="p-3 rounded bg-white/5 border border-white/10">
              <p className="text-[10px] text-[#cfc2d7] mb-1 uppercase tracking-wider">Privacy Level</p>
              <p className="text-sm font-bold text-green-400">MAXIMUM</p>
            </div>
          </div>
          
          <div className="flex flex-col gap-3">
            <div className="flex gap-4">
              <button 
                onClick={() => setActiveTab('send')}
                className="flex-1 btn-primary py-3 rounded text-xs transition-transform active:scale-95 border-none cursor-pointer text-center font-bold"
              >
                Withdraw / Send
              </button>
              <button 
                onClick={() => setActiveTab('pool')}
                className="flex-1 glass-action py-3 rounded text-xs transition-all cursor-pointer font-bold"
              >
                Deposit / Shield
              </button>
            </div>
            {isConnected && (
              <div className="flex flex-col gap-2">
                <button 
                  onClick={syncNotesFromChain}
                  disabled={isSyncing}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded bg-white/5 border border-white/10 hover:bg-white/10 text-xs text-[#00f4fe] font-mono cursor-pointer transition-all active:scale-95 disabled:opacity-50"
                >
                  <span className={`material-symbols-outlined text-xs ${isSyncing ? 'animate-spin' : ''}`}>sync</span>
                  {isSyncing ? "Syncing Notes Store..." : "Sync Notes From Blockchain"}
                </button>
                {syncProgress && (
                  <div className="text-[10px] font-mono text-[#cfc2d7] bg-black/40 px-3 py-1.5 rounded border border-[#00f4fe]/20 animate-fade-in">
                    {syncProgress}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Invisible Pool Stats */}
      <PoolStats />

      {/* Recent Private Activity */}
      <ActivityLog logs={logs} />

      {/* Ecosystem Grid */}
      <div className="col-span-12 lg:col-span-5 space-y-6">
        <h3 className="font-bold text-lg text-white mb-2">Ecosystem Apps</h3>
        <div className="grid grid-cols-1 gap-4">
          <div className="glass-panel p-5 rounded-lg glass-inner-stroke group cursor-pointer hover:bg-white/8 transition-all overflow-hidden relative">
            <div className="absolute -right-4 -top-4 w-24 h-24 bg-[#00f4fe]/10 blur-2xl group-hover:bg-[#00f4fe]/20 transition-all"></div>
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded bg-[#00f4fe]/20 flex items-center justify-center text-[#00f4fe]">
                <span className="material-symbols-outlined">water_drop</span>
              </div>
              <span className="text-[10px] text-[#00dce5] font-mono font-bold">NEW</span>
            </div>
            <h4 className="font-bold text-sm text-white mb-1">Liquidity Pools</h4>
            <p className="text-xs text-[#cfc2d7] leading-relaxed">Provide liquidity while maintaining total wallet anonymity.</p>
          </div>

          <div className="glass-panel p-5 rounded-lg glass-inner-stroke group cursor-pointer hover:bg-white/8 transition-all overflow-hidden relative">
            <div className="absolute -right-4 -top-4 w-24 h-24 bg-[#8a2be2]/10 blur-2xl group-hover:bg-[#8a2be2]/20 transition-all"></div>
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded bg-[#8a2be2]/20 flex items-center justify-center text-[#8a2be2]">
                <span className="material-symbols-outlined">psychology</span>
              </div>
            </div>
            <h4 className="font-bold text-sm text-white mb-1">ZK-Proofs Hub</h4>
            <p className="text-xs text-[#cfc2d7] leading-relaxed">Generate zero-knowledge proofs for third-party verification.</p>
          </div>

          <div className="glass-panel p-5 rounded-lg glass-inner-stroke group cursor-pointer hover:bg-white/8 transition-all overflow-hidden relative">
            <div className="absolute -right-4 -top-4 w-24 h-24 bg-[#fface8]/10 blur-2xl group-hover:bg-[#fface8]/20 transition-all"></div>
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded bg-[#fface8]/20 flex items-center justify-center text-[#fface8]">
                <span className="material-symbols-outlined">currency_exchange</span>
              </div>
            </div>
            <h4 className="font-bold text-sm text-white mb-1">Private Swap</h4>
            <p className="text-xs text-[#cfc2d7] leading-relaxed">High-speed slippage-free swaps with obscured paths.</p>
          </div>
        </div>

        {/* Active Shielded Notes Registry */}
        <div className="glass-panel p-5 rounded-lg glass-inner-stroke mt-6">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/10">
            <h3 className="font-bold text-sm text-white flex items-center gap-1.5 font-sans">
              <span className="material-symbols-outlined text-sm text-[#00f4fe]">receipt_long</span>
              Active Shielded Notes Registry
            </h3>
            <span className="text-[9px] font-mono text-[#cfc2d7] bg-white/5 px-2 py-0.5 rounded border border-white/10">
              {activeNotes.length} Active Notes
            </span>
          </div>

          <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
            {activeNotes.length === 0 ? (
              <div className="text-center py-6 text-[#cfc2d7] text-xs">
                No shielded notes detected on-chain. Deposits or transfers will automatically generate notes.
              </div>
            ) : (
              activeNotes.map((note) => (
                <div 
                  key={note.commitment} 
                  className="p-3 rounded border text-xs transition-all bg-green-950/10 border-green-500/20 hover:border-green-500/40"
                >
                  <div className="flex justify-between items-start mb-1.5">
                    <span className="font-bold text-white font-mono">{note.amount.toFixed(2)} USDC</span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider bg-green-500/20 text-green-400">
                      Spendable
                    </span>
                  </div>
                  <div className="font-mono text-[9px] text-[#cfc2d7] flex flex-col gap-0.5">
                    <div className="flex items-center justify-between w-full" title={note.commitment}>
                      <span className="truncate flex-grow">
                        <span className="text-[#00dce5]">Commitment:</span> {note.commitment.slice(0, 16)}...
                      </span>
                      <CopyButton text={note.commitment} tooltip="Commitment" />
                    </div>
                    <div className="flex items-center justify-between w-full" title={note.nullifierNonce}>
                      <span className="truncate flex-grow">
                        <span className="text-[#dcb8ff]">Nonce:</span> {note.nullifierNonce.slice(0, 16)}...
                      </span>
                      <CopyButton text={note.nullifierNonce} tooltip="Nonce" />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
