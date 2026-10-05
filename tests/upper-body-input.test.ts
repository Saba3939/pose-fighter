import { describe, expect, it } from "vitest";
import { assignUpperBodySlots, BOTH_HANDS_HOLD_MS, emptyInputState, hasVisibleUpperBody,
  HOLD_MS, SPECIAL_HOLD_MS, BURST_HOLD_MS, recognizeUpperBody, RELEASE_MS, TRACKING_GRACE_MS, updateUpperBodyInput } from "../src/upper-body-input";
import type { UpperBodyInput } from "../src/upper-body-input";
import type { Pose } from "../src/types";

function body(input: UpperBodyInput | null = null, center = 0.5): Pose {
  // Lower-body landmarks are deliberately absent. x is anatomical (unmirrored).
  const pose: Pose = Array.from({ length: 17 }, () => ({ x: center, y: .3, z: 0, visibility: 0 }));
  for (const [i, x, y] of [[11, .6, .4], [12, .4, .4], [13, .65, .55], [14, .35, .55], [15, .65, .7], [16, .35, .7]]) {
    pose[i!] = { x: x! + center - .5, y: y!, z: 0, visibility: .99 };
  }
  if (input === "LEFT_HAND_UP" || input === "BOTH_HANDS_UP") pose[15]!.y = .2;
  if (input === "RIGHT_HAND_UP" || input === "BOTH_HANDS_UP") pose[16]!.y = .2;
  if (input === "ARMS_CROSSED") { pose[15]!.x = center - .06; pose[16]!.x = center + .06; pose[15]!.y = pose[16]!.y = .55; }
  return pose;
}

describe("上半身だけの認識", () => {
  it.each(["LEFT_HAND_UP", "RIGHT_HAND_UP", "BOTH_HANDS_UP", "ARMS_CROSSED"] as const)("腰と足がなくても%sを判定する", (input) => {
    expect(hasVisibleUpperBody(body(input))).toBe(true);
    expect(recognizeUpperBody(body(input))).toBe(input);
  });
  it("画像の反転で本人の左右を取り違えない", () => {
    const pose = body("LEFT_HAND_UP").map((p) => ({ ...p, x: 1 - p.x }));
    expect(recognizeUpperBody(pose)).toBe("LEFT_HAND_UP");
    expect(recognizeUpperBody(body("ARMS_CROSSED").map((p) => ({ ...p, x: 1 - p.x })))).toBe("ARMS_CROSSED");
  });
  it("構えと肩の高さの曖昧なポーズは攻撃にしない", () => {
    expect(recognizeUpperBody(body())).toBeNull();
    const pose = body("LEFT_HAND_UP"); pose[16]!.y = .4;
    expect(recognizeUpperBody(pose)).toBeNull();
  });
  it.each([11, 12, 15, 16])("関節%sが見えない場合は認識しない", (index) => {
    const pose = body("BOTH_HANDS_UP"); pose[index]!.visibility = .1;
    expect(hasVisibleUpperBody(pose)).toBe(false);
    expect(recognizeUpperBody(pose)).toBeNull();
  });
  it("画面外や無効な座標を使わない", () => {
    const pose = body("LEFT_HAND_UP"); pose[15]!.y = -.1;
    expect(recognizeUpperBody(pose)).toBeNull();
    pose[15]!.y = NaN;
    expect(hasVisibleUpperBody(pose)).toBe(false);
  });
});

describe("プレイヤーの入力先", () => {
  it("検出順に依存せず、鏡映しの左を1Pにする", () => {
    const p1 = body(null, .75), p2 = body(null, .25);
    expect(assignUpperBodySlots([p2, p1])).toEqual([p1, p2]);
    expect(assignUpperBodySlots([p1, p2])).toEqual([p1, p2]);
    expect(assignUpperBodySlots([p2])).toEqual([null, p2]);
    expect(assignUpperBodySlots([])).toEqual([null, null]);
  });
  it("同じ半分にいる人を別プレイヤーへ割り当てない", () => {
    const pose = body(null, .75);
    expect(assignUpperBodySlots([body(null, .65), pose])).toEqual([pose, null]);
  });
});

