# Stellar Whisper: Cryptographic & System Architecture

Stellar Whisper is a compliance-first, fully shielded stablecoin wallet and remittance corridor built on the Stellar network. It utilizes off-chain zero-knowledge proof generation and on-chain verification via Soroban smart contracts to allow users to shield balances, perform private transfers, and generate cryptographic compliance reports.

> **See also:** [docs/OVERVIEW.md](./docs/OVERVIEW.md) for a project overview, [docs/CIRCUITS.md](./docs/CIRCUITS.md) for circuit details, and [docs/SMART_CONTRACTS.md](./docs/SMART_CONTRACTS.md) for the full contract API reference.

---

## 1. Cryptographic Primitives & Parameters

Stellar Whisper employs a customized zero-knowledge architecture tailored to the performance constraints of blockchain networks and client-side execution.

### Parameters
*   **Curve**: BN254 (alt_bn128) scalar field $\mathbb{F}_r$, matching the native elliptic curve support introduced in Stellar Protocol 26.
*   **Hash Function**: Poseidon Hashing. Poseidon is a ZK-friendly hash function utilizing sponge constructions. It requires significantly fewer constraints (approx. 200–300 constraints per hash) than SHA-256 (approx. 20,000 constraints).
    *   **2-to-1 compression**: Used for note commitment derivation and Merkle tree nodes ($\text{Poseidon}(L, R)$).
    *   **1-to-1 compression**: Used for key derivation.
*   **Merkle Tree**:
    *   **Depth**: 16 levels.
    *   **Capacity**: $2^{16} = 65,536$ notes.
    *   **Nullifier Space**: Tracked on-chain as a spent list to prevent double spending.
*   **Proving System**: Noir DSL compiled to an **UltraHonk** proving system. UltraHonk leverages:
    *   Custom gates and lookups (via UltraPlonk style constraints).
    *   Sumcheck protocol for multivariate polynomial relation verification.
    *   Shplemini/Gemini polynomial commitment opening scheme.
    *   KZG pairing check over BN254.

---

## 2. Note and Key Derivation

```
               [ User Secret Key (32 bytes) ]
                            │
                            ├──────────────────────────┐
                            ▼                          ▼
               [ ZK Private Key (32 bytes) ]   [ Viewing Key (32 bytes) ]
                            │
                            ▼
               [ ZK Public Key (32 bytes) ]
```

### Key Derivation
1.  **ZK Private Key ($sk_{zk}$)**: A 32-byte secret key kept locally in client memory.
2.  **ZK Public Key ($pk_{zk}$)**: Derived by hashing the private key:
    $$pk_{zk} = \text{Poseidon}(sk_{zk})$$
3.  **Viewing Key ($vk_{view}$)**: An independent key used for note decryption and auditing, derived client-side via a separate hashing routine from the master seed:
    $$vk_{view} = \text{Poseidon}(sk_{zk} + \text{Salt})$$

### Note Commitment
A private note represents an unspent output (UTXO) containing a balance. It is defined by the tuple:
$$\text{Note} = (\text{Amount}, \text{Nullifier Nonce})$$

To commit this note to the public Merkle tree without revealing its properties, we derive a note commitment ($C$):
1.  **Salted Amount**:
    $$\text{SaltedAmount} = \text{Poseidon}(\text{Amount}, \text{Nullifier Nonce})$$
2.  **Commitment ($C$)**:
    $$C = \text{Poseidon}(pk_{zk}, \text{SaltedAmount})$$

This double-hash structure ensures:
*   **Unique commitments**: Even if two users deposit the same amount, their commitments are unique due to the random 32-byte `Nullifier Nonce`.
*   **Information hiding**: A public observer cannot guess the owner ($pk_{zk}$) or the value ($\text{Amount}$) of the note.

### Nullifier Derivation
To spend a note, the user must reveal its nullifier hash ($H_{null}$), which is recorded on-chain. This nullifier is derived deterministically from the private key and the note's nonce:
$$H_{null} = \text{Poseidon}(sk_{zk}, \text{Nullifier Nonce})$$

*   Since $sk_{zk}$ is private, observers cannot link $H_{null}$ to the original commitment $C$.
*   Since $H_{null}$ is deterministic, trying to spend the same note twice will result in the same $H_{null}$, which the smart contract rejects.

---

## 3. ZK Circuit Specification (`circuits/whisper/src/main.nr`)

The Noir circuit validates the correctness of the value transfer and membership proofs.

