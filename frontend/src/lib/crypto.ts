// Convert hex string to Uint8Array
export const hexToBytes = (hex: string): Uint8Array => {
  let cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (cleanHex.length % 2 !== 0) cleanHex = '0' + cleanHex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

// Convert Uint8Array to hex string
export const bytesToHexDirect = (bytes: Uint8Array): string => {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
};

// Convert BigInt back to a 32-byte Uint8Array (big-endian)
export const bigIntToBytes32 = (val: bigint): Uint8Array => {
  let hex = val.toString(16);
  if (hex.length % 2 !== 0) hex = '0' + hex;
  hex = hex.padStart(64, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

const webCrypto = typeof window !== 'undefined' && window.crypto ? window.crypto : globalThis.crypto;

// Helper to compute SHA-256 hash natively in browser
export const sha256 = async (message: string): Promise<string> => {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await webCrypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

// Derives a viewing key (symmetric key for note decryption) from the private key
export const deriveViewingKey = async (zkPrivateKeyHex: string): Promise<string> => {
  const seed = new TextEncoder().encode("viewing_key:" + zkPrivateKeyHex);
  const hashBuffer = await webCrypto.subtle.digest('SHA-256', seed);
  return bytesToHexDirect(new Uint8Array(hashBuffer));
};

import { poseidon } from '@iden3/js-crypto';

// BN254 scalar field modulus (r)
const BN254_SCALAR_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

// Reduce a bigint to be within the BN254 scalar field
const modScalarField = (val: bigint): bigint => {
  return val % BN254_SCALAR_MODULUS;
};

export const bytesToBigInt = (bytes: Uint8Array): bigint => {
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return BigInt('0x' + hex);
};

export const derivePubkey = async (zkPrivateKeyHex: string): Promise<Uint8Array> => {
  const secretKeyBytes = hexToBytes(zkPrivateKeyHex);
  const secretKeyBigInt = modScalarField(bytesToBigInt(secretKeyBytes));
  const pubkeyBigInt = poseidon.hash([secretKeyBigInt]);
  return bigIntToBytes32(pubkeyBigInt);
};

export const hashOnChain = async (leftBytes: Uint8Array, rightBytes: Uint8Array): Promise<Uint8Array> => {
  const leftBigInt = modScalarField(bytesToBigInt(leftBytes));
  const rightBigInt = modScalarField(bytesToBigInt(rightBytes));
  const hashBigInt = poseidon.hash([leftBigInt, rightBigInt]);
  return bigIntToBytes32(hashBigInt);
};

// Derives commitment: poseidon_2(pubkey, poseidon_2(amount, nonce))
// The nonce binds each commitment to a unique nullifier, preventing duplicate commitments
// for the same (pubkey, amount) pair and preventing double-spend via nonce reuse.
export const deriveCommitment = async (pubkeyBytes: Uint8Array, amountBigInt: bigint, nonceHex: string): Promise<Uint8Array> => {
  const pubkeyBigInt = modScalarField(bytesToBigInt(pubkeyBytes));
  const amountField = modScalarField(amountBigInt);
  const nonceBytes = hexToBytes(nonceHex);
  const nonceBigInt = modScalarField(bytesToBigInt(nonceBytes));
  const saltedAmount = poseidon.hash([amountField, nonceBigInt]);
  const commitmentBigInt = poseidon.hash([pubkeyBigInt, saltedAmount]);
  return bigIntToBytes32(commitmentBigInt);
};

// Derives nullifier hash: poseidon_2(secret_key, nullifier_nonce)
export const deriveNullifier = async (zkPrivateKeyHex: string, nullifierNonceHex: string): Promise<Uint8Array> => {
  const secretKeyBytes = hexToBytes(zkPrivateKeyHex);
  const secretKeyBigInt = modScalarField(bytesToBigInt(secretKeyBytes));
  const nonceBytes = hexToBytes(nullifierNonceHex);
  const nonceBigInt = modScalarField(bytesToBigInt(nonceBytes));
  const nullifierBigInt = poseidon.hash([secretKeyBigInt, nonceBigInt]);
  return bigIntToBytes32(nullifierBigInt);
};

export const bytesToHex = (bytesVal: any): string => {
  if (!bytesVal) return '';
  if (typeof bytesVal === 'string') return bytesVal;
  try {
    const arr = Uint8Array.from(bytesVal);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    if (bytesVal && typeof bytesVal === 'object') {
      if ('data' in bytesVal && (Array.isArray(bytesVal.data) || ArrayBuffer.isView(bytesVal.data))) {
        return Array.from(bytesVal.data).map((b: any) => Number(b).toString(16).padStart(2, '0')).join('');
      }
      return bytesVal.toString();
    }
    return String(bytesVal);
  }
};

export const deriveEncryptionKey = async (zkPrivateKeyHex: string): Promise<CryptoKey> => {
  const rawKeyMaterial = new TextEncoder().encode(zkPrivateKeyHex);
  const baseKey = await webCrypto.subtle.importKey(
    'raw',
    rawKeyMaterial,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  );
  
  return await webCrypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt: new TextEncoder().encode('stellar-whisper-salt'),
      info: new TextEncoder().encode('note-encryption'),
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

export const encryptNote = async (zkPrivateKeyHex: string, noteData: object): Promise<string> => {
  const key = await deriveEncryptionKey(zkPrivateKeyHex);
  const iv = webCrypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(noteData));
  
  const ciphertextBuffer = await webCrypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );
  
  const ciphertextBytes = new Uint8Array(ciphertextBuffer);
  const combined = new Uint8Array(iv.length + ciphertextBytes.length);
  combined.set(iv, 0);
  combined.set(ciphertextBytes, iv.length);
  
  return Array.from(combined).map(b => b.toString(16).padStart(2, '0')).join('');
};

export const decryptNote = async (zkPrivateKeyHex: string, hexCiphertext: string): Promise<any | null> => {
  try {
    const key = await deriveEncryptionKey(zkPrivateKeyHex);
    const bytes = new Uint8Array(hexCiphertext.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hexCiphertext.slice(i * 2, i * 2 + 2), 16);
    }
    
    const iv = bytes.slice(0, 12);
    const ciphertext = bytes.slice(12);
    
    const decryptedBuffer = await webCrypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    
    const plaintext = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(plaintext);
  } catch (e) {
    return null;
  }
};
