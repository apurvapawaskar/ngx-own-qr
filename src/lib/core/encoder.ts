import { BitBuffer } from './bit-buffer';
import { getAllErrorCorrectionLevels, getAlignmentPatternPositions, getCharacterCountBits, getVersionInfo, FORMAT_EC_BITS } from './qr-tables';
import { encodeReedSolomon } from './reed-solomon';
import type { QrEncodeOptions, QrErrorCorrectionLevel, QrMatrix, QrSegmentMode } from './types';

const ALPHANUMERIC_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const PAD_BYTES = [0xec, 0x11] as const;

function assertVersion(version: number): void {
  if (!Number.isInteger(version) || version < 1 || version > 40) {
    throw new Error(`QR version must be an integer between 1 and 40. Received ${version}.`);
  }
}

function assertMask(mask: number): void {
  if (!Number.isInteger(mask) || mask < 0 || mask > 7) {
    throw new Error(`QR mask must be an integer between 0 and 7. Received ${mask}.`);
  }
}

function chooseMode(text: string): QrSegmentMode {
  if (/^[0-9]+$/.test(text)) {
    return 'numeric';
  }
  if (new RegExp(`^[${ALPHANUMERIC_CHARSET.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]+$`).test(text)) {
    return 'alphanumeric';
  }
  return 'byte';
}

function getModeBits(mode: QrSegmentMode): number {
  return mode === 'numeric' ? 0x1 : mode === 'alphanumeric' ? 0x2 : 0x4;
}

function getEncodedPayload(text: string, mode: QrSegmentMode): Uint8Array {
  return mode === 'byte' ? new TextEncoder().encode(text) : new Uint8Array();
}

function getCharacterCount(text: string, mode: QrSegmentMode, payload: Uint8Array): number {
  return mode === 'byte' ? payload.length : text.length;
}

function getDataBitLength(text: string, mode: QrSegmentMode, payload: Uint8Array): number {
  if (mode === 'numeric') {
    const fullTriplets = Math.floor(text.length / 3);
    const remainder = text.length % 3;
    return fullTriplets * 10 + (remainder === 0 ? 0 : remainder === 1 ? 4 : 7);
  }
  if (mode === 'alphanumeric') {
    return Math.floor(text.length / 2) * 11 + (text.length % 2) * 6;
  }
  return payload.length * 8;
}

function chooseVersion(
  text: string,
  mode: QrSegmentMode,
  payload: Uint8Array,
  errorCorrection: QrErrorCorrectionLevel,
  requestedVersion?: number,
): number {
  const versions = requestedVersion ? [requestedVersion] : Array.from({ length: 40 }, (_, index) => index + 1);
  const dataBitLength = getDataBitLength(text, mode, payload);

  for (const version of versions) {
    assertVersion(version);
    const info = getVersionInfo(version, errorCorrection);
    const requiredBits = 4 + getCharacterCountBits(mode, version) + dataBitLength;
    if (requiredBits <= info.dataCodewords * 8) {
      return version;
    }
  }

  throw new Error('The input is too large for the selected QR version/error correction level.');
}

function appendSegment(buffer: BitBuffer, text: string, mode: QrSegmentMode, payload: Uint8Array): void {
  if (mode === 'numeric') {
    for (let index = 0; index < text.length; index += 3) {
      const chunk = text.slice(index, index + 3);
      buffer.append(Number(chunk), chunk.length === 3 ? 10 : chunk.length === 2 ? 7 : 4);
    }
    return;
  }

  if (mode === 'alphanumeric') {
    for (let index = 0; index < text.length; index += 2) {
      const left = ALPHANUMERIC_CHARSET.indexOf(text[index]);
      if (index + 1 < text.length) {
        const right = ALPHANUMERIC_CHARSET.indexOf(text[index + 1]);
        buffer.append(left * 45 + right, 11);
      } else {
        buffer.append(left, 6);
      }
    }
    return;
  }

  buffer.appendBytes(payload);
}

