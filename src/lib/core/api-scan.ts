import { scanImageData } from './decoder';
import { cropImageData, loadQrSource } from './source';
import type {
  QrImageDataLike,
  QrScanHandlers,
  QrScanOptions,
  QrScanResult,
  QrScanSession,
  QrSource,
} from './types';

export function scanFrame(imageData: QrImageDataLike, options: QrScanOptions = {}): QrScanResult | null {
  const { imageData: cropped, offsetX, offsetY } = cropImageData(imageData, options.scanRegion);
  const result = scanImageData(cropped, options);
  if (!result) {
    return null;
  }
  return {
    ...result,
    corners: result.corners.map((corner) => ({
      x: corner.x + offsetX,
      y: corner.y + offsetY,
    })) as QrScanResult['corners'],
  };
}

export async function scan(source: QrSource, options: QrScanOptions = {}): Promise<QrScanResult | null> {
  const loaded = await loadQrSource(source, options);
  const { imageData: cropped, offsetX, offsetY } = cropImageData(loaded.imageData, options.scanRegion);
  const result = scanImageData(cropped, options);
  if (!result) {
    return null;
  }
  return {
    ...result,
    corners: result.corners.map((corner) => ({
      x: (corner.x + offsetX) * loaded.scaleX,
      y: (corner.y + offsetY) * loaded.scaleY,
    })) as QrScanResult['corners'],
  };
}

class VideoScanSession implements QrScanSession {
  private running = false;
  private disposed = false;
  private lastFrameAt = 0;
  private rafId = 0;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly handlers: QrScanHandlers,
    private readonly options: QrScanOptions,
  ) {}

  get active(): boolean {
    return this.running && !this.disposed;
  }

  start(): void {
    if (this.disposed || this.running) {
      return;
    }
    this.running = true;
    this.tick();
  }

  pause(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  resume(): void {
    this.start();
  }

  stop(): void {
    this.pause();
    this.disposed = true;
  }

  private tick = (): void => {
    if (!this.running || this.disposed) {
      return;
    }
    const now = Date.now();
    const throttleMs = this.options.videoThrottleMs ?? 120;
    if (now - this.lastFrameAt >= throttleMs) {
      this.lastFrameAt = now;
      scan(this.video, this.options)
        .then((result) => {
          if (result) {
            this.handlers.onResult?.(result);
          }
        })
        .catch((error) => {
          this.handlers.onError?.(error);
        });
    }
    this.rafId = requestAnimationFrame(this.tick);
  };
}

export function startVideoScan(video: HTMLVideoElement, handlers: QrScanHandlers = {}, options: QrScanOptions = {}): QrScanSession {
  if (typeof requestAnimationFrame !== 'function') {
    throw new Error('Video scanning is only available in browser environments.');
  }
  const session = new VideoScanSession(video, handlers, options);
  session.start();
  return session;
}
