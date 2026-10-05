import type { Pose, PoseLandmark } from "./types";

export const INPUTS = {
  LEFT_HAND_UP: { label: "左手UP", move: "ジャブ" },
  RIGHT_HAND_UP: { label: "右手UP", move: "ストレート" },
  BOTH_HANDS_UP: { label: "両手UP", move: "強攻撃" },
  ARMS_CROSSED: { label: "腕クロス", move: "ガード" },
  ARMS_OPEN: { label: "両腕を横に開く", move: "コンボ脱出" },
  ONE_ARM_OUT: { label: "片腕を横に開く", move: "カウンター" },
  L_SHAPE: { label: "L字", move: "必殺技" },
} as const;
export type UpperBodyInput = keyof typeof INPUTS;
export const HOLD_MS = 180;
export const BOTH_HANDS_HOLD_MS = 260;
export const SPECIAL_HOLD_MS = 260;
export const BURST_HOLD_MS = 120;
export const RELEASE_MS = 200;
export const TRACKING_GRACE_MS = 220;
const MAX_FRAME_GAP_MS = 500;
// Elbows are drawn, but none of these gestures require their coordinates.
const REQUIRED = [11, 12, 15, 16] as const;

function visible(point: PoseLandmark | undefined): point is PoseLandmark {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
    point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1 &&
    (point.visibility ?? 0) >= 0.45;
}

export function hasVisibleUpperBody(pose: Pose): boolean {
  return REQUIRED.every((index) => visible(pose[index]));
}

export function recognizeUpperBody(pose: Pose, previous: UpperBodyInput | null = null): UpperBodyInput | null {
  if (!hasVisibleUpperBody(pose)) return null;
  const left = pose[11]!;
  const right = pose[12]!;
  const leftWrist = pose[15]!;
  const rightWrist = pose[16]!;
  const width = Math.abs(right.x - left.x);
  if (width < 0.025) return null;
  const centerX = (left.x + right.x) / 2;
  const centerY = (left.y + right.y) / 2;
  const direction = Math.sign(right.x - left.x);
  const inChest = (point: PoseLandmark) =>
    point.y >= centerY - width * 0.2 && point.y <= centerY + width * 1.7;
  const crossMargin = previous === "ARMS_CROSSED" ? -0.1 : 0.04;
  if ((leftWrist.x - centerX) * direction > width * crossMargin &&
      (rightWrist.x - centerX) * direction < -width * crossMargin &&
      inChest(leftWrist) && inChest(rightWrist)) return "ARMS_CROSSED";
  // Side gestures use both height and outward distance. Elbows may stay bent.
  // Strictly raised hands cannot simultaneously count as horizontal arms.
  const sideGesture = previous === "ARMS_OPEN" || previous === "ONE_ARM_OUT" || previous === "L_SHAPE";
  const sideBand = sideGesture ? 0.34 : 0.25;
  const sideReach = sideGesture ? 0.42 : 0.6;
  const leftSide = (left.x - leftWrist.x) * direction > width * sideReach &&
    Math.abs(leftWrist.y - left.y) <= width * sideBand;
  const rightSide = (rightWrist.x - right.x) * direction > width * sideReach &&
    Math.abs(rightWrist.y - right.y) <= width * sideBand;
  const leftHigh = leftWrist.y < left.y - width * 0.42;
  const rightHigh = rightWrist.y < right.y - width * 0.42;
  const leftDown = leftWrist.y > left.y + width * 0.4;
  const rightDown = rightWrist.y > right.y + width * 0.4;
  // Escape is a reaction gesture: allow both arms to slope down without
  // loosening the one-arm counter or confusing raised hands with a burst.
  const burstBandBelow = previous === "ARMS_OPEN" ? 0.8 : 0.65;
  const burstSide = (shoulder: PoseLandmark, wrist: PoseLandmark, outward: number) =>
    outward > width * sideReach && wrist.y >= shoulder.y - width * 0.34 &&
    wrist.y <= shoulder.y + width * burstBandBelow;
  if (burstSide(left, leftWrist, (left.x - leftWrist.x) * direction) &&
      burstSide(right, rightWrist, (rightWrist.x - right.x) * direction)) return "ARMS_OPEN";
  if ((leftHigh && rightSide) || (rightHigh && leftSide)) return "L_SHAPE";
  if ((leftSide && rightDown) || (rightSide && leftDown)) return "ONE_ARM_OUT";

  const leftWasUp = previous === "LEFT_HAND_UP" || previous === "BOTH_HANDS_UP";
  const rightWasUp = previous === "RIGHT_HAND_UP" || previous === "BOTH_HANDS_UP";
  // A dead band keeps horizontal gestures separate from an overhead attack.
  const leftUp = !leftSide && (leftHigh || (leftWasUp && leftWrist.y < left.y + width * 0.1));
  const rightUp = !rightSide && (rightHigh || (rightWasUp && rightWrist.y < right.y + width * 0.1));
  if (leftUp && rightUp) return "BOTH_HANDS_UP";
  const downMargin = previous ? -0.05 : 0.05;
  if (leftUp && rightWrist.y > right.y + width * downMargin && !rightSide) return "LEFT_HAND_UP";
  if (rightUp && leftWrist.y > left.y + width * downMargin && !leftSide) return "RIGHT_HAND_UP";
  return null;
}

