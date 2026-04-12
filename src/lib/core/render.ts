import { createMatrix, drawFunctionPatterns, encodeQr } from './encoder';
import type { QrEncodeOptions, QrImageDataLike, QrMatrix, QrRenderOptions, QrRenderableInput } from './types';
import {
  FLOW_OVERLAP_RATIO,
  buildSvgPaint,
  createCanvasPaint,
  createImageDataLike,
  escapeXml,
  formatNumber,
  getCanvasContext,
  getCanvasFactory,
  getFinderPart,
  isPlainRender,
  normalizeRenderOptions,
  parseSolidStyleColor,
  putPixelsOnCanvas,
  type CanvasTarget,
  type NormalizedCenterOptions,
  type NormalizedRenderOptions,
  type RenderArea,
} from './render-options';
import {
  buildSvgEyeOuterElement,
  buildSvgShapeElement,
  fillCanvasShape,
  fillEyeOuterCanvas,
  getFlowModuleCornerRadii,
  getModuleCornerRadii,
} from './render-shapes';

interface OverlayBox {
  x: number;
  y: number;
  size: number;
  imageX: number;
  imageY: number;
  imageSize: number;
  radius: number;
}

const CENTER_BOX_RATIO = 0.22;
const CENTER_LOGO_RADIUS_RATIO = 0.12;

function resolveMatrix(input: QrRenderableInput, options: QrEncodeOptions & QrRenderOptions): QrMatrix {
  const logoMode = isLogoModeRequested(options);
  if (typeof input !== 'string') {
    if (logoMode && input.errorCorrection !== 'H') {
      throw new Error('QR center logo mode requires error correction level H for pre-encoded matrices.');
    }
    return input;
  }
  return encodeQr(input, {
    ...options,
    errorCorrection: logoMode ? 'H' : options.errorCorrection,
  });
}

function isLogoModeRequested(options: QrEncodeOptions & QrRenderOptions): boolean {
  const mode = options.center?.mode;
  if (mode === 'logo') {
    return true;
  }
  if (mode === 'text' || mode === 'none') {
    return false;
  }
  return Boolean(options.center?.logo?.src?.trim());
}

function getSafeCenterLimit(matrix: QrMatrix): number {
  const { modules, isFunction } = createMatrix(matrix.size);
  drawFunctionPatterns(modules, isFunction, matrix.version);
  const center = matrix.size / 2;

  for (let candidate = matrix.size; candidate >= 1; candidate -= 0.25) {
    const half = candidate / 2;
    const left = center - half;
    const top = center - half;
    const right = center + half;
    const bottom = center + half;
    let intersectsFunction = false;

    for (let row = 0; row < matrix.size && !intersectsFunction; row += 1) {
      for (let col = 0; col < matrix.size; col += 1) {
        if (!isFunction[row][col]) {
          continue;
        }
        if (left < col + 1 && right > col && top < row + 1 && bottom > row) {
          intersectsFunction = true;
          break;
        }
      }
    }

    if (!intersectsFunction) {
      return candidate;
    }
  }

  return 0;
}

function resolveOverlayBox(matrix: QrMatrix, center: NormalizedCenterOptions, qrArea: RenderArea): OverlayBox | null {
  if (center.mode === 'none') {
    return null;
  }

  const safeLimit = getSafeCenterLimit(matrix);
  if (safeLimit <= 0) {
    return null;
  }

  const requestedSize = matrix.size * CENTER_BOX_RATIO;
  const boxSize = Math.min(safeLimit, requestedSize);
  if (boxSize <= 0) {
    return null;
  }

  const imageSize = boxSize;
  const x = qrArea.x + (qrArea.width - boxSize) / 2;
  const y = qrArea.y + (qrArea.height - boxSize) / 2;
  const imageX = x;
  const imageY = y;

  return {
    x,
    y,
    size: boxSize,
    imageX,
    imageY,
    imageSize,
    radius: center.mode === 'logo' ? Math.min(boxSize * CENTER_LOGO_RADIUS_RATIO, boxSize / 2) : 0,
  };
}

