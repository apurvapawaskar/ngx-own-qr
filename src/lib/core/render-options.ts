import type {
  QrEyeShape,
  QrGradientColor,
  QrImageDataLike,
  QrModuleShape,
  QrPupilShape,
  QrRenderColor,
  QrRenderOptions,
} from './types';

export type Rgba = [number, number, number, number];
export type CanvasTarget = HTMLCanvasElement | OffscreenCanvas;
export type CanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type CanvasPaint = string | CanvasGradient;
export type FinderPart = 'eye' | 'pupil' | null;

export interface CornerRadii {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export interface RenderArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NormalizedStyles {
  moduleShape: QrModuleShape;
  moduleColor: QrRenderColor;
  eyeShape: QrEyeShape;
  eyeColor: QrRenderColor;
  pupilShape: QrPupilShape;
  pupilColor: QrRenderColor;
}

export interface NormalizedRenderOptions {
  margin: number;
  scale: number;
  darkColor: string;
  lightColor: string;
  darkRgba: Rgba;
  lightRgba: Rgba;
  styles: NormalizedStyles;
  hasStyles: boolean;
  usesGradientStyles: boolean;
  usesShapedStyles: boolean;
}

export const FLOW_OVERLAP_RATIO = 0.08;

let gradientIdCounter = 0;

export function normalizeRenderOptions(options: QrRenderOptions = {}): NormalizedRenderOptions {
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
  const styles = normalizeStyles(options, darkColor);
  const hasStyles = hasStyleOverrides(options);

  return {
    margin,
    scale,
    darkColor,
    lightColor,
    darkRgba: parseColor(darkColor, [0, 0, 0, 255]),
    lightRgba: parseColor(lightColor, [255, 255, 255, 255]),
    styles,
    hasStyles,
    usesGradientStyles:
      hasGradientColor(styles.moduleColor) ||
      hasGradientColor(styles.eyeColor) ||
      hasGradientColor(styles.pupilColor),
    usesShapedStyles:
      styles.moduleShape !== 'square' || styles.eyeShape !== 'square' || styles.pupilShape !== 'square',
  };
}

export function hasStyleOverrides(options: QrRenderOptions): boolean {
  const styles = options.styles;
  if (!styles) {
    return false;
  }
  return (
    styles.module?.shape !== undefined ||
    styles.module?.color !== undefined ||
    styles.eye?.shape !== undefined ||
    styles.eye?.color !== undefined ||
    styles.pupil?.shape !== undefined ||
    styles.pupil?.color !== undefined
  );
}

function normalizeStyles(options: QrRenderOptions, darkColor: string): NormalizedStyles {
  return {
    moduleShape: normalizeModuleShape(options.styles?.module?.shape),
    moduleColor: options.styles?.module?.color ?? darkColor,
    eyeShape: normalizeEyeShape(options.styles?.eye?.shape),
    eyeColor: options.styles?.eye?.color ?? options.styles?.module?.color ?? darkColor,
    pupilShape: normalizePupilShape(options.styles?.pupil?.shape),
    pupilColor: options.styles?.pupil?.color ?? options.styles?.module?.color ?? darkColor,
  };
}

function normalizeModuleShape(shape: QrModuleShape | undefined): QrModuleShape {
  const value = shape ?? 'square';
  return ['square', 'rounded', 'extra-rounded', 'diamond', 'splash', 'liquid', 'liquid-flow'].includes(value)
    ? value
    : 'square';
}

function normalizeEyeShape(shape: QrEyeShape | undefined): QrEyeShape {
  const value = shape ?? 'square';
  return ['square', 'rounded', 'extra-rounded'].includes(value) ? value : 'square';
}

function normalizePupilShape(shape: QrPupilShape | undefined): QrPupilShape {
  const value = shape ?? 'square';
  return ['square', 'rounded', 'extra-rounded', 'diamond'].includes(value) ? value : 'square';
}

export function hasGradientColor(color: QrRenderColor): color is QrGradientColor {
  return typeof color === 'object' && color !== null && (color.type === 'linear' || color.type === 'circular');
}

export function parseColor(input: string, fallback: Rgba): Rgba {
  const value = input.trim().toLowerCase();
  if (value === 'transparent') {
    return [0, 0, 0, 0];
  }
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const digits = hex.split('').map((char) => parseInt(char + char, 16));
      return [digits[0], digits[1], digits[2], digits.length === 4 ? digits[3] : 255];
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

export function parseSolidStyleColor(color: QrRenderColor, fallback: Rgba): Rgba {
  if (hasGradientColor(color)) {
    return fallback;
  }
  return parseColor(color, fallback);
}

export function createImageDataLike(data: Uint8ClampedArray, width: number, height: number): QrImageDataLike {
  const ImageDataCtor = (globalThis as { ImageData?: typeof ImageData }).ImageData;
  if (typeof ImageDataCtor === 'function') {
    const imageData = new ImageDataCtor(width, height);
    imageData.data.set(data);
    return imageData;
  }
  return { data, width, height };
}

export function getCanvasFactory(): {
  create(width: number, height: number): CanvasTarget;
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

export function getCanvasContext(canvas: CanvasTarget): CanvasContext {
  const context = canvas.getContext('2d');
  if (!context || typeof (context as CanvasContext).fillRect !== 'function') {
    throw new Error('Unable to acquire a 2D canvas context.');
  }
  return context as CanvasContext;
}

export function isPlainRender(options: NormalizedRenderOptions): boolean {
  return !options.hasStyles;
}

export function getFinderPart(row: number, col: number, size: number): FinderPart {
  const origins = [
    { top: 0, left: 0 },
    { top: 0, left: size - 7 },
    { top: size - 7, left: 0 },
  ];

  for (const origin of origins) {
    const dy = row - origin.top;
    const dx = col - origin.left;
    if (dx < 0 || dy < 0 || dx > 6 || dy > 6) {
      continue;
    }
    if (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4) {
      return 'pupil';
    }
    if (dx === 0 || dx === 6 || dy === 0 || dy === 6) {
      return 'eye';
    }
    return null;
  }

  return null;
}

export function putPixelsOnCanvas(canvas: CanvasTarget, imageData: QrImageDataLike): void {
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = getCanvasContext(canvas);
  const ImageDataCtor = (globalThis as { ImageData?: typeof ImageData }).ImageData;
  if (ImageDataCtor && imageData instanceof ImageDataCtor) {
    context.putImageData(imageData, 0, 0);
    return;
  }
  const native = context.createImageData(imageData.width, imageData.height);
  native.data.set(imageData.data);
  context.putImageData(native, 0, 0);
}

export function createCanvasPaint(
  context: CanvasContext,
  color: QrRenderColor,
  area: RenderArea,
  fallback: string,
): CanvasPaint {
  if (!hasGradientColor(color)) {
    return color;
  }

  const gradientColors = color.colors.filter((entry) => entry.trim().length > 0);
  if (gradientColors.length < 2) {
    return fallback;
  }

  if (color.type === 'circular') {
    const cx = area.x + area.width / 2;
    const cy = area.y + area.height / 2;
    const radius = Math.max(area.width, area.height) / 2;
    const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, radius);
    addGradientStops(gradient, gradientColors);
    return gradient;
  }

  const angle = ((color.rotation ?? 0) * Math.PI) / 180;
  const cx = area.x + area.width / 2;
  const cy = area.y + area.height / 2;
  const halfW = area.width / 2;
  const halfH = area.height / 2;
  const x1 = cx - Math.cos(angle) * halfW;
  const y1 = cy - Math.sin(angle) * halfH;
  const x2 = cx + Math.cos(angle) * halfW;
  const y2 = cy + Math.sin(angle) * halfH;
  const gradient = context.createLinearGradient(x1, y1, x2, y2);
  addGradientStops(gradient, gradientColors);
  return gradient;
}

function addGradientStops(gradient: CanvasGradient, colors: string[]): void {
  const steps = Math.max(colors.length - 1, 1);
  for (let index = 0; index < colors.length; index += 1) {
    const offset = index / steps;
    gradient.addColorStop(offset, colors[index]);
  }
}

export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, '');
}