// Fixed camera zones prevent P2 from becoming P1 when P1 leaves the frame.
// The preview is mirrored: displayed left is player 1.
export function assignUpperBodySlots(poses: Pose[]): [Pose | null, Pose | null] {
  const slots: [Pose | null, Pose | null] = [null, null];
  const distances = [Infinity, Infinity];
  for (const pose of poses) {
    if (!visible(pose[11]) || !visible(pose[12])) continue;
    const displayX = 1 - (pose[11]!.x + pose[12]!.x) / 2;
    const index = displayX < 0.5 ? 0 : 1;
    const distance = Math.abs(displayX - (index === 0 ? 0.25 : 0.75));
    if (distance < distances[index]!) {
      slots[index] = pose;
      distances[index] = distance;
    }
  }
  return slots;
}

export interface InputState {
  candidate: UpperBodyInput | null;
  since: number;
  confirmed: UpperBodyInput | null;
  latched: UpperBodyInput | null;
  neutralSince: number | null;
  lastFrame: number | null;
  progress: number;
  interruptedSince: number | null;
  lastConfirmedAt: number | null;
}
export function emptyInputState(): InputState {
  return { candidate: null, since: 0, confirmed: null, latched: null,
    neutralSince: null, lastFrame: null, progress: 0, interruptedSince: null, lastConfirmedAt: null };
}

export function updateUpperBodyInput(
  previous: InputState, detected: UpperBodyInput | null, tracked: boolean, now: number,
): { state: InputState; event: UpperBodyInput | null } {
  let state = { ...previous, lastFrame: now };
  if (previous.lastFrame !== null &&
    (now - previous.lastFrame > MAX_FRAME_GAP_MS || now < previous.lastFrame)) {
    state = { ...emptyInputState(), latched: previous.latched, lastFrame: now };
  }
  if (!tracked || !detected) {
    const interruptedSince = state.interruptedSince ?? now;
    const neutralSince = tracked ? (state.neutralSince ?? now) : null;
    const grace = tracked ? RELEASE_MS : TRACKING_GRACE_MS;
    const expired = now - interruptedSince >= grace;
    // A brief uncertain frame neither erases progress nor counts as new evidence.
    // Only a sustained visible release rearms the same attack.
    return { state: { ...state, interruptedSince, neutralSince,
      candidate: expired ? null : state.candidate,
      confirmed: expired ? null : state.confirmed,
      progress: expired ? 0 : state.progress,
      latched: neutralSince !== null && now - neutralSince >= RELEASE_MS ? null : state.latched,
    }, event: null };
  }
  const required = detected === "ARMS_OPEN" ? BURST_HOLD_MS : detected === "BOTH_HANDS_UP" ? BOTH_HANDS_HOLD_MS
    : detected === "L_SHAPE" || detected === "ONE_ARM_OUT" ? SPECIAL_HOLD_MS : HOLD_MS;
  const interruption = state.interruptedSince === null ? 0 : now - state.interruptedSince;
  const canResume = interruption < TRACKING_GRACE_MS;
  const restoringConfirmed = state.confirmed === detected && state.lastConfirmedAt !== null &&
    now - state.lastConfirmedAt < TRACKING_GRACE_MS;
  const since = restoringConfirmed ? now - required : state.candidate === detected && canResume
    ? state.since + interruption : now;
  const progress = Math.min(1, Math.max(0, now - since) / required);
  const newlyConfirmed = progress === 1 ? detected : null;
  // Keep the established pose visible while a brief competing candidate settles.
  const confirmed = newlyConfirmed ?? (state.lastConfirmedAt !== null &&
    now - state.lastConfirmedAt < TRACKING_GRACE_MS ? state.confirmed : null);
  const event = newlyConfirmed && state.latched !== newlyConfirmed ? newlyConfirmed : null;
  return { state: { ...state, candidate: detected, since, confirmed, progress,
    interruptedSince: null, neutralSince: null,
    lastConfirmedAt: newlyConfirmed ? now : state.lastConfirmedAt,
    latched: newlyConfirmed ?? state.latched }, event };
}
