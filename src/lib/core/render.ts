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
  type CanvasPaint,
  type CornerRadii,
  type NormalizedBorderOptions,
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

interface RenderLayout {
  totalModules: number;
  qrOffsetX: number;
  qrOffsetY: number;
  squareBorder?: {
    outerX: number;
    outerY: number;
    outerSize: number;
    innerX: number;
    innerY: number;
    innerSize: number;
  };
  circleBorder?: {
    centerX: number;
    centerY: number;
    innerRadius: number;
    outerRadius: number;
  };
}

const CENTER_BOX_RATIO = 0.3;
const CENTER_LOGO_RADIUS_RATIO = 0.16;
const CIRCLE_PATCH_PATTERN_TILE_SCALE = 0.86;
const CIRCLE_PATCH_PATTERN_OPACITY = 0.62;
const CIRCLE_PATCH_QR_GAP = 0.18;
const CIRCLE_PATCH_EDGE_INSET = 0.2;
const CIRCLE_PATCH_SCATTER_DENSITY = 0.54;
const CIRCLE_PATCH_MAX_NEIGHBORS = 2;
const CIRCLE_PATCH_EMPTY_POCKET_FILL_PROBABILITY = 0.84;
const CIRCLE_PATCH_SOFT_POCKET_FILL_PROBABILITY = 0.26;

interface PatternCell {
  row: number;
  col: number;
  x: number;
  y: number;
}

function resolveRenderLayout(matrixSize: number, options: NormalizedRenderOptions): RenderLayout {
  const border = options.border;
  if (!border) {
    const totalModules = matrixSize + options.margin * 2;
    return {
      totalModules,
      qrOffsetX: options.margin,
      qrOffsetY: options.margin,
    };
  }

  if (border.shape === 'circle') {
    const innerRadius = (matrixSize * Math.SQRT2) / 2 + border.innerGap;
    const outerRadius = innerRadius + border.width;
    const center = options.margin + outerRadius;
    return {
      totalModules: 2 * (options.margin + outerRadius),
      qrOffsetX: center - matrixSize / 2,
      qrOffsetY: center - matrixSize / 2,
      circleBorder: {
        centerX: center,
        centerY: center,
        innerRadius,
        outerRadius,
      },
    };
  }

  const borderBand = border.innerGap + border.width;
  const qrOffset = options.margin + borderBand;
  return {
    totalModules: matrixSize + 2 * (options.margin + borderBand),
    qrOffsetX: qrOffset,
    qrOffsetY: qrOffset,
    squareBorder: {
      outerX: options.margin,
      outerY: options.margin,
      outerSize: matrixSize + 2 * borderBand,
      innerX: qrOffset - border.innerGap,
      innerY: qrOffset - border.innerGap,
      innerSize: matrixSize + border.innerGap * 2,
    },
  };
}

function resolveBorderLayerWidths(border: NormalizedBorderOptions): { outer: number; inner: number } {
  const hasOuter = Boolean(border.outerColor);
  const hasInner = Boolean(border.innerColor);
  if (!hasOuter && !hasInner) {
    return { outer: 0, inner: 0 };
  }

  const desiredOuter = hasOuter ? border.width * 0.28 : 0;
  const desiredInner = hasInner ? border.width * 0.28 : 0;
  const minBaseBand = Math.min(Math.max(border.width * 0.2, 0.35), border.width);
  const availableForLayers = Math.max(0, border.width - minBaseBand);
  const desiredTotal = desiredOuter + desiredInner;

  if (desiredTotal <= 0 || availableForLayers <= 0) {
    return { outer: 0, inner: 0 };
  }

  const scale = Math.min(1, availableForLayers / desiredTotal);
  return {
    outer: desiredOuter * scale,
    inner: desiredInner * scale,
  };
}

