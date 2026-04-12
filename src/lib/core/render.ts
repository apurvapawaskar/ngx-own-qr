import { encodeQr } from './encoder';
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

function resolveMatrix(input: QrRenderableInput, options: QrEncodeOptions & QrRenderOptions): QrMatrix {
  return typeof input === 'string' ? encodeQr(input, options) : input;
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

  if (isPlainRender(renderOptions)) {
    return createPlainImageData(matrix, renderOptions);
  }

  if (!renderOptions.usesGradientStyles && !renderOptions.usesShapedStyles) {
    return createSquareStyledImageData(matrix, renderOptions);
  }

  const canvas = renderStyledCanvas(matrix, renderOptions);
  return toImageDataFromCanvas(canvas);
}

function renderStyledCanvas(matrix: QrMatrix, options: NormalizedRenderOptions, targetCanvas?: CanvasTarget): CanvasTarget {
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

  const modulePaint = createCanvasPaint(context, options.styles.moduleColor, qrArea, options.darkColor);
  const eyePaint = createCanvasPaint(context, options.styles.eyeColor, qrArea, options.darkColor);
  const pupilPaint = createCanvasPaint(context, options.styles.pupilColor, qrArea, options.darkColor);

  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (!matrix.modules[row][col] || getFinderPart(row, col, matrix.size)) {
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

  return canvas;
}

export function toCanvas(
  input: QrRenderableInput,
  canvas?: CanvasTarget,
  options: QrEncodeOptions & QrRenderOptions = {},
): CanvasTarget {
  const matrix = resolveMatrix(input, options);
  const renderOptions = normalizeRenderOptions(options);

  if (isPlainRender(renderOptions)) {
    const imageData = createPlainImageData(matrix, renderOptions);
    const target = canvas ?? getCanvasFactory().create(imageData.width, imageData.height);
    putPixelsOnCanvas(target, imageData);
    return target;
  }

  return renderStyledCanvas(matrix, renderOptions, canvas);
}

export async function toPngBlob(
  input: QrRenderableInput,
  options: QrEncodeOptions & QrRenderOptions = {},
): Promise<Blob> {
  const canvas = toCanvas(input, undefined, options);
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
  const canvas = toCanvas(input, undefined, options);
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
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${formatNumber(totalSize)} ${formatNumber(totalSize)}" shape-rendering="crispEdges">`,
    `<rect width="${formatNumber(totalSize)}" height="${formatNumber(totalSize)}" fill="${escapeXml(options.lightColor)}"/>`,
    `<path fill="${escapeXml(options.darkColor)}" d="${pathCommands.join(' ')}"/>`,
    '</svg>',
  ].join('');
}

function buildStyledSvg(matrix: QrMatrix, options: NormalizedRenderOptions): string {
  const totalSize = matrix.size + options.margin * 2;
  const qrArea: RenderArea = {
    x: options.margin,
    y: options.margin,
    width: matrix.size,
    height: matrix.size,
  };

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

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${formatNumber(totalSize)} ${formatNumber(totalSize)}">`,
    defs.length > 0 ? `<defs>${defs.join('')}</defs>` : '',
    elements.join(''),
    '</svg>',
  ].join('');
}

export function toSvg(input: QrRenderableInput, options: QrEncodeOptions & QrRenderOptions = {}): string {
  const matrix = resolveMatrix(input, options);
  const renderOptions = normalizeRenderOptions(options);

  if (isPlainRender(renderOptions)) {
    return buildPlainSvg(matrix, renderOptions);
  }

  return buildStyledSvg(matrix, renderOptions);
}