describe("ポーズから技への入力", () => {
  function confirm(input: UpperBodyInput) {
    const first = updateUpperBodyInput(emptyInputState(), input, true, 1000);
    return updateUpperBodyInput(first.state, input, true, 1000 + HOLD_MS);
  }
  it("安定確認後に1回だけ発火し、保持中は連発しない", () => {
    const confirmed = confirm("LEFT_HAND_UP");
    expect(confirmed.event).toBe("LEFT_HAND_UP");
    const next = updateUpperBodyInput(confirmed.state, "LEFT_HAND_UP", true, 1300);
    expect(next.event).toBeNull();
    expect(next.state.confirmed).toBe("LEFT_HAND_UP");
  });
  it("短い両手UPの通過では強攻撃が出ない", () => {
    const left = confirm("LEFT_HAND_UP");
    const both = updateUpperBodyInput(left.state, "BOTH_HANDS_UP", true, 1200);
    const short = updateUpperBodyInput(both.state, "BOTH_HANDS_UP", true, 1300);
    expect(short.event).toBeNull();
    const right = updateUpperBodyInput(short.state, "RIGHT_HAND_UP", true, 1350);
    expect(updateUpperBodyInput(right.state, "RIGHT_HAND_UP", true, 1350 + HOLD_MS).event).toBe("RIGHT_HAND_UP");
  });
  it("左手→右手→両手を中立姿勢なしでつなげる", () => {
    const left = confirm("LEFT_HAND_UP");
    const right = updateUpperBodyInput(left.state, "RIGHT_HAND_UP", true, 1200);
    const rightConfirmed = updateUpperBodyInput(right.state, "RIGHT_HAND_UP", true, 1200 + HOLD_MS);
    expect(rightConfirmed.event).toBe("RIGHT_HAND_UP");
    const both = updateUpperBodyInput(rightConfirmed.state, "BOTH_HANDS_UP", true, 1400);
    const mid = updateUpperBodyInput(both.state, "BOTH_HANDS_UP", true, 1550);
    expect(updateUpperBodyInput(mid.state, "BOTH_HANDS_UP", true, 1400 + BOTH_HANDS_HOLD_MS).event).toBe("BOTH_HANDS_UP");
  });
  it("十分に解除したときだけ同じ攻撃を再入力できる", () => {
    const confirmed = confirm("LEFT_HAND_UP");
    const neutral = updateUpperBodyInput(confirmed.state, null, true, 1200);
    const jitter = updateUpperBodyInput(neutral.state, "LEFT_HAND_UP", true, 1250);
    expect(updateUpperBodyInput(jitter.state, "LEFT_HAND_UP", true, 1250 + HOLD_MS).event).toBeNull();
    const released = updateUpperBodyInput(neutral.state, null, true, 1200 + RELEASE_MS);
    const again = updateUpperBodyInput(released.state, "LEFT_HAND_UP", true, 1450);
    expect(updateUpperBodyInput(again.state, "LEFT_HAND_UP", true, 1450 + HOLD_MS).event).toBe("LEFT_HAND_UP");
  });
  it("認識が途切れても短時間はガードを維持し、長く消えると解除する", () => {
    const guard = confirm("ARMS_CROSSED");
    expect(guard.state.confirmed).toBe("ARMS_CROSSED");
    const flicker = updateUpperBodyInput(guard.state, null, false, 1200);
    expect(flicker.state.confirmed).toBe("ARMS_CROSSED");
    expect(updateUpperBodyInput(flicker.state, null, false, 1200 + TRACKING_GRACE_MS).state.confirmed).toBeNull();
    const left = confirm("LEFT_HAND_UP");
    const missing = updateUpperBodyInput(left.state, null, false, 1200);
    const restored = updateUpperBodyInput(missing.state, "LEFT_HAND_UP", true, 1400);
    expect(updateUpperBodyInput(restored.state, "LEFT_HAND_UP", true, 1400 + HOLD_MS).event).toBeNull();
  });
  it("フレームが長く途切れた時間を保持時間に含めない", () => {
    const first = updateUpperBodyInput(emptyInputState(), "BOTH_HANDS_UP", true, 1000);
    const next = updateUpperBodyInput(first.state, "BOTH_HANDS_UP", true, 3000);
    expect(next.event).toBeNull();
    expect(next.state.progress).toBe(0);
  });
});