function createDataCodewords(
  text: string,
  mode: QrSegmentMode,
  payload: Uint8Array,
  version: number,
  errorCorrection: QrErrorCorrectionLevel,
): Uint8Array {
  const info = getVersionInfo(version, errorCorrection);
  const characterCount = getCharacterCount(text, mode, payload);
  const buffer = new BitBuffer();
  buffer.append(getModeBits(mode), 4);
  buffer.append(characterCount, getCharacterCountBits(mode, version));
  appendSegment(buffer, text, mode, payload);

  const capacityBits = info.dataCodewords * 8;
  buffer.append(0, Math.min(4, capacityBits - buffer.bitLength));
  while (buffer.bitLength % 8 !== 0) {
    buffer.append(0, 1);
  }

  const bytes = buffer.toUint8Array();
  if (bytes.length > info.dataCodewords) {
    throw new Error('Encoded payload exceeds the available data capacity for the selected version.');
  }

  const result = new Uint8Array(info.dataCodewords);
  result.set(bytes);
  for (let index = bytes.length; index < result.length; index += 1) {
    result[index] = PAD_BYTES[(index - bytes.length) % PAD_BYTES.length];
  }
  return result;
}

function interleaveCodewords(dataCodewords: Uint8Array, version: number, errorCorrection: QrErrorCorrectionLevel): Uint8Array {
  const info = getVersionInfo(version, errorCorrection);
  const dataBlocks: Uint8Array[] = [];
  let offset = 0;
  for (const group of info.groups) {
    for (let block = 0; block < group.count; block += 1) {
      dataBlocks.push(dataCodewords.slice(offset, offset + group.dataCodewords));
      offset += group.dataCodewords;
    }
  }

  const ecBlocks = dataBlocks.map((block) => encodeReedSolomon(block, info.ecCodewordsPerBlock));
  const interleaved: number[] = [];
  const maxDataLength = Math.max(...dataBlocks.map((block) => block.length));

  for (let i = 0; i < maxDataLength; i += 1) {
    for (const block of dataBlocks) {
      if (i < block.length) {
        interleaved.push(block[i]);
      }
    }
  }
  for (let i = 0; i < info.ecCodewordsPerBlock; i += 1) {
    for (const block of ecBlocks) {
      interleaved.push(block[i]);
    }
  }

  return Uint8Array.from(interleaved);
}

export function createMatrix(size: number): { modules: boolean[][]; isFunction: boolean[][] } {
  return {
    modules: Array.from({ length: size }, () => Array<boolean>(size).fill(false)),
    isFunction: Array.from({ length: size }, () => Array<boolean>(size).fill(false)),
  };
}

function setFunctionModule(modules: boolean[][], isFunction: boolean[][], row: number, col: number, value: boolean): void {
  if (row < 0 || col < 0 || row >= modules.length || col >= modules.length) {
    return;
  }
  modules[row][col] = value;
  isFunction[row][col] = true;
}

function drawFinderPattern(modules: boolean[][], isFunction: boolean[][], top: number, left: number): void {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const row = top + dy;
      const col = left + dx;
      const isSeparator = dx === -1 || dx === 7 || dy === -1 || dy === 7;
      const isDark =
        !isSeparator &&
        (dx === 0 ||
          dx === 6 ||
          dy === 0 ||
          dy === 6 ||
          (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      setFunctionModule(modules, isFunction, row, col, isDark);
    }
  }
}

function drawAlignmentPattern(modules: boolean[][], isFunction: boolean[][], centerRow: number, centerCol: number): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      setFunctionModule(modules, isFunction, centerRow + dy, centerCol + dx, distance !== 1);
    }
  }
}

export function drawFunctionPatterns(modules: boolean[][], isFunction: boolean[][], version: number): void {
  const size = modules.length;
  drawFinderPattern(modules, isFunction, 0, 0);
  drawFinderPattern(modules, isFunction, 0, size - 7);
  drawFinderPattern(modules, isFunction, size - 7, 0);

  for (let i = 0; i < size; i += 1) {
    if (!isFunction[6][i]) {
      setFunctionModule(modules, isFunction, 6, i, i % 2 === 0);
    }
    if (!isFunction[i][6]) {
      setFunctionModule(modules, isFunction, i, 6, i % 2 === 0);
    }
  }

  const positions = getAlignmentPatternPositions(version);
  for (const row of positions) {
    for (const col of positions) {
      const overlapsFinder =
        (row <= 8 && col <= 8) ||
        (row <= 8 && col >= size - 8) ||
        (row >= size - 8 && col <= 8);
      if (!overlapsFinder) {
        drawAlignmentPattern(modules, isFunction, row, col);
      }
    }
  }

  setFunctionModule(modules, isFunction, size - 8, 8, true);

  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) {
      setFunctionModule(modules, isFunction, 8, i, false);
      setFunctionModule(modules, isFunction, i, 8, false);
    }
  }
  for (let i = 0; i < 8; i += 1) {
    setFunctionModule(modules, isFunction, size - 1 - i, 8, false);
    setFunctionModule(modules, isFunction, 8, size - 1 - i, false);
  }

  if (version >= 7) {
    for (let i = 0; i < 6; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        setFunctionModule(modules, isFunction, i, size - 11 + j, false);
        setFunctionModule(modules, isFunction, size - 11 + j, i, false);
      }
    }
  }
}