function shouldSkipModuleForOverlayWithShape(
  row: number,
  col: number,
  overlayBox: OverlayBox | null,
  center: NormalizedCenterOptions,
  moduleShape: NormalizedRenderOptions['styles']['moduleShape'],
): boolean {
  if (!overlayBox || center.mode === 'none' || !center.hideModulesBehind) {
    return false;
  }

  const moduleCenterX = col + 0.5;
  const moduleCenterY = row + 0.5;

  if (moduleShape === 'square') {
    return (
      moduleCenterX >= overlayBox.x &&
      moduleCenterX <= overlayBox.x + overlayBox.size &&
      moduleCenterY >= overlayBox.y &&
      moduleCenterY <= overlayBox.y + overlayBox.size
    );
  }

  const centerX = overlayBox.x + overlayBox.size / 2;
  const centerY = overlayBox.y + overlayBox.size / 2;
  const half = overlayBox.size / 2;

  if (moduleShape === 'diamond') {
    return Math.abs(moduleCenterX - centerX) + Math.abs(moduleCenterY - centerY) <= half;
  }

  const dx = moduleCenterX - centerX;
  const dy = moduleCenterY - centerY;
  return dx * dx + dy * dy <= half * half;
}

function createPlainImageData(matrix: QrMatrix, options: NormalizedRenderOptions): QrImageDataLike {
  const cellSize = options.scale;
  const totalCells = matrix.size + options.margin * 2;
  const outputSize = totalCells * cellSize;
  const pixels = new Uint8ClampedArray(outputSize * outputSize * 4);

  for (let y = 0; y < outputSize; y += 1) {
    const matrixRow = Math.floor(y / cellSize) - options.margin;
    for (let x = 0; x < outputSize; x += 1) {
      const matrixCol = Math.floor(x / cellSize) - options.margin;
      const isDark =
        matrixRow >= 0 &&
        matrixCol >= 0 &&
        matrixRow < matrix.size &&
        matrixCol < matrix.size &&
        matrix.modules[matrixRow][matrixCol];
      const color = isDark ? options.darkRgba : options.lightRgba;
      const index = (y * outputSize + x) * 4;
      pixels[index] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
      pixels[index + 3] = color[3];
    }
  }

  return createImageDataLike(pixels, outputSize, outputSize);
}

function createSquareStyledImageData(matrix: QrMatrix, options: NormalizedRenderOptions): QrImageDataLike {
  const cellSize = options.scale;
  const totalCells = matrix.size + options.margin * 2;
  const outputSize = totalCells * cellSize;
  const pixels = new Uint8ClampedArray(outputSize * outputSize * 4);

  const moduleRgba = parseSolidStyleColor(options.styles.moduleColor, options.darkRgba);
  const eyeRgba = parseSolidStyleColor(options.styles.eyeColor, moduleRgba);
  const pupilRgba = parseSolidStyleColor(options.styles.pupilColor, moduleRgba);

  for (let y = 0; y < outputSize; y += 1) {
    const matrixRow = Math.floor(y / cellSize) - options.margin;
    for (let x = 0; x < outputSize; x += 1) {
      const matrixCol = Math.floor(x / cellSize) - options.margin;
      const index = (y * outputSize + x) * 4;
      if (
        matrixRow < 0 ||
        matrixCol < 0 ||
        matrixRow >= matrix.size ||
        matrixCol >= matrix.size ||
        !matrix.modules[matrixRow][matrixCol]
      ) {
        pixels[index] = options.lightRgba[0];
        pixels[index + 1] = options.lightRgba[1];
        pixels[index + 2] = options.lightRgba[2];
        pixels[index + 3] = options.lightRgba[3];
        continue;
      }

      const finderPart = getFinderPart(matrixRow, matrixCol, matrix.size);
      const color = finderPart === 'eye' ? eyeRgba : finderPart === 'pupil' ? pupilRgba : moduleRgba;
      pixels[index] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
      pixels[index + 3] = color[3];
    }
  }

  return createImageDataLike(pixels, outputSize, outputSize);
}

