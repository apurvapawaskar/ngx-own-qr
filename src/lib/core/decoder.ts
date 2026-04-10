import { applyMaskPattern, createMatrix, drawFunctionPatterns } from './encoder';
import { getAlignmentPatternPositions, getAllErrorCorrectionLevels, getVersionInfo } from './qr-tables';
import { decodeReedSolomon } from './reed-solomon';
import type {
  QrCornerPoint,
  QrErrorCorrectionLevel,
  QrImageDataLike,
  QrScanOptions,
  QrScanResult,
} from './types';

interface Point {
  x: number;
  y: number;
}

interface FinderCandidate extends Point {
  moduleSize: number;
  count: number;
}

interface FinderTriple {
  topLeft: FinderCandidate;
  topRight: FinderCandidate;
  bottomLeft: FinderCandidate;
  moduleSize: number;
  dimension: number;
  version: number;
}

interface SampledMatrix {
  modules: boolean[][];
  corners: [QrCornerPoint, QrCornerPoint, QrCornerPoint, QrCornerPoint];
  version: number;
}

function toGrayscale(imageData: QrImageDataLike): Uint8ClampedArray {
  const grayscale = new Uint8ClampedArray(imageData.width * imageData.height);
  for (let i = 0; i < grayscale.length; i += 1) {
    const offset = i * 4;
    grayscale[i] = Math.round(
      imageData.data[offset] * 0.299 +
      imageData.data[offset + 1] * 0.587 +
      imageData.data[offset + 2] * 0.114,
    );
  }
  return grayscale;
}

function binarize(grayscale: Uint8ClampedArray, width: number, height: number, invert = false): Uint8Array {
  const blockSize = 8;
  const blocksX = Math.ceil(width / blockSize);
  const blocksY = Math.ceil(height / blockSize);
  const thresholds = new Uint8ClampedArray(blocksX * blocksY);

  for (let blockY = 0; blockY < blocksY; blockY += 1) {
    for (let blockX = 0; blockX < blocksX; blockX += 1) {
      let min = 255;
      let max = 0;
      let sum = 0;
      let count = 0;
      for (let y = blockY * blockSize; y < Math.min(height, (blockY + 1) * blockSize); y += 1) {
        for (let x = blockX * blockSize; x < Math.min(width, (blockX + 1) * blockSize); x += 1) {
          const value = grayscale[y * width + x];
          min = Math.min(min, value);
          max = Math.max(max, value);
          sum += value;
          count += 1;
        }
      }
      const average = Math.floor(sum / Math.max(count, 1));
      thresholds[blockY * blocksX + blockX] = max - min > 24 ? Math.floor((min + max) / 2) : average;
    }
  }

  const binary = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const blockY = Math.min(blocksY - 1, Math.floor(y / blockSize));
    for (let x = 0; x < width; x += 1) {
      const blockX = Math.min(blocksX - 1, Math.floor(x / blockSize));
      const threshold = thresholds[blockY * blocksX + blockX];
      const dark = grayscale[y * width + x] <= threshold;
      binary[y * width + x] = invert ? (dark ? 0 : 1) : dark ? 1 : 0;
    }
  }
  return binary;
}

function binarizeGlobal(grayscale: Uint8ClampedArray, width: number, height: number, invert = false): Uint8Array {
  let sum = 0;
  for (const value of grayscale) {
    sum += value;
  }
  const threshold = sum / Math.max(1, grayscale.length);
  const binary = new Uint8Array(width * height);
  for (let i = 0; i < binary.length; i += 1) {
    const dark = grayscale[i] <= threshold;
    binary[i] = invert ? (dark ? 0 : 1) : dark ? 1 : 0;
  }
  return binary;
}

function getBinary(binary: Uint8Array, width: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < width && y * width + x < binary.length ? binary[y * width + x] === 1 : false;
}

