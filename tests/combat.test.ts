import { describe, expect, it } from "vitest";
import { advanceBattle, createBattle, inputAction, inputAttack, isGuarding } from "../src/combat";

describe("対戦", () => {
  it("攻撃は発生時間後に相手へ当たり、HPを減らす", () => {
    const battle = createBattle(); inputAttack(battle, 0, "LEFT_HAND_UP");
    advanceBattle(battle, 159); expect(battle.fighters[1].hp).toBe(100);
    advanceBattle(battle, 1); expect(battle.fighters[1].hp).toBe(94);
  });
  it("同時に当たる攻撃は両者にダメージが入り、処理順で勝敗が変わらない", () => {
    const battle = createBattle();
    inputAttack(battle, 0, "LEFT_HAND_UP"); inputAttack(battle, 1, "LEFT_HAND_UP");
    advanceBattle(battle, 200);
    expect(battle.fighters.map(f => f.hp)).toEqual([94, 94]);
  });
  it("遅い攻撃の発生前に速い攻撃が当たると中断する", () => {
    const battle = createBattle();
    inputAttack(battle, 0, "BOTH_HANDS_UP"); inputAttack(battle, 1, "LEFT_HAND_UP");
    advanceBattle(battle, 600);
    expect(battle.fighters.map(f => f.hp)).toEqual([94, 100]);
    expect(battle.fighters[0].attack).toBeNull();
  });
  it("ガードは通常攻撃を防ぐが、強攻撃で崩せる", () => {
    const battle = createBattle(); battle.fighters[1].guard = true;
    inputAttack(battle, 0, "LEFT_HAND_UP"); advanceBattle(battle, 500);
    expect(battle.fighters[1].hp).toBe(100);
    expect(battle.events.some(event => event.kind === "block")).toBe(true);
    advanceBattle(battle, 240); // Let the blocked jab finish its recovery.
    inputAttack(battle, 0, "BOTH_HANDS_UP"); advanceBattle(battle, 450);
    expect(battle.fighters[1].hp).toBe(88);
    expect(battle.events.some(event => event.kind === "break")).toBe(true);
  });
  it("攻撃中と被弾直後はガードに移れない", () => {
    const battle = createBattle(); battle.fighters[0].guard = true;
    inputAttack(battle, 0, "LEFT_HAND_UP"); expect(isGuarding(battle, 0)).toBe(false);
    battle.fighters[1].guard = true; battle.fighters[1].stunnedUntil = 300; battle.fighters[1].guardReadyAt = 240;
    expect(isGuarding(battle, 1)).toBe(false);
  });
  it("左→右→両手をつなぎ、3連撃の後は追撃を防ぐ", () => {
    const battle = createBattle();
    inputAttack(battle, 0, "LEFT_HAND_UP"); advanceBattle(battle, 200);
    inputAttack(battle, 0, "RIGHT_HAND_UP"); advanceBattle(battle, 250);
    inputAttack(battle, 0, "BOTH_HANDS_UP"); advanceBattle(battle, 450);
    expect(battle.events.filter(event => event.kind === "hit").map(event => event.combo)).toEqual([1, 2, 3]);
    const hp = battle.fighters[1].hp;
    advanceBattle(battle, 640);
    inputAttack(battle, 0, "LEFT_HAND_UP"); advanceBattle(battle, 180);
    expect(battle.fighters[1].hp).toBe(hp);
  });
  it("攻撃中に入力した次の技を短時間先行受付する", () => {
    const battle = createBattle(); inputAttack(battle, 0, "LEFT_HAND_UP");
    advanceBattle(battle, 100); inputAttack(battle, 0, "RIGHT_HAND_UP");
    advanceBattle(battle, 100);
    expect(battle.fighters[0].attack?.move).toBe("RIGHT_HAND_UP");
    advanceBattle(battle, 250); expect(battle.fighters[0].combo).toBe(2);
  });
  it("ガードされた技からコンボにはならない", () => {
    const battle = createBattle(); battle.fighters[1].guard = true;
    inputAttack(battle, 0, "LEFT_HAND_UP"); advanceBattle(battle, 180);
    inputAttack(battle, 0, "RIGHT_HAND_UP");
    expect(battle.fighters[0].attack?.move).toBe("LEFT_HAND_UP");
    expect(battle.fighters[0].combo).toBe(0);
  });
  it("KO後は入力を受け付けず、時間切れではHPで決着する", () => {
    const battle = createBattle(); battle.fighters[1].hp = 6;
    inputAttack(battle, 0, "LEFT_HAND_UP"); advanceBattle(battle, 200);
    expect(battle.phase).toBe("ended"); expect(battle.winner).toBe(0);
    inputAttack(battle, 1, "BOTH_HANDS_UP"); expect(battle.fighters[1].attack).toBeNull();
    const timeout = createBattle(); timeout.fighters[0].hp = 90;
    advanceBattle(timeout, 60_000); expect(timeout.winner).toBe(1);
    const draw = createBattle(); advanceBattle(draw, 60_000); expect(draw.winner).toBe("draw");
  });
});