function fillCanvasRectRing(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  outerX: number,
  outerY: number,
  outerSize: number,
  innerX: number,
  innerY: number,
  innerSize: number,
  fillStyle: string,
  opacity: number,
): void {
  context.save();
  context.globalAlpha = Math.max(0, Math.min(1, opacity));
  context.fillStyle = fillStyle;
  context.beginPath();
  context.rect(outerX, outerY, outerSize, outerSize);
  context.rect(innerX, innerY, innerSize, innerSize);
  context.fill('evenodd');
  context.restore();
}

function fillCanvasCircleRing(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  outerRadius: number,
  innerRadius: number,
  fillStyle: string,
  opacity: number,
): void {
  context.save();
  context.globalAlpha = Math.max(0, Math.min(1, opacity));
  context.fillStyle = fillStyle;
  context.beginPath();
  context.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
  context.arc(centerX, centerY, innerRadius, 0, Math.PI * 2, true);
  context.fill('evenodd');
  context.restore();
}

function fillCanvasPatternTile(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  shape: NormalizedRenderOptions['styles']['moduleShape'],
  x: number,
  y: number,
  size: number,
  paint: CanvasPaint,
  opacity: number,
  row: number,
  col: number,
  cornerRadii?: CornerRadii,
): void {
  context.save();
  context.globalAlpha = Math.max(0, Math.min(1, opacity));
  fillCanvasShape(context, shape, x, y, size, paint, row, col, cornerRadii);
  context.restore();
}

function getPatternCellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function getPatternScatterNoise(row: number, col: number, salt: number): number {
  let hash = Math.imul(row ^ Math.imul(salt + 1, 374761393), 668265263);
  hash ^= Math.imul(col ^ Math.imul(salt + 1, 1274126177), 2246822519);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 1274126177);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

function countFilledPatternNeighbors(filled: Set<string>, row: number, col: number): number {
  let count = 0;
  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let colOffset = -1; colOffset <= 1; colOffset += 1) {
      if (rowOffset === 0 && colOffset === 0) {
        continue;
      }
      if (filled.has(getPatternCellKey(row + rowOffset, col + colOffset))) {
        count += 1;
      }
    }
  }
  return count;
}

