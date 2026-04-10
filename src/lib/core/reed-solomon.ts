import { gfDiv, gfInverse, gfMul, gfPow, polyEvalAscending, polyEvalDescending } from './gf256';

const GENERATOR_CACHE = new Map<number, Uint8Array>();

function makeGeneratorPolynomial(degree: number): Uint8Array {
  const cached = GENERATOR_CACHE.get(degree);
  if (cached) {
    return cached;
  }

  let polynomial = new Uint8Array([1]);
  for (let i = 0; i < degree; i += 1) {
    const next = new Uint8Array(polynomial.length + 1);
    const factor = gfPow(2, i);
    for (let j = 0; j < polynomial.length; j += 1) {
      next[j] ^= polynomial[j];
      next[j + 1] ^= gfMul(polynomial[j], factor);
    }
    polynomial = next;
  }

  GENERATOR_CACHE.set(degree, polynomial);
  return polynomial;
}

export function encodeReedSolomon(data: Uint8Array, ecCodewords: number): Uint8Array {
  const generator = makeGeneratorPolynomial(ecCodewords);
  const buffer = new Uint8Array(data.length + ecCodewords);
  buffer.set(data);

  for (let i = 0; i < data.length; i += 1) {
    const factor = buffer[i];
    if (factor === 0) {
      continue;
    }
    for (let j = 1; j < generator.length; j += 1) {
      buffer[i + j] ^= gfMul(generator[j], factor);
    }
  }

  return buffer.slice(data.length);
}

function computeSyndromes(codewords: Uint8Array, ecCodewords: number): Uint8Array {
  const syndromes = new Uint8Array(ecCodewords);
  for (let i = 0; i < ecCodewords; i += 1) {
    syndromes[i] = polyEvalDescending(codewords, gfPow(2, i));
  }
  return syndromes;
}

function isAllZero(values: Uint8Array): boolean {
  return values.every((value) => value === 0);
}

function berlekampMassey(syndromes: Uint8Array): number[] {
  let current = [1];
  let previous = [1];
  let currentDegree = 0;
  let shift = 1;
  let lastDiscrepancy = 1;

  for (let n = 0; n < syndromes.length; n += 1) {
    let discrepancy = syndromes[n];
    for (let i = 1; i <= currentDegree; i += 1) {
      discrepancy ^= gfMul(current[i] ?? 0, syndromes[n - i]);
    }

    if (discrepancy === 0) {
      shift += 1;
      continue;
    }

    const previousSnapshot = current.slice();
    const scale = gfDiv(discrepancy, lastDiscrepancy);
    const requiredLength = Math.max(current.length, previous.length + shift);
    while (current.length < requiredLength) {
      current.push(0);
    }
    for (let i = 0; i < previous.length; i += 1) {
      current[i + shift] ^= gfMul(scale, previous[i]);
    }

    if (2 * currentDegree <= n) {
      currentDegree = n + 1 - currentDegree;
      previous = previousSnapshot;
      lastDiscrepancy = discrepancy;
      shift = 1;
    } else {
      shift += 1;
    }
  }

  return current.slice(0, currentDegree + 1);
}

function findErrorPositions(locator: ReadonlyArray<number>, codewordLength: number): number[] | null {
  const positions: number[] = [];
  for (let i = 0; i < codewordLength; i += 1) {
    const x = gfPow(2, 255 - i);
    if (polyEvalAscending(locator, x) === 0) {
      positions.push(codewordLength - 1 - i);
    }
  }
  return positions.length === locator.length - 1 ? positions : null;
}

function solveForMagnitudes(syndromes: Uint8Array, positions: ReadonlyArray<number>, codewordLength: number): number[] | null {
  const size = positions.length;
  if (size === 0) {
    return [];
  }

  const matrix: number[][] = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => {
      const locator = gfPow(2, codewordLength - 1 - positions[column]);
      return row === 0 ? 1 : gfPow(locator, row);
    }),
  );
  const vector = Array.from({ length: size }, (_, index) => syndromes[index]);

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    while (pivotRow < size && matrix[pivotRow][column] === 0) {
      pivotRow += 1;
    }
    if (pivotRow === size) {
      return null;
    }
    if (pivotRow !== column) {
      [matrix[column], matrix[pivotRow]] = [matrix[pivotRow], matrix[column]];
      [vector[column], vector[pivotRow]] = [vector[pivotRow], vector[column]];
    }

    const pivotInverse = gfInverse(matrix[column][column]);
    for (let c = column; c < size; c += 1) {
      matrix[column][c] = gfMul(matrix[column][c], pivotInverse);
    }
    vector[column] = gfMul(vector[column], pivotInverse);

    for (let row = 0; row < size; row += 1) {
      if (row === column || matrix[row][column] === 0) {
        continue;
      }
      const factor = matrix[row][column];
      for (let c = column; c < size; c += 1) {
        matrix[row][c] ^= gfMul(factor, matrix[column][c]);
      }
      vector[row] ^= gfMul(factor, vector[column]);
    }
  }

  return vector;
}

export function decodeReedSolomon(codewords: Uint8Array, ecCodewords: number): Uint8Array | null {
  const corrected = Uint8Array.from(codewords);
  const syndromes = computeSyndromes(corrected, ecCodewords);
  if (isAllZero(syndromes)) {
    return corrected;
  }

  const locator = berlekampMassey(syndromes);
  const positions = findErrorPositions(locator, corrected.length);
  if (!positions) {
    return null;
  }

  const magnitudes = solveForMagnitudes(syndromes, positions, corrected.length);
  if (!magnitudes) {
    return null;
  }

  for (let i = 0; i < positions.length; i += 1) {
    corrected[positions[i]] ^= magnitudes[i];
  }

  return isAllZero(computeSyndromes(corrected, ecCodewords)) ? corrected : null;
}
