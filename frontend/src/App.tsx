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
import { LiquidityPanel } from './components/liquidity/LiquidityPanel';
import { SwapPanel } from './components/swap/SwapPanel';

export default function App() {
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'vault' | 'pool' | 'send' | 'compliance' | 'liquidity' | 'swap'>('vault');
  const { showToast } = useNotification();

  const [config] = useState<Config>(() => ({
    network: DEFAULT_CONFIG.network,
    adminAddress: DEFAULT_CONFIG.adminAddress,
    tokenContractId: DEFAULT_CONFIG.tokenContractId,
    tokenBContractId: DEFAULT_CONFIG.tokenBContractId,
    xlmContractId: DEFAULT_CONFIG.xlmContractId,
    verifierContractId: DEFAULT_CONFIG.verifierContractId,
    whisperContractId: DEFAULT_CONFIG.whisperContractId
  }));

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
    balances.updateShieldedBalances,
    config.tokenContractId
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
    setActiveTab,
    selectedAsset: balances.selectedAsset
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

  const fundUsdc = async () => {
    if (!wallet.userAddress) return;
    try {
      showToast("Requesting USDC from faucet...", "info");
      const res = await fetch("http://localhost:8123/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: wallet.userAddress })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Received ${data.amount} USDC!`, "success");
      } else {
        showToast("USDC faucet failed: " + (data.error || "unknown"), "error");
      }
      await balances.fetchBalances(wallet.userAddress);
    } catch (e: any) {
      showToast("USDC faucet failed: " + e.message, "error");
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
        fundUsdc={fundUsdc}
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
              publicUsdcBalance={balances.publicUsdcBalance}
              publicXlmBalance={balances.publicXlmBalance}
              shieldedUsdcBalance={balances.shieldedUsdcBalance}
              shieldedXlmBalance={balances.shieldedXlmBalance}
              selectedAsset={balances.selectedAsset}
              setSelectedAsset={balances.setSelectedAsset}
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
              selectedAsset={balances.selectedAsset}
              setSelectedAsset={balances.setSelectedAsset}
              publicBalance={balances.publicBalance}
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
              isSyncing={notes.isSyncing}
              connectWallet={wallet.connectWallet}
              handleShieldedTransfer={transfers.handleShieldedTransfer}
              selectedAsset={balances.selectedAsset}
              setSelectedAsset={balances.setSelectedAsset}
              publicBalance={balances.publicBalance}
              shieldedBalance={balances.shieldedBalance}
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

          {activeTab === 'liquidity' && (
            <LiquidityPanel 
              isConnected={wallet.isConnected}
              connectWallet={wallet.connectWallet}
              publicXlmBalance={balances.publicXlmBalance}
              publicUsdcBalance={balances.publicUsdcBalance}
              whisperContractId={config.whisperContractId}
              executeSorobanCall={soroban.executeSorobanCall}
              userAddress={wallet.userAddress}
              fetchBalances={balances.fetchBalances}
            />
          )}

          {activeTab === 'swap' && (
            <SwapPanel 
              isConnected={wallet.isConnected}
              connectWallet={wallet.connectWallet}
              shieldedXlmBalance={balances.shieldedXlmBalance}
              shieldedUsdcBalance={balances.shieldedUsdcBalance}
              notes={notes.notes}
              setNotes={notes.setNotes}
              zkPrivateKey={wallet.zkPrivateKey}
              derivedViewingKey={wallet.derivedViewingKey}
              allCommitments={notes.allCommitments}
              setAllCommitments={notes.setAllCommitments}
              executeSorobanCall={soroban.executeSorobanCall}
              config={config}
              fetchBalances={balances.fetchBalances}
              userAddress={wallet.userAddress}
              syncNotesFromChain={notes.syncNotesFromChain}
              isProving={soroban.isProving}
              provingProgress={soroban.provingProgress}
              provingLogs={soroban.provingLogs}
              setIsProving={soroban.setIsProving}
              setProvingProgress={soroban.setProvingProgress}
              setProvingLogs={soroban.setProvingLogs}
              addProvingLog={soroban.addProvingLog}
              setTransferStatus={transfers.setTransferStatus}
              setLogs={setLogs}
            />
          )}
        </div>

        {/* Global Footer */}
        <footer className="mt-auto pt-8 border-t border-white/10 flex flex-wrap gap-6 items-center justify-between text-xs text-[#cfc2d7]/60">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]"></div>
            <span>Connected to Stellar Testnet</span>
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
        assetSymbol={transfers.depositStatus.assetSymbol}
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
        assetSymbol={transfers.transferStatus.assetSymbol}
        toAssetSymbol={transfers.transferStatus.toAssetSymbol}
        toAmount={transfers.transferStatus.toAmount}
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
