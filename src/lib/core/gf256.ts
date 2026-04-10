const PRIMITIVE = 0x11d;
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);

let value = 1;
for (let i = 0; i < 255; i += 1) {
  EXP_TABLE[i] = value;
  LOG_TABLE[value] = i;
  value <<= 1;
  if (value & 0x100) {
    value ^= PRIMITIVE;
  }
}
for (let i = 255; i < EXP_TABLE.length; i += 1) {
  EXP_TABLE[i] = EXP_TABLE[i - 255];
}

export function gfAdd(left: number, right: number): number {
  return left ^ right;
}

export function gfMul(left: number, right: number): number {
  if (left === 0 || right === 0) {
    return 0;
  }
  return EXP_TABLE[LOG_TABLE[left] + LOG_TABLE[right]];
}

export function gfDiv(left: number, right: number): number {
  if (right === 0) {
    throw new Error('Division by zero in GF(256).');
  }
  if (left === 0) {
    return 0;
  }
  let index = LOG_TABLE[left] - LOG_TABLE[right];
  if (index < 0) {
    index += 255;
  }
  return EXP_TABLE[index];
}

export function gfPow(valueToRaise: number, power: number): number {
  if (power === 0) {
    return 1;
  }
  if (valueToRaise === 0) {
    return 0;
  }
  let exponent = (LOG_TABLE[valueToRaise] * power) % 255;
  if (exponent < 0) {
    exponent += 255;
  }
  return EXP_TABLE[exponent];
}

export function gfInverse(valueToInvert: number): number {
  if (valueToInvert === 0) {
    throw new Error('Cannot invert zero in GF(256).');
  }
  return EXP_TABLE[255 - LOG_TABLE[valueToInvert]];
}

export function polyEvalDescending(poly: ArrayLike<number>, x: number): number {
  let result = 0;
  for (let index = 0; index < poly.length; index += 1) {
    result = gfMul(result, x) ^ poly[index];
  }
  return result;
}

export function polyEvalAscending(poly: ArrayLike<number>, x: number): number {
  let result = 0;
  for (let i = poly.length - 1; i >= 0; i -= 1) {
    result = gfMul(result, x) ^ poly[i];
  }
  return result;
}