function resolveCirclePatchPatternCells(
  matrix: QrMatrix,
  layout: RenderLayout,
  qrAreaInModules: RenderArea,
): PatternCell[] {
  if (!layout.circleBorder) {
    return [];
  }

  const circle = layout.circleBorder;
  const innerRadiusLimit = Math.max(0, circle.innerRadius - CIRCLE_PATCH_EDGE_INSET);
  const radiusSq = innerRadiusLimit * innerRadiusLimit;

  const minCol = Math.floor(circle.centerX - innerRadiusLimit - qrAreaInModules.x - 1);
  const maxCol = Math.ceil(circle.centerX + innerRadiusLimit - qrAreaInModules.x + 1);
  const minRow = Math.floor(circle.centerY - innerRadiusLimit - qrAreaInModules.y - 1);
  const maxRow = Math.ceil(circle.centerY + innerRadiusLimit - qrAreaInModules.y + 1);

  const cells: PatternCell[] = [];
  const tileInset = (1 - CIRCLE_PATCH_PATTERN_TILE_SCALE) / 2;

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const localCenterX = col + 0.5;
      const localCenterY = row + 0.5;

      const isNearQr =
        localCenterX > -CIRCLE_PATCH_QR_GAP &&
        localCenterX < matrix.size + CIRCLE_PATCH_QR_GAP &&
        localCenterY > -CIRCLE_PATCH_QR_GAP &&
        localCenterY < matrix.size + CIRCLE_PATCH_QR_GAP;
      if (isNearQr) {
        continue;
      }

      const absoluteCenterX = qrAreaInModules.x + localCenterX;
      const absoluteCenterY = qrAreaInModules.y + localCenterY;
      const dx = absoluteCenterX - circle.centerX;
      const dy = absoluteCenterY - circle.centerY;
      if (dx * dx + dy * dy > radiusSq) {
        continue;
      }

      cells.push({
        row,
        col,
        x: qrAreaInModules.x + col + tileInset,
        y: qrAreaInModules.y + row + tileInset,
      });
    }
  }

  if (cells.length === 0) {
    return cells;
  }

  const ordered = [...cells].sort(
    (left, right) => getPatternScatterNoise(left.row, left.col, 11) - getPatternScatterNoise(right.row, right.col, 11),
  );
  const filled = new Set<string>();

  for (const cell of ordered) {
    if (getPatternScatterNoise(cell.row, cell.col, 17) > CIRCLE_PATCH_SCATTER_DENSITY) {
      continue;
    }

    const neighbors = countFilledPatternNeighbors(filled, cell.row, cell.col);
    if (neighbors > CIRCLE_PATCH_MAX_NEIGHBORS) {
      continue;
    }

    if (neighbors === 2) {
      const hasHorizontalBridge =
        filled.has(getPatternCellKey(cell.row, cell.col - 1)) && filled.has(getPatternCellKey(cell.row, cell.col + 1));
      const hasVerticalBridge =
        filled.has(getPatternCellKey(cell.row - 1, cell.col)) && filled.has(getPatternCellKey(cell.row + 1, cell.col));
      if ((hasHorizontalBridge || hasVerticalBridge) && getPatternScatterNoise(cell.row, cell.col, 23) > 0.35) {
        continue;
      }
    }

    filled.add(getPatternCellKey(cell.row, cell.col));
  }

  for (const cell of ordered) {
    const key = getPatternCellKey(cell.row, cell.col);
    if (filled.has(key)) {
      continue;
    }

    const neighbors = countFilledPatternNeighbors(filled, cell.row, cell.col);
    const noise = getPatternScatterNoise(cell.row, cell.col, 29);
    if (neighbors === 0 && noise < CIRCLE_PATCH_EMPTY_POCKET_FILL_PROBABILITY) {
      filled.add(key);
      continue;
    }

    if (neighbors === 1 && noise < CIRCLE_PATCH_SOFT_POCKET_FILL_PROBABILITY) {
      filled.add(key);
    }
  }

  return cells.filter((cell) => filled.has(getPatternCellKey(cell.row, cell.col)));
}

function getCirclePatchPatternRadii(
  shape: NormalizedRenderOptions['styles']['moduleShape'],
  filledCells: Set<string>,
  row: number,
  col: number,
  size: number,
): CornerRadii | undefined {
  if (shape !== 'liquid' && shape !== 'liquid-flow') {
    return undefined;
  }

  const has = (r: number, c: number) => filledCells.has(getPatternCellKey(r, c));
  const up = has(row - 1, col);
  const right = has(row, col + 1);
  const down = has(row + 1, col);
  const left = has(row, col - 1);
  const radius = size * 0.45;

  if (shape === 'liquid-flow') {
    const topLeftDiag = has(row - 1, col - 1);
    const topRightDiag = has(row - 1, col + 1);
    const bottomRightDiag = has(row + 1, col + 1);
    const bottomLeftDiag = has(row + 1, col - 1);
    return {
      topLeft: !up && !left && !topLeftDiag ? radius : 0,
      topRight: !up && !right && !topRightDiag ? radius : 0,
      bottomRight: !down && !right && !bottomRightDiag ? radius : 0,
      bottomLeft: !down && !left && !bottomLeftDiag ? radius : 0,
    };
  }

  return {
    topLeft: !up && !left ? radius : 0,
    topRight: !up && !right ? radius : 0,
    bottomRight: !down && !right ? radius : 0,
    bottomLeft: !down && !left ? radius : 0,
  };
}

