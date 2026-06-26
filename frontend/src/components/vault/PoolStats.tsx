import { useState, useEffect } from 'react';
import { scValToNative, xdr } from '@stellar/stellar-sdk';
import { DEFAULT_CONFIG } from '../../config/constants';

export function PoolStats() {
  const [tvl, setTvl] = useState<number>(0);
  const [volume24h, setVolume24h] = useState<number>(0);
  const [volChange, setVolChange] = useState<number>(0);
  const [anonymitySet, setAnonymitySet] = useState<number>(0);
  const [isLive, setIsLive] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Fallback demo values if indexer is offline
  const DEMO_TVL = 14200000;
  const DEMO_VOLUME = 1820000;
  const DEMO_VOL_CHANGE = 4.2;
  const DEMO_ANON_SET = 18402;

  useEffect(() => {
    let active = true;

    const fetchStats = async () => {
      try {
        const response = await fetch("http://localhost:8123/api/events");
        if (!response.ok) throw new Error("Indexer offline");
        const data = await response.json();
        
        // Filter events for the current active contract
        const events = (data.events || []).filter(
          (e: any) => e.contractId === DEFAULT_CONFIG.whisperContractId
        );
        
        let calculatedTvl = 0;
        let anonSet = 0;
        let vol24h = 0;
        let volPrev = 0;

        const now = Date.now();
        const oneDayAgo = now - 24 * 60 * 60 * 1000;
        const twoDaysAgo = now - 48 * 60 * 60 * 1000;

        for (const event of events) {
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
              calculatedTvl += amount;
              anonSet += 1;
              
              if (eventTime >= oneDayAgo) {
                vol24h += amount;
              } else if (eventTime >= twoDaysAgo) {
                volPrev += amount;
              }
            } else if (eventType === "shielded_output") {
              anonSet += 1;
            } else if (eventType === "withdrawal") {
              calculatedTvl -= amount;
              
              if (eventTime >= oneDayAgo) {
                vol24h += amount;
              } else if (eventTime >= twoDaysAgo) {
                volPrev += amount;
              }
            }
          } catch (err) {
            console.error("Failed to parse event in PoolStats:", err);
          }
        }

        if (active) {
          setTvl(Math.max(0, calculatedTvl));
          setAnonymitySet(anonSet);
          setVolume24h(vol24h);
          
          if (volPrev > 0) {
            const change = ((vol24h - volPrev) / volPrev) * 100;
            setVolChange(change);
          } else {
            setVolChange(vol24h > 0 ? 100 : 0);
          }

          setIsLive(true);
          setIsLoading(false);
        }
      } catch (err) {
        // Fallback to demo mode if indexer is unreachable
        if (active) {
          setIsLive(false);
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
  }, []);

  const formatCurrency = (val: number, isDemo: boolean) => {
    if (isDemo) {
      if (val >= 1000000) return `$${(val / 1000000).toFixed(2)}M`;
      if (val >= 1000) return `$${(val / 1000).toFixed(2)}K`;
      return `$${val.toFixed(2)}`;
    }
    return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
  };

  const currentTvl = isLive ? tvl : DEMO_TVL;
  const currentVolume = isLive ? volume24h : DEMO_VOLUME;
  const currentVolChange = isLive ? volChange : DEMO_VOL_CHANGE;
  const currentAnonSet = isLive ? anonymitySet : DEMO_ANON_SET;

  return (
    <div className="col-span-12 lg:col-span-4 glass-panel rounded-lg p-6 glass-inner-stroke flex flex-col bg-surface-container-high/40 relative">
      <div className="flex items-center justify-between mb-6">
        <div className="flex flex-col">
          <h3 className="font-bold text-lg text-white">Invisible Pool</h3>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-400 animate-pulse' : 'bg-amber-400'}`}></span>
            <span className="text-[10px] font-mono font-bold tracking-wider text-[#cfc2d7]">
              {isLoading ? 'CONNECTING...' : isLive ? 'LIVE DATA' : 'DEMO MODE'}
            </span>
          </div>
        </div>
        <span className="material-symbols-outlined text-[#00dce5]">analytics</span>
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
                {isLive ? formatCurrency(currentTvl, false) : `$1.42B`}
              </span>
            </div>
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div 
                className="h-full bg-[#8a2be2] shadow-[0_0_10px_#8a2be2] transition-all duration-500" 
                style={{ width: isLive ? `${Math.min(100, Math.max(10, (currentTvl / 1000) * 100))}%` : '72%' }}
              ></div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 gap-3">
            <div className="p-4 rounded bg-white/5 border border-white/5 flex items-center justify-between">
              <div>
                <p className="text-[10px] text-[#cfc2d7]">24h Volume</p>
                <p className="text-sm font-bold text-white font-mono">
                  {formatCurrency(currentVolume, !isLive)}
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
        onClick={() => alert(`Detailed metrics showing total volume, transaction distribution, and verifier contracts status.\n\nActive Contract ID: ${DEFAULT_CONFIG.whisperContractId}\nIndexer Connection: ${isLive ? "Online (Port 8123)" : "Offline (Using demo data)"}`)}
        className="mt-6 w-full py-2.5 text-xs font-bold text-[#00dce5] hover:text-white transition-colors flex items-center justify-center gap-1 cursor-pointer bg-transparent border-none"
      >
        View Detailed Metrics
        <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
      </button>
    </div>
  );
}
