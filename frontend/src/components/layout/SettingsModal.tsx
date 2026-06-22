import type { Config } from '../../types';

interface SettingsModalProps {
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  config: Config;
}

export function SettingsModal({ showSettings, setShowSettings, config }: SettingsModalProps) {
  if (!showSettings) return null;

  return (
    <div className="modal-overlay" onClick={() => setShowSettings(false)}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-2 flex items-center gap-2 text-white font-sans">
          <span className="material-symbols-outlined">settings</span> Developer Settings
        </h2>
        <p className="text-[#cfc2d7] text-xs mb-6">
          Configure the execution environment for ZK proof generations and smart contract calls.
        </p>
        
        <div className="space-y-3 bg-black/30 border border-white/5 rounded p-4 text-xs font-mono mb-6">
          <div className="text-xs text-[#00dce5] font-bold border-b border-white/5 pb-2 mb-2">Soroban Address Map</div>
          <div className="flex justify-between">
            <span className="text-[#cfc2d7]">Network:</span>
            <span className="text-white font-bold">{config.network}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#cfc2d7]">Whisper Pool:</span>
            <span className="text-[#cfc2d7] truncate max-w-[200px]" title={config.whisperContractId}>{config.whisperContractId}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#cfc2d7]">Verifier Contract:</span>
            <span className="text-[#cfc2d7] truncate max-w-[200px]" title={config.verifierContractId}>{config.verifierContractId}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#cfc2d7]">USDC SAC Token:</span>
            <span className="text-[#cfc2d7] truncate max-w-[200px]" title={config.tokenContractId}>{config.tokenContractId}</span>
          </div>
        </div>

        <button className="w-full btn-primary text-white font-bold py-2.5 rounded transition-all" onClick={() => setShowSettings(false)}>
          Save Configurations
        </button>
      </div>
    </div>
  );
}
