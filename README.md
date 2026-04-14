# ngx-own-qr

Build QR experiences that actually feel product-grade.

`ngx-own-qr` is an Angular-first QR toolkit with an in-house encoder, renderer, and scanner. It gives you clean defaults for fast shipping and deep control when you want to craft premium-looking QR assets.

Live demo: https://ngx-own-qr.apurvapawaskar.in/

<img src="https://raw.githubusercontent.com/apurvapawaskar/ngx-own-qr/master/assets/cover.png" alt="ngx-own-qr cover" width="960" />

## Visual examples

### Plain QR

<img src="https://raw.githubusercontent.com/apurvapawaskar/ngx-own-qr/master/assets/plain-qr.svg" alt="Plain QR" width="360" />

### Styled QR

<img src="https://raw.githubusercontent.com/apurvapawaskar/ngx-own-qr/master/assets/styled-qr.svg" alt="Styled QR" width="360" />

### Logo center QR

<img src="https://raw.githubusercontent.com/apurvapawaskar/ngx-own-qr/master/assets/qr-logo.svg" alt="Logo center QR" width="360" />

### Text center QR

<img src="https://raw.githubusercontent.com/apurvapawaskar/ngx-own-qr/master/assets/qr-text.svg" alt="Text center QR" width="360" />

---

## Why this library exists

Most QR packages solve one part of the problem. This one solves the full flow:

- Generate QR from text with proper error correction.
- Render in multiple outputs (`SVG`, `Canvas`, `ImageData`, PNG `Blob`, Data URL).
- Scan QR from files, images, videos, and live camera streams.
- Style beyond basic black squares: shapes, gradients, borders, and center content.
- Keep strict TypeScript support with clear interfaces.

---

## Feature highlights

- Full QR pipeline: encode, render, scan
- Angular services for dependency-injection friendly usage
- Pure function exports for framework-agnostic usage
- Advanced styling:
  - Module shapes: `square`, `rounded`, `extra-rounded`, `diamond`, `splash`, `liquid`, `liquid-flow`
  - Eye and pupil shape controls
  - Solid or gradient colors
- Border system:
  - `square` and `circle`
  - Circle ring prefill pattern with deterministic scatter (visual depth without noisy clustering)
- Center content support:
  - Logo or text mode
  - Optional module masking behind center content
- Option-limit constants (`QR_RENDER_OPTION_LIMITS`) for UI sliders/validation

---

## Installation

```bash
npm install ngx-own-qr
```

### Peer dependencies

- `@angular/common >=17.0.0 <22.0.0`
- `@angular/core >=17.0.0 <22.0.0`

---

## Import strategies

Use whichever layer fits your app architecture.

### 1) Angular services (recommended in Angular apps)

```ts
import { QrGeneratorService } from 'ngx-own-qr/generator';
import { QrScannerService } from 'ngx-own-qr/scanner';
```

### 2) Pure functions (framework-agnostic)

```ts
import {
  encode,
  renderSvg,
  renderCanvas,
  renderPngBlob,
  scan,
  scanFrame,
  startVideoScan,
} from 'ngx-own-qr/core';
```

---

## Quick start: Generate QR in Angular (`toDataUrl`)

```ts
import { Component, effect, inject, signal } from '@angular/core';
import { QrGeneratorService } from 'ngx-own-qr/generator';

@Component({
  selector: 'app-qr-preview',
  standalone: true,
  template: `
    <h2>QR Preview</h2>
    <img [src]="qrDataUrl()" alt="QR code" />
  `,
})
export class QrPreviewComponent {
  private readonly qr = inject(QrGeneratorService);

  readonly text = signal('https://ngx-own-qr.apurvapawaskar.in/');
  readonly qrDataUrl = signal<string>('');
  readonly error = signal<string>('');

  constructor() {
    effect(() => {
      void this.generatePreview(this.text());
    });
  }

  private async generatePreview(value: string): Promise<void> {
    try {
      this.error.set('');
      const dataUrl = await this.qr.toDataUrl(value, {
        errorCorrection: 'M',
        margin: 4,
        scale: 8,
      });
      this.qrDataUrl.set(dataUrl);
    } catch (e) {
      this.qrDataUrl.set('');
      this.error.set(e instanceof Error ? e.message : 'Failed to generate QR.');
    }
  }
}
```

