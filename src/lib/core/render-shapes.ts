import type { QrMatrix, QrModuleShape, QrPupilShape, QrEyeShape } from './types';
import type { CanvasContext, CanvasPaint, CornerRadii } from './render-options';
import { formatNumber } from './render-options';

export function getModuleCornerRadii(matrix: QrMatrix, row: number, col: number, size: number): CornerRadii {
  const up = row > 0 && matrix.modules[row - 1][col];
  const right = col + 1 < matrix.size && matrix.modules[row][col + 1];
  const down = row + 1 < matrix.size && matrix.modules[row + 1][col];
  const left = col > 0 && matrix.modules[row][col - 1];

  const radius = size * 0.45;
  return {
    topLeft: !up && !left ? radius : 0,
    topRight: !up && !right ? radius : 0,
    bottomRight: !down && !right ? radius : 0,
    bottomLeft: !down && !left ? radius : 0,
  };
}

export function getFlowModuleCornerRadii(matrix: QrMatrix, row: number, col: number, size: number): CornerRadii {
  const up = row > 0 && matrix.modules[row - 1][col];
  const right = col + 1 < matrix.size && matrix.modules[row][col + 1];
  const down = row + 1 < matrix.size && matrix.modules[row + 1][col];
  const left = col > 0 && matrix.modules[row][col - 1];
  const topLeftDiag = row > 0 && col > 0 && matrix.modules[row - 1][col - 1];
  const topRightDiag = row > 0 && col + 1 < matrix.size && matrix.modules[row - 1][col + 1];
  const bottomRightDiag = row + 1 < matrix.size && col + 1 < matrix.size && matrix.modules[row + 1][col + 1];
  const bottomLeftDiag = row + 1 < matrix.size && col > 0 && matrix.modules[row + 1][col - 1];

  const radius = size * 0.45;
  return {
    topLeft: !up && !left && !topLeftDiag ? radius : 0,
    topRight: !up && !right && !topRightDiag ? radius : 0,
    bottomRight: !down && !right && !bottomRightDiag ? radius : 0,
    bottomLeft: !down && !left && !bottomLeftDiag ? radius : 0,
  };
}

export function fillEyeOuterCanvas(
  context: CanvasContext,
  shape: QrEyeShape,
  x: number,
  y: number,
  cellSize: number,
  paint: CanvasPaint,
): void {
  const outerSize = 7 * cellSize;
  const innerOffset = cellSize;
  const innerSize = 5 * cellSize;

  context.save();
  context.fillStyle = paint;
  context.beginPath();
  if (shape === 'extra-rounded') {
    const cx = x + outerSize / 2;
    const cy = y + outerSize / 2;
    context.arc(cx, cy, outerSize / 2, 0, Math.PI * 2);
    context.arc(cx, cy, innerSize / 2, 0, Math.PI * 2, true);
  } else if (shape === 'rounded') {
    appendRoundRectPath(context, x, y, outerSize, outerSize, cellSize * 1.55);
    appendRoundRectPath(context, x + innerOffset, y + innerOffset, innerSize, innerSize, cellSize * 0.95);
  } else {
    context.rect(x, y, outerSize, outerSize);
    context.rect(x + innerOffset, y + innerOffset, innerSize, innerSize);
  }
  context.fill('evenodd');
  context.restore();
}

export function fillCanvasShape(
  context: CanvasContext,
  shape: QrModuleShape | QrPupilShape,
  x: number,
  y: number,
  size: number,
  paint: CanvasPaint,
  row = 0,
  col = 0,
  cornerRadii?: CornerRadii,
): void {
  context.save();
  context.fillStyle = paint;

  if (shape === 'square') {
    context.fillRect(x, y, size, size);
    context.restore();
    return;
  }

  context.beginPath();
  if (shape === 'rounded') {
    appendRoundRectPath(context, x, y, size, size, size * 0.22);
  } else if (shape === 'extra-rounded') {
    context.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  } else if (shape === 'diamond') {
    context.moveTo(x + size / 2, y);
    context.lineTo(x + size, y + size / 2);
    context.lineTo(x + size / 2, y + size);
    context.lineTo(x, y + size / 2);
    context.closePath();
  } else if (shape === 'liquid' || shape === 'liquid-flow') {
    appendVariableRoundRectPath(
      context,
      x,
      y,
      size,
      size,
      cornerRadii ?? {
        topLeft: size * 0.45,
        topRight: size * 0.45,
        bottomRight: size * 0.45,
        bottomLeft: size * 0.45,
      },
    );
  } else {
    appendSplashPath(context, x, y, size, row, col);
  }

  context.fill();
  context.restore();
}

