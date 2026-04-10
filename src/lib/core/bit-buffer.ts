export class BitBuffer {
  private readonly bits: number[] = [];

  append(value: number, bitCount: number): void {
    if (bitCount < 0 || bitCount > 31) {
      throw new Error(`Bit count must be between 0 and 31. Received ${bitCount}.`);
    }
    for (let i = bitCount - 1; i >= 0; i -= 1) {
      this.bits.push((value >>> i) & 1);
    }
  }

  appendBits(bits: ReadonlyArray<number>): void {
    for (const bit of bits) {
      this.bits.push(bit ? 1 : 0);
    }
  }

  appendBytes(bytes: Uint8Array): void {
    for (const value of bytes) {
      this.append(value, 8);
    }
  }

  get bitLength(): number {
    return this.bits.length;
  }

  getByte(index: number): number {
    let value = 0;
    for (let i = 0; i < 8; i += 1) {
      value = (value << 1) | (this.bits[index * 8 + i] ?? 0);
    }
    return value;
  }

  toUint8Array(): Uint8Array {
    const byteLength = Math.ceil(this.bits.length / 8);
    const bytes = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i += 1) {
      bytes[i] = this.getByte(i);
    }
    return bytes;
  }
}
