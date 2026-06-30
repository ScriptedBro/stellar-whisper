import { useState, useEffect } from 'react';
import { scValToNative, xdr, rpc, Contract, Account, TransactionBuilder, Networks, nativeToScVal, Keypair } from '@stellar/stellar-sdk';
import { DEFAULT_CONFIG, XLM_CONTRACT_ID } from '../../config/constants';
import { getOnChainZeroHash, computeLatestMerkleRootOnChain } from '../../lib/merkle';

async function fetchOnChainTvl(
  tokenContractId: string,
  whisperContractId: string
): Promise<number> {
  try {
    const server = new rpc.Server("https://soroban-testnet.stellar.org");
    const simAccount = new Account(Keypair.random().publicKey(), "0");
    const contract = new Contract(tokenContractId);
    const tx = new TransactionBuilder(simAccount, {
      fee: "100",
      networkPassphrase: Networks.TESTNET
    })
    .addOperation(
      contract.call("balance", nativeToScVal(whisperContractId, { type: "address" }))
    )
    .setTimeout(30)
    .build();

    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
      const rawBalance = scValToNative(sim.result.retval);
      return Number(BigInt(rawBalance)) / 10000000;
    }
  } catch (err) {
    console.error("Error fetching on-chain TVL in PoolStats:", err);
  }
  return 0;
}

interface PoolStatsProps {
  selectedAsset: 'USDC' | 'XLM';
}

