import type { Pose, PoseLandmark } from "./types";

export const POSE_HOLD_MS = 300;

export const POSE_LABELS = {
  BOTH_HANDS_UP: "両手UP",
  ARMS_CROSSED: "腕クロス",
  SQUAT: "しゃがみ",
} as const;

export type RecognizedPose = keyof typeof POSE_LABELS;

export interface PoseHoldState {
  candidate: RecognizedPose | null;
  confirmed: RecognizedPose | null;
  startedAt: number;
  progress: number;
}

export const EMPTY_POSE_HOLD_STATE: PoseHoldState = {
  candidate: null,
  confirmed: null,
  startedAt: 0,
  progress: 0,
};

const MINIMUM_VISIBILITY = 0.5;

const LANDMARK = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

export function recognizePose(pose: Pose): RecognizedPose | null {
  if (isArmsCrossed(pose)) return "ARMS_CROSSED";
  if (isBothHandsUp(pose)) return "BOTH_HANDS_UP";
  if (isSquatting(pose)) return "SQUAT";
  return null;
}

export function updatePoseHold(
  previous: PoseHoldState,
  detected: RecognizedPose | null,
  timestampMs: number,
  requiredHoldMs = POSE_HOLD_MS,
): PoseHoldState {
  if (!detected) {
    return { ...EMPTY_POSE_HOLD_STATE };
  }

  if (detected !== previous.candidate) {
    return {
      candidate: detected,
      confirmed: null,
      startedAt: timestampMs,
      progress: 0,
    };
  }

  const elapsed = Math.max(0, timestampMs - previous.startedAt);
  const progress = Math.min(1, elapsed / requiredHoldMs);

  return {
    candidate: detected,
    confirmed: progress >= 1 ? detected : null,
    startedAt: previous.startedAt,
    progress,
  };
}

function isBothHandsUp(pose: Pose): boolean {
  const leftShoulder = visibleLandmark(pose, LANDMARK.LEFT_SHOULDER);
  const rightShoulder = visibleLandmark(pose, LANDMARK.RIGHT_SHOULDER);
  const leftWrist = visibleLandmark(pose, LANDMARK.LEFT_WRIST);
  const rightWrist = visibleLandmark(pose, LANDMARK.RIGHT_WRIST);
  const leftHip = visibleLandmark(pose, LANDMARK.LEFT_HIP);
  const rightHip = visibleLandmark(pose, LANDMARK.RIGHT_HIP);

  if (!leftShoulder || !rightShoulder || !leftWrist || !rightWrist) return false;

  const torsoLength = bodyScale(leftShoulder, rightShoulder, leftHip, rightHip);
  const margin = torsoLength * 0.08;

  return (
    leftWrist.y < leftShoulder.y - margin &&
    rightWrist.y < rightShoulder.y - margin
  );
}

function isArmsCrossed(pose: Pose): boolean {
  const leftShoulder = visibleLandmark(pose, LANDMARK.LEFT_SHOULDER);
  const rightShoulder = visibleLandmark(pose, LANDMARK.RIGHT_SHOULDER);
  const leftWrist = visibleLandmark(pose, LANDMARK.LEFT_WRIST);
  const rightWrist = visibleLandmark(pose, LANDMARK.RIGHT_WRIST);
  const leftHip = visibleLandmark(pose, LANDMARK.LEFT_HIP);
  const rightHip = visibleLandmark(pose, LANDMARK.RIGHT_HIP);

  if (
    !leftShoulder ||
    !rightShoulder ||
    !leftWrist ||
    !rightWrist ||
    !leftHip ||
    !rightHip
  ) {
    return false;
  }

  const shoulderCenter = midpoint(leftShoulder, rightShoulder);
  const hipCenter = midpoint(leftHip, rightHip);
  const shoulderWidth = distance(leftShoulder, rightShoulder);
  const torsoLength = Math.max(distance(shoulderCenter, hipCenter), 0.01);
  const crossedMargin = shoulderWidth * 0.04;
  const leftToRightDirection = Math.sign(rightShoulder.x - leftShoulder.x) || 1;
  const chestTop = shoulderCenter.y - torsoLength * 0.12;
  const chestBottom = hipCenter.y + torsoLength * 0.05;

  return (
    (leftWrist.x - shoulderCenter.x) * leftToRightDirection > crossedMargin &&
    (rightWrist.x - shoulderCenter.x) * leftToRightDirection < -crossedMargin &&
    leftWrist.y >= chestTop &&
    leftWrist.y <= chestBottom &&
    rightWrist.y >= chestTop &&
    rightWrist.y <= chestBottom
  );
}

function isSquatting(pose: Pose): boolean {
  const leftHip = visibleLandmark(pose, LANDMARK.LEFT_HIP);
  const rightHip = visibleLandmark(pose, LANDMARK.RIGHT_HIP);
  const leftKnee = visibleLandmark(pose, LANDMARK.LEFT_KNEE);
  const rightKnee = visibleLandmark(pose, LANDMARK.RIGHT_KNEE);
  const leftAnkle = visibleLandmark(pose, LANDMARK.LEFT_ANKLE);
  const rightAnkle = visibleLandmark(pose, LANDMARK.RIGHT_ANKLE);

  if (!leftHip || !rightHip || !leftKnee || !rightKnee || !leftAnkle || !rightAnkle) {
    return false;
  }

  const leftKneeAngle = angleDegrees(leftHip, leftKnee, leftAnkle);
  const rightKneeAngle = angleDegrees(rightHip, rightKnee, rightAnkle);
  const hipCenter = midpoint(leftHip, rightHip);
  const kneeCenter = midpoint(leftKnee, rightKnee);

  return (
    leftKneeAngle <= 145 &&
    rightKneeAngle <= 145 &&
    hipCenter.y < kneeCenter.y
  );
}

function visibleLandmark(pose: Pose, index: number): PoseLandmark | null {
  const landmark = pose[index];
  if (!landmark || (landmark.visibility ?? 1) < MINIMUM_VISIBILITY) return null;
  return landmark;
}

function bodyScale(
  leftShoulder: PoseLandmark,
  rightShoulder: PoseLandmark,
  leftHip: PoseLandmark | null,
  rightHip: PoseLandmark | null,
): number {
  const shoulderWidth = distance(leftShoulder, rightShoulder);
  if (!leftHip || !rightHip) return Math.max(shoulderWidth, 0.01);

  const torsoLength = distance(
    midpoint(leftShoulder, rightShoulder),
    midpoint(leftHip, rightHip),
  );
  return Math.max(shoulderWidth, torsoLength, 0.01);
}

function midpoint(left: PoseLandmark, right: PoseLandmark): PoseLandmark {
  return {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
    z: (left.z + right.z) / 2,
    visibility: Math.min(left.visibility ?? 1, right.visibility ?? 1),
  };
}

function distance(left: PoseLandmark, right: PoseLandmark): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function angleDegrees(
  first: PoseLandmark,
  vertex: PoseLandmark,
  third: PoseLandmark,
): number {
  const firstVector = { x: first.x - vertex.x, y: first.y - vertex.y };
  const secondVector = { x: third.x - vertex.x, y: third.y - vertex.y };
  const denominator = Math.hypot(firstVector.x, firstVector.y) * Math.hypot(secondVector.x, secondVector.y);

  if (denominator === 0) return 180;

  const cosine = Math.max(
    -1,
    Math.min(
      1,
      (firstVector.x * secondVector.x + firstVector.y * secondVector.y) /
        denominator,
    ),
  );
  return (Math.acos(cosine) * 180) / Math.PI;
}
