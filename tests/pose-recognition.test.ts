import { describe, expect, it } from "vitest";
import {
  EMPTY_POSE_HOLD_STATE,
  POSE_HOLD_MS,
  recognizePose,
  updatePoseHold,
} from "../src/pose-recognition";
import type { Pose } from "../src/types";

describe("recognizePose", () => {
  it("両手首が肩より上なら両手UPと判定する", () => {
    const pose = neutralPose();
    pose[15] = landmark(0.4, 0.14);
    pose[16] = landmark(0.6, 0.14);
    expect(recognizePose(pose)).toBe("BOTH_HANDS_UP");
  });

  it("胸の前で両手首が身体中央を越えたら腕クロスと判定する", () => {
    const pose = neutralPose();
    pose[15] = landmark(0.58, 0.42);
    pose[16] = landmark(0.42, 0.42);
    expect(recognizePose(pose)).toBe("ARMS_CROSSED");
  });

  it("カメラ上で左右が反転した骨格でも腕クロスと判定する", () => {
    const pose = neutralPose();
    pose[15] = landmark(0.58, 0.42);
    pose[16] = landmark(0.42, 0.42);
    const horizontallyFlipped = pose.map((point) => ({ ...point, x: 1 - point.x }));
    expect(recognizePose(horizontallyFlipped)).toBe("ARMS_CROSSED");
  });

  it("両膝を曲げたらしゃがみと判定する", () => {
    const pose = neutralPose();
    pose[23] = landmark(0.43, 0.55);
    pose[24] = landmark(0.57, 0.55);
    pose[25] = landmark(0.35, 0.72);
    pose[26] = landmark(0.65, 0.72);
    pose[27] = landmark(0.43, 0.87);
    pose[28] = landmark(0.57, 0.87);
    expect(recognizePose(pose)).toBe("SQUAT");
  });

  it("通常姿勢はいずれにも該当しない", () => {
    expect(recognizePose(neutralPose())).toBeNull();
  });

  it("必要な関節の可視性が低い場合は判定しない", () => {
    const pose = neutralPose();
    pose[15] = { ...landmark(0.4, 0.14), visibility: 0.2 };
    pose[16] = landmark(0.6, 0.14);
    expect(recognizePose(pose)).toBeNull();
  });
});

describe("updatePoseHold", () => {
  it("同じポーズを300ms維持すると確定する", () => {
    const started = updatePoseHold(EMPTY_POSE_HOLD_STATE, "BOTH_HANDS_UP", 1_000);
    const holding = updatePoseHold(started, "BOTH_HANDS_UP", 1_150);
    const confirmed = updatePoseHold(
      holding,
      "BOTH_HANDS_UP",
      1_000 + POSE_HOLD_MS,
    );

    expect(holding.progress).toBeCloseTo(0.5);
    expect(holding.confirmed).toBeNull();
    expect(confirmed.progress).toBe(1);
    expect(confirmed.confirmed).toBe("BOTH_HANDS_UP");
  });

  it("途中でポーズが外れたら保持時間をリセットする", () => {
    const started = updatePoseHold(EMPTY_POSE_HOLD_STATE, "ARMS_CROSSED", 1_000);
    const reset = updatePoseHold(started, null, 1_200);
    expect(reset).toEqual(EMPTY_POSE_HOLD_STATE);
  });

  it("別のポーズへ変わったら新しい保持を開始する", () => {
    const started = updatePoseHold(EMPTY_POSE_HOLD_STATE, "ARMS_CROSSED", 1_000);
    const changed = updatePoseHold(started, "SQUAT", 1_200);
    expect(changed.candidate).toBe("SQUAT");
    expect(changed.startedAt).toBe(1_200);
    expect(changed.progress).toBe(0);
  });
});

function neutralPose(): Pose {
  const pose = Array.from({ length: 33 }, () => landmark(0.5, 0.5));
  pose[11] = landmark(0.4, 0.3);
  pose[12] = landmark(0.6, 0.3);
  pose[13] = landmark(0.38, 0.44);
  pose[14] = landmark(0.62, 0.44);
  pose[15] = landmark(0.38, 0.58);
  pose[16] = landmark(0.62, 0.58);
  pose[23] = landmark(0.43, 0.55);
  pose[24] = landmark(0.57, 0.55);
  pose[25] = landmark(0.43, 0.72);
  pose[26] = landmark(0.57, 0.72);
  pose[27] = landmark(0.43, 0.9);
  pose[28] = landmark(0.57, 0.9);
  return pose;
}

function landmark(x: number, y: number) {
  return { x, y, z: 0, visibility: 0.99 };
}
