import { useState, useEffect } from 'react';
import { 
  isConnected as isFreighterConnected, 
  requestAccess as requestFreighterAccess, 
  signMessage as signFreighterMessage
} from '@stellar/freighter-api';
import { sha256, deriveViewingKey, derivePubkey, bytesToHexDirect } from '../lib/crypto';
import { useNotification } from '../context/NotificationContext';

export function useWallet() {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [userAddress, setUserAddress] = useState<string>('');
  const [zkPrivateKey, setZkPrivateKey] = useState<string>('');
  const [derivedViewingKeyStr, setDerivedViewingKeyStr] = useState<string>('');
  const [derivedPubkeyHex, setDerivedPubkeyHex] = useState<string>('');
  const { showAlert } = useNotification();

  // Synchronize ZK private key with sessionStorage & derive viewing key and ZK public key
  useEffect(() => {
    if (isConnected && userAddress) {
      const stored = sessionStorage.getItem(`whisper_zk_pkey_${userAddress}`);
      if (stored) {
        setZkPrivateKey(stored);
        deriveViewingKey(stored).then(key => {
          setDerivedViewingKeyStr(key);
        });
        derivePubkey(stored).then(pubkeyBytes => {
          setDerivedPubkeyHex(bytesToHexDirect(pubkeyBytes));
        });
      }
    } else {
      setZkPrivateKey('');
      setDerivedViewingKeyStr('');
      setDerivedPubkeyHex('');
    }
  }, [isConnected, userAddress]);

  // Update viewing key and ZK public key when private key changes directly
  useEffect(() => {
    if (zkPrivateKey) {
      deriveViewingKey(zkPrivateKey).then(key => {
        setDerivedViewingKeyStr(key);
      });
      derivePubkey(zkPrivateKey).then(pubkeyBytes => {
        setDerivedPubkeyHex(bytesToHexDirect(pubkeyBytes));
      });
    } else {
      setDerivedViewingKeyStr('');
      setDerivedPubkeyHex('');
    }
  }, [zkPrivateKey]);

  const connectWallet = async () => {
    try {
      const freighterConn = await isFreighterConnected();
      const hasFreighter = freighterConn && freighterConn.isConnected;
      if (hasFreighter) {
        const accessResult = await requestFreighterAccess();
        if (accessResult.error) {
          showAlert("Connection Rejected", "Freighter connection rejected: " + accessResult.error, "error");
        } else if (accessResult.address) {
          const addr = accessResult.address;
          setUserAddress(addr);
          setIsConnected(true);
          
          try {
            const authMessage = "Sign this message to authorize Stellar Whisper ZK Privacy Key Derivation";
            const signResult = await signFreighterMessage(authMessage, { address: addr });
            
            if (signResult && signResult.signedMessage) {
              const signatureVal = signResult.signedMessage;
              const msgStr = typeof signatureVal === 'string' 
                ? signatureVal 
                : Array.from(new Uint8Array(signatureVal as any)).map(b => b.toString(16).padStart(2, '0')).join('');
              const derivedKey = await sha256(msgStr);
              setZkPrivateKey(derivedKey);
              sessionStorage.setItem(`whisper_zk_pkey_${addr}`, derivedKey);
            }
          } catch (signErr: any) {
            console.error("ZK Key Derivation signature rejected/failed:", signErr);
            showAlert("ZK Key Signature Rejected", "Signature rejected. ZK Private Key was not derived. You can still use the app, but shielding operations will use random commitments.", "warning");
          }
        }
      } else {
        showAlert("Freighter Wallet Required", "Freighter Wallet not found. Please install the extension.", "warning");
      }
    } catch (e: any) {
      showAlert("Connection Error", "Failed to connect Freighter: " + e.message, "error");
    }
  };

  const disconnectWallet = () => {
    if (userAddress) {
      sessionStorage.removeItem(`whisper_zk_pkey_${userAddress}`);
    }
    setIsConnected(false);
    setUserAddress('');
    setZkPrivateKey('');
    setDerivedViewingKeyStr('');
    setDerivedPubkeyHex('');
  };

  return {
    isConnected,
    userAddress,
    zkPrivateKey,
    derivedViewingKey: derivedViewingKeyStr,
    derivedPubkeyHex,
    connectWallet,
    disconnectWallet,
    setZkPrivateKey
  };
}