function toImageDataFromCanvas(canvas: CanvasTarget): QrImageDataLike {
  const context = getCanvasContext(canvas);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return createImageDataLike(new Uint8ClampedArray(image.data), image.width, image.height);
}

export function toImageData(input: QrRenderableInput, options: QrEncodeOptions & QrRenderOptions = {}): QrImageDataLike {
  const matrix = resolveMatrix(input, options);
  const renderOptions = normalizeRenderOptions(options);

  if (renderOptions.center.mode === 'logo') {
    throw new Error('Center logo rendering requires async helpers. Use toImageDataAsync().');
  }

  if (isPlainRender(renderOptions)) {
    return createPlainImageData(matrix, renderOptions);
  }

  if (!renderOptions.usesGradientStyles && !renderOptions.usesShapedStyles) {
    return createSquareStyledImageData(matrix, renderOptions);
  }

  const canvas = renderStyledCanvas(matrix, renderOptions);
  return toImageDataFromCanvas(canvas);
}

export async function toImageDataAsync(
  input: QrRenderableInput,
  options: QrEncodeOptions & QrRenderOptions = {},
): Promise<QrImageDataLike> {
  const renderOptions = normalizeRenderOptions(options);
  if (renderOptions.center.mode !== 'logo') {
    return toImageData(input, options);
  }
  const canvas = await renderStyledCanvasAsync(input, undefined, options);
  return toImageDataFromCanvas(canvas);
}

function renderStyledCanvas(
  matrix: QrMatrix,
  options: NormalizedRenderOptions,
  targetCanvas?: CanvasTarget,
  logoImage?: CanvasImageSource,
): CanvasTarget {
  const cellSize = options.scale;
  const totalCells = matrix.size + options.margin * 2;
  const outputSize = totalCells * cellSize;
  const canvas = targetCanvas ?? getCanvasFactory().create(outputSize, outputSize);
  canvas.width = outputSize;
  canvas.height = outputSize;

  const context = getCanvasContext(canvas);
  context.clearRect(0, 0, outputSize, outputSize);

  if (options.lightRgba[3] > 0) {
    context.fillStyle = options.lightColor;
    context.fillRect(0, 0, outputSize, outputSize);
  }

  const qrArea: RenderArea = {
    x: options.margin * cellSize,
    y: options.margin * cellSize,
    width: matrix.size * cellSize,
    height: matrix.size * cellSize,
  };
  const qrAreaInModules: RenderArea = {
    x: options.margin,
    y: options.margin,
    width: matrix.size,
    height: matrix.size,
  };
  const overlayModuleBox = resolveOverlayBox(matrix, options.center, qrAreaInModules);

  const modulePaint = createCanvasPaint(context, options.styles.moduleColor, qrArea, options.darkColor);
  const eyePaint = createCanvasPaint(context, options.styles.eyeColor, qrArea, options.darkColor);
  const pupilPaint = createCanvasPaint(context, options.styles.pupilColor, qrArea, options.darkColor);

  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (!matrix.modules[row][col] || getFinderPart(row, col, matrix.size)) {
        continue;
      }
      const moduleX = options.margin + col;
      const moduleY = options.margin + row;
      if (shouldSkipModuleForOverlayWithShape(moduleY, moduleX, overlayModuleBox, options.center, options.styles.moduleShape)) {
        continue;
      }
      const baseX = qrArea.x + col * cellSize;
      const baseY = qrArea.y + row * cellSize;
      const overlap = options.styles.moduleShape === 'liquid-flow' ? cellSize * FLOW_OVERLAP_RATIO : 0;
      const x = baseX - overlap;
      const y = baseY - overlap;
      const drawSize = cellSize + overlap * 2;
      const radii =
        options.styles.moduleShape === 'liquid'
          ? getModuleCornerRadii(matrix, row, col, cellSize)
          : options.styles.moduleShape === 'liquid-flow'
            ? getFlowModuleCornerRadii(matrix, row, col, drawSize)
            : undefined;
      fillCanvasShape(context, options.styles.moduleShape, x, y, drawSize, modulePaint, row, col, radii);
    }
  }

  const finderOrigins = [
    { x: qrArea.x, y: qrArea.y },
    { x: qrArea.x + (matrix.size - 7) * cellSize, y: qrArea.y },
    { x: qrArea.x, y: qrArea.y + (matrix.size - 7) * cellSize },
  ];

  for (const origin of finderOrigins) {
    fillEyeOuterCanvas(context, options.styles.eyeShape, origin.x, origin.y, cellSize, eyePaint);
    fillCanvasShape(
      context,
      options.styles.pupilShape,
      origin.x + 2 * cellSize,
      origin.y + 2 * cellSize,
      3 * cellSize,
      pupilPaint,
    );
  }

  drawCenterOverlayOnCanvas(context, options, overlayModuleBox, cellSize, logoImage);

  return canvas;
}