Template note: use `<img [src]="qrDataUrl()" alt="QR code" />` and optionally show `error()`.

---

## Quick start: Scan uploaded image

```ts
import { Component, inject, signal } from '@angular/core';
import { QrScannerService, type QrScanResult } from 'ngx-own-qr/scanner';

@Component({
  selector: 'app-qr-scan',
  standalone: true,
  template: `
    <input type="file" accept="image/*" (change)="scanFile($event)" />

    <section *ngIf="result() as value">
      <h3>Decoded:</h3>
      <pre>{{ value.text }}</pre>
    </section>
  `,
})
export class QrScanComponent {
  private readonly scanner = inject(QrScannerService);

  readonly result = signal<QrScanResult | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');

  async scanFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    this.loading.set(true);
    this.error.set('');
    this.result.set(null);

    try {
      const output = await this.scanner.scan(file, {
        inversionMode: 'attemptBoth',
        maxDimension: 1600,
      });

      if (!output) {
        this.error.set('No QR code detected in this image.');
        return;
      }

      this.result.set(output);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Unable to scan this image.');
    } finally {
      this.loading.set(false);
      input.value = '';
    }
  }
}
```

---

## Live camera scanning

```ts
import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { QrScannerService, type QrScanSession } from 'ngx-own-qr/scanner';

@Component({
  selector: 'app-live-scan',
  standalone: true,
  template: `<video #video autoplay playsinline muted></video>`,
})
export class LiveScanComponent {
  @ViewChild('video', { static: true })
  videoRef!: ElementRef<HTMLVideoElement>;

  private readonly scanner = inject(QrScannerService);
  private session: QrScanSession | null = null;

  start(): void {
    this.session = this.scanner.startVideoScan(this.videoRef.nativeElement, {
      onResult: (result) => {
        console.log('Found QR:', result.text);
        this.session?.stop();
      },
      onError: (error) => {
        console.error('Scan error:', error);
      },
    });
  }

  stop(): void {
    this.session?.stop();
    this.session = null;
  }
}
```

Notes:

- Live scan requires browser APIs and should run in a secure context (`https://` or `localhost`).
- You can pause/resume/stop using the returned session.

---

## Styling examples

### Shape styling

```ts
const svg = qr.toSvg('https://example.com', {
  styles: {
    module: { shape: 'liquid', color: '#15223a' },
    eye: { shape: 'extra-rounded', color: '#0a0a0a' },
    pupil: { shape: 'diamond', color: '#0a0a0a' },
  },
});
```

### Gradient styling

```ts
const svg = qr.toSvg('gradient-demo', {
  styles: {
    module: {
      color: {
        type: 'linear',
        colors: ['#0f172a', '#2563eb', '#22d3ee'],
        rotation: 35,
      },
    },
  },
  lightColor: '#ffffff',
});
```

### Circle border with pattern prefill

```ts
const canvas = await qr.toCanvasAsync('ring-demo', undefined, {
  border: {
    shape: 'circle',
    width: 6,
    innerGap: 2,
    prefill: true,
    color: '#0f172a',
    innerColor: '#111827',
    outerColor: '#1e293b',
    opacity: 0.95,
  },
  styles: {
    module: { shape: 'liquid-flow', color: '#0f172a' },
  },
});
```

---

## API reference

### Generator service (`ngx-own-qr/generator`)

```ts
type QrInput = string | QrMatrix;
type QrGenOptions = QrEncodeOptions & QrRenderOptions;
type QrCanvas = HTMLCanvasElement | OffscreenCanvas;
type QrPixelData = ImageData | { data: Uint8ClampedArray; width: number; height: number };

class QrGeneratorService {
  encode(text: string, options?: QrEncodeOptions): QrMatrix;

  toSvg(input: QrInput, options?: QrGenOptions): string;

  toCanvas(input: QrInput, canvas?: QrCanvas, options?: QrGenOptions): QrCanvas;

  toCanvasAsync(input: QrInput, canvas?: QrCanvas, options?: QrGenOptions): Promise<QrCanvas>;

  toImageData(input: QrInput, options?: QrGenOptions): QrPixelData;

  toImageDataAsync(input: QrInput, options?: QrGenOptions): Promise<QrPixelData>;

  toPngBlob(input: QrInput, options?: QrGenOptions): Promise<Blob>;
  toDataUrl(input: QrInput, options?: QrGenOptions): Promise<string>;
}
```

