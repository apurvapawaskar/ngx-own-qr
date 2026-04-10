import { Injectable } from '@angular/core';

import { scan, scanFrame, startVideoScan } from './core/api-scan';
import type { QrImageDataLike, QrScanHandlers, QrScanOptions, QrScanResult, QrScanSession, QrSource } from './core/types';

@Injectable({ providedIn: 'root' })
export class QrScannerService {
  scan(source: QrSource, options: QrScanOptions = {}): Promise<QrScanResult | null> {
    return scan(source, options);
  }

  scanFrame(imageData: QrImageDataLike, options: QrScanOptions = {}): QrScanResult | null {
    return scanFrame(imageData, options);
  }

  startVideoScan(video: HTMLVideoElement, handlers: QrScanHandlers = {}, options: QrScanOptions = {}): QrScanSession {
    return startVideoScan(video, handlers, options);
  }
}
