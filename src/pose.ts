import type { Pose } from "./types";

export const POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10], [11, 12],
  [11, 13], [13, 15], [15, 17], [17, 19], [19, 15], [15, 21],
  [12, 14], [14, 16], [16, 18], [18, 20], [20, 16], [16, 22],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [31, 27],
  [24, 26], [26, 28], [28, 30], [30, 32], [32, 28],
];

const HIP_INDICES = [23, 24] as const;
const SHOULDER_INDICES = [11, 12] as const;

export function poseCenterX(pose: Pose): number {
  const hipValues = HIP_INDICES.map((index) => pose[index]?.x).filter(
    (value): value is number => value !== undefined,
  );

  if (hipValues.length > 0) {
    return average(hipValues);
  }

  const shoulderValues = SHOULDER_INDICES.map((index) => pose[index]?.x).filter(
    (value): value is number => value !== undefined,
  );

  return shoulderValues.length > 0 ? average(shoulderValues) : 0.5;
}

export function assignPlayerSlots(poses: Pose[], mirrored: boolean): Pose[] {
  return [...poses]
    .sort((left, right) => {
      const difference = poseCenterX(left) - poseCenterX(right);
      return mirrored ? -difference : difference;
    })
    .slice(0, 2);
}

export function hasVisibleFullBody(pose: Pose, minimumVisibility = 0.5): boolean {
  const requiredLandmarks = [11, 12, 15, 16, 23, 24, 27, 28];
  return requiredLandmarks.every((index) => {
    const landmark = pose[index];
    return landmark !== undefined && (landmark.visibility ?? 1) >= minimumVisibility;
  });
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