function buildRowRuns(binary: Uint8Array, width: number, row: number): Array<{ dark: boolean; start: number; length: number }> {
  const runs: Array<{ dark: boolean; start: number; length: number }> = [];
  let current = getBinary(binary, width, 0, row);
  let start = 0;
  for (let x = 1; x < width; x += 1) {
    const value = getBinary(binary, width, x, row);
    if (value !== current) {
      runs.push({ dark: current, start, length: x - start });
      current = value;
      start = x;
    }
  }
  runs.push({ dark: current, start, length: width - start });
  return runs;
}

function isFinderRatio(counts: ReadonlyArray<number>): boolean {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total < 7) {
    return false;
  }
  const moduleSize = total / 7;
  const maxVariance = moduleSize * 0.75;
  return (
    Math.abs(moduleSize - counts[0]) < maxVariance &&
    Math.abs(moduleSize - counts[1]) < maxVariance &&
    Math.abs(3 * moduleSize - counts[2]) < 3 * maxVariance &&
    Math.abs(moduleSize - counts[3]) < maxVariance &&
    Math.abs(moduleSize - counts[4]) < maxVariance
  );
}

function crossCheckVertical(binary: Uint8Array, width: number, height: number, centerX: number, centerY: number): { y: number; moduleSize: number } | null {
  let upCenter = 0;
  let y = centerY;
  while (y >= 0 && getBinary(binary, width, centerX, y)) {
    upCenter += 1;
    y -= 1;
  }
  let upWhite = 0;
  while (y >= 0 && !getBinary(binary, width, centerX, y)) {
    upWhite += 1;
    y -= 1;
  }
  let upOuter = 0;
  while (y >= 0 && getBinary(binary, width, centerX, y)) {
    upOuter += 1;
    y -= 1;
  }

  let downCenter = 0;
  y = centerY + 1;
  while (y < height && getBinary(binary, width, centerX, y)) {
    downCenter += 1;
    y += 1;
  }
  let downWhite = 0;
  while (y < height && !getBinary(binary, width, centerX, y)) {
    downWhite += 1;
    y += 1;
  }
  let downOuter = 0;
  while (y < height && getBinary(binary, width, centerX, y)) {
    downOuter += 1;
    y += 1;
  }

  const counts = [upOuter, upWhite, upCenter + downCenter, downWhite, downOuter];
  if (counts.some((count) => count === 0) || !isFinderRatio(counts)) {
    return null;
  }
  const startCenter = centerY - upCenter + 1;
  return {
    y: startCenter + (counts[2] - 1) / 2,
    moduleSize: counts.reduce((sum, count) => sum + count, 0) / 7,
  };
}

function crossCheckHorizontal(binary: Uint8Array, width: number, centerX: number, centerY: number): { x: number; moduleSize: number } | null {
  let leftCenter = 0;
  let x = centerX;
  while (x >= 0 && getBinary(binary, width, x, centerY)) {
    leftCenter += 1;
    x -= 1;
  }
  let leftWhite = 0;
  while (x >= 0 && !getBinary(binary, width, x, centerY)) {
    leftWhite += 1;
    x -= 1;
  }
  let leftOuter = 0;
  while (x >= 0 && getBinary(binary, width, x, centerY)) {
    leftOuter += 1;
    x -= 1;
  }

  let rightCenter = 0;
  x = centerX + 1;
  while (x < width && getBinary(binary, width, x, centerY)) {
    rightCenter += 1;
    x += 1;
  }
  let rightWhite = 0;
  while (x < width && !getBinary(binary, width, x, centerY)) {
    rightWhite += 1;
    x += 1;
  }
  let rightOuter = 0;
  while (x < width && getBinary(binary, width, x, centerY)) {
    rightOuter += 1;
    x += 1;
  }

  const counts = [leftOuter, leftWhite, leftCenter + rightCenter, rightWhite, rightOuter];
  if (counts.some((count) => count === 0) || !isFinderRatio(counts)) {
    return null;
  }
  const startCenter = centerX - leftCenter + 1;
  return {
    x: startCenter + (counts[2] - 1) / 2,
    moduleSize: counts.reduce((sum, count) => sum + count, 0) / 7,
  };
}

