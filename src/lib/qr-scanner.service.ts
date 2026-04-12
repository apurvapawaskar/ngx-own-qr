import { Injectable } from '@angular/core';

import { scan, scanFrame, startVideoScan } from 'ngx-own-qr/core';
import type { QrImageDataLike, QrScanHandlers, QrScanOptions, QrScanResult, QrScanSession, QrSource } from 'ngx-own-qr/core';

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
