import { useState, useEffect } from 'react';
import type { Config, ActivityLog } from './types';
import { DEFAULT_CONFIG } from './config/constants';
import { useWallet } from './hooks/useWallet';
import { useBalances } from './hooks/useBalances';
import { useNotes } from './hooks/useNotes';
import { useSorobanCall } from './hooks/useSorobanCall';
import { useTransfers } from './hooks/useTransfers';

import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { SettingsModal } from './components/layout/SettingsModal';
import { TransactionStatusModal } from './components/layout/TransactionStatusModal';
import { useNotification } from './context/NotificationContext';

import { VaultDashboard } from './components/vault/VaultDashboard';
import { DepositPanel } from './components/pool/DepositPanel';
import { SendPanel } from './components/send/SendPanel';
import { CompliancePanel } from './components/compliance/CompliancePanel';

export default function App() {
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'vault' | 'pool' | 'send' | 'compliance'>('vault');
  const { showToast } = useNotification();

  // Deployment configuration state
  const [config] = useState<Config>(() => {
    // Try to load deployed config synchronously if available
    try {
      // Note: Vite doesn't support dynamic require, but we can still use import.meta.env
      return {
        network: import.meta.env.VITE_NETWORK || DEFAULT_CONFIG.network,
        adminAddress: import.meta.env.VITE_ADMIN_ADDRESS || DEFAULT_CONFIG.adminAddress,
        tokenContractId: import.meta.env.VITE_TOKEN_CONTRACT_ID || DEFAULT_CONFIG.tokenContractId,
        verifierContractId: import.meta.env.VITE_VERIFIER_CONTRACT_ID || DEFAULT_CONFIG.verifierContractId,
        whisperContractId: import.meta.env.VITE_WHISPER_CONTRACT_ID || DEFAULT_CONFIG.whisperContractId
      };
    } catch {
      return DEFAULT_CONFIG;
    }
  });

  useEffect(() => {
    // Dynamic import to merge locally deployed config
    import('./config/deployed.json')
      .then((data) => {
        // Since we're removing setConfig, we'll just log this instead
        console.log("Deployed config available, but config is immutable in real mode:", data.default);
      })
      .catch(() => {
        console.log("No deployed.json config override found, using environment/default settings.");
      });
  }, []);

  // Initialize modular hooks
  const wallet = useWallet();
  
  const balances = useBalances(
    wallet.userAddress, 
    config.tokenContractId, 
    config.network
  );

  const notes = useNotes(
    wallet.userAddress, 
    wallet.zkPrivateKey, 
    config.whisperContractId, 
    balances.updateShieldedBalance
  );

  const soroban = useSorobanCall(config.whisperContractId);

  // Activity logs
  const [logs, setLogs] = useState<ActivityLog[]>([]);

  // Sync activity logs from useNotes reconstructed logs
  useEffect(() => {
    if (notes.logs && notes.logs.length > 0) {
      setLogs(notes.logs);
    }
  }, [notes.logs]);

  const transfers = useTransfers({
    userAddress: wallet.userAddress,
    zkPrivateKey: wallet.zkPrivateKey,
    derivedViewingKey: wallet.derivedViewingKey,
    publicBalance: balances.publicBalance,
    shieldedBalance: balances.shieldedBalance,
    fetchBalances: balances.fetchBalances,
    notes: notes.notes,
    setNotes: notes.setNotes,
    selectedNoteCommitment: notes.selectedNoteCommitment,
    allCommitments: notes.allCommitments,
    setAllCommitments: notes.setAllCommitments,
    syncNotesFromChain: notes.syncNotesFromChain,
    executeSorobanCall: soroban.executeSorobanCall,
    setIsProving: soroban.setIsProving,
    setProvingProgress: soroban.setProvingProgress,
    setProvingLogs: soroban.setProvingLogs,
    addProvingLog: soroban.addProvingLog,
    config,
    setLogs,
    setActiveTab
  });

  const fundWallet = async () => {
    if (!wallet.userAddress) return;
    try {
      showToast("Requesting testnet XLM funding from Friendbot...", "info");
      await fetch(`https://friendbot.stellar.org/?addr=${wallet.userAddress}`);
      showToast("Funding successful! Refreshing balance...", "success");
      await balances.fetchBalances(wallet.userAddress);
    } catch (e: any) {
      showToast("Friendbot funding failed: " + e.message, "error");
    }
  };

  return (
    <div className="app-container min-h-screen text-[#cfc2d7]">
      {/* Sidebar navigation */}
      <Sidebar 
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isConnected={wallet.isConnected}
        userAddress={wallet.userAddress}
        zkPrivateKey={wallet.zkPrivateKey}
        derivedPubkeyHex={wallet.derivedPubkeyHex}
        derivedViewingKey={wallet.derivedViewingKey}
        connectWallet={wallet.connectWallet}
        disconnectWallet={wallet.disconnectWallet}
        fundWallet={fundWallet}
        setShowSettings={setShowSettings}
      />

      {/* Main Layout Area */}
      <main className="md:ml-64 min-h-screen flex flex-col p-4 md:p-8 pb-24 md:pb-8">
        <Header 
          isConnected={wallet.isConnected}
          userAddress={wallet.userAddress}
          connectWallet={wallet.connectWallet}
        />

        {/* Dynamic Panels */}
        <div className="flex-grow">
          {activeTab === 'vault' && (
            <VaultDashboard 
              shieldedBalance={balances.shieldedBalance}
              publicBalance={balances.publicBalance}
              isConnected={wallet.isConnected}
              isSyncing={notes.isSyncing}
              syncProgress={notes.syncProgress}
              syncNotesFromChain={notes.syncNotesFromChain}
              setActiveTab={setActiveTab}
              logs={logs}
              notes={notes.notes}
              importNotes={notes.importNotes}
            />
          )}

          {activeTab === 'pool' && (
            <DepositPanel 
              depositAmount={transfers.depositAmount}
              setDepositAmount={transfers.setDepositAmount}
              isProving={soroban.isProving}
              provingProgress={soroban.provingProgress}
              provingLogs={soroban.provingLogs}
              isConnected={wallet.isConnected}
              connectWallet={wallet.connectWallet}
              handleShieldDeposit={transfers.handleShieldDeposit}
            />
          )}

          {activeTab === 'send' && (
            <SendPanel 
              transferAmount={transfers.transferAmount}
              setTransferAmount={transfers.setTransferAmount}
              recipientAddress={transfers.recipientAddress}
              setRecipientAddress={transfers.setRecipientAddress}
              isPrivateNoteTransfer={transfers.isPrivateNoteTransfer}
              setIsPrivateNoteTransfer={transfers.setIsPrivateNoteTransfer}
              recipientZkPublicKey={transfers.recipientZkPublicKey}
              setRecipientZkPublicKey={transfers.setRecipientZkPublicKey}
              recipientViewingKey={transfers.recipientViewingKey}
              setRecipientViewingKey={transfers.setRecipientViewingKey}
              isProving={soroban.isProving}
              provingProgress={soroban.provingProgress}
              provingLogs={soroban.provingLogs}
              notes={notes.notes}
              selectedNoteCommitment={notes.selectedNoteCommitment}
              setSelectedNoteCommitment={notes.setSelectedNoteCommitment}
              isConnected={wallet.isConnected}
              connectWallet={wallet.connectWallet}
              handleShieldedTransfer={transfers.handleShieldedTransfer}
            />
          )}

          {activeTab === 'compliance' && (
            <CompliancePanel 
              complianceStandard={transfers.complianceStandard}
              setComplianceStandard={transfers.setComplianceStandard}
              viewingKey={transfers.viewingKey}
              setViewingKey={transfers.setViewingKey}
              complianceReport={transfers.complianceReport}
              setComplianceReport={transfers.setComplianceReport}
              isProving={soroban.isProving}
              provingProgress={soroban.provingProgress}
              provingLogs={soroban.provingLogs}
              isConnected={wallet.isConnected}
              zkPrivateKey={wallet.zkPrivateKey}
              connectWallet={wallet.connectWallet}
              handleGenerateCompliance={transfers.handleGenerateCompliance}
            />
          )}
        </div>

        {/* Global Footer */}
        <footer className="mt-auto pt-8 border-t border-white/10 flex flex-wrap gap-6 items-center justify-between text-xs text-[#cfc2d7]/60">
          <div className="flex gap-6">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#cfc2d7]/40">Network Health</p>
              <p className="font-bold text-[#00dce5]">Optimal</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#cfc2d7]/40">Latency</p>
              <p className="font-bold text-white">142ms</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#cfc2d7]/40">Nodes Online</p>
              <p className="font-bold text-white">4,129</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <span>Securely Connected via 12.0.4.82</span>
            <div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]"></div>
          </div>
        </footer>
      </main>

      {/* Settings / Sandbox Dialog Modal */}
      <SettingsModal 
        showSettings={showSettings}
        setShowSettings={setShowSettings}
        config={config}
      />

      {/* Deposit Status Modal */}
      <TransactionStatusModal 
        type="deposit"
        status={transfers.depositStatus.status}
        amount={transfers.depositStatus.amount}
        txHash={transfers.depositStatus.txHash}
        commitment={transfers.depositStatus.commitment}
        error={transfers.depositStatus.error}
        onClose={() => transfers.setDepositStatus({ status: 'idle' })}
      />

      {/* Transfer / Withdraw Status Modal */}
      <TransactionStatusModal 
        type={transfers.transferStatus.type}
        status={transfers.transferStatus.status}
        amount={transfers.transferStatus.amount}
        txHash={transfers.transferStatus.txHash}
        nullifier={transfers.transferStatus.nullifier}
        error={transfers.transferStatus.error}
        onClose={() => transfers.setTransferStatus({ status: 'idle', type: 'transfer' })}
      />

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full bg-[#191c22]/90 backdrop-blur-xl border-t border-white/10 px-6 py-3 flex justify-between items-center z-[100]">
        <button 
          onClick={() => setActiveTab('vault')}
          className={`flex flex-col items-center gap-1 bg-transparent border-none ${activeTab === 'vault' ? 'text-[#00f4fe]' : 'text-[#cfc2d7]'}`}
        >
          <span className="material-symbols-outlined text-xl">dashboard</span>
          <span className="text-[9px] font-bold">VAULT</span>
        </button>
        <button 
          onClick={() => setActiveTab('pool')}
          className={`flex flex-col items-center gap-1 bg-transparent border-none ${activeTab === 'pool' ? 'text-[#00f4fe]' : 'text-[#cfc2d7]'}`}
        >
          <span className="material-symbols-outlined text-xl">waves</span>
          <span className="text-[9px]">POOL</span>
        </button>
        <button 
          onClick={() => setActiveTab('send')}
          className={`flex flex-col items-center gap-1 bg-transparent border-none ${activeTab === 'send' ? 'text-[#00f4fe]' : 'text-[#cfc2d7]'}`}
        >
          <span className="material-symbols-outlined text-xl">send</span>
          <span className="text-[9px]">SEND</span>
        </button>
        <button 
          onClick={() => setActiveTab('compliance')}
          className={`flex flex-col items-center gap-1 bg-transparent border-none ${activeTab === 'compliance' ? 'text-[#00f4fe]' : 'text-[#cfc2d7]'}`}
        >
          <span className="material-symbols-outlined text-xl">verified_user</span>
          <span className="text-[9px]">COMPLIANCE</span>
        </button>
      </nav>
    </div>
  );
}
