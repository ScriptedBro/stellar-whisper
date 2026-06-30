import { hashOnChain } from './crypto';

export const getOnChainZeroHash = (_level: number): Uint8Array => {
  const bytes = new Uint8Array(32);
  return bytes;
};

const zeroHashCache = new Map<number, Uint8Array>();
let zeroHashCacheInitialized = false;

const ZERO_LEAF = new Uint8Array(32);

const ensureZeroHashes = async (): Promise<Uint8Array[]> => {
  if (zeroHashCacheInitialized) {
    const result: Uint8Array[] = [];
    for (let i = 0; i <= 16; i++) {
      result.push(zeroHashCache.get(i)!);
    }
    return result;
  }
  const zeroHashes: Uint8Array[] = [ZERO_LEAF];
  zeroHashCache.set(0, ZERO_LEAF);
  for (let i = 1; i <= 16; i++) {
    const prev = zeroHashes[i - 1];
    const zh = await hashOnChain(prev, prev);
    zeroHashes.push(zh);
    zeroHashCache.set(i, zh);
  }
  zeroHashCacheInitialized = true;
  return zeroHashes;
};

export const computeLatestMerkleRootOnChain = async (allCommitmentsBytes: Uint8Array[]): Promise<string> => {
  const TREE_DEPTH = 16;
  const zeroHashes = await ensureZeroHashes();

  let filledSubtrees: Uint8Array[] = [];
  for (let i = 0; i < TREE_DEPTH; i++) {
    filledSubtrees.push(zeroHashes[i]);
  }

  let latestRoot = zeroHashes[TREE_DEPTH];

  for (let nextIndex = 0; nextIndex < allCommitmentsBytes.length; nextIndex++) {
    let currentLevelHash = allCommitmentsBytes[nextIndex];
    let index = nextIndex;

    for (let i = 0; i < TREE_DEPTH; i++) {
      if (index % 2 === 1) {
        const left = filledSubtrees[i];
        currentLevelHash = await hashOnChain(left, currentLevelHash);
      } else {
        filledSubtrees[i] = currentLevelHash;
        const right = zeroHashes[i];
        currentLevelHash = await hashOnChain(currentLevelHash, right);
      }
      index = Math.floor(index / 2);
    }
    latestRoot = currentLevelHash;
  }

  return Array.from(latestRoot).map(b => b.toString(16).padStart(2, '0')).join('');
};

const computeSubtreeRoot = async (
  commitments: Uint8Array[],
  level: number,
  leafStart: number,
  zeroHashes: Uint8Array[]
): Promise<Uint8Array> => {
  if (leafStart >= commitments.length) {
    return zeroHashes[level];
  }

  if (level === 0) {
    return commitments[leafStart];
  }

  const halfSize = 1 << (level - 1);
  const left = await computeSubtreeRoot(commitments, level - 1, leafStart, zeroHashes);
  const right = await computeSubtreeRoot(commitments, level - 1, leafStart + halfSize, zeroHashes);
  return hashOnChain(left, right);
};

export const constructMerklePath = async (
  allCommitmentsBytes: Uint8Array[],
  leafIndex: number
): Promise<{ merklePath: Uint8Array[], merkleIndex: number }> => {
  const TREE_DEPTH = 16;
  const zeroHashes = await ensureZeroHashes();

  const merklePath: Uint8Array[] = [];
  let currentIdx = leafIndex;

  for (let level = 0; level < TREE_DEPTH; level++) {
    const siblingIdx = currentIdx % 2 === 1 ? currentIdx - 1 : currentIdx + 1;
    const subtreeLeafStart = siblingIdx << level;
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
