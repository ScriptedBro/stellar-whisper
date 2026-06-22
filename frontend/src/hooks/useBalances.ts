import { useState, useEffect, useCallback } from 'react';
import { rpc, Contract, Account, TransactionBuilder, Networks, nativeToScVal, scValToNative } from '@stellar/stellar-sdk';

export function useBalances(userAddress: string, tokenContractId: string, _network: string = 'testnet') {
  const [publicBalance, setPublicBalance] = useState<number>(0);
  const [shieldedBalance, setShieldedBalance] = useState<number>(0.00);

  const fetchBalances = useCallback(async (address: string) => {
    if (!address) {
      setPublicBalance(0);
      return;
    }
    try {
      const server = new rpc.Server("https://soroban-testnet.stellar.org");
      const contract = new Contract(tokenContractId);
      
      let sequence = "0";
      try {
        const accountDetails = await server.getAccount(address);
        sequence = accountDetails.sequenceNumber();
      } catch (e) {
        setPublicBalance(0);
        return;
      }

      const account = new Account(address, sequence);
      const tx = new TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: Networks.TESTNET
      })
      .addOperation(
        contract.call("balance", nativeToScVal(address, { type: "address" }))
      )
      .setTimeout(30)
      .build();

      const sim = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
        const balBigInt = scValToNative(sim.result.retval);
        setPublicBalance(Number(balBigInt) / 10000000);
      }
    } catch (e) {
      console.error("Error fetching balances from testnet:", e);
    }
  }, [tokenContractId]);

  useEffect(() => {
    if (userAddress) {
      fetchBalances(userAddress);
    } else {
      setPublicBalance(0);
      setShieldedBalance(0);
    }
  }, [userAddress, fetchBalances]);

  // Load initial shielded balance from localStorage
  useEffect(() => {
    if (userAddress) {
      const key = `whisper_shielded_balance_${userAddress}`;
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        setShieldedBalance(Number(stored));
      } else {
        setShieldedBalance(0.00);
      }
    } else {
      setShieldedBalance(0.00);
    }
  }, [userAddress]);

  const updateShieldedBalance = useCallback((newBalance: number) => {
    setShieldedBalance(newBalance);
    if (userAddress) {
      localStorage.setItem(`whisper_shielded_balance_${userAddress}`, newBalance.toString());
    }
  }, [userAddress]);

  return {
    publicBalance,
    shieldedBalance,
    fetchBalances,
    updateShieldedBalance
  };
}
