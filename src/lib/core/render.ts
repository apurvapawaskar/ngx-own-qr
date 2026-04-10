import { encodeQr } from './encoder';
import type { QrEncodeOptions, QrImageDataLike, QrMatrix, QrRenderOptions, QrRenderableInput } from './types';

type Rgba = [number, number, number, number];

interface NormalizedRenderOptions {
  margin: number;
  scale: number;
  darkColor: string;
  lightColor: string;
  darkRgba: Rgba;
  lightRgba: Rgba;
}

function resolveMatrix(input: QrRenderableInput, options: QrEncodeOptions & QrRenderOptions): QrMatrix {
  return typeof input === 'string' ? encodeQr(input, options) : input;
}

function normalizeRenderOptions(options: QrRenderOptions = {}): NormalizedRenderOptions {
  const margin = options.margin ?? 4;
  const scale = options.scale ?? 4;
  if (!Number.isInteger(margin) || margin < 0) {
    throw new Error(`QR margin must be a non-negative integer. Received ${margin}.`);
  }
  if (!Number.isInteger(scale) || scale <= 0) {
    throw new Error(`QR scale must be a positive integer. Received ${scale}.`);
  }
  const darkColor = options.darkColor ?? '#000000';
  const lightColor = options.lightColor ?? '#ffffff';
  return {
    margin,
    scale,
    darkColor,
    lightColor,
    darkRgba: parseColor(darkColor, [0, 0, 0, 255]),
    lightRgba: parseColor(lightColor, [255, 255, 255, 255]),
  };
}

function parseColor(input: string, fallback: Rgba): Rgba {
  const value = input.trim().toLowerCase();
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const digits = hex.split('').map((char) => parseInt(char + char, 16));
      return [
        digits[0],
        digits[1],
        digits[2],
        digits.length === 4 ? digits[3] : 255,
      ];
    }
    if (hex.length === 6 || hex.length === 8) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255,
      ];
    }
  }

  const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) {
    const pieces = rgbMatch[1].split(',').map((piece) => piece.trim());
    if (pieces.length >= 3) {
      const alphaValue = pieces.length === 4 ? Number(pieces[3]) : 1;
      return [
        clampByte(Number(pieces[0])),
        clampByte(Number(pieces[1])),
        clampByte(Number(pieces[2])),
        clampByte(alphaValue <= 1 ? alphaValue * 255 : alphaValue),
      ];
    }
  }

  return fallback;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function createImageDataLike(data: Uint8ClampedArray, width: number, height: number): QrImageDataLike {
  const ImageDataCtor = (globalThis as { ImageData?: typeof ImageData }).ImageData;
  if (typeof ImageDataCtor === 'function') {
    const imageData = new ImageDataCtor(width, height);
    imageData.data.set(data);
    return imageData;
  }
  return { data, width, height };
}

export function toImageData(input: QrRenderableInput, options: QrEncodeOptions & QrRenderOptions = {}): QrImageDataLike {
  const matrix = resolveMatrix(input, options);
  const renderOptions = normalizeRenderOptions(options);
  const cellSize = renderOptions.scale;
  const totalCells = matrix.size + renderOptions.margin * 2;
  const outputSize = totalCells * cellSize;
  const pixels = new Uint8ClampedArray(outputSize * outputSize * 4);

  for (let y = 0; y < outputSize; y += 1) {
    const matrixRow = Math.floor(y / cellSize) - renderOptions.margin;
    for (let x = 0; x < outputSize; x += 1) {
      const matrixCol = Math.floor(x / cellSize) - renderOptions.margin;
      const isDark =
        matrixRow >= 0 &&
        matrixCol >= 0 &&
        matrixRow < matrix.size &&
        matrixCol < matrix.size &&
        matrix.modules[matrixRow][matrixCol];
      const color = isDark ? renderOptions.darkRgba : renderOptions.lightRgba;
      const index = (y * outputSize + x) * 4;
      pixels[index] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
      pixels[index + 3] = color[3];
    }
  }

  return createImageDataLike(pixels, outputSize, outputSize);
}

function getCanvasFactory(): {
  create(width: number, height: number): HTMLCanvasElement | OffscreenCanvas;
} {
  if (typeof OffscreenCanvas !== 'undefined') {
    return {
      create(width, height) {
        return new OffscreenCanvas(width, height);
      },
    };
  }
  if (typeof document !== 'undefined') {
    return {
      create(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
      },
    };
  }
  throw new Error('Canvas rendering is only available in browser environments.');
}

function putPixelsOnCanvas(canvas: HTMLCanvasElement | OffscreenCanvas, imageData: QrImageDataLike): void {
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to acquire a 2D canvas context.');
  }
  const ImageDataCtor = (globalThis as { ImageData?: typeof ImageData }).ImageData;
  if (ImageDataCtor && imageData instanceof ImageDataCtor) {
    context.putImageData(imageData, 0, 0);
    return;
  }
  const native = context.createImageData(imageData.width, imageData.height);
  native.data.set(imageData.data);
  context.putImageData(native, 0, 0);
}

export function toCanvas(
  input: QrRenderableInput,
  canvas?: HTMLCanvasElement | OffscreenCanvas,
  options: QrEncodeOptions & QrRenderOptions = {},
): HTMLCanvasElement | OffscreenCanvas {
  const imageData = toImageData(input, options);
  const target = canvas ?? getCanvasFactory().create(imageData.width, imageData.height);
  putPixelsOnCanvas(target, imageData);
  return target;
}

export async function toPngBlob(
  input: QrRenderableInput,
  options: QrEncodeOptions & QrRenderOptions = {},
): Promise<Blob> {
  const canvas = toCanvas(input, undefined, options);
  if ('convertToBlob' in canvas && typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: 'image/png' });
  }
  if ('toBlob' in canvas && typeof canvas.toBlob === 'function') {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to serialize the QR canvas to PNG.'));
        }
      }, 'image/png');
    });
  }
  throw new Error('PNG export is only available in browser environments.');
}

export async function toDataUrl(
  input: QrRenderableInput,
  options: QrEncodeOptions & QrRenderOptions = {},
): Promise<string> {
  const canvas = toCanvas(input, undefined, options);
  if ('toDataURL' in canvas && typeof canvas.toDataURL === 'function') {
    return canvas.toDataURL('image/png');
  }
  const blob = await toPngBlob(input, options);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

export function toSvg(input: QrRenderableInput, options: QrEncodeOptions & QrRenderOptions = {}): string {
  const matrix = resolveMatrix(input, options);
  const renderOptions = normalizeRenderOptions(options);
  const totalSize = matrix.size + renderOptions.margin * 2;
  const pathCommands: string[] = [];

  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (matrix.modules[row][col]) {
        const x = col + renderOptions.margin;
        const y = row + renderOptions.margin;
        pathCommands.push(`M${x},${y}h1v1h-1z`);
      }
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" shape-rendering="crispEdges">`,
    `<rect width="${totalSize}" height="${totalSize}" fill="${renderOptions.lightColor}"/>`,
    `<path fill="${renderOptions.darkColor}" d="${pathCommands.join(' ')}"/>`,
    '</svg>',
  ].join('');
}