export function applyMaskPattern(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return false;
  }
}

function drawCodewords(modules: boolean[][], isFunction: boolean[][], codewords: Uint8Array, mask: number): void {
  const size = modules.length;
  let bitIndex = 0;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) {
      right = 5;
    }
    for (let offset = 0; offset < size; offset += 1) {
      const row = upward ? size - 1 - offset : offset;
      for (let colOffset = 0; colOffset < 2; colOffset += 1) {
        const col = right - colOffset;
        if (isFunction[row][col]) {
          continue;
        }
        const bit =
          bitIndex < codewords.length * 8 &&
          ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
        modules[row][col] = applyMaskPattern(mask, row, col) ? !bit : bit;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

function getFormatBits(errorCorrection: QrErrorCorrectionLevel, mask: number): number {
  const data = (FORMAT_EC_BITS[errorCorrection] << 3) | mask;
  let remainder = data << 10;
  const generator = 0x537;
  while ((remainder >>> 10) >= 1) {
    const shift = Math.floor(Math.log2(remainder)) - 10;
    remainder ^= generator << shift;
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

function getVersionBits(version: number): number {
  let remainder = version << 12;
  const generator = 0x1f25;
  while ((remainder >>> 12) >= 1) {
    const shift = Math.floor(Math.log2(remainder)) - 12;
    remainder ^= generator << shift;
  }
  return (version << 12) | remainder;
}

function drawFormatAndVersion(modules: boolean[][], isFunction: boolean[][], version: number, errorCorrection: QrErrorCorrectionLevel, mask: number): void {
  const size = modules.length;
  const formatBits = getFormatBits(errorCorrection, mask);

  for (let i = 0; i < 15; i += 1) {
    const bit = ((formatBits >>> i) & 1) !== 0;

    if (i < 6) {
      setFunctionModule(modules, isFunction, i, 8, bit);
    } else if (i < 8) {
      setFunctionModule(modules, isFunction, i + 1, 8, bit);
    } else {
      setFunctionModule(modules, isFunction, size - 15 + i, 8, bit);
    }

    if (i < 8) {
      setFunctionModule(modules, isFunction, 8, size - i - 1, bit);
    } else if (i < 9) {
      setFunctionModule(modules, isFunction, 8, 7, bit);
    } else {
      setFunctionModule(modules, isFunction, 8, 15 - i - 1, bit);
    }
  }

  // The fixed dark module sits adjacent to the lower-left timing pattern.
  // It is not part of the format information and must always remain dark.
  setFunctionModule(modules, isFunction, size - 8, 8, true);

  if (version >= 7) {
    const versionBits = getVersionBits(version);
    for (let i = 0; i < 18; i += 1) {
      const bit = ((versionBits >>> i) & 1) !== 0;
      const row = Math.floor(i / 3);
      const col = i % 3;
      setFunctionModule(modules, isFunction, row, size - 11 + col, bit);
      setFunctionModule(modules, isFunction, size - 11 + col, row, bit);
    }
  }
}

function cloneMatrix(matrix: boolean[][]): boolean[][] {
  return matrix.map((row) => row.slice());
}

function scorePenalty(modules: boolean[][]): number {
  const size = modules.length;
  let score = 0;

  for (let row = 0; row < size; row += 1) {
    let runColor = modules[row][0];
    let runLength = 1;
    for (let col = 1; col < size; col += 1) {
      if (modules[row][col] === runColor) {
        runLength += 1;
      } else {
        if (runLength >= 5) {
          score += 3 + (runLength - 5);
        }
        runColor = modules[row][col];
        runLength = 1;
      }
    }
    if (runLength >= 5) {
      score += 3 + (runLength - 5);
    }
  }

  for (let col = 0; col < size; col += 1) {
    let runColor = modules[0][col];
    let runLength = 1;
    for (let row = 1; row < size; row += 1) {
      if (modules[row][col] === runColor) {
        runLength += 1;
      } else {
        if (runLength >= 5) {
          score += 3 + (runLength - 5);
        }
        runColor = modules[row][col];
        runLength = 1;
      }
    }
    if (runLength >= 5) {
      score += 3 + (runLength - 5);
    }
  }

  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const color = modules[row][col];
      if (
        color === modules[row][col + 1] &&
        color === modules[row + 1][col] &&
        color === modules[row + 1][col + 1]
      ) {
        score += 3;
      }
    }
  }

  const patternA = [true, false, true, true, true, false, true, false, false, false, false];
  const patternB = [false, false, false, false, true, false, true, true, true, false, true];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col <= size - 11; col += 1) {
      const slice = modules[row].slice(col, col + 11);
      if (matchesPattern(slice, patternA) || matchesPattern(slice, patternB)) {
        score += 40;
      }
    }
  }
  for (let col = 0; col < size; col += 1) {
    for (let row = 0; row <= size - 11; row += 1) {
      const slice = Array.from({ length: 11 }, (_, index) => modules[row + index][col]);
      if (matchesPattern(slice, patternA) || matchesPattern(slice, patternB)) {
        score += 40;
      }
    }
  }

  let darkCount = 0;
  for (const row of modules) {
    for (const module of row) {
      if (module) {
        darkCount += 1;
      }
    }
  }
  const totalModules = size * size;
  score += Math.floor(Math.abs(darkCount * 20 - totalModules * 10) / totalModules) * 10;
  return score;
}

