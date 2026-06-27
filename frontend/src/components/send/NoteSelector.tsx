import { useEffect, useMemo, useState } from 'react';
import type { PrivateNote } from '../../types';

interface NoteSelectorProps {
  notes: PrivateNote[];
  selectedNoteCommitment: string;
  setSelectedNoteCommitment: (commitment: string) => void;
  transferAmount: string;
  selectedAsset?: 'USDC' | 'XLM';
}

export function NoteSelector({
  notes,
  selectedNoteCommitment,
  setSelectedNoteCommitment,
  transferAmount,
  selectedAsset = 'USDC'
}: NoteSelectorProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const unspentNotes = useMemo(
    () => notes.filter(n => !n.spent).sort((a, b) => a.amount - b.amount),
    [notes]
  );
  const requestedAmount = Number(transferAmount);
  const hasRequestedAmount = Number.isFinite(requestedAmount) && requestedAmount > 0;
  const selectedNote = unspentNotes.find(note => note.commitment === selectedNoteCommitment);
  const bestNote = hasRequestedAmount
    ? unspentNotes.find(note => note.amount >= requestedAmount)
    : unspentNotes[0];
  const sourceNote = bestNote || selectedNote || unspentNotes[0];
  const visibleBalance = sourceNote?.amount ?? 0;
  const changeAmount = sourceNote && hasRequestedAmount
    ? Math.max(sourceNote.amount - requestedAmount, 0)
    : 0;

  useEffect(() => {
    if (!bestNote) return;
    if (selectedNote?.commitment !== bestNote.commitment) {
      setSelectedNoteCommitment(bestNote.commitment);
    }
  }, [
    bestNote,
    selectedNote,
    hasRequestedAmount,
    requestedAmount,
    setSelectedNoteCommitment
  ]);

  if (unspentNotes.length === 0) {
    return (
      <div className="p-4 rounded-xl bg-red-950/15 border border-red-500/20 text-xs text-[#ffb4ab] flex items-center gap-3">
        <span className="material-symbols-outlined">warning</span>
        <div>
          <p className="font-bold">No Unspent Notes Detected</p>
          <p className="mt-1 text-[11px] text-[#ffb4ab]/80">Please deposit or shield assets first to create a private spending source note.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-white/10 bg-white/3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-[#cfc2d7] block">Private Balance</label>
            <div className="mt-1 text-lg font-bold text-white font-mono">{visibleBalance.toFixed(2)} {selectedAsset}</div>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced(prev => !prev)}
            className="shrink-0 px-3 py-2 rounded-md border border-white/10 bg-black/20 text-[10px] font-bold uppercase tracking-wider text-[#cfc2d7] hover:text-white hover:border-white/25"
          >
            {showAdvanced ? 'Hide Notes' : 'Advanced'}
          </button>
        </div>

        {showAdvanced && sourceNote && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-md bg-black/25 border border-white/5 p-3">
              <div className="text-[9px] font-bold uppercase tracking-wider text-[#cfc2d7]/60">Source</div>
              <div className="mt-1 text-sm font-bold text-white font-mono">{sourceNote.amount.toFixed(2)} {selectedAsset}</div>
            </div>
            <div className="rounded-md bg-black/25 border border-white/5 p-3">
              <div className="text-[9px] font-bold uppercase tracking-wider text-[#cfc2d7]/60">Send</div>
              <div className="mt-1 text-sm font-bold text-[#00f4fe] font-mono">
                {hasRequestedAmount ? requestedAmount.toFixed(2) : '0.00'} {selectedAsset}
              </div>
            </div>
            <div className="rounded-md bg-black/25 border border-white/5 p-3">
              <div className="text-[9px] font-bold uppercase tracking-wider text-[#cfc2d7]/60">Private Change</div>
              <div className="mt-1 text-sm font-bold text-[#dcb8ff] font-mono">{changeAmount.toFixed(2)} {selectedAsset}</div>
            </div>
          </div>
        )}

        {hasRequestedAmount && !bestNote && (
          <div className="mt-4 rounded-md border border-red-500/20 bg-red-950/15 p-3 text-xs text-[#ffb4ab]">
            No single private note can cover this amount. Send a smaller amount or deposit a larger note.
          </div>
        )}
      </div>

      {showAdvanced && (
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-[#cfc2d7] block">Private Notes</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {unspentNotes.map((note) => {
              const isSelected = note.commitment === selectedNoteCommitment;
              return (
                <div 
                  key={note.commitment}
                  onClick={() => setSelectedNoteCommitment(note.commitment)}
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all active:scale-98 ${
                    isSelected 
                      ? 'bg-[#8a2be2]/20 border-[#8a2be2] shadow-[0_0_12px_rgba(138,43,226,0.3)]' 
                      : 'bg-white/3 border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-white font-mono text-sm">{note.amount.toFixed(2)} {selectedAsset}</span>
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${isSelected ? 'border-[#00f4fe]' : 'border-white/30'}`}>
                      {isSelected && <div className="w-2 h-2 rounded-full bg-[#00f4fe]"></div>}
                    </div>
                  </div>
                  <div className="text-[9px] font-mono text-[#cfc2d7] flex flex-col gap-0.5">
                    <div className="truncate"><span className="text-[#00dce5]">Hash:</span> {note.commitment.slice(0, 14)}...</div>
                    <div className="truncate"><span className="text-[#dcb8ff]">Nonce:</span> {note.nullifierNonce.slice(0, 14)}...</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
