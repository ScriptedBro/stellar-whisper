import type { PrivateNote } from '../../types';

interface NoteSelectorProps {
  notes: PrivateNote[];
  selectedNoteCommitment: string;
  setSelectedNoteCommitment: (commitment: string) => void;
}

export function NoteSelector({
  notes,
  selectedNoteCommitment,
  setSelectedNoteCommitment
}: NoteSelectorProps) {
  const unspentNotes = notes.filter(n => !n.spent);

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
    <div className="space-y-2">
      <label className="text-[10px] font-bold uppercase tracking-wider text-[#cfc2d7] block">Select Spent Note Source</label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {unspentNotes.map((note) => {
          const isSelected = note.commitment === selectedNoteCommitment;
          return (
            <div 
              key={note.commitment}
              onClick={() => setSelectedNoteCommitment(note.commitment)}
              className={`p-4 rounded-xl border-2 cursor-pointer transition-all active:scale-98 ${
                isSelected 
                  ? 'bg-[#8a2be2]/20 border-[#8a2be2] shadow-[0_0_12px_rgba(138,43,226,0.3)]' 
                  : 'bg-white/3 border-white/10 hover:border-white/20'
              }`}
            >
              <div className="flex justify-between items-center mb-2">
                <span className="font-bold text-white font-mono text-sm">{note.amount.toFixed(2)} USDC</span>
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
