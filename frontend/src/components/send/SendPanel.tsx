import type React from 'react';
import type { PrivateNote } from '../../types';
import { NoteSelector } from './NoteSelector';

interface SendPanelProps {
  transferAmount: string;
  setTransferAmount: (amount: string) => void;
  recipientAddress: string;
  setRecipientAddress: (address: string) => void;
  isPrivateNoteTransfer: boolean;
  setIsPrivateNoteTransfer: (val: boolean) => void;
  recipientZkPublicKey: string;
  setRecipientZkPublicKey: (key: string) => void;
  recipientViewingKey: string;
  setRecipientViewingKey: (key: string) => void;
  isProving: boolean;
  provingProgress: number;
  provingLogs: string[];
  notes: PrivateNote[];
  selectedNoteCommitment: string;
  setSelectedNoteCommitment: (commitment: string) => void;
  isConnected: boolean;
  connectWallet: () => Promise<void>;
  handleShieldedTransfer: (e: React.FormEvent) => Promise<void>;
  selectedAsset: 'USDC' | 'XLM';
  setSelectedAsset: (asset: 'USDC' | 'XLM') => void;
  publicBalance: number;
  shieldedBalance: number;
}

export function SendPanel({
  transferAmount,
  setTransferAmount,
  recipientAddress,
  setRecipientAddress,
  isPrivateNoteTransfer,
  setIsPrivateNoteTransfer,
  recipientZkPublicKey,
  setRecipientZkPublicKey,
  recipientViewingKey,
  setRecipientViewingKey,
  isProving,
  provingProgress,
  provingLogs,
  notes,
  selectedNoteCommitment,
  setSelectedNoteCommitment,
  isConnected,
  connectWallet,
  handleShieldedTransfer,
  selectedAsset,
  setSelectedAsset
}: SendPanelProps) {
  // Filter notes to only show those belonging to the selected asset
  const filteredNotes = notes.filter(n => {
    const isXlm = n.assetAddress === 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
    return selectedAsset === 'XLM' ? isXlm : !isXlm;
  });

  return (
    <div className="max-w-[800px] mx-auto animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Form Column */}
        <div className="lg:col-span-7 space-y-6">
          <div className="glass-panel rounded-lg p-6 md:p-8 glass-inner-stroke">
            <div className="flex items-center justify-between w-full mb-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#00f4fe]/20 border border-[#00f4fe]/30 text-[#00f4fe]">
                <div className="w-1.5 h-1.5 rounded-full bg-[#00ff87] privacy-pulse"></div>
                <span className="text-[10px] font-mono uppercase tracking-wider">Aztec UltraHonk Pipeline</span>
              </div>

              {/* Asset Selector */}
              <div className="flex bg-white/5 p-1 rounded-full border border-white/10">
                <button
                  type="button"
                  onClick={() => setSelectedAsset('USDC')}
                  className={`px-3 py-1 rounded-full text-[10px] font-bold tracking-wider transition-all cursor-pointer border-none ${
                    selectedAsset === 'USDC' 
                      ? 'bg-[#00f4fe] text-black shadow-[0_0_8px_rgba(0,244,254,0.4)]' 
                      : 'text-[#cfc2d7] hover:text-white bg-transparent'
                  }`}
                >
                  USDC
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedAsset('XLM')}
                  className={`px-3 py-1 rounded-full text-[10px] font-bold tracking-wider transition-all cursor-pointer border-none ${
                    selectedAsset === 'XLM' 
                      ? 'bg-[#00f4fe] text-black shadow-[0_0_8px_rgba(0,244,254,0.4)]' 
                      : 'text-[#cfc2d7] hover:text-white bg-transparent'
                  }`}
                >
                  XLM
                </button>
              </div>
            </div>
            
            <h2 className="text-xl font-bold text-white mb-2">Shielded Send / Withdraw</h2>
            <p className="text-xs text-[#cfc2d7] leading-relaxed mb-6">
              Spend from a shielded note. Generate an Aztec UltraHonk proof client-side to prove value conservation and ownership of a note in the Merkle root without exposing the note source or public wallet address.
            </p>

            <form onSubmit={handleShieldedTransfer} className="space-y-5">
              
              {/* Note Selector */}
              {isConnected && (
                <NoteSelector 
                  notes={filteredNotes}
                  selectedNoteCommitment={selectedNoteCommitment}
                  setSelectedNoteCommitment={setSelectedNoteCommitment}
                  transferAmount={transferAmount}
                  selectedAsset={selectedAsset}
                />
              )}

              {/* Mode Toggle */}
              <div className="bg-black/30 border border-white/5 p-1 rounded-lg flex">
                <button 
                  type="button"
                  onClick={() => setIsPrivateNoteTransfer(false)}
                  className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${!isPrivateNoteTransfer ? 'bg-white/10 text-white shadow' : 'text-[#cfc2d7] hover:text-white'}`}
                >
                  Withdraw to Stellar Account
                </button>
                <button 
                  type="button"
                  onClick={() => setIsPrivateNoteTransfer(true)}
                  className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${isPrivateNoteTransfer ? 'bg-white/10 text-[#00f4fe] shadow' : 'text-[#cfc2d7] hover:text-white'}`}
                >
                  Internal Shielded Transfer
                </button>
              </div>

              {/* Recipient Input fields based on Toggle */}
              {!isPrivateNoteTransfer ? (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#cfc2d7] block">Recipient Stellar Wallet Address</label>
                  <input 
                    type="text"
                    placeholder="Enter Stellar address, e.g. GB2V..."
                    value={recipientAddress}
                    onChange={(e) => setRecipientAddress(e.target.value)}
                    disabled={isProving || !isConnected}
                    className="w-full glass-input px-4 py-3 text-sm text-white rounded font-mono"
                  />
                </div>
              ) : (
                <div className="space-y-4 bg-white/3 border border-white/5 p-4 rounded-xl">
                  <div className="text-xs text-[#00f4fe] font-bold font-sans">Shielded Recipient Credentials</div>
                  <p className="text-[10px] text-[#cfc2d7] leading-relaxed">
                    Note-to-note internal transfer. The recipient's keys are used to encrypt the change notes and derive the new commitment inserted into the Merkle tree.
                  </p>
                  
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold uppercase tracking-wider text-[#cfc2d7] block">Recipient ZK Public Key (Hex)</label>
                    <input 
                      type="text"
                      placeholder="64-character ZK public key hex, e.g. 7f93a..."
                      value={recipientZkPublicKey}
                      onChange={(e) => setRecipientZkPublicKey(e.target.value)}
                      disabled={isProving || !isConnected}
                      className="w-full glass-input px-4 py-2.5 text-xs text-white rounded font-mono"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[9px] font-bold uppercase tracking-wider text-[#cfc2d7] block">Recipient Viewing Key (Hex)</label>
                    <input 
                      type="text"
                      placeholder="64-character viewing key hex, e.g. 8d31b..."
                      value={recipientViewingKey}
                      onChange={(e) => setRecipientViewingKey(e.target.value)}
                      disabled={isProving || !isConnected}
                      className="w-full glass-input px-4 py-2.5 text-xs text-white rounded font-mono"
                    />
                  </div>
                </div>
              )}

              {/* Amount input */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-[#cfc2d7] block">Transfer Amount ({selectedAsset})</label>
                <input 
                  type="number"
                  placeholder={`Enter amount of ${selectedAsset}, e.g. 50`}
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  disabled={isProving || !isConnected}
                  className="w-full glass-input px-4 py-3 text-sm text-white rounded"
                />
              </div>

              {!isConnected ? (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
                    <span className="material-symbols-outlined text-sm">warning</span>
                    <span>Connect your wallet to execute private transfers.</span>
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
                  {isProving ? "Calculating ZK-Proof..." : isPrivateNoteTransfer ? `Send Shielded ${selectedAsset}` : `Withdraw ${selectedAsset}`}
                </button>
              )}
            </form>
          </div>
        </div>

        {/* Prover Status Column */}
        <div className="lg:col-span-5 flex flex-col items-center justify-center">
          <div className="relative w-64 h-64 flex items-center justify-center mb-6">
            {/* Atmospheric Glow */}
            <div className="absolute w-48 h-48 bg-[#00f4fe]/10 rounded-full blur-[40px] animate-pulse-glow"></div>
            
            {/* Inner Orb */}
            <div className={`absolute w-36 h-36 rounded-full border border-white/10 flex flex-col items-center justify-center bg-black/40 backdrop-blur-md relative z-10 ${isProving ? 'cyber-glow' : ''}`}>
              <span className="text-[10px] font-mono text-[#00f4fe] uppercase tracking-wider">
                {isProving ? 'PROVING' : 'READY'}
              </span>
              <h4 className="text-2xl font-bold text-white mt-1">
                {isProving ? `${provingProgress}%` : '100%'}
              </h4>
            </div>
            
            {/* Ring 1 */}
            <div 
              className="absolute inset-0 border-2 border-[#8a2be2]/20 rounded-full"
              style={{ animation: 'spin 15s linear infinite' }}
            >
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-[#8a2be2] rounded-full shadow-[0_0_10px_#8a2be2]"></div>
            </div>
            
            {/* Ring 2 */}
            <div 
              className="absolute inset-6 border border-[#00f4fe]/20 rounded-full"
              style={{ animation: 'spin 20s linear reverse infinite' }}
            >
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-[#00f4fe] rounded-full shadow-[0_0_10px_#00f4fe]"></div>
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
