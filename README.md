# ngx-own-qr

Angular QR generator and scanner library for creating, rendering, and reading QR codes.

## Live Demo

Try it here: https://ngx-own-qr.apurvapawaskar.in/

## Features

- Generate QR codes from text
- Render QR codes as `SVG`, `canvas`, `ImageData`, PNG `Blob`, and data URL
- Scan QR codes from `File`, `Blob`, `ImageData`, `HTMLImageElement`, `HTMLVideoElement`, and `ImageBitmap`
- Angular services plus pure utility exports
- Supports error correction levels `L`, `M`, `Q`, and `H`

## Installation

```bash
npm install ngx-own-qr
```

Peer dependencies:

- `@angular/common >=17 <22`
- `@angular/core >=17 <22`

## Generate A QR

```ts
import { Component, computed, inject, signal } from '@angular/core';
import { QrGeneratorService } from 'ngx-own-qr';

@Component({
  selector: 'app-qr-example',
  standalone: true,
  template: `<img [src]="previewUrl()" alt="QR preview" />`,
})
export class QrExampleComponent {
  private readonly qr = inject(QrGeneratorService);

  readonly text = signal('https://ngx-own-qr.apurvapawaskar.in/');

  readonly previewUrl = computed(() => {
    const svg = this.qr.toSvg(this.text(), {
      errorCorrection: 'M',
      margin: 4,
      scale: 8,
    });

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}
```

## Scan An Image

```ts
import { Component, inject, signal } from '@angular/core';
import { QrScannerService, type QrScanResult } from 'ngx-own-qr';

@Component({
  selector: 'app-qr-scan-example',
  standalone: true,
  template: `
    <input type="file" accept="image/*" (change)="scanFile($event)" />
    <pre *ngIf="result() as value">{{ value.text }}</pre>
  `,
})
export class QrScanExampleComponent {
  private readonly qrScanner = inject(QrScannerService);

  readonly result = signal<QrScanResult | null>(null);

  async scanFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    this.result.set(await this.qrScanner.scan(file));
    input.value = '';
  }
}
```

## Optional Live Video Scan

```ts
import { inject } from '@angular/core';
import { QrScannerService } from 'ngx-own-qr';

const scanner = inject(QrScannerService);

const session = scanner.startVideoScan(videoElement, {
  onResult: (result) => {
    console.log(result.text);
    session.stop();
  },
});
```

Live video scanning is browser-only and typically requires a secure context such as `https://` or `localhost`.

## API Overview

Generator service:

- `encode(text, options): QrMatrix`
- `toSvg(input, options): string`
- `toCanvas(input, canvas?, options): HTMLCanvasElement | OffscreenCanvas`
- `toImageData(input, options): ImageData | QrImageDataLike`
- `toPngBlob(input, options): Promise<Blob>`
- `toDataUrl(input, options): Promise<string>`

Scanner service:

- `scan(source, options): Promise<QrScanResult | null>`
- `scanFrame(imageData, options): QrScanResult | null`
- `startVideoScan(video, handlers, options): QrScanSession`

Pure exports:

- `encode`
- `renderSvg`
- `renderCanvas`
- `renderImageData`
- `renderPngBlob`
- `renderDataUrl`
- `scan`
- `scanFrame`
- `startVideoScan`

## Browser Notes

- `encode` and `toSvg` can be used without browser canvas APIs.
- Canvas, PNG, and live video scanning rely on browser APIs.
- The scanner is for QR codes.