export function buildSvgShapeElement(
  shape: QrModuleShape | QrPupilShape,
  x: number,
  y: number,
  size: number,
  fill: string,
  row = 0,
  col = 0,
  cornerRadii?: CornerRadii,
): string {
  if (shape === 'square') {
    return `<rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(size)}" height="${formatNumber(size)}" fill="${fill}"/>`;
  }
  if (shape === 'rounded') {
    const radius = size * 0.22;
    return `<rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(size)}" height="${formatNumber(size)}" rx="${formatNumber(radius)}" ry="${formatNumber(radius)}" fill="${fill}"/>`;
  }
  if (shape === 'extra-rounded') {
    return `<circle cx="${formatNumber(x + size / 2)}" cy="${formatNumber(y + size / 2)}" r="${formatNumber(size / 2)}" fill="${fill}"/>`;
  }
  if (shape === 'diamond') {
    return `<polygon points="${formatNumber(x + size / 2)},${formatNumber(y)} ${formatNumber(x + size)},${formatNumber(y + size / 2)} ${formatNumber(x + size / 2)},${formatNumber(y + size)} ${formatNumber(x)},${formatNumber(y + size / 2)}" fill="${fill}"/>`;
  }
  if (shape === 'liquid' || shape === 'liquid-flow') {
    const d = buildVariableRoundRectPathData(
      x,
      y,
      size,
      size,
      cornerRadii ?? {
        topLeft: size * 0.45,
        topRight: size * 0.45,
        bottomRight: size * 0.45,
        bottomLeft: size * 0.45,
      },
    );
    return `<path d="${d}" fill="${fill}"/>`;
  }
  return `<path d="${buildSvgSplashPathData(x, y, size, row, col)}" fill="${fill}"/>`;
}

export function buildSvgEyeOuterElement(shape: QrEyeShape, x: number, y: number, fill: string): string {
  if (shape === 'extra-rounded') {
    const cx = x + 3.5;
    const cy = y + 3.5;
    const d = `${buildCirclePathData(cx, cy, 3.5)} ${buildCirclePathData(cx, cy, 2.5, true)}`;
    return `<path d="${d}" fill="${fill}" fill-rule="evenodd"/>`;
  }

  if (shape === 'rounded') {
    const d = `${buildRoundRectPathData(x, y, 7, 7, 1.55)} ${buildRoundRectPathData(x + 1, y + 1, 5, 5, 0.95)}`;
    return `<path d="${d}" fill="${fill}" fill-rule="evenodd"/>`;
  }

  const d = `${buildRectPathData(x, y, 7, 7)} ${buildRectPathData(x + 1, y + 1, 5, 5)}`;
  return `<path d="${d}" fill="${fill}" fill-rule="evenodd"/>`;
}

function appendVariableRoundRectPath(
  context: CanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radii: CornerRadii,
): void {
  const topLeft = Math.max(0, Math.min(radii.topLeft, width / 2, height / 2));
  const topRight = Math.max(0, Math.min(radii.topRight, width / 2, height / 2));
  const bottomRight = Math.max(0, Math.min(radii.bottomRight, width / 2, height / 2));
  const bottomLeft = Math.max(0, Math.min(radii.bottomLeft, width / 2, height / 2));

  context.moveTo(x + topLeft, y);
  context.lineTo(x + width - topRight, y);
  if (topRight > 0) {
    context.quadraticCurveTo(x + width, y, x + width, y + topRight);
  }
  context.lineTo(x + width, y + height - bottomRight);
  if (bottomRight > 0) {
    context.quadraticCurveTo(x + width, y + height, x + width - bottomRight, y + height);
  }
  context.lineTo(x + bottomLeft, y + height);
  if (bottomLeft > 0) {
    context.quadraticCurveTo(x, y + height, x, y + height - bottomLeft);
  }
  context.lineTo(x, y + topLeft);
  if (topLeft > 0) {
    context.quadraticCurveTo(x, y, x + topLeft, y);
  }
  context.closePath();
}

