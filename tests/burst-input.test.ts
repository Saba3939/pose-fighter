import { describe, expect, it } from "vitest";
import { advanceBattle, createBattle, inputAction, inputAttack } from "../src/combat";
import { emptyInputState, recognizeUpperBody, updateUpperBodyInput } from "../src/upper-body-input";
import type { Pose } from "../src/types";

function openArms(): Pose {
  const pose: Pose = Array.from({ length: 17 }, () => ({ x: .5, y: .5, z: 0, visibility: 0 }));
  for (const [i, x, y] of [[11, .6, .4], [12, .4, .4], [15, .8, .4], [16, .2, .4]]) {
    pose[i!] = { x: x!, y: y!, z: 0, visibility: .99 };
  }
  return pose;
}

describe("カメラ入力からのコンボ脱出", () => {
  it("両腕が肩より少し下でも脱出として認識する", () => {
    const pose = openArms(); pose[15]!.y = .49; pose[16]!.y = .51;
    expect(recognizeUpperBody(pose)).toBe("ARMS_OPEN");
    expect(recognizeUpperBody(pose.map(p => ({ ...p, x: 1 - p.x })))).toBe("ARMS_OPEN");
    pose[15]!.y = pose[16]!.y = .7;
    expect(recognizeUpperBody(pose, "ARMS_OPEN")).toBeNull();
  });

  it.each([0, 1] as const)("%s側が被弾直前に確定したポーズを保持していても脱出できる", defender => {
    const battle = createBattle(); const attacker = defender === 0 ? 1 : 0;
    let state = emptyInputState();
    inputAttack(battle, attacker, "BOTH_HANDS_UP");
    for (let time = 0; time <= 600; time += 20) {
      advanceBattle(battle, time - battle.time);
      const result = updateUpperBodyInput(state, recognizeUpperBody(openArms()), true, time);
      state = result.state;
      if (result.event && result.event !== "ARMS_CROSSED") inputAction(battle, defender, result.event);
    }
    // Holding from too early must not become automatic protection against later hits.
    expect(battle.events.filter(e => e.kind === "burst")).toHaveLength(0);

    const nearHit = createBattle(); state = emptyInputState();
    inputAttack(nearHit, attacker, "BOTH_HANDS_UP");
    for (let time = 100; time <= 700; time += 20) {
      advanceBattle(nearHit, time - nearHit.time);
      const result = updateUpperBodyInput(state, recognizeUpperBody(openArms()), true, time);
      state = result.state;
      if (result.event && result.event !== "ARMS_CROSSED") inputAction(nearHit, defender, result.event);
    }
    expect(nearHit.events.filter(e => e.kind === "burst")).toHaveLength(1);
    expect(nearHit.fighters[defender].meter).toBe(12);
  });

  it("3発目の被弾から250ms後に腕を開き始めても脱出が間に合う", () => {
    const battle = createBattle();
    for (const move of ["LEFT_HAND_UP", "RIGHT_HAND_UP", "BOTH_HANDS_UP"] as const) {
      inputAttack(battle, 0, move); advanceBattle(battle, move === "BOTH_HANDS_UP" ? 440 : 220);
    }
    advanceBattle(battle, 250);
    let state = emptyInputState(); const start = battle.time;
    for (let elapsed = 0; elapsed <= 300; elapsed += 20) {
      advanceBattle(battle, start + elapsed - battle.time);
      const result = updateUpperBodyInput(state, "ARMS_OPEN", true, start + elapsed);
      state = result.state;
      if (result.event && result.event !== "ARMS_CROSSED") inputAction(battle, 1, result.event);
    }
    expect(battle.events.filter(e => e.kind === "burst")).toHaveLength(1);
  });
});