### Scanner service (`ngx-own-qr/scanner`)

```ts
class QrScannerService {
  scan(source: QrSource, options?: QrScanOptions): Promise<QrScanResult | null>;

  scanFrame(imageData: QrImageDataLike, options?: QrScanOptions): QrScanResult | null;

  startVideoScan(video: HTMLVideoElement, handlers?: QrScanHandlers, options?: QrScanOptions): QrScanSession;
}
```

### Core exports (`ngx-own-qr/core`)

```ts
import {
  // Encode + render
  encode,
  renderSvg,
  renderCanvas,
  renderCanvasAsync,
  renderImageData,
  renderImageDataAsync,
  renderPngBlob,
  renderDataUrl,

  // Scan
  scan,
  scanFrame,
  startVideoScan,

  // Validation limits
  QR_RENDER_OPTION_LIMITS,
} from 'ngx-own-qr/core';
```

---

## Interface reference (most used)

```ts
type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

type QrModuleShape =
  | 'square'
  | 'rounded'
  | 'extra-rounded'
  | 'diamond'
  | 'splash'
  | 'liquid'
  | 'liquid-flow';

interface QrEncodeOptions {
  errorCorrection?: QrErrorCorrectionLevel;
  version?: number;
  mask?: number;
  margin?: number;
  scale?: number;
  darkColor?: string;
  lightColor?: string;
}

interface QrBorderOptions {
  shape?: 'square' | 'circle';
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

interface QrCenterContentOptions {
  mode?: 'none' | 'logo' | 'text';
  hideModulesBehind?: boolean;
  logo?: { src: string; crossOrigin?: string };
  text?: {
    value: string;
    color?: string;
    fontFamily?: string;
    fontWeight?: string | number;
  };
}

type QrGradientType = 'linear' | 'circular';

interface QrGradientColor {
  type: QrGradientType;
  colors: string[];
  rotation?: number;
}

type QrRenderColor = string | QrGradientColor;
type QrEyeShape = 'square' | 'rounded' | 'extra-rounded';
type QrPupilShape = 'square' | 'rounded' | 'extra-rounded' | 'diamond';

interface QrRenderStyles {
  module?: { shape?: QrModuleShape; color?: QrRenderColor };
  eye?: { shape?: QrEyeShape; color?: QrRenderColor };
  pupil?: { shape?: QrPupilShape; color?: QrRenderColor };
}

interface QrRenderOptions {
  margin?: number;
  scale?: number;
  darkColor?: string;
  lightColor?: string;
  styles?: QrRenderStyles;
  center?: QrCenterContentOptions;
  border?: QrBorderOptions;
}

interface QrScanOptions {
  scanRegion?: { x: number; y: number; width: number; height: number };
  inversionMode?: 'original' | 'invert' | 'attemptBoth';
  maxDimension?: number;
  videoThrottleMs?: number;
}

interface QrScanResult {
  text: string;
  bytes: Uint8Array;
  version: number;
  errorCorrection: QrErrorCorrectionLevel;
  mask: number;
  corners: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
}
```

---

## Limits for UI controls

Use this to keep your form sliders and validators aligned with internal clamping.

```ts
import { QR_RENDER_OPTION_LIMITS } from 'ngx-own-qr/core';

console.log(QR_RENDER_OPTION_LIMITS.margin.min); // 0
console.log(QR_RENDER_OPTION_LIMITS.scale.min); // 1
console.log(QR_RENDER_OPTION_LIMITS.border.width.min); // 1
console.log(QR_RENDER_OPTION_LIMITS.border.width.max); // 10
console.log(QR_RENDER_OPTION_LIMITS.border.innerGap.min); // 0
console.log(QR_RENDER_OPTION_LIMITS.border.innerGap.max); // 4
console.log(QR_RENDER_OPTION_LIMITS.border.opacity.min); // 0
console.log(QR_RENDER_OPTION_LIMITS.border.opacity.max); // 1
```

---

## Browser/runtime notes

- `encode` and `renderSvg` can be used without canvas output.
- `renderCanvas`, `renderPngBlob`, and scanner APIs rely on browser APIs.
- `startVideoScan` requires `requestAnimationFrame` and a browser environment.

---

## Build from source

```bash
npm install
npm run build
```

---

## License

MIT

If this library helps your product or team, a GitHub star helps this project grow and stay actively maintained.