function drawCenterOverlayOnCanvas(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  options: NormalizedRenderOptions,
  overlayBox: OverlayBox | null,
  cellSize: number,
  logoImage?: CanvasImageSource,
): void {
  if (!overlayBox || options.center.mode === 'none') {
    return;
  }

  const x = overlayBox.x * cellSize;
  const y = overlayBox.y * cellSize;
  const size = overlayBox.size * cellSize;

  if (options.center.mode === 'text' && options.center.text) {
    context.save();
    context.fillStyle = options.center.text.color;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const lines = wrapCenterText(options.center.text.value);
    const fontSize = getCenterCanvasTextFontSize(
      context,
      lines,
      options.center.text.fontFamily,
      options.center.text.fontWeight,
      size,
      size,
    );
    context.font = `${options.center.text.fontWeight} ${fontSize}px ${options.center.text.fontFamily}`;
    drawWrappedCenterTextCanvas(context, lines, x + size / 2, y + size / 2, fontSize);
    context.restore();
    return;
  }

  if (options.center.mode === 'logo' && logoImage) {
    const imageX = overlayBox.imageX * cellSize;
    const imageY = overlayBox.imageY * cellSize;
    const imageSize = overlayBox.imageSize * cellSize;
    drawContainedImage(context, logoImage, imageX, imageY, imageSize, imageSize);
  }
}

function getCenterCanvasTextFontSize(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  lines: string[],
  fontFamily: string,
  fontWeight: string | number,
  targetWidth: number,
  targetHeight: number,
): number {
  const normalizedLines = lines.map((line) => line.trim()).filter((line) => line.length > 0);
  if (normalizedLines.length === 0) {
    return 1;
  }

  const widthBudget = Math.max(1, targetWidth * 0.96);
  const heightBudget = Math.max(1, targetHeight * (normalizedLines.length === 1 ? 0.84 : normalizedLines.length === 2 ? 0.7 : 0.62));
  let size = Math.max(1, Math.min(heightBudget, widthBudget));

  for (let i = 0; i < 5; i += 1) {
    context.font = `${fontWeight} ${size}px ${fontFamily}`;
    const maxMeasured = Math.max(...normalizedLines.map((line) => context.measureText(line).width));
    const estimatedHeight = size * normalizedLines.length * 1.06;
    if (maxMeasured <= widthBudget && estimatedHeight <= targetHeight * 0.94) {
      break;
    }
    const ratio = Math.min(widthBudget / maxMeasured, (targetHeight * 0.94) / Math.max(1, estimatedHeight));
    size = Math.max(1, size * ratio * 0.98);
  }

  return Math.max(1, Math.min(size, heightBudget));
}

function wrapCenterText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const words = trimmed.split(/\s+/);
  if (words.length === 1) {
    return [trimmed];
  }

  const targetLength = Math.max(4, Math.round(Math.sqrt(trimmed.length) * 1.6));
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > targetLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) {
    lines.push(current);
  }

  if (lines.length <= 3) {
    return lines;
  }

  const chunkSize = Math.max(1, Math.ceil(words.length / 3));
  const chunked: string[] = [];
  for (let index = 0; index < words.length; index += chunkSize) {
    chunked.push(words.slice(index, index + chunkSize).join(' '));
  }
  return chunked;
}