function addCandidate(candidates: FinderCandidate[], candidate: FinderCandidate): void {
  for (const existing of candidates) {
    const distance = Math.hypot(existing.x - candidate.x, existing.y - candidate.y);
    if (distance <= Math.max(existing.moduleSize, candidate.moduleSize) * 1.5) {
      const total = existing.count + 1;
      existing.x = (existing.x * existing.count + candidate.x) / total;
      existing.y = (existing.y * existing.count + candidate.y) / total;
      existing.moduleSize = (existing.moduleSize * existing.count + candidate.moduleSize) / total;
      existing.count = total;
      return;
    }
  }
  candidates.push(candidate);
}

function findFinderCandidates(binary: Uint8Array, width: number, height: number): FinderCandidate[] {
  const candidates: FinderCandidate[] = [];
  for (let row = 0; row < height; row += 1) {
    const runs = buildRowRuns(binary, width, row);
    for (let i = 2; i < runs.length - 2; i += 1) {
      const sequence = runs.slice(i - 2, i + 3);
      if (
        !sequence[0].dark ||
        sequence[1].dark ||
        !sequence[2].dark ||
        sequence[3].dark ||
        !sequence[4].dark
      ) {
        continue;
      }
      const counts = sequence.map((run) => run.length);
      if (!isFinderRatio(counts)) {
        continue;
      }

      const centerX = sequence[2].start + sequence[2].length / 2;
      const vertical = crossCheckVertical(binary, width, height, Math.round(centerX), row);
      if (!vertical) {
        continue;
      }
      const horizontal = crossCheckHorizontal(binary, width, Math.round(centerX), Math.round(vertical.y));
      if (!horizontal) {
        continue;
      }
      addCandidate(candidates, {
        x: horizontal.x,
        y: vertical.y,
        moduleSize: (vertical.moduleSize + horizontal.moduleSize) / 2,
        count: 1,
      });
    }
  }
  return candidates.filter((candidate) => candidate.count >= 1).sort((left, right) => right.count - left.count);
}

function nearestValidDimension(value: number): number {
  let best = 21;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let dimension = 21; dimension <= 177; dimension += 4) {
    const distance = Math.abs(dimension - value);
    if (distance < bestDistance) {
      best = dimension;
      bestDistance = distance;
    }
  }
  return best;
}

function chooseFinderTriple(candidates: FinderCandidate[]): FinderTriple | null {
  const shortlist = candidates.slice(0, 10);
  let best: FinderTriple | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 0; i < shortlist.length - 2; i += 1) {
    for (let j = i + 1; j < shortlist.length - 1; j += 1) {
      for (let k = j + 1; k < shortlist.length; k += 1) {
        const trio = [shortlist[i], shortlist[j], shortlist[k]];
        const distances = [
          { a: trio[0], b: trio[1], d: Math.hypot(trio[0].x - trio[1].x, trio[0].y - trio[1].y) },
          { a: trio[0], b: trio[2], d: Math.hypot(trio[0].x - trio[2].x, trio[0].y - trio[2].y) },
          { a: trio[1], b: trio[2], d: Math.hypot(trio[1].x - trio[2].x, trio[1].y - trio[2].y) },
        ].sort((left, right) => right.d - left.d);

        const topLeft = trio.find((candidate) => candidate !== distances[0].a && candidate !== distances[0].b);
        if (!topLeft) {
          continue;
        }
        let topRight = distances[0].a;
        let bottomLeft = distances[0].b;
        const cross =
          (topRight.x - topLeft.x) * (bottomLeft.y - topLeft.y) -
          (topRight.y - topLeft.y) * (bottomLeft.x - topLeft.x);
        if (cross < 0) {
          [topRight, bottomLeft] = [bottomLeft, topRight];
        }

        const horizontal = Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y);
        const vertical = Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y);
        const moduleSize = (topLeft.moduleSize + topRight.moduleSize + bottomLeft.moduleSize) / 3;
        const orthogonality =
          Math.abs(
            (topRight.x - topLeft.x) * (bottomLeft.x - topLeft.x) +
            (topRight.y - topLeft.y) * (bottomLeft.y - topLeft.y),
          ) / Math.max(horizontal * vertical, 1);
        const symmetry = Math.abs(horizontal - vertical) / Math.max(horizontal, vertical, 1);
        const dimension = nearestValidDimension((horizontal / moduleSize + vertical / moduleSize) / 2 + 7);
        const version = (dimension - 17) / 4;
        if (dimension < 21 || dimension > 177 || !Number.isInteger(version)) {
          continue;
        }

        const score = orthogonality * 2 + symmetry - (topLeft.count + topRight.count + bottomLeft.count) * 0.05;
        if (score < bestScore) {
          bestScore = score;
          best = { topLeft, topRight, bottomLeft, moduleSize, dimension, version };
        }
      }
    }
  }
  return best;
}