it("同じ攻撃の繰り返しでも3回連続被弾後は追撃を防ぐ", () => {
  const battle = createBattle();
  for (let i = 0; i < 3; i++) {
    inputAttack(battle, 0, "LEFT_HAND_UP"); advanceBattle(battle, 480);
  }
  const hp = battle.fighters[1].hp;
  inputAttack(battle, 0, "LEFT_HAND_UP"); advanceBattle(battle, 480);
  expect(battle.fighters[1].hp).toBe(hp);
});


describe("左右交互入力への対抗", () => {
  it("最初の被弾後にガードへ戻り、交互入力の追撃を防げる", () => {
    const battle = createBattle();
    inputAttack(battle, 0, "LEFT_HAND_UP"); advanceBattle(battle, 200);
    expect(battle.fighters[1].hp).toBe(94);
    battle.fighters[1].guard = true;
    expect(isGuarding(battle, 1)).toBe(false);
    inputAttack(battle, 0, "RIGHT_HAND_UP"); advanceBattle(battle, 200);
    expect(isGuarding(battle, 1)).toBe(true);
    advanceBattle(battle, 20);
    expect(battle.fighters[1].hp).toBe(94);
    expect(battle.fighters[1].stunnedUntil).toBe(battle.time);
    expect(battle.events.at(-1)?.kind).toBe("block");
  });
  it("ガード後の交互入力を先行受付せず、体の入力時間を挟んだ反撃が間に合う", () => {
    const battle = createBattle(); battle.fighters[1].guard = true;
    inputAttack(battle, 0, "LEFT_HAND_UP"); advanceBattle(battle, 100);
    inputAttack(battle, 0, "RIGHT_HAND_UP"); // Input queued before the block.
    advanceBattle(battle, 60);
    expect(battle.fighters[0].buffer).toBeNull();
    inputAttack(battle, 0, "RIGHT_HAND_UP");
    expect(battle.fighters[0].buffer).toBeNull();
    advanceBattle(battle, 180); // Recognize the defender's next pose.
    battle.fighters[1].guard = false;
    inputAttack(battle, 1, "LEFT_HAND_UP"); advanceBattle(battle, 160);
    expect(battle.fighters.map(f => f.hp)).toEqual([94, 100]);
    expect(battle.fighters[0].attack).toBeNull();
  });
  it.each([0, 1] as const)("%s側が10秒間交互に入力しても、被弾後にガードすれば押し切られない", (attacker) => {
    const battle = createBattle(); const defender = attacker === 0 ? 1 : 0;
    for (let tick = 0; tick < 50; tick++) {
      if (tick === 1) battle.fighters[defender].guard = true;
      inputAttack(battle, attacker, tick % 2 === 0 ? "LEFT_HAND_UP" : "RIGHT_HAND_UP");
      advanceBattle(battle, 200);
    }
    expect(battle.fighters[defender].hp).toBe(94);
    expect(battle.phase).toBe("fight");
  });
});


