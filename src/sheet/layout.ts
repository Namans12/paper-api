import type { Pt } from '../geometry/homography';

export interface Rect { x: number; y: number; w: number; h: number }

export const LAYOUT_ID = 'stocktake-v1';
export const PAGE = { w: 210, h: 297 };
export const FIDUCIAL_SIZE = 12;
/** Top-left origins: page TL, TR, BL, BR. */
export const FIDUCIAL_ORIGINS: Pt[] = [[10, 10], [188, 10], [10, 275], [188, 275]];
export function fiducialCenters(): Pt[] {
  return FIDUCIAL_ORIGINS.map(([x, y]) => [x + FIDUCIAL_SIZE / 2, y + FIDUCIAL_SIZE / 2] as Pt);
}
/** Includes a 4-module quiet zone. */
export const QR_BOX: Rect = { x: 148, y: 28, w: 44, h: 44 };
export const ROW_TOP = 100, ROW_HEIGHT = 26, ROW_COUNT = 6, BOX_SIZE = 12;
/** Column i corresponds to STATUSES[i]. */
export const BOX_XS = [112, 142, 172];
export const SAMPLE_INSET = 2.5;

export function boxRect(row: number, col: number): Rect {
  return { x: BOX_XS[col], y: ROW_TOP + row * ROW_HEIGHT + (ROW_HEIGHT - BOX_SIZE) / 2, w: BOX_SIZE, h: BOX_SIZE };
}
export function rowRect(row: number): Rect {
  return { x: 14, y: ROW_TOP + row * ROW_HEIGHT, w: 182, h: ROW_HEIGHT };
}
