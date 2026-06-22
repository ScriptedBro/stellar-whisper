import type { Config } from '../types';
import deployedConfig from './deployed.json';

export const SANCTIONED_ADDRESSES = [
  "GBOFACBLOCKLIST1111111111111111111111111111111111111111",
  "GCONGRESSBLOCKLIST222222222222222222222222222222222222",
  "GBLOCKLISTEXPLOTER33333333333333333333333333333333333"
];

const FALLBACK_CONFIG: Config = {
  network: import.meta.env.VITE_NETWORK || 'testnet',
  adminAddress: import.meta.env.VITE_ADMIN_ADDRESS || 'GD42PB2CL44DBKQUMM7Q2I7AHVOXVTZOVQCC4ZYRGONHSZKLISA6WQMD',
  tokenContractId: import.meta.env.VITE_TOKEN_CONTRACT_ID || 'CCD7B5ENZPTMYOB7XZ6VYLCABAQ66TB4UY5BEAQWCZMHMNAXPWKBKXYR',
  verifierContractId: import.meta.env.VITE_VERIFIER_CONTRACT_ID || 'CDQQWLRSFFRXQBJJYJXCBNPUB4D6SMJ3CZDAYOK3JBZTUHNHX3E56AJG',
  whisperContractId: import.meta.env.VITE_WHISPER_CONTRACT_ID || 'CDWS5RT54SO4DZZIEDITZJOO4P5CZJCBQZRQXZE33K5QTNLVXAZVSQJH'
};

export const DEFAULT_CONFIG: Config = {
  network: import.meta.env.VITE_NETWORK || deployedConfig.network || FALLBACK_CONFIG.network,
  adminAddress: import.meta.env.VITE_ADMIN_ADDRESS || deployedConfig.adminAddress || FALLBACK_CONFIG.adminAddress,
  tokenContractId: import.meta.env.VITE_TOKEN_CONTRACT_ID || deployedConfig.tokenContractId || FALLBACK_CONFIG.tokenContractId,
  verifierContractId: import.meta.env.VITE_VERIFIER_CONTRACT_ID || deployedConfig.verifierContractId || FALLBACK_CONFIG.verifierContractId,
  whisperContractId: import.meta.env.VITE_WHISPER_CONTRACT_ID || deployedConfig.whisperContractId || FALLBACK_CONFIG.whisperContractId
};