function makeAffineMapper(topLeft: Point, topRight: Point, bottomLeft: Point, dimension: number): (u: number, v: number) => Point {
  const scaleX = {
    x: (topRight.x - topLeft.x) / (dimension - 7),
    y: (topRight.y - topLeft.y) / (dimension - 7),
  };
  const scaleY = {
    x: (bottomLeft.x - topLeft.x) / (dimension - 7),
    y: (bottomLeft.y - topLeft.y) / (dimension - 7),
  };
  return (u: number, v: number) => ({
    x: topLeft.x + scaleX.x * (u - 3.5) + scaleY.x * (v - 3.5),
    y: topLeft.y + scaleX.y * (u - 3.5) + scaleY.y * (v - 3.5),
  });
}

function isAlignmentRatio(counts: ReadonlyArray<number>): boolean {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total < 3) {
    return false;
  }
  const moduleSize = total / 3;
  const maxVariance = moduleSize * 0.7;
  return counts.every((count) => Math.abs(count - moduleSize) < maxVariance);
}

function checkAlignmentCandidate(binary: Uint8Array, width: number, height: number, x: number, y: number): number | null {
  if (!getBinary(binary, width, x, y)) {
    return null;
  }
  let left = 0;
  while (x - left >= 0 && getBinary(binary, width, x - left, y)) {
    left += 1;
  }
  let right = 0;
  while (x + right < width && getBinary(binary, width, x + right, y)) {
    right += 1;
  }
  let up = 0;
  while (y - up >= 0 && getBinary(binary, width, x, y - up)) {
    up += 1;
  }
  let down = 0;
  while (y + down < height && getBinary(binary, width, x, y + down)) {
    down += 1;
  }
  const horizontal = [left, 1, right];
  const vertical = [up, 1, down];
  return isAlignmentRatio(horizontal) && isAlignmentRatio(vertical) ? left + right + up + down : null;
}

function findAlignmentPattern(
  binary: Uint8Array,
  width: number,
  height: number,
  mapper: (u: number, v: number) => Point,
  version: number,
  moduleSize: number,
): Point | null {
  if (version <= 1) {
    return null;
  }
  const positions = getAlignmentPatternPositions(version);
  const alignmentCoordinate = positions[positions.length - 1];
  const predicted = mapper(alignmentCoordinate, alignmentCoordinate);
  const radius = Math.max(6, Math.round(moduleSize * 8));
  let best: Point | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let y = Math.max(0, Math.floor(predicted.y - radius)); y <= Math.min(height - 1, Math.ceil(predicted.y + radius)); y += 1) {
    for (let x = Math.max(0, Math.floor(predicted.x - radius)); x <= Math.min(width - 1, Math.ceil(predicted.x + radius)); x += 1) {
      const score = checkAlignmentCandidate(binary, width, height, x, y);
      if (score !== null) {
        const distancePenalty = Math.hypot(predicted.x - x, predicted.y - y);
        const weightedScore = score - distancePenalty;
        if (weightedScore > bestScore) {
          bestScore = weightedScore;
          best = { x, y };
        }
      }
    }
  }

  return best;
}