function drawCirclePatchPatternOnCanvas(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  matrix: QrMatrix,
  options: NormalizedRenderOptions,
  layout: RenderLayout,
  qrAreaInModules: RenderArea,
  cellSize: number,
  modulePaint: CanvasPaint,
): void {
  if (!layout.circleBorder || options.border?.prefill === false) {
    return;
  }

  const patternCells = resolveCirclePatchPatternCells(matrix, layout, qrAreaInModules);
  if (patternCells.length === 0) {
    return;
  }

  const filled = new Set<string>(patternCells.map((cell) => getPatternCellKey(cell.row, cell.col)));
  const tileSize = CIRCLE_PATCH_PATTERN_TILE_SCALE * cellSize;

  for (const cell of patternCells) {
    const shape = options.styles.moduleShape;
    const radii = getCirclePatchPatternRadii(shape, filled, cell.row, cell.col, tileSize);
    fillCanvasPatternTile(
      context,
      shape,
      cell.x * cellSize,
      cell.y * cellSize,
      tileSize,
      modulePaint,
      CIRCLE_PATCH_PATTERN_OPACITY,
      cell.row,
      cell.col,
      radii,
    );
  }
}


function drawBorderOnCanvas(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  border: NormalizedBorderOptions | undefined,
  layout: RenderLayout,
  cellSize: number,
): void {
  if (!border) {
    return;
  }

  const layerWidths = resolveBorderLayerWidths(border);
  const outerLayer = layerWidths.outer;
  const innerLayer = layerWidths.inner;

  if (layout.squareBorder) {
    const outer = layout.squareBorder;
    fillCanvasRectRing(
      context,
      outer.outerX * cellSize,
      outer.outerY * cellSize,
      outer.outerSize * cellSize,
      outer.innerX * cellSize,
      outer.innerY * cellSize,
      outer.innerSize * cellSize,
      border.color,
      border.opacity,
    );

    if (border.outerColor && outerLayer > 0) {
      const inset = outerLayer * cellSize;
      fillCanvasRectRing(
        context,
        outer.outerX * cellSize,
        outer.outerY * cellSize,
        outer.outerSize * cellSize,
        outer.outerX * cellSize + inset,
        outer.outerY * cellSize + inset,
        outer.outerSize * cellSize - inset * 2,
        border.outerColor,
        border.outerOpacity,
      );
    }

    if (border.innerColor && innerLayer > 0) {
      fillCanvasRectRing(
        context,
        (outer.innerX - innerLayer) * cellSize,
        (outer.innerY - innerLayer) * cellSize,
        (outer.innerSize + innerLayer * 2) * cellSize,
        outer.innerX * cellSize,
        outer.innerY * cellSize,
        outer.innerSize * cellSize,
        border.innerColor,
        border.innerOpacity,
      );
    }
    return;
  }

  if (!layout.circleBorder) {
    return;
  }

  const circle = layout.circleBorder;
  fillCanvasCircleRing(
    context,
    circle.centerX * cellSize,
    circle.centerY * cellSize,
    circle.outerRadius * cellSize,
    circle.innerRadius * cellSize,
    border.color,
    border.opacity,
  );

  if (border.outerColor && outerLayer > 0) {
    fillCanvasCircleRing(
      context,
      circle.centerX * cellSize,
      circle.centerY * cellSize,
      circle.outerRadius * cellSize,
      (circle.outerRadius - outerLayer) * cellSize,
      border.outerColor,
      border.outerOpacity,
    );
  }

  if (border.innerColor && innerLayer > 0) {
    fillCanvasCircleRing(
      context,
      circle.centerX * cellSize,
      circle.centerY * cellSize,
      (circle.innerRadius + innerLayer) * cellSize,
      circle.innerRadius * cellSize,
      border.innerColor,
      border.innerOpacity,
    );
  }
}

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

  if (!renderOptions.usesGradientStyles && !renderOptions.usesShapedStyles && !renderOptions.hasBorder) {
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
  const layout = resolveRenderLayout(matrix.size, options);
  const outputSize = layout.totalModules * cellSize;
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
    x: layout.qrOffsetX * cellSize,
    y: layout.qrOffsetY * cellSize,
    width: matrix.size * cellSize,
    height: matrix.size * cellSize,
  };
  const qrAreaInModules: RenderArea = {
    x: layout.qrOffsetX,
    y: layout.qrOffsetY,
    width: matrix.size,
    height: matrix.size,
  };
  const overlayModuleBox = resolveOverlayBox(matrix, options.center, qrAreaInModules);

  const modulePaint = createCanvasPaint(context, options.styles.moduleColor, qrArea, options.darkColor);
  const eyePaint = createCanvasPaint(context, options.styles.eyeColor, qrArea, options.darkColor);
  const pupilPaint = createCanvasPaint(context, options.styles.pupilColor, qrArea, options.darkColor);

  drawCirclePatchPatternOnCanvas(context, matrix, options, layout, qrAreaInModules, cellSize, modulePaint);

  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (!matrix.modules[row][col] || getFinderPart(row, col, matrix.size)) {
        continue;
      }
      const moduleX = qrAreaInModules.x + col;
      const moduleY = qrAreaInModules.y + row;
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
  drawBorderOnCanvas(context, options.border, layout, cellSize);

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