describe("判定の揺れに対する安定性", () => {
  it("肘が隠れても肩と手首で判定できる", () => {
    const pose = body("ARMS_CROSSED");
    pose[13]!.visibility = pose[14]!.visibility = .1;
    expect(hasVisibleUpperBody(pose)).toBe(true);
    expect(recognizeUpperBody(pose)).toBe("ARMS_CROSSED");
  });
  it("肩付近の手を新規入力にせず、認識済みの手は多少下がっても維持する", () => {
    const pose = body("LEFT_HAND_UP");
    pose[15]!.y = .41;
    expect(recognizeUpperBody(pose)).toBeNull();
    expect(recognizeUpperBody(pose, "LEFT_HAND_UP")).toBe("LEFT_HAND_UP");
    pose[15]!.y = .55;
    expect(recognizeUpperBody(pose, "LEFT_HAND_UP")).toBeNull();
  });
  it("両手から片手へは明確に下げた手を解除する", () => {
    expect(recognizeUpperBody(body("LEFT_HAND_UP"), "BOTH_HANDS_UP")).toBe("LEFT_HAND_UP");
  });
  it("ガードの手首が少しずれても維持し、ほどくと解除する", () => {
    const pose = body("ARMS_CROSSED");
    pose[15]!.x = .51; pose[16]!.x = .49;
    expect(recognizeUpperBody(pose)).toBeNull();
    expect(recognizeUpperBody(pose, "ARMS_CROSSED")).toBe("ARMS_CROSSED");
    expect(recognizeUpperBody(body(), "ARMS_CROSSED")).toBeNull();
  });
  it("確定前のゲージを短い途切れで消さず、途切れ時間を加算しない", () => {
    let result = updateUpperBodyInput(emptyInputState(), "LEFT_HAND_UP", true, 1000);
    result = updateUpperBodyInput(result.state, "LEFT_HAND_UP", true, 1100);
    const progress = result.state.progress;
    result = updateUpperBodyInput(result.state, null, false, 1120);
    expect(result.state.progress).toBe(progress);
    result = updateUpperBodyInput(result.state, "LEFT_HAND_UP", true, 1200);
    expect(result.event).toBeNull();
    result = updateUpperBodyInput(result.state, "LEFT_HAND_UP", true, 1260);
    expect(result.event).toBe("LEFT_HAND_UP");
  });
  it("未確定のポーズは見失っている間に勝手に確定しない", () => {
    let result = updateUpperBodyInput(emptyInputState(), "LEFT_HAND_UP", true, 1000);
    result = updateUpperBodyInput(result.state, null, false, 1100);
    result = updateUpperBodyInput(result.state, null, false, 1280);
    expect(result.event).toBeNull(); expect(result.state.confirmed).toBeNull();
    result = updateUpperBodyInput(result.state, null, false, 1320);
    expect(result.state.candidate).toBeNull(); expect(result.state.progress).toBe(0);
  });
  it("短い無判定を挟んでも確定表示を維持し、連発しない", () => {
    let result = updateUpperBodyInput(emptyInputState(), "LEFT_HAND_UP", true, 1000);
    result = updateUpperBodyInput(result.state, "LEFT_HAND_UP", true, 1180);
    result = updateUpperBodyInput(result.state, null, true, 1200);
    expect(result.state.confirmed).toBe("LEFT_HAND_UP");
    result = updateUpperBodyInput(result.state, "LEFT_HAND_UP", true, 1250);
    expect(result.state.confirmed).toBe("LEFT_HAND_UP"); expect(result.event).toBeNull();
  });
  it("一瞬別の候補になっても元の確定済みポーズへすぐ戻れる", () => {
    let result = updateUpperBodyInput(emptyInputState(), "LEFT_HAND_UP", true, 1000);
    result = updateUpperBodyInput(result.state, "LEFT_HAND_UP", true, 1180);
    result = updateUpperBodyInput(result.state, "BOTH_HANDS_UP", true, 1200);
    expect(result.state.confirmed).toBe("LEFT_HAND_UP");
    result = updateUpperBodyInput(result.state, "LEFT_HAND_UP", true, 1250);
    expect(result.state.confirmed).toBe("LEFT_HAND_UP"); expect(result.state.progress).toBe(1);
    expect(result.event).toBeNull();
  });
  it("姿勢の解除が続けばガードと確定表示を消す", () => {
    let result = updateUpperBodyInput(emptyInputState(), "ARMS_CROSSED", true, 1000);
    result = updateUpperBodyInput(result.state, "ARMS_CROSSED", true, 1180);
    result = updateUpperBodyInput(result.state, null, true, 1200);
    result = updateUpperBodyInput(result.state, null, true, 1200 + RELEASE_MS);
    expect(result.state.confirmed).toBeNull(); expect(result.state.latched).toBeNull();
  });
});