function solveHomography(modulePoints: ReadonlyArray<Point>, imagePoints: ReadonlyArray<Point>): (u: number, v: number) => Point {
  const matrix: number[][] = [];
  const vector: number[] = [];

  for (let i = 0; i < 4; i += 1) {
    const { x: u, y: v } = modulePoints[i];
    const { x, y } = imagePoints[i];
    matrix.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    vector.push(x);
    matrix.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    vector.push(y);
  }

  for (let column = 0; column < 8; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 8; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) {
        pivot = row;
      }
    }
    if (pivot !== column) {
      [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
      [vector[column], vector[pivot]] = [vector[pivot], vector[column]];
    }
    const pivotValue = matrix[column][column];
    for (let c = column; c < 8; c += 1) {
      matrix[column][c] /= pivotValue;
    }
    vector[column] /= pivotValue;
    for (let row = 0; row < 8; row += 1) {
      if (row === column) {
        continue;
      }
      const factor = matrix[row][column];
      for (let c = column; c < 8; c += 1) {
        matrix[row][c] -= factor * matrix[column][c];
      }
      vector[row] -= factor * vector[column];
    }
  }

  const [h0, h1, h2, h3, h4, h5, h6, h7] = vector;
  return (u: number, v: number) => {
    const denominator = h6 * u + h7 * v + 1;
    return {
      x: (h0 * u + h1 * v + h2) / denominator,
      y: (h3 * u + h4 * v + h5) / denominator,
    };
  };
}

function sampleMatrix(binary: Uint8Array, width: number, height: number): SampledMatrix | null {
  const candidates = findFinderCandidates(binary, width, height);
  if (candidates.length < 3) {
    return null;
  }

  const triple = chooseFinderTriple(candidates);
  if (!triple) {
    return null;
  }

  const affine = makeAffineMapper(triple.topLeft, triple.topRight, triple.bottomLeft, triple.dimension);
  const alignment = findAlignmentPattern(binary, width, height, affine, triple.version, triple.moduleSize);
  const alignmentPositions = getAlignmentPatternPositions(triple.version);
  const alignmentCoordinate =
    alignmentPositions.length > 0
      ? alignmentPositions[alignmentPositions.length - 1]
      : triple.dimension - 6.5;
  const mapper = alignment
    ? solveHomography(
        [
          { x: 3.5, y: 3.5 },
          { x: triple.dimension - 3.5, y: 3.5 },
          { x: 3.5, y: triple.dimension - 3.5 },
          { x: alignmentCoordinate, y: alignmentCoordinate },
        ],
        [triple.topLeft, triple.topRight, triple.bottomLeft, alignment],
      )
    : affine;

  const modules = Array.from({ length: triple.dimension }, () => Array<boolean>(triple.dimension).fill(false));
  for (let row = 0; row < triple.dimension; row += 1) {
    for (let col = 0; col < triple.dimension; col += 1) {
      const point = mapper(col + 0.5, row + 0.5);
      const x = Math.round(point.x);
      const y = Math.round(point.y);
      if (x < 0 || y < 0 || x >= width || y >= height) {
        return null;
      }
      modules[row][col] = getBinary(binary, width, x, y);
    }
  }

  return {
    modules,
    version: triple.version,
    corners: [
      mapper(0, 0),
      mapper(triple.dimension, 0),
      mapper(triple.dimension, triple.dimension),
      mapper(0, triple.dimension),
    ],
  };
}

