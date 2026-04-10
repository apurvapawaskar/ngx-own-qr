export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';
export type QrSegmentMode = 'numeric' | 'alphanumeric' | 'byte';

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
