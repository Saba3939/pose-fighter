import { describe, expect, it } from "vitest";
import { assignPlayerSlots, hasVisibleFullBody, poseCenterX } from "../src/pose";
import type { Pose } from "../src/types";

describe("poseCenterX", () => {
  it("左右の腰の中央を返す", () => {
    const pose = createPose(0.25);
    pose[23] = landmark(0.2);
    pose[24] = landmark(0.4);
    expect(poseCenterX(pose)).toBeCloseTo(0.3);
  });
});

describe("assignPlayerSlots", () => {
  it("通常表示では画面左からPLAYER 1、PLAYER 2へ割り当てる", () => {
    const left = createPose(0.2);
    const right = createPose(0.8);
    expect(assignPlayerSlots([right, left], false)).toEqual([left, right]);
  });

  it("鏡表示ではカメラ座標の右側を表示上のPLAYER 1へ割り当てる", () => {
    const rawLeft = createPose(0.2);
    const rawRight = createPose(0.8);
    expect(assignPlayerSlots([rawLeft, rawRight], true)).toEqual([rawRight, rawLeft]);
  });
});

describe("hasVisibleFullBody", () => {
  it("主要関節が見えている場合はtrueを返す", () => {
    expect(hasVisibleFullBody(createPose(0.5))).toBe(true);
  });

  it("足首が見えない場合はfalseを返す", () => {
    const pose = createPose(0.5);
    pose[28] = { ...pose[28]!, visibility: 0.2 };
    expect(hasVisibleFullBody(pose)).toBe(false);
  });
});

function createPose(centerX: number): Pose {
  return Array.from({ length: 33 }, () => landmark(centerX));
}

function landmark(x: number) {
  return { x, y: 0.5, z: 0, visibility: 0.99 };
}