function buildFunctionMask(version: number): boolean[][] {
  const size = version * 4 + 17;
  const { modules, isFunction } = createMatrix(size);
  drawFunctionPatterns(modules, isFunction, version);
  return isFunction;
}

function readCodewords(
  modules: boolean[][],
  isFunction: boolean[][],
  mask: number,
  expectedCodewords: number,
): Uint8Array | null {
  const size = modules.length;
  const bytes = new Uint8Array(expectedCodewords);
  let bitIndex = 0;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) {
      right = 5;
    }
    for (let offset = 0; offset < size; offset += 1) {
      const row = upward ? size - 1 - offset : offset;
      for (let columnOffset = 0; columnOffset < 2; columnOffset += 1) {
        const col = right - columnOffset;
        if (isFunction[row][col]) {
          continue;
        }
        if (bitIndex >= expectedCodewords * 8) {
          return bytes;
        }
        let bit = modules[row][col];
        if (applyMaskPattern(mask, row, col)) {
          bit = !bit;
        }
        if (bit) {
          bytes[bitIndex >>> 3] |= 1 << (7 - (bitIndex & 7));
        }
        bitIndex += 1;
      }
    }
    upward = !upward;
  }

  return bitIndex >= expectedCodewords * 8 ? bytes : null;
}

function getDataBlockLengths(version: number, errorCorrection: QrErrorCorrectionLevel): number[] {
  const info = getVersionInfo(version, errorCorrection);
  const lengths: number[] = [];
  for (const group of info.groups) {
    for (let i = 0; i < group.count; i += 1) {
      lengths.push(group.dataCodewords);
    }
  }
  return lengths;
}

function deinterleaveAndCorrect(
  codewords: Uint8Array,
  version: number,
  errorCorrection: QrErrorCorrectionLevel,
): Uint8Array | null {
  const info = getVersionInfo(version, errorCorrection);
  const dataLengths = getDataBlockLengths(version, errorCorrection);
  const blocks = dataLengths.map((dataLength) => new Uint8Array(dataLength + info.ecCodewordsPerBlock));

  let index = 0;
  const maxDataLength = Math.max(...dataLengths);
  for (let i = 0; i < maxDataLength; i += 1) {
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      if (i < dataLengths[blockIndex]) {
        blocks[blockIndex][i] = codewords[index++];
      }
    }
  }
  for (let i = 0; i < info.ecCodewordsPerBlock; i += 1) {
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      blocks[blockIndex][dataLengths[blockIndex] + i] = codewords[index++];
    }
  }

  const correctedData: number[] = [];
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const corrected = decodeReedSolomon(blocks[blockIndex], info.ecCodewordsPerBlock);
    if (!corrected) {
      return null;
    }
    correctedData.push(...corrected.slice(0, dataLengths[blockIndex]));
  }
  return Uint8Array.from(correctedData);
}

class BitReader {
  private bitOffset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get bitsAvailable(): number {
    return this.bytes.length * 8 - this.bitOffset;
  }

  read(bitCount: number): number | null {
    if (this.bitOffset + bitCount > this.bytes.length * 8) {
      return null;
    }
    let value = 0;
    for (let i = 0; i < bitCount; i += 1) {
      const index = this.bitOffset + i;
      value = (value << 1) | ((this.bytes[index >>> 3] >>> (7 - (index & 7))) & 1);
    }
    this.bitOffset += bitCount;
    return value;
  }
}

function getCharacterCountBitsForDecode(mode: number, version: number): number {
  if (version <= 9) {
    return mode === 0x1 ? 10 : mode === 0x2 ? 9 : 8;
  }
  if (version <= 26) {
    return mode === 0x1 ? 12 : mode === 0x2 ? 11 : 16;
  }
  return mode === 0x1 ? 14 : mode === 0x2 ? 13 : 16;
}

