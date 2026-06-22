declare module '@iden3/js-crypto' {
  export const poseidon: {
    hash(inputs: bigint[]): bigint;
    hashBytes(msg: Uint8Array): bigint;
    hashBytesX(msg: Uint8Array, frameSize: number): bigint;
    spongeHashX(inputs: bigint[], frameSize: number): bigint;
  };
}
