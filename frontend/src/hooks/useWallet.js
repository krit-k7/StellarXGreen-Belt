import { useState, useCallback } from 'react';
import {
  isConnected,
  requestAccess,
  signTransaction,
} from '@stellar/freighter-api';

export function useWallet() {
  const [address, setAddress] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const connected = await isConnected();
      if (!connected.isConnected) {
        throw new Error('Freighter wallet not found. Please install it.');
      }
      const accessObj = await requestAccess();
      if (accessObj.error) {
        throw new Error(accessObj.error);
      }
      setAddress(accessObj.address);
      return accessObj.address;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setError(null);
  }, []);

  const sign = useCallback(async (txXdr) => {
    try {
      const result = await signTransaction(txXdr, {
        networkPassphrase: 'Test SDF Network ; September 2015',
        network: 'TESTNET',
      });
      return result.signedTxXdr;
    } catch (err) {
      throw new Error('Transaction signing rejected.');
    }
  }, []);

  return { address, isConnecting, connect, disconnect, signTransaction: sign, error };
}