### Circuit Inputs
| Type | Parameter | Size | Description |
| :--- | :--- | :---: | :--- |
| **Private** | `secret_key` | `[u8; 32]` | Sender's ZK private key ($sk_{zk}$). |
| **Private** | `nullifier_nonce` | `[u8; 32]` | Nonce of the note being spent. |
| **Private** | `merkle_path` | `[[u8; 32]; 16]` | Sibling hashes up the Merkle tree. |
| **Private** | `merkle_index` | `u32` | Binary index of the leaf in the Merkle tree. |
| **Private** | `recipient_pubkey` | `[u8; 32]` | Target ZK public key (for private transfer). |
| **Private** | `recipient_amount` | `[u8; 32]` | Amount sent to the recipient. |
| **Private** | `recipient_nonce` | `[u8; 32]` | Nonce for the recipient's new note. |
| **Private** | `change_pubkey` | `[u8; 32]` | Sender's ZK public key (for change). |
| **Private** | `change_amount` | `[u8; 32]` | Change amount returned to sender. |
| **Private** | `change_nonce` | `[u8; 32]` | Nonce for the change note. |
| **Public** | `merkle_root` | `[u8; 32]` | The current state root of the pool. |
| **Public** | `nullifier_hash` | `[u8; 32]` | Deterministic nullifier hash to mark note spent. |
| **Public** | `input_amount` | `[u8; 32]` | Value of the note being spent. |
| **Public** | `public_withdraw_amount`| `[u8; 32]` | Value withdrawn back to a public address. |
| **Public** | `public_recipient_hash` | `[u8; 32]` | SHA-256 hash of the public recipient address. |
| **Public** | `output_commitment_1` | `[u8; 32]` | Commitment hash of the recipient's note. |
| **Public** | `output_commitment_2` | `[u8; 32]` | Commitment hash of the change note. |

### Constraints & Assertions
1.  **Ownership Check**: Derives public key $pk_{zk} = \text{Poseidon}(sk_{zk})$ and validates that the spent note commitment matches $pk_{zk}$ and the private `input_amount`/`nullifier_nonce`.
2.  **Nullifier Integrity**: Asserts that the public input `nullifier_hash` matches $\text{Poseidon}(sk_{zk}, \text{nullifier_nonce})$.
3.  **Membership Verification**: Reconstructs the Merkle path from the spent commitment to the root using the binary index:
    $$\text{computed\_root} = \text{MerklePathVerify}(C, \text{merkle\_path}, \text{merkle\_index})$$
    Assures $\text{computed\_root} == \text{merkle\_root}$.
4.  **Value Conservation**:
    $$\text{input\_amount} == \text{public\_withdraw\_amount} + \text{recipient\_amount} + \text{change\_amount}$$
5.  **Output Commitment Verification**:
    *   If `recipient_amount` > 0, verifies `output_commitment_1` is $\text{Poseidon}(recipient\_pubkey, \text{Poseidon}(recipient\_amount, recipient\_nonce))$.
    *   If `change_amount` > 0, verifies `output_commitment_2` is $\text{Poseidon}(change\_pubkey, \text{Poseidon}(change\_amount, change\_nonce))$.

---

## 4. Soroban Contracts Logic

```
        ┌─────────────────────────────────────────────────────────┐
        │                 Soroban Pool Contract                   │
        │                                                         │
        │  ┌───────────┐      Verify Proof      ┌──────────────┐  │
        │  │  deposit  │ ─────────────────────> │  verify_zk   │  │
        │  └───────────┘                        └──────────────┘  │
        │        │                                     ▲          │
        │        ▼                                     │          │
        │  ┌───────────┐      Invoke Verifier          │          │
        │  │  transfer │ ──────────────────────────────┘          │
        │  └───────────┘                                          │
        └─────────────────────────────────────────────────────────┘
```

The system is decoupled into two smart contracts to isolate proving keys and tree state:

### A. The Verifier Contract (`contracts/verifier`)
The verifier contract is auto-generated by the Barretenberg compiler but optimized for Soroban host execution. It executes:
1.  **Proof Parsing**: Validates that the raw proof bytes are structural and within safe boundaries (between 200 bytes and 16,000 bytes).
2.  **Public Inputs Formatting**: Unpacks the 8 public inputs (`merkle_root`, `nullifier_hash`, `input_amount`, `public_withdraw_amount`, `public_recipient_hash`, `output_commitment_1`, `output_commitment_2`, `asset_id`) into 32-byte scalar field representations.
3.  **Sumcheck Protocol**: Validates the multivariate sumcheck relations.
4.  **Pairing Verification**: Executes Gemini/Shplonk batch opening and KZG pairing checks using Soroban's native BN254 host operations.

### B. The Shielded Pool Contract (`contracts/whisper`)
Maintains the Merkle tree state, tracks spent nullifiers, verifies proof bindings, and manages token transfers.

*   **State Tree Storage**:
    To avoid expensive storage reads of the entire tree on every transaction, the contract maintains:
    *   `NextIndex`: The leaf index of the next deposit.
    *   `FilledSubtrees`: A list of the boundary nodes at each level of the tree.