export function PoolStats({ selectedAsset }: PoolStatsProps) {
  const [localAsset, setLocalAsset] = useState<'USDC' | 'XLM'>(selectedAsset);
  const [tvl, setTvl] = useState<number>(0);
  const [volume24h, setVolume24h] = useState<number>(0);
  const [volChange, setVolChange] = useState<number>(0);
  const [anonymitySet, setAnonymitySet] = useState<number>(0);
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Detailed Modal states
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [copiedText, setCopiedText] = useState<string>('');
  const [depositCount, setDepositCount] = useState<number>(0);
  const [transferCount, setTransferCount] = useState<number>(0);
  const [withdrawalCount, setWithdrawalCount] = useState<number>(0);
  const [merkleRoot, setMerkleRoot] = useState<string>('');
  const [lastSyncedLedger, setLastSyncedLedger] = useState<number>(0);

  // Pre-calculate default empty root
  const defaultRootBytes = getOnChainZeroHash(16);
  const DEFAULT_ROOT = Array.from(defaultRootBytes).map((b: number) => b.toString(16).padStart(2, '0')).join('');

  // Sync localAsset with prop selectedAsset when it changes
  useEffect(() => {
    setLocalAsset(selectedAsset);
  }, [selectedAsset]);

  useEffect(() => {
    let active = true;

    const fetchStats = async () => {
      try {
        const response = await fetch("http://localhost:8123/api/events");
        if (!response.ok) throw new Error("Indexer offline");
        const data = await response.json();
        
        const targetToken = localAsset === 'USDC' 
          ? DEFAULT_CONFIG.tokenContractId 
          : XLM_CONTRACT_ID;

        // Filter events for the current active contract
        const events = (data.events || []).filter(
          (e: any) => e.contractId === DEFAULT_CONFIG.whisperContractId
        );

        // Filter events for the currently selected local asset
        const filteredEvents = events.filter((e: any) => {
          const token = e.tokenAddress || DEFAULT_CONFIG.tokenContractId;
          return token.toLowerCase() === targetToken.toLowerCase();
        });
        
        let anonSet = 0;
        let vol24h_deposits = 0;
        let vol24h_withdrawals = 0;
        let deps = 0;
        let txs = 0;
        let wds = 0;
        const allCommitmentsBytes: Uint8Array[] = [];

        const now = Date.now();
        const oneDayAgo = now - 24 * 60 * 60 * 1000;

        for (const event of filteredEvents) {
          try {
            // Parse event type from topics
            const topics = (event.topic || []).map((t: any) => 
              scValToNative(xdr.ScVal.fromXDR(t as any, "base64"))
            );
            const rawEventType = topics[0];
            let eventType = "";
            
            if (typeof rawEventType === 'string') {
              eventType = rawEventType;
            } else if (rawEventType && rawEventType instanceof Uint8Array) {
              eventType = new TextDecoder().decode(rawEventType);
            } else if (rawEventType && typeof rawEventType === 'object') {
              if (rawEventType.constructor?.name === 'Buffer' || rawEventType.constructor?.name === 'Uint8Array') {
                eventType = new TextDecoder().decode(Uint8Array.from(rawEventType));
              } else {
                eventType = rawEventType.toString();
              }
            } else if (rawEventType) {
              eventType = String(rawEventType);
            }

            const valData = scValToNative(xdr.ScVal.fromXDR(event.value as any, "base64"));
            const rawAmount = valData && typeof valData === 'object' 
              ? (valData.amount || valData.Amount || 0n) 
              : 0n;
            const amount = Number(BigInt(rawAmount)) / 10000000;

            const eventTime = new Date(event.ledgerClosedAt || now).getTime();

            if (eventType === "deposit") {
              anonSet += 1;
              deps += 1;
              const commitmentVal = valData && typeof valData === 'object' 
                ? (valData.commitment || valData.Commitment || (Array.isArray(valData) ? valData[0] : undefined)) 
                : undefined;
              if (commitmentVal) {
                allCommitmentsBytes.push(new Uint8Array(commitmentVal as any));
              }
              
              if (eventTime >= oneDayAgo) {
                vol24h_deposits += amount;
              }
            } else if (eventType === "shielded_output") {
              anonSet += 1;
              const commitmentVal = valData && typeof valData === 'object' 
                ? (valData.commitment || valData.Commitment || (Array.isArray(valData) ? valData[0] : undefined)) 
                : undefined;
              if (commitmentVal) {
                allCommitmentsBytes.push(new Uint8Array(commitmentVal as any));
              }
            } else if (eventType === "shielded_transfer") {
              txs += 1;
            } else if (eventType === "withdrawal") {
              wds += 1;
              
              if (eventTime >= oneDayAgo) {
                vol24h_withdrawals += amount;
              }
            }
          } catch (err) {
            console.error("Failed to parse event in PoolStats:", err);
          }
        }

        // Dynamically compute Merkle root from all active commitments
        let calculatedRoot = DEFAULT_ROOT;
        if (allCommitmentsBytes.length > 0) {
          calculatedRoot = await computeLatestMerkleRootOnChain(allCommitmentsBytes);
        }

        // Fetch on-chain TVL directly for accuracy
        const onChainTvl = await fetchOnChainTvl(targetToken, DEFAULT_CONFIG.whisperContractId);

        // 24h volume = total activity (deposits + withdrawals)
        const vol24h = vol24h_deposits + vol24h_withdrawals;
        // Net 24h change = deposits - withdrawals
        const netChange24h = vol24h_deposits - vol24h_withdrawals;

        if (active) {
          setTvl(onChainTvl);
          setAnonymitySet(anonSet);
          setVolume24h(vol24h);
          
          // Percentage = net 24h change relative to starting TVL (standard growth rate)
          const prevTvl = onChainTvl - netChange24h;
          if (vol24h === 0) {
            setVolChange(0);
          } else if (prevTvl <= 0) {
            setVolChange(netChange24h > 0 ? 100 : 0);
          } else {
            const change = (netChange24h / prevTvl) * 100;
            setVolChange(change);
          }

          setDepositCount(deps);
          setTransferCount(txs);
          setWithdrawalCount(wds);
          setMerkleRoot(calculatedRoot);
          setLastSyncedLedger(data.lastSyncedLedger || 0);

          setIsOnline(true);
          setIsLoading(false);
        }
      } catch (err) {
        if (active) {
          setIsOnline(false);
          setIsLoading(false);
        }
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 5000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [localAsset]);

  const formatCurrency = (val: number) => {
    const symbol = localAsset === 'USDC' ? '$' : '';
    const assetLabel = localAsset;
    const prefix = val < 0 ? '-' : '';
    const absVal = Math.abs(val);
    return `${prefix}${symbol}${absVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${assetLabel}`;
  };

  const triggerCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(''), 1500);
  };

  const currentTvl = tvl;
  const currentVolume = volume24h;
  const currentVolChange = volChange;
  const currentAnonSet = anonymitySet;

  const currentDeposits = depositCount;
  const currentTransfers = transferCount;
  const currentWithdrawals = withdrawalCount;
  const currentRoot = merkleRoot || DEFAULT_ROOT;

  const totalCount = currentDeposits + currentTransfers + currentWithdrawals;

  return (
    <>
      <div className="col-span-12 lg:col-span-4 glass-panel rounded-lg p-6 glass-inner-stroke flex flex-col bg-surface-container-high/40 relative">
        <div className="flex items-center justify-between mb-6">
          <div className="flex flex-col">
            <h3 className="font-bold text-lg text-white">Invisible Pool</h3>
            <div className="flex items-center gap-1.5 mt-1">
              <span className={`w-2 h-2 rounded-full ${isLoading ? 'bg-amber-400 animate-pulse' : isOnline ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`}></span>
              <span className="text-[10px] font-mono font-bold tracking-wider text-[#cfc2d7]">
                {isLoading ? 'CONNECTING...' : isOnline ? 'LIVE DATA' : 'OFFLINE'}
              </span>
            </div>
          </div>
          <span className="material-symbols-outlined text-[#00dce5]">analytics</span>
        </div>

        {/* Pool Stats Asset Selector Tabs */}
        <div className="flex bg-white/5 p-1 rounded-lg border border-white/5 mb-6">
          <button 
            onClick={() => setLocalAsset('USDC')}
            className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer border-none ${localAsset === 'USDC' ? 'bg-[#00dce5] text-black shadow-[0_0_10px_rgba(0,220,229,0.3)]' : 'text-[#cfc2d7] hover:text-white bg-transparent'}`}
          >
            USDC Pool
          </button>
          <button 
            onClick={() => setLocalAsset('XLM')}
            className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer border-none ${localAsset === 'XLM' ? 'bg-[#00dce5] text-black shadow-[0_0_10px_rgba(0,220,229,0.3)]' : 'text-[#cfc2d7] hover:text-white bg-transparent'}`}
          >
            XLM Pool
          </button>
        </div>
        
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-12 space-y-3">
            <div className="w-8 h-8 border-2 border-[#00dce5] border-t-transparent rounded-full animate-spin"></div>
            <span className="text-xs font-mono text-[#cfc2d7]">Connecting to indexer...</span>
          </div>
        ) : (
          <div className="space-y-6 flex-1 animate-fade-in">
            <div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-[#cfc2d7]">Pool TVL</span>
                <span className="text-white font-bold font-mono">
                  {formatCurrency(currentTvl)}
                </span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-[#8a2be2] shadow-[0_0_10px_#8a2be2] transition-all duration-500" 
                  style={{ width: `${Math.min(100, Math.max(10, (currentTvl > 0 ? 30 + (currentTvl / (localAsset === 'USDC' ? 10000 : 100000)) * 70 : 10)))}%` }}
                ></div>
              </div>
            </div>
            
            <div className="grid grid-cols-1 gap-3">
              <div className="p-4 rounded bg-white/5 border border-white/5 flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-[#cfc2d7]">24h Volume</p>
                  <p className="text-sm font-bold text-white font-mono">
                    {formatCurrency(currentVolume)}
                  </p>
                </div>
                <span className={`text-xs font-semibold font-mono ${currentVolChange >= 0 ? 'text-[#00dce5]' : 'text-red-400'}`}>
                  {currentVolChange >= 0 ? '+' : ''}{currentVolChange.toFixed(1)}%
                </span>
              </div>
              
              <div className="p-4 rounded bg-white/5 border border-white/5 flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-[#cfc2d7]">Anonymity Set</p>
                  <p className="text-sm font-bold text-white font-mono">
                    {currentAnonSet.toLocaleString()}
                  </p>
                </div>
                <span className="material-symbols-outlined text-[#00dce5] text-sm">verified</span>
              </div>
            </div>
          </div>
        )}
        
        <button 
          onClick={() => setIsModalOpen(true)}
          className="mt-6 w-full py-2.5 text-xs font-bold text-[#00dce5] hover:text-white transition-colors flex items-center justify-center gap-1 cursor-pointer bg-transparent border-none"
        >
          View Detailed Metrics
          <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
        </button>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-lg glass-panel rounded-lg p-6 glass-inner-stroke bg-surface-container-high/90 relative text-left">
            <button 
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 text-[#cfc2d7] hover:text-white transition-colors cursor-pointer bg-transparent border-none flex items-center"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>

            <div className="flex items-center gap-2 mb-6">
              <span className="material-symbols-outlined text-[#00dce5] text-2xl">analytics</span>
              <h3 className="font-bold text-xl text-white">Detailed Pool Metrics</h3>
            </div>

            <div className="space-y-6">
              {/* Section 1: Network & Indexer */}
              <div>
                <h4 className="text-[10px] font-mono font-bold text-[#00dce5] uppercase tracking-wider mb-2.5">Ledger & Indexer Status</h4>
                <div className="p-4 rounded bg-white/5 border border-white/5 space-y-3 font-mono text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-[#cfc2d7]">Contract Address:</span>
                    <div className="flex items-center gap-1">
                      <span className="text-white truncate max-w-[180px]" title={DEFAULT_CONFIG.whisperContractId}>
                        {DEFAULT_CONFIG.whisperContractId.slice(0, 10)}...{DEFAULT_CONFIG.whisperContractId.slice(-10)}
                      </span>
                      <button 
                        onClick={() => triggerCopy(DEFAULT_CONFIG.whisperContractId)}
                        className="text-[#00dce5] hover:text-white bg-transparent border-none cursor-pointer p-0.5 flex items-center"
                        title="Copy Address"
                      >
                        <span className="material-symbols-outlined text-sm">
                          {copiedText === DEFAULT_CONFIG.whisperContractId ? 'check' : 'content_copy'}
                        </span>
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#cfc2d7]">Indexer URL:</span>
                    <span className="text-white">http://localhost:8123</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#cfc2d7]">Sync Status:</span>
                    <span className={isOnline ? 'text-green-400 font-bold' : 'text-red-500 font-bold'}>
                      {isOnline ? 'CONNECTED' : 'OFFLINE'}
                    </span>
                  </div>
                  {isOnline && (
                    <div className="flex justify-between">
                      <span className="text-[#cfc2d7]">Last Synced Ledger:</span>
                      <span className="text-white font-mono">{lastSyncedLedger}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Section 2: Cryptographic State */}
              <div>
                <h4 className="text-[10px] font-mono font-bold text-[#8a2be2] uppercase tracking-wider mb-2.5">Cryptographic Configuration</h4>
                <div className="p-4 rounded bg-white/5 border border-white/5 space-y-3 font-mono text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-[#cfc2d7]">Current Merkle Root:</span>
                    <div className="flex items-center gap-1">
                      <span className="text-white truncate max-w-[180px]" title={currentRoot}>
                        {currentRoot.slice(0, 10)}...{currentRoot.slice(-10)}
                      </span>
                      <button 
                        onClick={() => triggerCopy(currentRoot)}
                        className="text-[#8a2be2] hover:text-white bg-transparent border-none cursor-pointer p-0.5 flex items-center"
                        title="Copy Root"
                      >
                        <span className="material-symbols-outlined text-sm">
                          {copiedText === currentRoot ? 'check' : 'content_copy'}
                        </span>
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#cfc2d7]">Tree Depth:</span>
                    <span className="text-white">16 Levels (Max 65,536 commitments)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#cfc2d7]">Proof System:</span>
                    <span className="text-white">Aztec UltraHonk (Gemini+Shplonk+KZG)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#cfc2d7]">Compliance Check:</span>
                    <span className="text-[#00ff87] font-bold">OFAC Filter Enabled (Active)</span>
                  </div>
                </div>
              </div>

              {/* Section 3: Event Distribution */}
              <div>
                <h4 className="text-[10px] font-mono font-bold text-[#fface8] uppercase tracking-wider mb-2.5">Transaction Distribution</h4>
                <div className="p-4 rounded bg-white/5 border border-white/5 space-y-4 text-xs">
                  <div>
                    <div className="flex justify-between mb-1.5 font-mono">
                      <span className="text-[#cfc2d7]">Shielded Deposits:</span>
                      <span className="text-white font-bold">{currentDeposits}</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-[#00dce5]" 
                        style={{ width: `${totalCount > 0 ? (currentDeposits / totalCount) * 100 : 33.3}%` }}
                      ></div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between mb-1.5 font-mono">
                      <span className="text-[#cfc2d7]">Shielded Transfers:</span>
                      <span className="text-white font-bold">{currentTransfers}</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-[#8a2be2]" 
                        style={{ width: `${totalCount > 0 ? (currentTransfers / totalCount) * 100 : 33.3}%` }}
                      ></div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between mb-1.5 font-mono">
                      <span className="text-[#cfc2d7]">Shielded Withdrawals:</span>
                      <span className="text-white font-bold">{currentWithdrawals}</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-[#fface8]" 
                        style={{ width: `${totalCount > 0 ? (currentWithdrawals / totalCount) * 100 : 33.3}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <button 
              onClick={() => setIsModalOpen(false)}
              className="mt-6 w-full py-3 rounded bg-white/5 border border-white/10 hover:bg-white/10 text-white text-xs font-bold transition-all cursor-pointer"
            >
              Close Detailed Metrics
            </button>
          </div>
        </div>
      )}
    </>
  );
}