function appendRoundRectPath(
  context: CanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function appendSplashPath(
  context: CanvasContext,
  x: number,
  y: number,
  size: number,
  row: number,
  col: number,
): void {
  const seed = ((row + 1) * 73856093) ^ ((col + 1) * 19349663);
  const jitter = ((((seed % 1000) + 1000) % 1000) / 1000 - 0.5) * size * 0.16;
  const left = x + size * 0.15;
  const right = x + size * 0.85;
  const top = y + size * 0.14;
  const bottom = y + size * 0.86;

  context.moveTo(x + size * 0.5, top);
  context.bezierCurveTo(right + jitter, top, right, y + size * 0.35, right, y + size * 0.5);
  context.bezierCurveTo(right, bottom - jitter, x + size * 0.68, bottom, x + size * 0.5, bottom);
  context.bezierCurveTo(left - jitter, bottom, left, y + size * 0.68, left, y + size * 0.5);
  context.bezierCurveTo(left, y + size * 0.32, x + size * 0.32, top - jitter, x + size * 0.5, top);
  context.closePath();
}

function buildRectPathData(x: number, y: number, width: number, height: number): string {
  return `M${formatNumber(x)},${formatNumber(y)}h${formatNumber(width)}v${formatNumber(height)}h-${formatNumber(width)}z`;
}

function buildRoundRectPathData(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  if (r === 0) {
    return buildRectPathData(x, y, width, height);
  }
  return [
    `M${formatNumber(x + r)},${formatNumber(y)}`,
    `H${formatNumber(x + width - r)}`,
    `Q${formatNumber(x + width)},${formatNumber(y)} ${formatNumber(x + width)},${formatNumber(y + r)}`,
    `V${formatNumber(y + height - r)}`,
    `Q${formatNumber(x + width)},${formatNumber(y + height)} ${formatNumber(x + width - r)},${formatNumber(y + height)}`,
    `H${formatNumber(x + r)}`,
    `Q${formatNumber(x)},${formatNumber(y + height)} ${formatNumber(x)},${formatNumber(y + height - r)}`,
    `V${formatNumber(y + r)}`,
    `Q${formatNumber(x)},${formatNumber(y)} ${formatNumber(x + r)},${formatNumber(y)}`,
    'Z',
  ].join(' ');
}

function buildVariableRoundRectPathData(x: number, y: number, width: number, height: number, radii: CornerRadii): string {
  const topLeft = Math.max(0, Math.min(radii.topLeft, width / 2, height / 2));
  const topRight = Math.max(0, Math.min(radii.topRight, width / 2, height / 2));
  const bottomRight = Math.max(0, Math.min(radii.bottomRight, width / 2, height / 2));
  const bottomLeft = Math.max(0, Math.min(radii.bottomLeft, width / 2, height / 2));

  return [
    `M${formatNumber(x + topLeft)},${formatNumber(y)}`,
    `H${formatNumber(x + width - topRight)}`,
    topRight > 0
      ? `Q${formatNumber(x + width)},${formatNumber(y)} ${formatNumber(x + width)},${formatNumber(y + topRight)}`
      : '',
    `V${formatNumber(y + height - bottomRight)}`,
    bottomRight > 0
      ? `Q${formatNumber(x + width)},${formatNumber(y + height)} ${formatNumber(x + width - bottomRight)},${formatNumber(y + height)}`
      : '',
    `H${formatNumber(x + bottomLeft)}`,
    bottomLeft > 0
      ? `Q${formatNumber(x)},${formatNumber(y + height)} ${formatNumber(x)},${formatNumber(y + height - bottomLeft)}`
      : '',
    `V${formatNumber(y + topLeft)}`,
    topLeft > 0 ? `Q${formatNumber(x)},${formatNumber(y)} ${formatNumber(x + topLeft)},${formatNumber(y)}` : '',
    'Z',
  ]
    .filter((segment) => segment.length > 0)
    .join(' ');
}

function buildCirclePathData(cx: number, cy: number, radius: number, reverse = false): string {
  const startX = cx + radius;
  const endX = cx - radius;
  if (reverse) {
    return [
      `M${formatNumber(startX)},${formatNumber(cy)}`,
      `A${formatNumber(radius)},${formatNumber(radius)} 0 1 0 ${formatNumber(endX)},${formatNumber(cy)}`,
      `A${formatNumber(radius)},${formatNumber(radius)} 0 1 0 ${formatNumber(startX)},${formatNumber(cy)}`,
      'Z',
    ].join(' ');
  }
  return [
    `M${formatNumber(startX)},${formatNumber(cy)}`,
    `A${formatNumber(radius)},${formatNumber(radius)} 0 1 1 ${formatNumber(endX)},${formatNumber(cy)}`,
    `A${formatNumber(radius)},${formatNumber(radius)} 0 1 1 ${formatNumber(startX)},${formatNumber(cy)}`,
    'Z',
  ].join(' ');
}

function buildSvgSplashPathData(x: number, y: number, size: number, row: number, col: number): string {
  const seed = ((row + 1) * 73856093) ^ ((col + 1) * 19349663);
  const jitter = ((((seed % 1000) + 1000) % 1000) / 1000 - 0.5) * size * 0.16;
  const left = x + size * 0.15;
  const right = x + size * 0.85;
  const top = y + size * 0.14;
  const bottom = y + size * 0.86;

  return [
    `M${formatNumber(x + size * 0.5)},${formatNumber(top)}`,
    `C${formatNumber(right + jitter)},${formatNumber(top)} ${formatNumber(right)},${formatNumber(y + size * 0.35)} ${formatNumber(right)},${formatNumber(y + size * 0.5)}`,
    `C${formatNumber(right)},${formatNumber(bottom - jitter)} ${formatNumber(x + size * 0.68)},${formatNumber(bottom)} ${formatNumber(x + size * 0.5)},${formatNumber(bottom)}`,
    `C${formatNumber(left - jitter)},${formatNumber(bottom)} ${formatNumber(left)},${formatNumber(y + size * 0.68)} ${formatNumber(left)},${formatNumber(y + size * 0.5)}`,
    `C${formatNumber(left)},${formatNumber(y + size * 0.32)} ${formatNumber(x + size * 0.32)},${formatNumber(top - jitter)} ${formatNumber(x + size * 0.5)},${formatNumber(top)}`,
    'Z',
  ].join(' ');
}
