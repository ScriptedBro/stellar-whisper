interface ComplianceReportProps {
  report: {
    id: string;
    timestamp: string;
    standard: string;
    merkleRoot: string;
    status: string;
    attestationHash?: string;
    attestationProof?: string;
    verifiedCommitments?: string[];
    sanctionedSourcesCount?: number;
  } | null;
  onClear: () => void;
}

export function ComplianceReport({ report, onClear }: ComplianceReportProps) {
  if (!report) return null;

  const copyPayload = () => {
    const payload = JSON.stringify(report, null, 2);
    navigator.clipboard.writeText(payload);
    alert("Cryptographic attestation payload copied to clipboard!");
  };

  const isPass = report.status === 'VERIFIED (PASS)';

  return (
    <div className="bg-[#10131a]/85 border border-[#fface8]/30 rounded-xl p-6 shadow-2xl relative overflow-hidden animate-fade-in mt-6">
      <div className="absolute top-0 right-0 w-32 h-32 bg-[#fface8]/5 blur-xl pointer-events-none"></div>
      
      <div className="flex justify-between items-start mb-6">
        <div>
          <span className="text-[10px] font-mono text-[#fface8] uppercase tracking-widest block mb-1">COMPLIANCE REPORT</span>
          <h3 className="text-lg font-bold text-white font-sans">{report.standard}</h3>
        </div>
        <button 
          onClick={onClear}
          className="text-xs text-[#cfc2d7] hover:text-white transition-colors cursor-pointer bg-transparent border-none"
        >
          Clear
        </button>
      </div>

      <div className="space-y-4 font-mono text-xs mb-6">
        <div className="flex justify-between border-b border-white/5 pb-2">
          <span className="text-[#cfc2d7]">Attestation ID:</span>
          <span className="text-white font-bold">{report.id}</span>
        </div>
        <div className="flex justify-between border-b border-white/5 pb-2">
          <span className="text-[#cfc2d7]">Timestamp:</span>
          <span className="text-white">{report.timestamp}</span>
        </div>
        <div className="flex justify-between border-b border-white/5 pb-2">
          <span className="text-[#cfc2d7]">Current Merkle Root:</span>
          <span className="text-white truncate max-w-[200px]" title={report.merkleRoot}>{report.merkleRoot}</span>
        </div>
        
        <div className="flex justify-between border-b border-white/5 pb-2">
          <span className="text-[#cfc2d7]">Verified Commitments:</span>
          <span className="text-white font-bold">{report.verifiedCommitments?.length || 0} note(s)</span>
        </div>

        {report.verifiedCommitments && report.verifiedCommitments.length > 0 && (
          <div className="border-b border-white/5 pb-2">
            <span className="text-[#cfc2d7] block mb-1 text-[10px]">Commitments List:</span>
            <div className="max-h-[60px] overflow-y-auto space-y-1 pr-1 scrollbar-thin">
              {report.verifiedCommitments.map((c, i) => (
                <div key={i} className="text-[9px] text-[#00f4fe] font-mono truncate">{c}</div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-between border-b border-white/5 pb-2">
          <span className="text-[#cfc2d7]">Sanctioned Sources:</span>
          <span className={`font-bold ${report.sanctionedSourcesCount === 0 ? 'text-green-400' : 'text-red-400'}`}>
            {report.sanctionedSourcesCount || 0} found
          </span>
        </div>

        {report.attestationHash && (
          <div className="flex justify-between border-b border-white/5 pb-2">
            <span className="text-[#cfc2d7]">Attestation Hash:</span>
            <span className="text-[#fface8] truncate max-w-[200px]" title={report.attestationHash}>{report.attestationHash}</span>
          </div>
        )}

        {report.attestationProof && (
          <div className="flex justify-between border-b border-white/5 pb-2">
            <span className="text-[#cfc2d7]">Attestation Proof Signature:</span>
            <span className="text-[#00f4fe] truncate max-w-[200px]" title={report.attestationProof}>{report.attestationProof}</span>
          </div>
        )}

        <div className="flex justify-between items-center bg-white/5 p-3 rounded border border-white/5">
          <span className="text-[#cfc2d7]">ZK Verification Result:</span>
          <span className={`px-2.5 py-1 rounded font-bold border text-[10px] tracking-wider uppercase ${
            isPass 
              ? 'bg-green-500/20 text-green-400 border-green-500/30' 
              : 'bg-red-500/20 text-red-400 border-red-500/30'
          }`}>
            {report.status}
          </span>
        </div>
      </div>

      <div className="flex gap-4 mb-4">
        <button 
          onClick={copyPayload}
          className="flex-grow py-2.5 rounded bg-white/5 border border-white/10 text-xs text-[#cfc2d7] hover:text-white font-mono hover:bg-white/10 active:scale-95 transition-all cursor-pointer font-bold"
        >
          Copy ZK-Payload
        </button>
        <button 
          onClick={() => window.print()}
          className="flex-grow py-2.5 rounded bg-[#fface8] text-black text-xs hover:bg-[#fface8]/90 active:scale-95 transition-all cursor-pointer font-bold border-none"
        >
          Print/Download PDF
        </button>
      </div>

      <div className="text-center border-t border-white/5 pt-3">
        <span className="text-[9px] text-[#cfc2d7]/50 font-mono italic block">
          * Note: This cryptographic compliance attestation is generated client-side by validating note origins against OFAC/risk parameters on-chain.
        </span>
      </div>
    </div>
  );
}
