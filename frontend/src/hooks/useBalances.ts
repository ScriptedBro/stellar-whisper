import { useState, useEffect, useCallback } from 'react';
import { rpc, Contract, Account, TransactionBuilder, Networks, nativeToScVal, scValToNative } from '@stellar/stellar-sdk';

export const XLM_CONTRACT_ID = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

export function useBalances(userAddress: string, tokenContractId: string, _network: string = 'testnet') {
  const [selectedAsset, setSelectedAsset] = useState<'USDC' | 'XLM'>('USDC');
  
  const [publicUsdcBalance, setPublicUsdcBalance] = useState<number>(0);
  const [publicXlmBalance, setPublicXlmBalance] = useState<number>(0);
  
  const [shieldedUsdcBalance, setShieldedUsdcBalance] = useState<number>(0.00);
  const [shieldedXlmBalance, setShieldedXlmBalance] = useState<number>(0.00);

  const fetchBalances = useCallback(async (address: string) => {
    if (!address) {
      setPublicUsdcBalance(0);
      setPublicXlmBalance(0);
      return;
    }
    try {
      const server = new rpc.Server("https://soroban-testnet.stellar.org");
      
      let sequence = "0";
      try {
        const accountDetails = await server.getAccount(address);
        sequence = accountDetails.sequenceNumber();
      } catch (e) {
        setPublicUsdcBalance(0);
        setPublicXlmBalance(0);
        return;
      }

      const account = new Account(address, sequence);
      
      // 1. Fetch USDC Balance
      try {
        const usdcContract = new Contract(tokenContractId);
        const txUsdc = new TransactionBuilder(account, {
          fee: "100",
          networkPassphrase: Networks.TESTNET
        })
        .addOperation(
          usdcContract.call("balance", nativeToScVal(address, { type: "address" }))
        )
        .setTimeout(30)
        .build();

        const simUsdc = await server.simulateTransaction(txUsdc);
        if (rpc.Api.isSimulationSuccess(simUsdc) && simUsdc.result) {
          const balBigInt = scValToNative(simUsdc.result.retval);
          setPublicUsdcBalance(Number(balBigInt) / 10000000);
        }
      } catch (err) {
        console.error("Error fetching USDC balance:", err);
      }

      // 2. Fetch XLM Balance from Horizon (canonical and robust source for native XLM)
      try {
        const response = await fetch(`https://horizon-testnet.stellar.org/accounts/${address}`);
        if (response.ok) {
          const data = await response.json();
          const nativeBalanceEntry = data.balances.find((b: any) => b.asset_type === 'native');
          if (nativeBalanceEntry) {
            setPublicXlmBalance(Number(nativeBalanceEntry.balance));
          }
        } else {
          throw new Error(`Horizon returned status ${response.status}`);
        }
      } catch (err) {
        console.error("Error fetching XLM balance from Horizon, falling back to Soroban simulation:", err);
        try {
          const xlmContract = new Contract(XLM_CONTRACT_ID);
          const txXlm = new TransactionBuilder(account, {
            fee: "100",
            networkPassphrase: Networks.TESTNET
          })
          .addOperation(
            xlmContract.call("balance", nativeToScVal(address, { type: "address" }))
          )
          .setTimeout(30)
          .build();

          const simXlm = await server.simulateTransaction(txXlm);
          if (rpc.Api.isSimulationSuccess(simXlm) && simXlm.result) {
            const balBigInt = scValToNative(simXlm.result.retval);
            setPublicXlmBalance(Number(balBigInt) / 10000000);
          }
        } catch (fallbackErr) {
          console.error("Soroban XLM balance fallback also failed:", fallbackErr);
        }
      }
    } catch (e) {
      console.error("Error fetching balances from testnet:", e);
    }
  }, [tokenContractId]);

  useEffect(() => {
    if (!userAddress) {
      setPublicUsdcBalance(0);
      setPublicXlmBalance(0);
      setShieldedUsdcBalance(0);
      setShieldedXlmBalance(0);
      return;
    }

    fetchBalances(userAddress);

    // Poll balances every 5 seconds to keep the UI in sync with on-chain changes
    const interval = setInterval(() => {
      fetchBalances(userAddress);
    }, 5000);

    return () => clearInterval(interval);
  }, [userAddress, fetchBalances]);

  // Load initial shielded balances from localStorage
  useEffect(() => {
    if (userAddress) {
      const storedUsdc = localStorage.getItem(`whisper_shielded_balance_usdc_${userAddress}`);
      const storedXlm = localStorage.getItem(`whisper_shielded_balance_xlm_${userAddress}`);
      if (storedUsdc !== null) setShieldedUsdcBalance(Number(storedUsdc));
      if (storedXlm !== null) setShieldedXlmBalance(Number(storedXlm));
    } else {
      setShieldedUsdcBalance(0.00);
      setShieldedXlmBalance(0.00);
    }
  }, [userAddress]);

  const updateShieldedBalances = useCallback((newUsdcBalance: number, newXlmBalance: number) => {
    setShieldedUsdcBalance(newUsdcBalance);
    setShieldedXlmBalance(newXlmBalance);
    if (userAddress) {
      localStorage.setItem(`whisper_shielded_balance_usdc_${userAddress}`, newUsdcBalance.toString());
      localStorage.setItem(`whisper_shielded_balance_xlm_${userAddress}`, newXlmBalance.toString());
      // Keep fallback legacy key for backward compatibility
      const currentActive = selectedAsset === 'USDC' ? newUsdcBalance : newXlmBalance;
      localStorage.setItem(`whisper_shielded_balance_${userAddress}`, currentActive.toString());
    }
  }, [userAddress, selectedAsset]);

  // Backward compatibility legacy update method
  const updateShieldedBalance = useCallback((newBalance: number) => {
    if (selectedAsset === 'USDC') {
      setShieldedUsdcBalance(newBalance);
      if (userAddress) localStorage.setItem(`whisper_shielded_balance_usdc_${userAddress}`, newBalance.toString());
    } else {
      setShieldedXlmBalance(newBalance);
      if (userAddress) localStorage.setItem(`whisper_shielded_balance_xlm_${userAddress}`, newBalance.toString());
    }
    if (userAddress) {
      localStorage.setItem(`whisper_shielded_balance_${userAddress}`, newBalance.toString());
    }
  }, [userAddress, selectedAsset]);

  const publicBalance = selectedAsset === 'USDC' ? publicUsdcBalance : publicXlmBalance;
  const shieldedBalance = selectedAsset === 'USDC' ? shieldedUsdcBalance : shieldedXlmBalance;

  return {
    selectedAsset,
    setSelectedAsset,
    publicBalance,
    shieldedBalance,
    publicUsdcBalance,
    publicXlmBalance,
    shieldedUsdcBalance,
    shieldedXlmBalance,
    fetchBalances,
    updateShieldedBalance,
    updateShieldedBalances
  };
}
