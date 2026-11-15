/** Logical world units. +x right, +y down; heading radians clockwise from +x. */
export const WORLD_WIDTH = 1200;
export const WORLD_HEIGHT = 800;

export interface Point { readonly x: number; readonly y: number }
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}
export interface Segment { readonly a: Point; readonly b: Point }
export interface Pose extends Point { readonly heading: number }

/** Main-owned, immutable after validation. Clone to worker; never transfer these arrays. */
export interface TrackGeometry {
  readonly id: string;
  /** Closed xy pairs; no duplicated terminal vertex. Forward is vertex order. */
  readonly centerline: Float32Array;
  /** n + 1 entries: starts at 0, includes closing edge, last equals length. */
  readonly cumulativeLengths: Float32Array;
  readonly length: number;
  readonly width: number;
  /** All collision walls, each [ax, ay, bx, by]. Includes both closed boundaries. */
  readonly walls: Float32Array;
  readonly bounds: Bounds;
  readonly startLine: Segment;
  /** Unit forward vector across the start line; dot(forward, velocity) > 0 is forward. */
  readonly startForward: Point;
  /** Centerline vertex 0, heading along startForward; progress starts at 0. */
  readonly spawn: Pose;
}

export type TrackIssueCode = 'too-short' | 'self-intersection' | 'too-tight' | 'out-of-bounds' | 'invalid-input';
export interface TrackIssue { readonly code: TrackIssueCode; readonly message: string }
export type TrackValidation =
  | { readonly ok: true; readonly track: TrackGeometry }
  | { readonly ok: false; readonly issues: readonly TrackIssue[] };
export interface TrackBuildOptions { readonly id: string; readonly width: number }
export interface TrackPreset { readonly id: string; readonly label: string }

/** cssX = worldX * scale + offsetX. CSS pixels, never backing-store pixels. */
export interface ViewTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}
export interface TrackEditorOptions {
  readonly canvas: HTMLCanvasElement;
  readonly initialTrack: TrackGeometry;
  readonly getView: () => ViewTransform;
  readonly onChange: (change: TrackEditorChange) => void;
}
export type TrackEditorChange =
  | { readonly type: 'draft'; readonly points: readonly Point[] }
  | { readonly type: 'commit'; readonly track: TrackGeometry }
  | { readonly type: 'invalid'; readonly issues: readonly TrackIssue[] }
  | { readonly type: 'clear' };
export interface TrackEditor {
  setEnabled(enabled: boolean): void;
  setTrack(track: TrackGeometry): void;
  clear(): void;
  destroy(): void;
}