const ALPHANUMERIC_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

function parsePayload(bytes: Uint8Array, version: number): { text: string; bytes: Uint8Array } | null {
  const reader = new BitReader(bytes);
  const textParts: string[] = [];

  while (reader.bitsAvailable >= 4) {
    const mode = reader.read(4);
    if (mode === null || mode === 0) {
      break;
    }
    if (mode !== 0x1 && mode !== 0x2 && mode !== 0x4) {
      return null;
    }

    const count = reader.read(getCharacterCountBitsForDecode(mode, version));
    if (count === null) {
      return null;
    }

    if (mode === 0x1) {
      let remaining = count;
      while (remaining >= 3) {
        const value = reader.read(10);
        if (value === null) {
          return null;
        }
        textParts.push(value.toString().padStart(3, '0'));
        remaining -= 3;
      }
      if (remaining === 2) {
        const value = reader.read(7);
        if (value === null) {
          return null;
        }
        textParts.push(value.toString().padStart(2, '0'));
      } else if (remaining === 1) {
        const value = reader.read(4);
        if (value === null) {
          return null;
        }
        textParts.push(value.toString());
      }
      continue;
    }

    if (mode === 0x2) {
      let remaining = count;
      while (remaining >= 2) {
        const value = reader.read(11);
        if (value === null) {
          return null;
        }
        textParts.push(
          ALPHANUMERIC_CHARSET[Math.floor(value / 45)] +
            ALPHANUMERIC_CHARSET[value % 45],
        );
        remaining -= 2;
      }
      if (remaining === 1) {
        const value = reader.read(6);
        if (value === null) {
          return null;
        }
        textParts.push(ALPHANUMERIC_CHARSET[value]);
      }
      continue;
    }

    const bytesOut = new Uint8Array(count);
    for (let i = 0; i < count; i += 1) {
      const value = reader.read(8);
      if (value === null) {
        return null;
      }
      bytesOut[i] = value;
    }
    textParts.push(new TextDecoder().decode(bytesOut));
  }

  const text = textParts.join('');
  return {
    text,
    bytes: new TextEncoder().encode(text),
  };
}

function tryDecodeSampled(sampled: SampledMatrix): QrScanResult | null {
  const isFunction = buildFunctionMask(sampled.version);
  for (const errorCorrection of getAllErrorCorrectionLevels()) {
    const info = getVersionInfo(sampled.version, errorCorrection);
    for (let mask = 0; mask < 8; mask += 1) {
      const codewords = readCodewords(sampled.modules, isFunction, mask, info.totalCodewords);
      if (!codewords) {
        continue;
      }
      const data = deinterleaveAndCorrect(codewords, sampled.version, errorCorrection);
      if (!data) {
        continue;
      }
      const payload = parsePayload(data, sampled.version);
      if (!payload) {
        continue;
      }
      return {
        text: payload.text,
        bytes: payload.bytes,
        version: sampled.version,
        errorCorrection,
        mask,
        corners: sampled.corners,
      };
    }
  }
  return null;
}

export function scanImageData(imageData: QrImageDataLike, options: QrScanOptions = {}): QrScanResult | null {
  const grayscale = toGrayscale(imageData);
  const inversionMode = options.inversionMode ?? 'attemptBoth';
  const attempts =
    inversionMode === 'original'
      ? [false]
      : inversionMode === 'invert'
        ? [true]
        : [false, true];

  for (const invert of attempts) {
    for (const binary of [
      binarize(grayscale, imageData.width, imageData.height, invert),
      binarizeGlobal(grayscale, imageData.width, imageData.height, invert),
    ]) {
      const sampled = sampleMatrix(binary, imageData.width, imageData.height);
      if (!sampled) {
        continue;
      }
      const decoded = tryDecodeSampled(sampled);
      if (decoded) {
        return decoded;
      }
    }
  }
  return null;
}
