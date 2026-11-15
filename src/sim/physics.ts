import { CAR, FIXED_DT } from '../shared/simulation';

export const CAR_RADIUS = 5;
export const WHEELBASE = 26;
export const MAX_STEER = 0.5;
export const ACCELERATION = 150;
export const DRAG = 0.45;

/** Kinematic bicycle, no reverse. Midpoint heading reduces turn integration error.
 * Collision/finish handling belongs to the engine; this writes one proposed step. */
export function drive(cars: Float32Array, base: number, steer: number, throttleOutput: number, maxSpeed: number): void {
  const throttle = (Math.max(-1, Math.min(1, throttleOutput)) + 1) * 0.5;
  const oldSpeed = cars[base + CAR.speed]!;
  const speed = Math.min(maxSpeed, Math.max(0, oldSpeed + (ACCELERATION * throttle - DRAG * oldSpeed) * FIXED_DT));
  const velocity = (oldSpeed + speed) * 0.5;
  const turn = velocity / WHEELBASE * Math.tan(Math.max(-1, Math.min(1, steer)) * MAX_STEER) * FIXED_DT;
  const heading = cars[base + CAR.heading]!;
  cars[base + CAR.x] = cars[base + CAR.x]! + Math.cos(heading + turn * 0.5) * velocity * FIXED_DT;
  cars[base + CAR.y] = cars[base + CAR.y]! + Math.sin(heading + turn * 0.5) * velocity * FIXED_DT;
  cars[base + CAR.heading] = Math.atan2(Math.sin(heading + turn), Math.cos(heading + turn));
  cars[base + CAR.speed] = speed;
}