export function buildSvgPaint(color: QrRenderColor, area: RenderArea, defs: string[], fallback: string): string {
  if (!hasGradientColor(color)) {
    return escapeXml(color);
  }

  const gradientColors = color.colors.filter((entry) => entry.trim().length > 0);
  if (gradientColors.length < 2) {
    return escapeXml(fallback);
  }

  const id = `qr-grad-${gradientIdCounter += 1}`;
  if (color.type === 'circular') {
    const cx = area.x + area.width / 2;
    const cy = area.y + area.height / 2;
    const radius = Math.max(area.width, area.height) / 2;
    defs.push(
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${formatNumber(cx)}" cy="${formatNumber(cy)}" r="${formatNumber(radius)}">${buildSvgStops(gradientColors)}</radialGradient>`,
    );
  } else {
    const angle = ((color.rotation ?? 0) * Math.PI) / 180;
    const cx = area.x + area.width / 2;
    const cy = area.y + area.height / 2;
    const halfW = area.width / 2;
    const halfH = area.height / 2;
    const x1 = cx - Math.cos(angle) * halfW;
    const y1 = cy - Math.sin(angle) * halfH;
    const x2 = cx + Math.cos(angle) * halfW;
    const y2 = cy + Math.sin(angle) * halfH;
    defs.push(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${formatNumber(x1)}" y1="${formatNumber(y1)}" x2="${formatNumber(x2)}" y2="${formatNumber(y2)}">${buildSvgStops(gradientColors)}</linearGradient>`,
    );
  }

  return `url(#${id})`;
}

function buildSvgStops(colors: string[]): string {
  const steps = Math.max(colors.length - 1, 1);
  const stops: string[] = [];
  for (let index = 0; index < colors.length; index += 1) {
    const offset = index / steps;
    stops.push(`<stop offset="${formatNumber(offset * 100)}%" stop-color="${escapeXml(colors[index])}"/>`);
  }
  return stops.join('');
}
