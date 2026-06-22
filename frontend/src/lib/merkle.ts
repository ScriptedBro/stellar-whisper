import { hashOnChain } from './crypto';

export const getOnChainZeroHash = (level: number): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes[0] = level;
  return bytes;
};

export const computeLatestMerkleRootOnChain = async (allCommitmentsBytes: Uint8Array[]): Promise<string> => {
  const TREE_DEPTH = 16;
  
  let filledSubtrees: Uint8Array[] = [];
  for (let i = 0; i < TREE_DEPTH; i++) {
    filledSubtrees.push(getOnChainZeroHash(i));
  }
  
  let latestRoot = getOnChainZeroHash(TREE_DEPTH);
  
  for (let nextIndex = 0; nextIndex < allCommitmentsBytes.length; nextIndex++) {
    let currentLevelHash = allCommitmentsBytes[nextIndex];
    let index = nextIndex;
    
    for (let i = 0; i < TREE_DEPTH; i++) {
      if (index % 2 === 1) {
        const left = filledSubtrees[i];
        currentLevelHash = await hashOnChain(left, currentLevelHash);
      } else {
        filledSubtrees[i] = currentLevelHash;
        const right = getOnChainZeroHash(i);
        currentLevelHash = await hashOnChain(currentLevelHash, right);
      }
      index = Math.floor(index / 2);
    }
    latestRoot = currentLevelHash;
  }
  
  return Array.from(latestRoot).map(b => b.toString(16).padStart(2, '0')).join('');
};
 
/**
 * Recursively computes the root hash of a subtree.
 * Short-circuits to the pre-computed zero hash when the entire subtree
 * is beyond the active commitment range — this is the key optimization
 * that makes path construction O(log N) for sparse trees.
 */
const computeSubtreeRoot = async (
  commitments: Uint8Array[],
  level: number,
  leafStart: number,
  zeroHashes: Uint8Array[]
): Promise<Uint8Array> => {
  // If the entire subtree is beyond active commitments, return zero hash
  if (leafStart >= commitments.length) {
    return zeroHashes[level];
  }

  // Base case: leaf level
  if (level === 0) {
    return commitments[leafStart];
  }

  // Recurse into left and right children
  const halfSize = 1 << (level - 1);
  const left = await computeSubtreeRoot(commitments, level - 1, leafStart, zeroHashes);
  const right = await computeSubtreeRoot(commitments, level - 1, leafStart + halfSize, zeroHashes);
  return hashOnChain(left, right);
};

/**
 * Constructs a Merkle path for a given leaf index in O(log N) for typical cases.
 *
 * Instead of rebuilding every node at each tree level (O(N·depth)), this function
 * computes only the sibling subtree roots along the authentication path. Subtrees
 * that are entirely empty (all leaf indices >= number of active commitments)
 * short-circuit to pre-computed zero hashes, avoiding any hash computation.
 */
export const constructMerklePath = async (
  allCommitmentsBytes: Uint8Array[], 
  leafIndex: number
): Promise<{ merklePath: Uint8Array[], merkleIndex: number }> => {
  const TREE_DEPTH = 16;
  
  // Pre-compute zero hashes for each level (matching contract's get_zero_hash)
  const zeroHashes: Uint8Array[] = [];
  for (let i = 0; i < TREE_DEPTH; i++) {
    zeroHashes.push(getOnChainZeroHash(i));
  }
  
  const merklePath: Uint8Array[] = [];
  let currentIdx = leafIndex;
  
  for (let level = 0; level < TREE_DEPTH; level++) {
    const siblingIdx = currentIdx % 2 === 1 ? currentIdx - 1 : currentIdx + 1;

    // The sibling node at this level covers 2^level leaves
    // starting at siblingIdx * 2^level
    const subtreeLeafStart = siblingIdx << level;

    // Compute the sibling's subtree root (short-circuits if empty)
    const siblingHash = await computeSubtreeRoot(
      allCommitmentsBytes, level, subtreeLeafStart, zeroHashes
    );
    merklePath.push(siblingHash);

    currentIdx = Math.floor(currentIdx / 2);
  }
  
  return {
    merklePath,
    merkleIndex: leafIndex
  };
};
