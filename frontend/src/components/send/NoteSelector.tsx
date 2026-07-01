import { useEffect, useMemo } from 'react';
import type { PrivateNote } from '../../types';

interface NoteSelectorProps {
  notes: PrivateNote[];
  selectedNoteCommitment: string;
  setSelectedNoteCommitment: (commitment: string) => void;
  transferAmount: string;
  selectedAsset?: 'USDC' | 'XLM';
  isSyncing?: boolean;
}

export function NoteSelector({
  notes,
  selectedNoteCommitment,
  setSelectedNoteCommitment,
  transferAmount,
  selectedAsset = 'USDC',
  isSyncing = false
}: NoteSelectorProps) {
  const unspentNotes = useMemo(
    () => notes.filter(n => !n.spent).sort((a, b) => a.amount - b.amount),
    [notes]
  );
  const requestedAmount = Number(transferAmount);
  const hasRequestedAmount = Number.isFinite(requestedAmount) && requestedAmount > 0;
  const selectedNote = unspentNotes.find(note => note.commitment === selectedNoteCommitment);
  const bestNote = hasRequestedAmount
    ? unspentNotes.find(note => note.amount + 0.001 >= requestedAmount)
    : unspentNotes[0];

  useEffect(() => {
    if (hasRequestedAmount && selectedNote && selectedNote.amount + 0.001 < requestedAmount) {
      if (bestNote && selectedNote.commitment !== bestNote.commitment) {
        setSelectedNoteCommitment(bestNote.commitment);
      }
    } else if (!selectedNote && bestNote) {
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
    if (isSyncing) {
      return (
        <div className="p-4 rounded-xl bg-blue-950/15 border border-blue-500/20 text-xs text-[#7fcfff] flex items-center gap-3">
          <span className="material-symbols-outlined animate-spin">sync</span>
          <div>
            <p className="font-bold">Syncing Private Notes</p>
            <p className="mt-1 text-[11px] text-[#7fcfff]/80">Scanning chain for your notes. Please wait a moment...</p>
          </div>
        </div>
      );
    }
    if (notes.length > 0) {
      return (
        <div className="p-4 rounded-xl bg-amber-950/15 border border-amber-500/20 text-xs text-[#ffb4ab] flex items-center gap-3">
          <span className="material-symbols-outlined">info</span>
          <div>
            <p className="font-bold">Notes Being Verified</p>
            <p className="mt-1 text-[11px] text-[#ffb4ab]/80">All notes have been spent. Syncing on-chain state to confirm change notes...</p>
          </div>
        </div>
      );
    }
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
    <div className="space-y-2">
      <label className="text-[10px] font-bold uppercase tracking-wider text-[#cfc2d7] block">Private Notes</label>

      {hasRequestedAmount && !bestNote && (
        <div className="rounded-md border border-red-500/20 bg-red-950/15 p-3 text-xs text-[#ffb4ab] mb-2">
          No single private note can cover this amount. Send a smaller amount or deposit a larger note.
        </div>
      )}

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
  );
}