describe("EXゲージと追加アクション", () => {
  it("開始時50、命中と被弾で増え、空振りや待機では増えない", () => {
    const battle = createBattle();
    expect(battle.fighters.map(f => f.meter)).toEqual([50, 50]);
    advanceBattle(battle, 1000); expect(battle.fighters[0].meter).toBe(50);
    battle.fighters[1].invulnerableUntil = 2000;
    inputAttack(battle, 0, "LEFT_HAND_UP"); advanceBattle(battle, 1000);
    expect(battle.fighters.map(f => f.meter)).toEqual([50, 50]);
    inputAttack(battle, 0, "LEFT_HAND_UP"); advanceBattle(battle, 500);
    expect(battle.fighters.map(f => f.meter)).toEqual([58, 62]);
  });
  it("ガード成功で防御側だけが増え、上限100を超えない", () => {
    const battle = createBattle(); battle.fighters[1].guard = true; battle.fighters[1].meter = 98;
    inputAttack(battle, 0, "LEFT_HAND_UP"); advanceBattle(battle, 160);
    expect(battle.fighters.map(f => f.meter)).toEqual([50, 100]);
  });
  it("被弾中の脱出で50消費し、両者の攻撃予約を消して追撃を止める", () => {
    const battle = createBattle();
    inputAttack(battle, 0, "LEFT_HAND_UP"); advanceBattle(battle, 200);
    inputAttack(battle, 0, "RIGHT_HAND_UP");
    inputAction(battle, 1, "ARMS_OPEN");
    expect(battle.fighters[1].meter).toBe(12);
    expect(battle.fighters[1].stunnedUntil).toBe(battle.time);
    expect(battle.fighters[0].attack).toBeNull(); expect(battle.fighters[0].buffer).toBeNull();
    inputAttack(battle, 0, "LEFT_HAND_UP"); expect(battle.fighters[0].attack).toBeNull();
    advanceBattle(battle, 400); inputAttack(battle, 0, "LEFT_HAND_UP"); advanceBattle(battle, 160);
    expect(battle.fighters[1].hp).toBe(94);
  });
  it("脱出は平常時とゲージ不足時に使えず、値も変えない", () => {
    const battle = createBattle(); inputAction(battle, 0, "ARMS_OPEN");
    expect(battle.fighters[0].meter).toBe(50); expect(battle.fighters[0].invulnerableUntil).toBe(0);
    battle.fighters[0].meter = 49; battle.fighters[0].stunnedUntil = 500;
    inputAction(battle, 0, "ARMS_OPEN");
    expect(battle.fighters[0].meter).toBe(49); expect(battle.fighters[0].stunnedUntil).toBe(500);
  });
  it("被弾直前の脱出入力は命中後に1度だけ発動し、予約中はゲージを消費しない", () => {
    const battle = createBattle();
    inputAttack(battle, 0, "LEFT_HAND_UP"); inputAction(battle, 1, "ARMS_OPEN");
    expect(battle.fighters[1].meter).toBe(50);
    advanceBattle(battle, 160);
    expect(battle.fighters[1].hp).toBe(94); expect(battle.fighters[1].meter).toBe(12);
    expect(battle.fighters[1].stunnedUntil).toBe(battle.time);
    expect(battle.fighters[1].burstBufferUntil).toBeNull();
    advanceBattle(battle, 2000);
    expect(battle.events.filter(e => e.kind === "burst")).toHaveLength(1);
  });
  it("脱出の予約はガード成功やKOでは発動しない", () => {
    for (const guarded of [true, false]) {
      const battle = createBattle(); battle.fighters[1].guard = guarded;
      battle.fighters[1].hp = guarded ? 100 : 6;
      inputAttack(battle, 0, "LEFT_HAND_UP"); inputAction(battle, 1, "ARMS_OPEN");
      advanceBattle(battle, 400);
      expect(battle.events.some(e => e.kind === "burst")).toBe(false);
      expect(battle.fighters[1].burstBufferUntil).toBeNull();
      expect(battle.fighters[1].meter).toBe(guarded ? 58 : 62);
    }
  });
  it("脱出予約後の被弾でゲージが足りなければ消費せず、別の技を入力すると予約を消す", () => {
    const battle = createBattle(); battle.fighters[1].meter = 0;
    inputAttack(battle, 0, "LEFT_HAND_UP"); inputAction(battle, 1, "ARMS_OPEN"); advanceBattle(battle, 160);
    expect(battle.fighters[1].meter).toBe(12); expect(battle.fighters[1].burstBufferUntil).toBeNull();
    expect(battle.events.at(-1)?.message).toContain("ゲージ不足");
    const changed = createBattle();
    inputAction(changed, 1, "ARMS_OPEN"); inputAttack(changed, 1, "BOTH_HANDS_UP");
    inputAttack(changed, 0, "LEFT_HAND_UP"); advanceBattle(changed, 160);
    expect(changed.fighters[1].burstBufferUntil).toBeNull();
    expect(changed.events.some(e => e.kind === "burst")).toBe(false);
  });
  it.each(["LEFT_HAND_UP", "RIGHT_HAND_UP"] as const)("カウンターは%sを防ぎ、反撃とゲージ獲得を行う", move => {
    const battle = createBattle(); inputAction(battle, 1, "ONE_ARM_OUT");
    inputAttack(battle, 0, move); advanceBattle(battle, 250);
    expect(battle.fighters.map(f => f.hp)).toEqual([88, 100]);
    expect(battle.fighters[1].meter).toBe(70);
    expect(battle.events.some(e => e.kind === "counter")).toBe(true);
    expect(battle.fighters[0].attack).toBeNull();
  });
  it("カウンターの空振りには隙があり、ガードや再発動で消せない", () => {
    const battle = createBattle(); inputAction(battle, 0, "ONE_ARM_OUT");
    advanceBattle(battle, 550); battle.fighters[0].guard = true;
    expect(isGuarding(battle, 0)).toBe(false);
    inputAction(battle, 0, "ONE_ARM_OUT"); inputAttack(battle, 0, "LEFT_HAND_UP");
    expect(battle.fighters[0].counterUntil).toBe(500); expect(battle.fighters[0].attack).toBeNull();
    inputAttack(battle, 1, "LEFT_HAND_UP"); advanceBattle(battle, 160);
    expect(battle.fighters[0].hp).toBe(94);
  });
  it("カウンターは強攻撃と必殺技には負ける", () => {
    for (const move of ["BOTH_HANDS_UP", "L_SHAPE"] as const) {
      const battle = createBattle(); battle.fighters[0].meter = 100;
      inputAction(battle, 1, "ONE_ARM_OUT"); inputAttack(battle, 0, move); advanceBattle(battle, 450);
      expect(battle.fighters[1].hp).toBeLessThan(100); expect(battle.fighters[0].hp).toBe(100);
    }
  });
  it("必殺技は100必要で発動時に1回消費し、命中では自身のゲージを回復しない", () => {
    const battle = createBattle(); inputAction(battle, 0, "L_SHAPE");
    expect(battle.fighters[0].attack).toBeNull(); expect(battle.fighters[0].meter).toBe(50);
    battle.fighters[0].meter = 100; inputAction(battle, 0, "L_SHAPE");
    expect(battle.fighters[0].meter).toBe(0);
    advanceBattle(battle, 400);
    expect(battle.fighters[1].hp).toBe(70); expect(battle.fighters[0].meter).toBe(0);
  });
  it("必殺技はガードでき、中断されてもゲージを返さない", () => {
    const battle = createBattle(); battle.fighters[0].meter = 100; battle.fighters[1].guard = true;
    inputAttack(battle, 0, "L_SHAPE"); advanceBattle(battle, 400);
    expect(battle.fighters[1].hp).toBe(100); expect(battle.fighters[0].meter).toBe(0);
    const interrupted = createBattle(); interrupted.fighters[0].meter = 100;
    inputAttack(interrupted, 0, "L_SHAPE"); inputAttack(interrupted, 1, "LEFT_HAND_UP"); advanceBattle(interrupted, 400);
    expect(interrupted.fighters[0].meter).toBe(12); // Received-hit gain only.
    expect(interrupted.fighters[1].hp).toBe(100);
  });
  it("必殺技を先行入力しても二重消費せず、コンボの締めにできる", () => {
    const battle = createBattle(); battle.fighters[0].meter = 100;
    inputAttack(battle, 0, "LEFT_HAND_UP"); advanceBattle(battle, 200);
    inputAttack(battle, 0, "RIGHT_HAND_UP"); advanceBattle(battle, 100);
    inputAction(battle, 0, "L_SHAPE"); expect(battle.fighters[0].meter).toBe(100);
    advanceBattle(battle, 150); expect(battle.fighters[0].meter).toBe(0);
    advanceBattle(battle, 400);
    expect(battle.fighters[1].hp).toBe(60);
    expect(battle.events.filter(e => e.kind === "hit").map(e => e.combo)).toEqual([1, 2, 3]);
  });
  it("ラウンド終了後に追加技を使えず、再戦ではゲージを初期化する", () => {
    const battle = createBattle(); battle.fighters[0].meter = 100; advanceBattle(battle, 60_000);
    for (const move of ["ARMS_OPEN", "ONE_ARM_OUT", "L_SHAPE"] as const) inputAction(battle, 0, move);
    expect(battle.fighters[0].meter).toBe(100); expect(battle.fighters[0].attack).toBeNull();
    expect(battle.fighters[0].counterUntil).toBe(0); expect(createBattle().fighters[0].meter).toBe(50);
  });
});