function matchesPattern(slice: ReadonlyArray<boolean>, pattern: ReadonlyArray<boolean>): boolean {
  return slice.every((value, index) => value === pattern[index]);
}

function buildMaskedMatrix(baseModules: boolean[][], baseFunction: boolean[][], codewords: Uint8Array, version: number, errorCorrection: QrErrorCorrectionLevel, mask: number): boolean[][] {
  const modules = cloneMatrix(baseModules);
  const isFunction = cloneMatrix(baseFunction);
  drawCodewords(modules, isFunction, codewords, mask);
  drawFormatAndVersion(modules, isFunction, version, errorCorrection, mask);
  return modules;
}

function selectMask(
  baseModules: boolean[][],
  baseFunction: boolean[][],
  codewords: Uint8Array,
  version: number,
  errorCorrection: QrErrorCorrectionLevel,
  requestedMask?: number,
): { mask: number; modules: boolean[][] } {
  if (requestedMask !== undefined) {
    assertMask(requestedMask);
    return {
      mask: requestedMask,
      modules: buildMaskedMatrix(baseModules, baseFunction, codewords, version, errorCorrection, requestedMask),
    };
  }

  let bestMask = 0;
  let bestModules = buildMaskedMatrix(baseModules, baseFunction, codewords, version, errorCorrection, 0);
  let bestScore = scorePenalty(bestModules);

  for (let mask = 1; mask < 8; mask += 1) {
    const candidate = buildMaskedMatrix(baseModules, baseFunction, codewords, version, errorCorrection, mask);
    const candidateScore = scorePenalty(candidate);
    if (candidateScore < bestScore) {
      bestScore = candidateScore;
      bestMask = mask;
      bestModules = candidate;
    }
  }

  return { mask: bestMask, modules: bestModules };
}

export function encodeQr(text: string, options: QrEncodeOptions = {}): QrMatrix {
  const errorCorrection = options.errorCorrection ?? getAllErrorCorrectionLevels()[1];
  if (text.length === 0) {
    throw new Error('QR input text cannot be empty.');
  }

  const mode = chooseMode(text);
  const payload = getEncodedPayload(text, mode);
  const version = chooseVersion(text, mode, payload, errorCorrection, options.version);
  const dataCodewords = createDataCodewords(text, mode, payload, version, errorCorrection);
  const finalCodewords = interleaveCodewords(dataCodewords, version, errorCorrection);
  const size = version * 4 + 17;
  const { modules: baseModules, isFunction: baseFunction } = createMatrix(size);
  drawFunctionPatterns(baseModules, baseFunction, version);
  const { mask, modules } = selectMask(baseModules, baseFunction, finalCodewords, version, errorCorrection, options.mask);

  return {
    version,
    size,
    errorCorrection,
    mask,
    mode,
    text,
    modules,
  };
}
