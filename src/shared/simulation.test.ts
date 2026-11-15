import { describe, expect, it } from 'vitest';
import { ACTIVATION_COUNT, CAR, CAR_STRIDE, NETWORK_LAYERS, SENSOR_ANGLES, SENSOR_STRIDE, WEIGHT_COUNT, createSnapshotStorage, snapshotTransferList } from './simulation';

describe('snapshot transport contract (no engine implemented here)', () => {
  it('reserves the documented packed car, sensor and network layouts', () => {
    const storage = createSnapshotStorage(512);
    const [input, hidden, output] = NETWORK_LAYERS;
    expect(WEIGHT_COUNT).toBe((input + 1) * hidden + (hidden + 1) * output);
    expect(ACTIVATION_COUNT).toBe(input + hidden + output);
    expect(input).toBe(SENSOR_ANGLES.length + 1);
    expect(storage.cars.length).toBe(512 * CAR_STRIDE);
    expect(storage.sensors.length).toBe(SENSOR_ANGLES.length * SENSOR_STRIDE);
    expect(storage.weights.length).toBe(WEIGHT_COUNT);
    expect(storage.activations.length).toBe(ACTIVATION_COUNT);
  });

  it('detaches the sender on delivery and returns the same contents for reuse', () => {
    const workerStorage = createSnapshotStorage(2);
    workerStorage.cars[CAR.x] = 123;
    workerStorage.weights[0] = 0.5;
    const mainStorage = structuredClone(workerStorage, { transfer: snapshotTransferList(workerStorage) });
    expect(snapshotTransferList(workerStorage).every((buffer) => buffer.byteLength === 0)).toBe(true);
    expect(mainStorage.cars[CAR.x]).toBe(123);
    const recycled = structuredClone(mainStorage, { transfer: snapshotTransferList(mainStorage) });
    expect(snapshotTransferList(mainStorage).every((buffer) => buffer.byteLength === 0)).toBe(true);
    expect(recycled.weights[0]).toBe(0.5);
    expect(recycled.cars.length).toBe(2 * CAR_STRIDE);
  });

  it.each([0, 1, 2.5, 1001, Number.NaN])('rejects an invalid population of %s', (population) => {
    expect(() => createSnapshotStorage(population)).toThrow(RangeError);
  });
});