*   **Binding Verification**:
    To prevent "proof stealing" or front-running (where an attacker intercepts a valid proof and submits it with a different recipient), the contract validates:
    *   `public_recipient_hash == SHA-256(recipient_address_XDR)`
    *   `public_withdraw_amount == amount`
    *   `output_commitment_1 == new_commitments[0]`
    *   `output_commitment_2 == new_commitments[1]`

---

## 5. Client-Side Proving Pipeline

To maintain zero-knowledge guarantees, no private parameters (private keys, amounts, nonces) are ever shared with an RPC node or database. Proof generation is executed locally inside the user's browser:

1.  **Witness Construction**: The frontend gathers notes from localStorage and queries the off-chain indexer to get the Merkle paths.
2.  **WASM Execution**: The web app loads the compiled circuit bytecode (`whisper.json`) and invokes the Aztec `@aztec/bb.js` WebAssembly module.
3.  **Prover Pipeline**:
    *   Compiles the witness variables.
    *   Performs Multi-Scalar Multiplication (MSM) in WebAssembly.
    *   Outputs a serialized UltraHonk proof binary.
4.  **Transaction Submission**: The frontend packages the proof binary, the public inputs array, and the recipient address into a Soroban transaction using `@stellar/stellar-sdk` and broadcasts it.

---

## 6. Compliance-First Architecture

Stellar Whisper implements a dual-layer compliance model to solve the traditional privacy-compliance paradox:

```
[ Deposit / Shield ] ──► [ Check On-Chain OFAC Sanction List ] ──► [ Shielded Pool ]
                                                                        │
                                                                 (Viewing Key)
                                                                        │
                                                                        ▼
                                                             [ ZK Compliance Report ]
                                                             - OFAC Non-membership
                                                             - Transaction History
```

1.  **On-Chain Screening**:
    *   The pool contract checks deposits and withdrawals against a sanctioned address registry (`is_sanctioned`).
    *   Sanction status can be updated instantly by the admin or delegated to off-chain compliance providers (e.g., Elliptic, Chainalysis) via signed oracle authorizations using Ed25519 signature checks.
2.  **Zero-Knowledge Disclosures**:
    *   A viewing key ($vk_{view}$) is shared selectively with tax authorities or compliance officers.
    *   The viewing key decrypts the user's encrypted note logs stored in the event history without giving control over the funds.
    *   The compliance panel generates a cryptographic attestation proving the origin and destination paths are clean without exposing other pool activities.

---

## 7. Hybrid Public-Private Liquidity Pools (Path 1)

Stellar Whisper implements a hybrid design where standard public automated market maker (AMM) reserves are integrated with private shielded transactions to enable privacy-preserving asset swaps.

### Architecture Topology
1. **Public LP Layer**: Liquidity providers add and withdraw assets (USDC and native wrapped XLM) to the contract reserves publicly. The reserves and total issued LP shares are stored in public contract instance storage (`ReserveA`, `ReserveB`, `TotalLpShares`) and LP share records are managed on-chain (`LpShares(Address)`).
2. **Private Swap Layer**: Traders execute swaps using an Aztec UltraHonk spend proof. The input note of Asset A is spent privately, while the contract routes the swap against the public reserves to mint a new private note of Asset B for the trader.

```mermaid
graph TD;
    Alice[Trader (Private)] -- spends private note A --> Contract[Whisper Contract];
    Contract -- updates reserves publicly --> AMM[Public AMM Reserves];
    AMM -- returns swap output --> Contract;
    Contract -- mints private note B --> Bob[Trader/Recipient (Private)];
```

### Constant Product Math
The contract executes a constant product AMM swap ($x \cdot y = k$) with a `0.3%` fee protocol:
$$\Delta y = \frac{y \cdot (\Delta x \cdot 997)}{(x \cdot 1000) + (\Delta x \cdot 997)}$$
Where:
- $\Delta x$ is the swap amount in (Asset A/USDC).
- $\Delta y$ is the swap amount out (Asset B/XLM).
- $x$ and $y$ are the pool reserves of Asset A and Asset B.

### Input/Output Commitment Coupling
During a shielded swap, the circuit ensures that value conservation holds, and the contract derivations are tied as follows:
- **Nullifier Verification**: The input note commitment of Asset A is spent and marked spent via its nullifier hash.
- **On-chain Derivation**: The contract executes the AMM math on-chain to determine the exact output amount ($\Delta y$) based on the public reserves. It then derives the output commitment for Asset B using the modulo-reduced Poseidon hash over the trader's ZK public key and the calculated output amount:
  $$\text{commitment\_b} = \text{Poseidon}(pk_{zk}, \text{Poseidon}(\Delta y, nonce, asset\_id\_b))$$
- **Root Update**: The newly derived output commitment is automatically inserted as a leaf into the Merkle tree.

