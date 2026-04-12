import { Injectable } from '@angular/core';

import { encode, renderCanvas, renderDataUrl, renderImageData, renderPngBlob, renderSvg } from 'ngx-own-qr/core';
import type { QrEncodeOptions, QrMatrix, QrRenderOptions } from 'ngx-own-qr/core';

@Injectable({ providedIn: 'root' })
export class QrGeneratorService {
  encode(text: string, options: QrEncodeOptions = {}): QrMatrix {
    return encode(text, options);
  }

  toSvg(input: string | QrMatrix, options: QrEncodeOptions & QrRenderOptions = {}): string {
    return renderSvg(input, options);
  }

  toCanvas(
    input: string | QrMatrix,
    canvas?: HTMLCanvasElement | OffscreenCanvas,
    options: QrEncodeOptions & QrRenderOptions = {},
  ): HTMLCanvasElement | OffscreenCanvas {
    return renderCanvas(input, canvas, options);
  }

  toImageData(input: string | QrMatrix, options: QrEncodeOptions & QrRenderOptions = {}) {
    return renderImageData(input, options);
  }

  toPngBlob(input: string | QrMatrix, options: QrEncodeOptions & QrRenderOptions = {}): Promise<Blob> {
    return renderPngBlob(input, options);
  }

  toDataUrl(input: string | QrMatrix, options: QrEncodeOptions & QrRenderOptions = {}): Promise<string> {
    return renderDataUrl(input, options);
  }
}
