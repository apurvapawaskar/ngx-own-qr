export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';
export type QrSegmentMode = 'numeric' | 'alphanumeric' | 'byte';

export type QrGradientType = 'linear' | 'circular';

export interface QrGradientColor {
  type: QrGradientType;
  colors: string[];
  rotation?: number;
}

export type QrRenderColor = string | QrGradientColor;

export type QrModuleShape = 'square' | 'rounded' | 'extra-rounded' | 'diamond' | 'splash' | 'liquid' | 'liquid-flow';
export type QrEyeShape = 'square' | 'rounded' | 'extra-rounded';
export type QrPupilShape = 'square' | 'rounded' | 'extra-rounded' | 'diamond';
export type QrBorderShape = 'square' | 'circle';

export interface QrModuleStyle {
  color?: QrRenderColor;
  shape?: QrModuleShape;
}

export interface QrEyeStyle {
  color?: QrRenderColor;
  shape?: QrEyeShape;
}

export interface QrPupilStyle {
  color?: QrRenderColor;
  shape?: QrPupilShape;
}

export interface QrRenderStyles {
  module?: QrModuleStyle;
  eye?: QrEyeStyle;
  pupil?: QrPupilStyle;
}

export type QrCenterContentMode = 'none' | 'logo' | 'text';

export interface QrCenterLogoOptions {
  src: string;
  crossOrigin?: string;
}

export interface QrCenterTextOptions {
  value: string;
  color?: string;
  fontFamily?: string;
  fontWeight?: string | number;
}

export interface QrCenterContentOptions {
  mode?: QrCenterContentMode;
  hideModulesBehind?: boolean;
  logo?: QrCenterLogoOptions;
  text?: QrCenterTextOptions;
}

export interface QrBorderOptions {
  shape?: QrBorderShape;
  prefill?: boolean;
  color?: string;
  opacity?: number;
  innerColor?: string;
  innerOpacity?: number;
  outerColor?: string;
  outerOpacity?: number;
  width?: number;
  innerGap?: number;
}

export interface QrEncodeOptions {
  errorCorrection?: QrErrorCorrectionLevel;
  version?: number;
  mask?: number;
  margin?: number;
  scale?: number;
  darkColor?: string;
  lightColor?: string;
}

export interface QrRenderOptions {
  margin?: number;
  scale?: number;
  darkColor?: string;
  lightColor?: string;
  styles?: QrRenderStyles;
  center?: QrCenterContentOptions;
  border?: QrBorderOptions;
}

export interface QrMatrix {
  version: number;
  size: number;
  errorCorrection: QrErrorCorrectionLevel;
  mask: number;
  mode: QrSegmentMode;
  text: string;
  modules: boolean[][];
}

export interface QrCornerPoint {
  x: number;
  y: number;
}

export interface QrScanRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface QrScanOptions {
  scanRegion?: QrScanRegion;
  inversionMode?: 'original' | 'invert' | 'attemptBoth';
  maxDimension?: number;
  videoThrottleMs?: number;
}

export interface QrScanResult {
  text: string;
  bytes: Uint8Array;
  version: number;
  errorCorrection: QrErrorCorrectionLevel;
  mask: number;
  corners: [QrCornerPoint, QrCornerPoint, QrCornerPoint, QrCornerPoint];
}

export interface QrScanHandlers {
  onResult?: (result: QrScanResult) => void;
  onError?: (error: unknown) => void;
}

export interface QrScanSession {
  readonly active: boolean;
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

export type QrRenderableInput = string | QrMatrix;

export type QrSource =
  | ImageData
  | HTMLImageElement
  | HTMLVideoElement
  | ImageBitmap
  | File
  | Blob;

export interface QrImageDataLike {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}