describe("横開きとL字のポーズ", () => {
  function special(input: "ARMS_OPEN" | "ONE_ARM_OUT" | "L_SHAPE", opposite = false): Pose {
    const pose = body();
    pose[15]!.x = .8; pose[15]!.y = .4;
    if (input === "ARMS_OPEN") { pose[16]!.x = .2; pose[16]!.y = .4; }
    if (input === "L_SHAPE") { pose[16]!.y = .2; }
    if (opposite) {
      const left = pose[15]!, right = pose[16]!;
      pose[15] = { ...right, x: 1 - right.x }; pose[16] = { ...left, x: 1 - left.x };
    }
    return pose;
  }
  it.each(["ARMS_OPEN", "ONE_ARM_OUT", "L_SHAPE"] as const)("%sは左右反転・左右の腕・肘の欠落に対応する", (input) => {
    for (const opposite of [false, true]) {
      const pose = special(input, opposite);
      pose[13]!.visibility = pose[14]!.visibility = 0;
      expect(recognizeUpperBody(pose)).toBe(input);
      expect(recognizeUpperBody(pose.map(p => ({ ...p, x: 1 - p.x })))).toBe(input);
    }
  });
  it.each(["ARMS_OPEN", "ONE_ARM_OUT", "L_SHAPE"] as const)("%sを手上げから直接切り替えても通常攻撃と混同しない", (input) => {
    for (const previous of ["LEFT_HAND_UP", "RIGHT_HAND_UP", "BOTH_HANDS_UP"] as const) {
      expect(recognizeUpperBody(special(input), previous)).toBe(input);
    }
  });
  it("横に開いた手が少し上がっても両手UPにはしない", () => {
    const pose = special("ARMS_OPEN"); pose[15]!.y = pose[16]!.y = .36;
    expect(recognizeUpperBody(pose)).toBe("ARMS_OPEN");
    pose[15]!.y = pose[16]!.y = .2;
    expect(recognizeUpperBody(pose, "ARMS_OPEN")).toBe("BOTH_HANDS_UP");
  });
  it("横開きの維持条件は緩くし、下ろしたら解除する", () => {
    const pose = special("ARMS_OPEN"); pose[15]!.x = .7; pose[16]!.x = .3;
    expect(recognizeUpperBody(pose)).toBeNull();
    expect(recognizeUpperBody(pose, "ARMS_OPEN")).toBe("ARMS_OPEN");
    expect(recognizeUpperBody(body(), "ARMS_OPEN")).toBeNull();
  });
  it.each(["ARMS_OPEN", "ONE_ARM_OUT", "L_SHAPE"] as const)("%sは短い通過では出ず、保持しても連発しない", (input) => {
    const hold = input === "ARMS_OPEN" ? BURST_HOLD_MS : SPECIAL_HOLD_MS;
    let result = updateUpperBodyInput(emptyInputState(), input, true, 1000);
    result = updateUpperBodyInput(result.state, input, true, 1000 + hold - 20);
    expect(result.event).toBeNull();
    result = updateUpperBodyInput(result.state, input, true, 1000 + hold);
    expect(result.event).toBe(input);
    result = updateUpperBodyInput(result.state, input, true, 1450);
    expect(result.event).toBeNull();
  });
  it("両腕を開く途中の片腕ポーズをカウンターとして確定しない", () => {
    let result = updateUpperBodyInput(emptyInputState(), "ONE_ARM_OUT", true, 1000);
    result = updateUpperBodyInput(result.state, "ONE_ARM_OUT", true, 1150);
    expect(result.event).toBeNull();
    result = updateUpperBodyInput(result.state, "ARMS_OPEN", true, 1200);
    result = updateUpperBodyInput(result.state, "ARMS_OPEN", true, 1460);
    expect(result.event).toBe("ARMS_OPEN");
  });
});