function drawWrappedCenterTextCanvas(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  lines: string[],
  centerX: number,
  centerY: number,
  fontSize: number,
): void {
  if (lines.length === 0) {
    return;
  }

  const lineHeight = fontSize * (lines.length === 1 ? 1.0 : 0.92);
  const totalHeight = lineHeight * lines.length;
  let y = centerY - totalHeight / 2 + lineHeight / 2;

  for (const line of lines) {
    context.fillText(line, centerX, y);
    y += lineHeight;
  }
}

function drawContainedImage(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const sourceWidth = (image as { width?: number; naturalWidth?: number }).naturalWidth ?? (image as { width?: number }).width;
  const sourceHeight =
    (image as { height?: number; naturalHeight?: number }).naturalHeight ?? (image as { height?: number }).height;
  if (!sourceWidth || !sourceHeight) {
    context.drawImage(image, x, y, width, height);
    return;
  }

  const ratio = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * ratio;
  const drawHeight = sourceHeight * ratio;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

async function loadCenterLogoImage(center: NormalizedRenderOptions['center']): Promise<CanvasImageSource> {
  const logoSrc = center.logoSrc;
  if (!logoSrc) {
    throw new Error('QR center logo mode requires center.logo.src.');
  }
  if (typeof Image !== 'undefined') {
    return new Promise((resolve, reject) => {
      const image = new Image();
      if (center.logoCrossOrigin) {
        image.crossOrigin = center.logoCrossOrigin;
      }
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Failed to load center logo image from "${logoSrc}".`));
      image.src = logoSrc;
    });
  }
  if (typeof fetch === 'function' && typeof createImageBitmap === 'function') {
    const response = await fetch(logoSrc);
    if (!response.ok) {
      throw new Error(`Failed to load center logo image from "${logoSrc}".`);
    }
    return createImageBitmap(await response.blob());
  }
  throw new Error('Center logo rendering requires browser image APIs.');
}

async function renderStyledCanvasAsync(
  input: QrRenderableInput,
  targetCanvas: CanvasTarget | undefined,
  options: QrEncodeOptions & QrRenderOptions,
): Promise<CanvasTarget> {
  const matrix = resolveMatrix(input, options);
  const renderOptions = normalizeRenderOptions(options);
  const logoImage = renderOptions.center.mode === 'logo' ? await loadCenterLogoImage(renderOptions.center) : undefined;
  return renderStyledCanvas(matrix, renderOptions, targetCanvas, logoImage);
}

export function toCanvas(
  input: QrRenderableInput,
  canvas?: CanvasTarget,
  options: QrEncodeOptions & QrRenderOptions = {},
): CanvasTarget {
  const matrix = resolveMatrix(input, options);
  const renderOptions = normalizeRenderOptions(options);

  if (renderOptions.center.mode === 'logo') {
    throw new Error('Center logo rendering requires async canvas helper. Use toCanvasAsync().');
  }

  if (isPlainRender(renderOptions)) {
    const imageData = createPlainImageData(matrix, renderOptions);
    const target = canvas ?? getCanvasFactory().create(imageData.width, imageData.height);
    putPixelsOnCanvas(target, imageData);
    return target;
  }

  return renderStyledCanvas(matrix, renderOptions, canvas);
}

export async function toCanvasAsync(
  input: QrRenderableInput,
  canvas?: CanvasTarget,
  options: QrEncodeOptions & QrRenderOptions = {},
): Promise<CanvasTarget> {
  const renderOptions = normalizeRenderOptions(options);
  if (renderOptions.center.mode !== 'logo') {
    return toCanvas(input, canvas, options);
  }
  return renderStyledCanvasAsync(input, canvas, options);
}

export async function toPngBlob(
  input: QrRenderableInput,
  options: QrEncodeOptions & QrRenderOptions = {},
): Promise<Blob> {
  const renderOptions = normalizeRenderOptions(options);
  const canvas = renderOptions.center.mode === 'logo' ? await toCanvasAsync(input, undefined, options) : toCanvas(input, undefined, options);
  if ('convertToBlob' in canvas && typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: 'image/png' });
  }
  if ('toBlob' in canvas && typeof canvas.toBlob === 'function') {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to serialize the QR canvas to PNG.'));
        }
      }, 'image/png');
    });
  }
  throw new Error('PNG export is only available in browser environments.');
}

export async function toDataUrl(
  input: QrRenderableInput,
  options: QrEncodeOptions & QrRenderOptions = {},
): Promise<string> {
  const renderOptions = normalizeRenderOptions(options);
  const canvas = renderOptions.center.mode === 'logo' ? await toCanvasAsync(input, undefined, options) : toCanvas(input, undefined, options);
  if ('toDataURL' in canvas && typeof canvas.toDataURL === 'function') {
    return canvas.toDataURL('image/png');
  }
  const blob = await toPngBlob(input, options);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

function buildPlainSvg(matrix: QrMatrix, options: NormalizedRenderOptions): string {
  const totalSize = matrix.size + options.margin * 2;
  const scaledSize = totalSize * options.scale;
  const pathCommands: string[] = [];

  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (matrix.modules[row][col]) {
        const x = col + options.margin;
        const y = row + options.margin;
        pathCommands.push(`M${x},${y}h1v1h-1z`);
      }
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${formatNumber(totalSize)} ${formatNumber(totalSize)}" width="${formatNumber(scaledSize)}" height="${formatNumber(scaledSize)}" shape-rendering="crispEdges">`,
    `<rect width="${formatNumber(totalSize)}" height="${formatNumber(totalSize)}" fill="${escapeXml(options.lightColor)}"/>`,
    `<path fill="${escapeXml(options.darkColor)}" d="${pathCommands.join(' ')}"/>`,
    '</svg>',
  ].join('');
}

function buildStyledSvg(matrix: QrMatrix, options: NormalizedRenderOptions): string {
  const totalSize = matrix.size + options.margin * 2;
  const scaledSize = totalSize * options.scale;
  const qrArea: RenderArea = {
    x: options.margin,
    y: options.margin,
    width: matrix.size,
    height: matrix.size,
  };
  const overlayModuleBox = resolveOverlayBox(matrix, options.center, qrArea);

  const defs: string[] = [];
  const elements: string[] = [];
  const moduleFill = buildSvgPaint(options.styles.moduleColor, qrArea, defs, options.darkColor);
  const eyeFill = buildSvgPaint(options.styles.eyeColor, qrArea, defs, options.darkColor);
  const pupilFill = buildSvgPaint(options.styles.pupilColor, qrArea, defs, options.darkColor);

  elements.push(`<rect width="${formatNumber(totalSize)}" height="${formatNumber(totalSize)}" fill="${escapeXml(options.lightColor)}"/>`);

  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (!matrix.modules[row][col] || getFinderPart(row, col, matrix.size)) {
        continue;
      }
      const moduleX = options.margin + col;
      const moduleY = options.margin + row;
      if (shouldSkipModuleForOverlayWithShape(moduleY, moduleX, overlayModuleBox, options.center, options.styles.moduleShape)) {
        continue;
      }
      const baseX = qrArea.x + col;
      const baseY = qrArea.y + row;
      const overlap = options.styles.moduleShape === 'liquid-flow' ? FLOW_OVERLAP_RATIO : 0;
      const x = baseX - overlap;
      const y = baseY - overlap;
      const drawSize = 1 + overlap * 2;
      const radii =
        options.styles.moduleShape === 'liquid'
          ? getModuleCornerRadii(matrix, row, col, 1)
          : options.styles.moduleShape === 'liquid-flow'
            ? getFlowModuleCornerRadii(matrix, row, col, drawSize)
            : undefined;
      elements.push(buildSvgShapeElement(options.styles.moduleShape, x, y, drawSize, moduleFill, row, col, radii));
    }
  }

  const finderOrigins = [
    { x: qrArea.x, y: qrArea.y },
    { x: qrArea.x + matrix.size - 7, y: qrArea.y },
    { x: qrArea.x, y: qrArea.y + matrix.size - 7 },
  ];

  for (const origin of finderOrigins) {
    elements.push(buildSvgEyeOuterElement(options.styles.eyeShape, origin.x, origin.y, eyeFill));
    elements.push(buildSvgShapeElement(options.styles.pupilShape, origin.x + 2, origin.y + 2, 3, pupilFill));
  }

  appendCenterOverlaySvg(elements, options, overlayModuleBox);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${formatNumber(totalSize)} ${formatNumber(totalSize)}" width="${formatNumber(scaledSize)}" height="${formatNumber(scaledSize)}">`,
    defs.length > 0 ? `<defs>${defs.join('')}</defs>` : '',
    elements.join(''),
    '</svg>',
  ].join('');
}