function buildSvgRectRingPath(
  outerX: number,
  outerY: number,
  outerSize: number,
  innerX: number,
  innerY: number,
  innerSize: number,
): string {
  return [
    `M${formatNumber(outerX)},${formatNumber(outerY)}h${formatNumber(outerSize)}v${formatNumber(outerSize)}h${formatNumber(-outerSize)}z`,
    `M${formatNumber(innerX)},${formatNumber(innerY)}h${formatNumber(innerSize)}v${formatNumber(innerSize)}h${formatNumber(-innerSize)}z`,
  ].join(' ');
}

function buildSvgCircleRingPath(centerX: number, centerY: number, outerRadius: number, innerRadius: number): string {
  return [
    `M${formatNumber(centerX + outerRadius)},${formatNumber(centerY)}`,
    `A${formatNumber(outerRadius)},${formatNumber(outerRadius)} 0 1 0 ${formatNumber(centerX - outerRadius)},${formatNumber(centerY)}`,
    `A${formatNumber(outerRadius)},${formatNumber(outerRadius)} 0 1 0 ${formatNumber(centerX + outerRadius)},${formatNumber(centerY)}`,
    `M${formatNumber(centerX + innerRadius)},${formatNumber(centerY)}`,
    `A${formatNumber(innerRadius)},${formatNumber(innerRadius)} 0 1 1 ${formatNumber(centerX - innerRadius)},${formatNumber(centerY)}`,
    `A${formatNumber(innerRadius)},${formatNumber(innerRadius)} 0 1 1 ${formatNumber(centerX + innerRadius)},${formatNumber(centerY)}`,
  ].join(' ');
}

function buildSvgOpacityAttribute(opacity: number): string {
  if (opacity >= 1) {
    return '';
  }
  return ` fill-opacity="${formatNumber(opacity)}"`;
}

