export * from './qr-generator.service';
export { QR_RENDER_OPTION_LIMITS } from 'ngx-own-qr/core';
export {
	encode,
	renderCanvas,
	renderCanvasAsync,
	renderDataUrl,
	renderImageData,
	renderImageDataAsync,
	renderPngBlob,
	renderSvg,
} from 'ngx-own-qr/core';
export type { QrEncodeOptions, QrMatrix, QrRenderOptions } from 'ngx-own-qr/core';
