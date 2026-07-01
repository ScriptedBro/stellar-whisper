# Project Overview

## What is Stellar Whisper?

Stellar Whisper is a **compliance-first, fully shielded wallet and remittance application** for stablecoins (USDC/EURC) on the Stellar network. It integrates off-chain zero-knowledge cryptography (Noir/UltraHonk) with on-chain Soroban smart contract verification to enable private stablecoin transfers while maintaining institutional-grade compliance (OFAC sanctions screening, audit-ready viewing keys).

## The Problem

Stablecoin adoption is accelerating globally, but two competing forces create tension:

1. **Privacy**: Businesses and individuals need to protect sensitive financial data — transaction amounts, counterparties, wallet balances — from public exposure on transparent ledgers
2. **Compliance**: Regulators mandate sanctions screening (OFAC), anti-money laundering (AML) monitoring, and auditable transaction trails

Existing solutions force a compromise: public chains like Stellar expose all transaction details, while fully anonymous mixers (Tornado Cash) are non-compliant and attract regulatory action.

## The Solution

Stellar Whisper resolves this paradox with a **Three-Key Cryptographic Model**:

| Key | Derivation | Purpose | Sharing Model |
|-----|-----------|---------|---------------|
| **ZK Spending Key** (sk) | SHA-256(Ed25519 signature) | Signs ZK proofs for transfers | Never leaves browser |
| **ZK Public Key** (pk) | Poseidon(sk) | Pseudonymous identity in pool | Embedded in commitments (on-chain) |
| **Viewing Key** (vk) | SHA-256("viewing_key:" + sk) | Decrypts note metadata for audit | Shareable with auditors |

This design splits **spending authority** from **audit access**, allowing selective disclosure without compromising fund control.

## Key Features

- **Multi-Asset Shielded Pools**: USDC and XLM within a single contract
- **Browser-Based ZK Proving**: UltraHonk proofs via WebAssembly (private keys never leave device)
- **Double-Spend Protection**: Deterministic nullifier hashes recorded on-chain
- **Cryptographic Value Conservation**: Circuit enforces input = output (no fund creation/destruction)
- **On-Chain OFAC Screening**: Sanctions checking on deposit and withdrawal
- **Hybrid AMM**: Public liquidity + private swap execution
- **Gasless Relaying**: OpenZeppelin Stellar Channels for sponsored transactions
- **Decentralized Note Recovery**: Scan-and-decrypt from chain events using viewing key

## Project Status

This is a **hackathon prototype**. All 18 smart contract tests pass. The full proving pipeline works end-to-end: client-side witness generation → UltraHonk proof → Soroban verification → state update. Professional security audit required before production deployment.
