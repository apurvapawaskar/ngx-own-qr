import type { QrImageDataLike, QrScanOptions, QrSource } from './types';

export interface LoadedQrSource {
  imageData: QrImageDataLike;
  scaleX: number;
  scaleY: number;
}

function hasImageDataConstructor(): boolean {
  return typeof (globalThis as { ImageData?: typeof ImageData }).ImageData === 'function';
}

function isImageDataLike(value: unknown): value is QrImageDataLike {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<QrImageDataLike>;
  return (
    candidate.data instanceof Uint8ClampedArray &&
    typeof candidate.width === 'number' &&
    typeof candidate.height === 'number'
  );
}

function toImageDataLike(data: Uint8ClampedArray, width: number, height: number): QrImageDataLike {
  if (hasImageDataConstructor()) {
    const imageData = new ImageData(width, height);
    imageData.data.set(data);
    return imageData;
  }
  return { data, width, height };
}

function resizeDimensions(width: number, height: number, maxDimension?: number): { width: number; height: number } {
  if (!maxDimension || Math.max(width, height) <= maxDimension) {
    return { width, height };
  }
  const scale = maxDimension / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error('Image sources other than ImageData are only supported in browser environments.');
}

function getImageDataFromCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): QrImageDataLike {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to acquire a 2D canvas context.');
  }
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

async function loadBlobAsImage(source: Blob): Promise<HTMLImageElement | ImageBitmap> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(source);
  }
  if (typeof document === 'undefined') {
    throw new Error('Blob/File scanning requires browser image APIs.');
  }
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(source);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode the image blob.'));
    };
    image.src = url;
  });
}

function drawVisualSource(
  source: HTMLImageElement | HTMLVideoElement | ImageBitmap,
  maxDimension?: number,
): LoadedQrSource {
  const sourceWidth =
    'videoWidth' in source && typeof source.videoWidth === 'number' && source.videoWidth > 0
      ? source.videoWidth
      : 'naturalWidth' in source && typeof source.naturalWidth === 'number' && source.naturalWidth > 0
        ? source.naturalWidth
        : source.width;
  const sourceHeight =
    'videoHeight' in source && typeof source.videoHeight === 'number' && source.videoHeight > 0
      ? source.videoHeight
      : 'naturalHeight' in source && typeof source.naturalHeight === 'number' && source.naturalHeight > 0
        ? source.naturalHeight
        : source.height;

  const resized = resizeDimensions(sourceWidth, sourceHeight, maxDimension);
  const canvas = createCanvas(resized.width, resized.height);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to acquire a 2D canvas context.');
  }
  context.drawImage(source as CanvasImageSource, 0, 0, resized.width, resized.height);
  return {
    imageData: getImageDataFromCanvas(canvas),
    scaleX: sourceWidth / resized.width,
    scaleY: sourceHeight / resized.height,
  };
}

export async function loadQrSource(source: QrSource, options: QrScanOptions = {}): Promise<LoadedQrSource> {
  if (isImageDataLike(source)) {
    return {
      imageData: source,
      scaleX: 1,
      scaleY: 1,
    };
  }

  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
    return drawVisualSource(source, options.maxDimension);
  }
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
    return drawVisualSource(source, options.maxDimension);
  }
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
    return drawVisualSource(source, options.maxDimension);
  }
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    const image = await loadBlobAsImage(source);
    return drawVisualSource(image, options.maxDimension);
  }

  throw new Error('Unsupported QR source type.');
}

export function cropImageData(imageData: QrImageDataLike, region?: QrScanOptions['scanRegion']): { imageData: QrImageDataLike; offsetX: number; offsetY: number } {
  if (!region) {
    return { imageData, offsetX: 0, offsetY: 0 };
  }

  const x = Math.max(0, Math.min(imageData.width, Math.floor(region.x)));
  const y = Math.max(0, Math.min(imageData.height, Math.floor(region.y)));
  const width = Math.max(1, Math.min(imageData.width - x, Math.floor(region.width)));
  const height = Math.max(1, Math.min(imageData.height - y, Math.floor(region.height)));
  const cropped = new Uint8ClampedArray(width * height * 4);

  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * imageData.width + x) * 4;
    const sourceEnd = sourceStart + width * 4;
    cropped.set(imageData.data.slice(sourceStart, sourceEnd), row * width * 4);
  }

  return {
    imageData: toImageDataLike(cropped, width, height),
    offsetX: x,
    offsetY: y,
  };
}
