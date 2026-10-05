import type { UpperBodyInput } from "./upper-body-input";
export type Attack = "LEFT_HAND_UP" | "RIGHT_HAND_UP" | "BOTH_HANDS_UP" | "L_SHAPE";
export type Action = Exclude<UpperBodyInput, "ARMS_CROSSED">;
export type Player = 0 | 1;
export const MOVES: Record<Attack, { damage: number; startup: number; recovery: number }> = {
  LEFT_HAND_UP: { damage: 6, startup: 160, recovery: 320 },
  RIGHT_HAND_UP: { damage: 9, startup: 220, recovery: 380 },
  BOTH_HANDS_UP: { damage: 16, startup: 440, recovery: 640 },
  L_SHAPE: { damage: 30, startup: 380, recovery: 800 },
};
export const GUARD_RECOVERY_MS = 240;
export const BLOCKED_RECOVERY_MS = 560;
export const MAX_METER = 100;
export const START_METER = 50;
export const BURST_COST = 50;
export const BURST_BUFFER_MS = 250;
export const SUPER_COST = 100;
export const COUNTER_WINDOW_MS = 500;
export const COUNTER_RECOVERY_MS = 600;

interface Fighter {
  hp: number; meter: number; guard: boolean; guardReadyAt: number; stunnedUntil: number;
  invulnerableUntil: number; consecutiveHits: number; counterUntil: number; recoveryUntil: number;
  burstBufferUntil: number | null;
  attack: { move: Attack; hitAt: number; endsAt: number; resolved: boolean; blocked: boolean } | null;
  buffer: { move: Attack; expires: number } | null;
  combo: number; lastHit: Attack | null; chainUntil: number;
}
export interface BattleEvent {
  kind: "attack" | "hit" | "block" | "break" | "burst" | "counter-ready" | "counter" | "denied";
  player: Player; move: Action; damage: number; combo: number; message?: string;
}
export interface Battle {
  time: number; remaining: number; phase: "fight" | "ended"; winner: Player | "draw" | null;
  fighters: [Fighter, Fighter]; events: BattleEvent[];
}
export function createBattle(): Battle {
  const fighter = (): Fighter => ({ hp: 100, meter: START_METER, guard: false, guardReadyAt: 0,
    stunnedUntil: 0, consecutiveHits: 0, invulnerableUntil: 0, counterUntil: 0, recoveryUntil: 0,
    attack: null, buffer: null, burstBufferUntil: null, combo: 0, lastHit: null, chainUntil: 0 });
  return { time: 0, remaining: 60_000, phase: "fight", winner: null, fighters: [fighter(), fighter()], events: [] };
}
function gainMeter(fighter: Fighter, amount: number): void {
  fighter.meter = Math.min(MAX_METER, fighter.meter + amount);
}
function deny(battle: Battle, player: Player, move: Action, message: string): void {
  battle.events.push({ kind: "denied", player, move, damage: 0, combo: 0, message });
}
function clearOffense(fighter: Fighter): void {
  fighter.attack = null; fighter.buffer = null; fighter.combo = 0; fighter.lastHit = null; fighter.chainUntil = 0;
}
function chains(battle: Battle, player: Player, move: Attack): boolean {
  const f = battle.fighters[player];
  return f.chainUntil > battle.time && ((f.combo === 1 && f.lastHit === "LEFT_HAND_UP" && move === "RIGHT_HAND_UP") ||
    (f.combo === 2 && f.lastHit === "RIGHT_HAND_UP" && (move === "BOTH_HANDS_UP" || move === "L_SHAPE")));
}
function begin(battle: Battle, player: Player, move: Attack): void {
  const f = battle.fighters[player];
  f.buffer = null;
  if (move === "L_SHAPE") {
    if (f.meter < SUPER_COST) { deny(battle, player, move, "ゲージ不足 / 必殺 100"); return; }
    f.meter -= SUPER_COST;
  }
  if (!chains(battle, player, move)) { f.combo = 0; f.lastHit = null; }
  const definition = MOVES[move];
  f.attack = { move, hitAt: battle.time + definition.startup,
    endsAt: battle.time + definition.startup + definition.recovery, resolved: false, blocked: false };
  battle.events.push({ kind: "attack", player, move, damage: 0, combo: f.combo });
}
export function inputAction(battle: Battle, player: Player, action: Action): void {
  if (battle.phase !== "fight") return;
  if (action !== "ARMS_OPEN" && action !== "ONE_ARM_OUT") { inputAttack(battle, player, action); return; }
  const f = battle.fighters[player];
  if (action === "ARMS_OPEN") {
    if (f.stunnedUntil <= battle.time) {
      f.burstBufferUntil = battle.time + BURST_BUFFER_MS;
      return;
    }
    burst(battle, player);
    return;
  }
  f.burstBufferUntil = null;
  if (f.stunnedUntil > battle.time || f.recoveryUntil > battle.time || (f.attack && f.attack.endsAt > battle.time)) return;
  clearOffense(f);
  f.counterUntil = battle.time + COUNTER_WINDOW_MS;
  f.recoveryUntil = f.counterUntil + COUNTER_RECOVERY_MS;
  battle.events.push({ kind: "counter-ready", player, move: action, damage: 0, combo: 0 });
}
function burst(battle: Battle, player: Player): void {
  const f = battle.fighters[player];
  f.burstBufferUntil = null;
  if (f.meter < BURST_COST) { deny(battle, player, "ARMS_OPEN", "ゲージ不足 / 脱出 50"); return; }
  f.meter -= BURST_COST;
  const opponent = battle.fighters[1 - player]!;
  clearOffense(f); clearOffense(opponent);
  f.stunnedUntil = battle.time; f.guardReadyAt = battle.time; f.counterUntil = 0;
  f.recoveryUntil = battle.time + 120; f.consecutiveHits = 0;
  f.invulnerableUntil = Math.max(f.invulnerableUntil, battle.time + 800);
  opponent.counterUntil = 0;
  opponent.recoveryUntil = Math.max(opponent.recoveryUntil, battle.time + 400);
  battle.events.push({ kind: "burst", player, move: "ARMS_OPEN", damage: 0, combo: 0 });
}
export function inputAttack(battle: Battle, player: Player, move: Attack): void {
  if (battle.phase !== "fight") return;
  const f = battle.fighters[player];
  f.burstBufferUntil = null;
  if (f.stunnedUntil > battle.time || f.recoveryUntil > battle.time) return;
  if (f.attack && f.attack.endsAt > battle.time && !(f.attack.resolved && chains(battle, player, move))) {
    if (!f.attack.blocked) f.buffer = { move, expires: battle.time + 450 };
    return;
  }
  begin(battle, player, move);
}
export function isGuarding(battle: Battle, player: Player): boolean {
  const f = battle.fighters[player];
  return f.guard && f.guardReadyAt <= battle.time && f.recoveryUntil <= battle.time && (!f.attack || f.attack.endsAt <= battle.time);
}
function hit(battle: Battle, target: Fighter, damage: number, endCombo: boolean): void {
  target.guardReadyAt = battle.time + GUARD_RECOVERY_MS;
  target.hp = Math.max(0, target.hp - damage);
  clearOffense(target); target.counterUntil = 0; target.recoveryUntil = 0;
  target.consecutiveHits = target.stunnedUntil > battle.time ? target.consecutiveHits + 1 : 1;
  const endChain = endCombo || target.consecutiveHits >= 3;
  target.stunnedUntil = battle.time + (endChain ? 450 : 720);
  if (endChain) target.invulnerableUntil = battle.time + 1000;
  gainMeter(target, 12);
}
export function advanceBattle(battle: Battle, deltaMs: number): void {
  if (battle.phase !== "fight" || !Number.isFinite(deltaMs) || deltaMs < 0) return;
  const targetTime = battle.time + Math.min(deltaMs, battle.remaining);
  // Resolve by contact time, taking a snapshot for attacks that land together.
  while (battle.phase === "fight") {
    const due = battle.fighters.map(f => f.attack && !f.attack.resolved ? f.attack.hitAt : Infinity);
    const next = Math.min(...due);
    if (next > targetTime) break;
    battle.remaining -= next - battle.time; battle.time = next;
    const contacts = ([0, 1] as const).filter(i => due[i] === next).map(player => {
      const attack = battle.fighters[player].attack!;
      const defender = (1 - player) as Player;
      return { player, defender, attack, guard: isGuarding(battle, defender),
        counter: battle.fighters[defender].counterUntil > battle.time,
        immune: battle.fighters[defender].invulnerableUntil > battle.time };
    });
    for (const { player, defender, attack, guard, counter, immune } of contacts) {
      attack.resolved = true;
      const source = battle.fighters[player], target = battle.fighters[defender];
      if (immune) { source.combo = 0; source.chainUntil = 0; continue; }
      if (counter && (attack.move === "LEFT_HAND_UP" || attack.move === "RIGHT_HAND_UP")) {
        hit(battle, source, 12, false);
        target.counterUntil = 0; target.recoveryUntil = battle.time + 260;
        gainMeter(target, 20);
        battle.events.push({ kind: "counter", player: defender, move: "ONE_ARM_OUT", damage: 12, combo: 0 });
        continue;
      }
      const blocked = guard && attack.move !== "BOTH_HANDS_UP";
      const damage = blocked ? 0 : Math.round(MOVES[attack.move].damage * (guard ? .75 : source.combo > 0 ? .85 : 1));
      source.combo = blocked ? 0 : source.combo + 1;
      source.lastHit = blocked ? null : attack.move;
      source.chainUntil = !blocked && source.combo < 3 ? battle.time + 850 : 0;
      if (blocked) {
        attack.blocked = true;
        attack.endsAt = Math.max(attack.endsAt, battle.time + BLOCKED_RECOVERY_MS);
        source.buffer = null;
        target.stunnedUntil = battle.time;
        target.consecutiveHits = 0;
        gainMeter(target, 8);
      } else {
        hit(battle, target, damage, source.combo >= 3);
        if (attack.move !== "L_SHAPE") gainMeter(source, 8);
      }
      battle.events.push({ kind: blocked ? "block" : guard ? "break" : "hit", player, move: attack.move, damage, combo: source.combo });
    }
    finishIfNeeded(battle);
    // Apply escapes after simultaneous hits and KO resolution, so an early
    // gesture can escape hitstun but cannot erase the triggering damage.
    if (battle.phase === "fight") {
      for (const player of [0, 1] as const) {
        const f = battle.fighters[player];
        if (f.burstBufferUntil !== null && f.burstBufferUntil >= battle.time && f.stunnedUntil > battle.time) burst(battle, player);
      }
    }
  }
  if (battle.phase !== "fight") return;
  battle.remaining -= targetTime - battle.time; battle.time = targetTime;
  for (const player of [0, 1] as const) {
    const f = battle.fighters[player];
    if (f.burstBufferUntil !== null && f.burstBufferUntil < battle.time) {
      f.burstBufferUntil = null;
      deny(battle, player, "ARMS_OPEN", "脱出は被弾に合わせて両腕を開く");
    }
    if (f.attack && f.attack.endsAt <= battle.time) f.attack = null;
    if (f.buffer && f.buffer.expires < battle.time) f.buffer = null;
    if (f.buffer && f.stunnedUntil <= battle.time && f.recoveryUntil <= battle.time &&
      (!f.attack || (f.attack.resolved && chains(battle, player, f.buffer.move)))) {
      begin(battle, player, f.buffer.move);
    }
    if (f.chainUntil <= battle.time && !f.attack) f.combo = 0;
  }
  finishIfNeeded(battle);
}
function finishIfNeeded(battle: Battle): void {
  const [a, b] = battle.fighters;
  if (a.hp > 0 && b.hp > 0 && battle.remaining > 0) return;
  battle.phase = "ended";
  battle.winner = a.hp === b.hp ? "draw" : a.hp > b.hp ? 0 : 1;
  for (const fighter of battle.fighters) {
    fighter.attack = null; fighter.buffer = null; fighter.burstBufferUntil = null;
    fighter.guard = false; fighter.counterUntil = 0; fighter.recoveryUntil = 0;
  }
}