function appendBorderSvg(elements: string[], border: NormalizedBorderOptions | undefined, layout: RenderLayout): void {
  if (!border) {
    return;
  }

  const layerWidths = resolveBorderLayerWidths(border);
  const outerLayer = layerWidths.outer;
  const innerLayer = layerWidths.inner;

  if (layout.squareBorder) {
    const square = layout.squareBorder;
    const basePath = buildSvgRectRingPath(
      square.outerX,
      square.outerY,
      square.outerSize,
      square.innerX,
      square.innerY,
      square.innerSize,
    );
    elements.push(`<path d="${basePath}" fill="${escapeXml(border.color)}" fill-rule="evenodd"${buildSvgOpacityAttribute(border.opacity)}/>`);

    if (border.outerColor && outerLayer > 0) {
      const path = buildSvgRectRingPath(
        square.outerX,
        square.outerY,
        square.outerSize,
        square.outerX + outerLayer,
        square.outerY + outerLayer,
        square.outerSize - outerLayer * 2,
      );
      elements.push(`<path d="${path}" fill="${escapeXml(border.outerColor)}" fill-rule="evenodd"${buildSvgOpacityAttribute(border.outerOpacity)}/>`);
    }

    if (border.innerColor && innerLayer > 0) {
      const path = buildSvgRectRingPath(
        square.innerX - innerLayer,
        square.innerY - innerLayer,
        square.innerSize + innerLayer * 2,
        square.innerX,
        square.innerY,
        square.innerSize,
      );
      elements.push(`<path d="${path}" fill="${escapeXml(border.innerColor)}" fill-rule="evenodd"${buildSvgOpacityAttribute(border.innerOpacity)}/>`);
    }
    return;
  }

  if (!layout.circleBorder) {
    return;
  }

  const circle = layout.circleBorder;
  const basePath = buildSvgCircleRingPath(circle.centerX, circle.centerY, circle.outerRadius, circle.innerRadius);
  elements.push(`<path d="${basePath}" fill="${escapeXml(border.color)}" fill-rule="evenodd"${buildSvgOpacityAttribute(border.opacity)}/>`);

  if (border.outerColor && outerLayer > 0) {
    const path = buildSvgCircleRingPath(
      circle.centerX,
      circle.centerY,
      circle.outerRadius,
      circle.outerRadius - outerLayer,
    );
    elements.push(`<path d="${path}" fill="${escapeXml(border.outerColor)}" fill-rule="evenodd"${buildSvgOpacityAttribute(border.outerOpacity)}/>`);
  }

  if (border.innerColor && innerLayer > 0) {
    const path = buildSvgCircleRingPath(
      circle.centerX,
      circle.centerY,
      circle.innerRadius + innerLayer,
      circle.innerRadius,
    );
    elements.push(`<path d="${path}" fill="${escapeXml(border.innerColor)}" fill-rule="evenodd"${buildSvgOpacityAttribute(border.innerOpacity)}/>`);
  }
}

function appendCirclePatchPatternSvg(
  elements: string[],
  matrix: QrMatrix,
  options: NormalizedRenderOptions,
  layout: RenderLayout,
  qrAreaInModules: RenderArea,
  moduleFill: string,
): void {
  if (!layout.circleBorder || options.border?.prefill === false) {
    return;
  }

  const patternCells = resolveCirclePatchPatternCells(matrix, layout, qrAreaInModules);
  if (patternCells.length === 0) {
    return;
  }

  const filled = new Set<string>(patternCells.map((cell) => getPatternCellKey(cell.row, cell.col)));
  const tileSize = CIRCLE_PATCH_PATTERN_TILE_SCALE;
  const tiles: string[] = [];

  for (const cell of patternCells) {
    const shape = options.styles.moduleShape;
    const radii = getCirclePatchPatternRadii(shape, filled, cell.row, cell.col, tileSize);
    tiles.push(buildSvgShapeElement(shape, cell.x, cell.y, tileSize, moduleFill, cell.row, cell.col, radii));
  }

  const opacityAttribute = buildSvgOpacityAttribute(CIRCLE_PATCH_PATTERN_OPACITY);
  elements.push(`<g${opacityAttribute}>${tiles.join('')}</g>`);
}

function buildStyledSvg(matrix: QrMatrix, options: NormalizedRenderOptions): string {
  const layout = resolveRenderLayout(matrix.size, options);
  const totalSize = layout.totalModules;
  const scaledSize = totalSize * options.scale;
  const qrArea: RenderArea = {
    x: layout.qrOffsetX,
    y: layout.qrOffsetY,
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
  appendCirclePatchPatternSvg(elements, matrix, options, layout, qrArea, moduleFill);

  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (!matrix.modules[row][col] || getFinderPart(row, col, matrix.size)) {
        continue;
      }
      const moduleX = qrArea.x + col;
      const moduleY = qrArea.y + row;
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
  appendBorderSvg(elements, options.border, layout);

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
