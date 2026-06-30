import { useState, useCallback } from 'react';
import { rpc, Contract, Account, TransactionBuilder, Networks } from '@stellar/stellar-sdk';
import { 
  isConnected as isFreighterConnected, 
  requestAccess as requestFreighterAccess, 
  signTransaction as signFreighterTransaction 
} from '@stellar/freighter-api';

export function useSorobanCall(whisperContractId: string) {
  const [isProving, setIsProving] = useState<boolean>(false);
  const [provingProgress, setProvingProgress] = useState<number>(0);
  const [provingLogs, setProvingLogs] = useState<string[]>([]);

  const addProvingLog = useCallback((msg: string) => {
    setProvingLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const executeSorobanCall = useCallback(async (
    methodName: string,
    args: any[],
    callback: (txHash?: string, txResult?: any) => void,
    errorCallback: (err: string) => void,
    useRelayer: boolean = false
  ) => {
    setIsProving(true);
    
    try {
      const server = new rpc.Server("https://soroban-testnet.stellar.org");
      const { assembleTransaction } = rpc;

      if (useRelayer) {
        setProvingProgress(15);
        addProvingLog("Initializing OpenZeppelin Channels transaction flow...");

        try {
          setProvingProgress(40);
          addProvingLog("Serializing contract invocation for Relayer...");

          const contract = new Contract(whisperContractId);
          const callOp = contract.call(methodName, ...args) as any;
          
          // Bulletproof extraction of the host function XDR
          let hostFunctionXdr: string;
          if (callOp.func && typeof callOp.func.toXDR === 'function') {
            hostFunctionXdr = callOp.func.toXDR("base64");
          } else if (callOp.body && typeof callOp.body === 'function' && callOp.body().value && callOp.body().value().hostFunction) {
            hostFunctionXdr = callOp.body().value().hostFunction().toXDR("base64");
          } else {
            throw new Error("Could not extract HostFunction XDR from contract call operation.");
          }

          setProvingProgress(65);
          addProvingLog("Dispatching transaction to OpenZeppelin Channels Relayer proxy...");

          const response = await fetch("http://localhost:8123/api/relay", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ func: hostFunctionXdr, auth: [] })
          });

          const data = await response.json();
          if (!response.ok || !data.success) {
            throw new Error(data.details || data.error || "Relay submission failed.");
          }

          setProvingProgress(85);
          addProvingLog(`Transaction relayed! Hash: ${data.hash}. Awaiting blockchain consensus...`);

          // Poll for transaction status on-chain
          let status: string = "PENDING";
          let txResult: any;
          let attempts = 0;
          while ((status === "PENDING" || status === "NOT_FOUND") && attempts < 30) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            try {
              txResult = await server.getTransaction(data.hash);
              status = txResult.status;
            } catch (e) {
              status = "NOT_FOUND";
            }
            attempts++;
          }

          if (status !== "SUCCESS") {
            let errorDetails = "";
            if (txResult && txResult.resultXdr) {
              errorDetails = ` (Result XDR: ${txResult.resultXdr})`;
            }
            throw new Error(`Transaction execution failed on-chain with status ${status}.${errorDetails}`);
          }

          addProvingLog("Relayed transaction completed successfully!");
          setProvingProgress(100);
          setIsProving(false);
          callback(data.hash, txResult);
        } catch (err: any) {
          setIsProving(false);
          errorCallback(err.message || String(err));
        }
        return;
      }

      setProvingProgress(10);
      addProvingLog("Initializing Freighter connection...");

      const freighterConn = await isFreighterConnected();
      const hasFreighter = freighterConn && freighterConn.isConnected;
      if (!hasFreighter) throw new Error("Freighter wallet is not installed.");
      
      const accessResult = await requestFreighterAccess();
      if (accessResult.error || !accessResult.address) {
        throw new Error("Could not retrieve Freighter key: " + (accessResult.error || "unknown error"));
      }
      const pubKey = accessResult.address;

      setProvingProgress(25);
      addProvingLog("Fetching account sequence from Testnet...");

      let sequence = "0";
      try {
        const accountDetails = await server.getAccount(pubKey);
        sequence = accountDetails.sequenceNumber();
      } catch (e) {
        throw new Error("Account must be funded on Testnet first. Use Friendbot.");
      }

      setProvingProgress(40);
      addProvingLog("Constructing Soroban invocation details...");

      const contract = new Contract(whisperContractId);
      const account = new Account(pubKey, sequence);

      let tx = new TransactionBuilder(account, {
        fee: "100000",
        networkPassphrase: Networks.TESTNET
      })
      .addOperation(contract.call(methodName, ...args))
      .setTimeout(120)
      .build();

      setProvingProgress(55);
      addProvingLog("Invoking dry-run simulation against RPC...");

      const simulated = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(simulated)) {
        throw new Error("Simulation failed: " + JSON.stringify(simulated.error));
      }
      
      tx = assembleTransaction(tx, simulated).build();
      addProvingLog("Simulation successful. Resource footprint attached.");

      setProvingProgress(70);
      addProvingLog("Prompting Freighter for transaction signature...");

      const xdrString = tx.toXDR();
      const signResult = await signFreighterTransaction(xdrString, { networkPassphrase: Networks.TESTNET });
      if (signResult.error) {
        throw new Error("Signing rejected: " + signResult.error);
      }
      addProvingLog("Freighter signature retrieved.");

      setProvingProgress(85);
      addProvingLog("Broadcasting transaction to Testnet...");

      const signedTx = TransactionBuilder.fromXDR(signResult.signedTxXdr, Networks.TESTNET);
      const sendResult = await server.sendTransaction(signedTx);
      
      if (sendResult.status === "ERROR") {
        const errResult = (sendResult as any).errorResultXdr || (sendResult as any).errorResult || JSON.stringify(sendResult);
        throw new Error("Broadcast failed: " + errResult);
      }

      setProvingProgress(95);
      addProvingLog(`Tx pending. Hash: ${sendResult.hash}. Awaiting consensus...`);

      let status: string = "PENDING";
      let txResult: any;
      let attempts = 0;
      while ((status === "PENDING" || status === "NOT_FOUND") && attempts < 30) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
          txResult = await server.getTransaction(sendResult.hash);
          status = txResult.status;
        } catch (e) {
          status = "NOT_FOUND";
        }
        attempts++;
      }

      if (status !== "SUCCESS") {
        let errorDetails = "";
        if (txResult && txResult.resultXdr) {
          errorDetails = ` (Result XDR: ${txResult.resultXdr})`;
        }
        throw new Error(`Transaction execution failed on-chain with status ${status}.${errorDetails}`);
      }

      addProvingLog("Transaction completed successfully!");
      setProvingProgress(100);
      setIsProving(false);
      callback(sendResult.hash, txResult);
    } catch (err: any) {
      setIsProving(false);
      errorCallback(err.message || String(err));
    }
  }, [whisperContractId, addProvingLog]);

  return {
    isProving,
    setIsProving,
    provingProgress,
    setProvingProgress,
    provingLogs,
    setProvingLogs,
    addProvingLog,
    executeSorobanCall
  };
}