function appendCenterOverlaySvg(
  elements: string[],
  options: NormalizedRenderOptions,
  overlayBox: OverlayBox | null,
): void {
  if (!overlayBox || options.center.mode === 'none') {
    return;
  }

  if (options.center.mode === 'text' && options.center.text) {
    const lines = wrapCenterText(options.center.text.value);
    const fontSize = getCenterSvgTextFontSize(lines, overlayBox.size);
    const textLength = Math.max(1, overlayBox.size * 0.96);
    const lineHeight = fontSize * (lines.length === 1 ? 1.0 : 0.92);
    const totalHeight = lineHeight * lines.length;
    const startY = overlayBox.y + overlayBox.size / 2 - totalHeight / 2 + lineHeight / 2;
    const tspans = lines
      .map(
        (line, index) =>
          `<tspan x="${formatNumber(overlayBox.x + overlayBox.size / 2)}" dy="${index === 0 ? 0 : formatNumber(lineHeight)}" textLength="${formatNumber(textLength)}" lengthAdjust="spacingAndGlyphs">${escapeXml(line)}</tspan>`,
      )
      .join('');
    elements.push(
      `<text x="${formatNumber(overlayBox.x + overlayBox.size / 2)}" y="${formatNumber(startY)}" fill="${escapeXml(options.center.text.color)}" font-family="${escapeXml(options.center.text.fontFamily)}" font-size="${formatNumber(fontSize)}" font-weight="${escapeXml(String(options.center.text.fontWeight))}" text-anchor="middle" dominant-baseline="middle">${tspans}</text>`,
    );
    return;
  }

  if (options.center.mode === 'logo' && options.center.logoSrc) {
    elements.push(
      `<image href="${escapeXml(options.center.logoSrc)}" x="${formatNumber(overlayBox.imageX)}" y="${formatNumber(overlayBox.imageY)}" width="${formatNumber(overlayBox.imageSize)}" height="${formatNumber(overlayBox.imageSize)}" preserveAspectRatio="xMidYMid meet"/>`,
    );
  }
}

function getCenterSvgTextFontSize(lines: string[], boxSize: number): number {
  const normalizedLines = lines.map((line) => line.trim()).filter((line) => line.length > 0);
  if (normalizedLines.length === 0) {
    return 1;
  }
  const byHeight = Math.max(1, boxSize * (normalizedLines.length === 1 ? 0.84 : normalizedLines.length === 2 ? 0.7 : 0.62));
  const longestLine = Math.max(...normalizedLines.map((line) => line.length));
  const byWidth = Math.max(1, (boxSize * 0.96) / Math.max(1, longestLine * 0.58));
  return Math.max(1, Math.min(byHeight, byWidth));
}

export function toSvg(input: QrRenderableInput, options: QrEncodeOptions & QrRenderOptions = {}): string {
  const matrix = resolveMatrix(input, options);
  const renderOptions = normalizeRenderOptions(options);

  if (isPlainRender(renderOptions)) {
    return buildPlainSvg(matrix, renderOptions);
  }

  return buildStyledSvg(matrix, renderOptions);
}
