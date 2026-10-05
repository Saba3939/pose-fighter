import "./game.css";
import { PoseCamera } from "./pose-camera";
import type { CameraStatus } from "./pose-camera";
import { assignUpperBodySlots, emptyInputState, hasVisibleUpperBody, recognizeUpperBody, updateUpperBodyInput } from "./upper-body-input";
import type { Pose } from "./types";
import { advanceBattle, createBattle, inputAction, isGuarding } from "./combat";
import type { Action, Player } from "./combat";

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const video = el<HTMLVideoElement>("camera-video");
const startButton = el<HTMLButtonElement>("start-match");
const select = el<HTMLSelectElement>("camera-select");
const stopButton = el<HTMLButtonElement>("stop-camera");
const overlay = el("start-overlay");
const announcement = el("announcement");
const notice = el("connection-notice");
const settings = el<HTMLDetailsElement>("settings");
const cameraMini = el("camera-mini");
const showCamera = el<HTMLInputElement>("show-camera");
const arena = el("arena");
const players = ([1, 2] as const).map(id => ({
  input: emptyInputState(), lastSeen: -Infinity,
  fighter: el(id === 1 ? "fighter-one" : "fighter-two"),
  sensor: el(`p${id}-sensor`), health: el(`p${id}-health`), fill: el(`p${id}-health-fill`), hp: el(`p${id}-hp`),
  meter: el(`p${id}-meter`), meterFill: el(`p${id}-meter-fill`), meterValue: el(`p${id}-meter-value`),
  text: el(`p${id}-combat`), textUntil: 0, effectUntil: 0, burstUntil: 0, counterHitUntil: 0,
}));
let battle = createBattle();
let mode: "title" | "waiting" | "countdown" | "fight" | "ended" = "title";
let cameraStatus: CameraStatus = "idle";
let demo = false;
let countdown = 3000;
let readySince: number | null = null;
let announcementUntil = 0;
let shakeUntil = 0;
const demoGuards = [false, false];
const camera = new PoseCamera(video, {
  frame: recognize,
  status(status, message) {
    cameraStatus = status;
    stopButton.disabled = status === "idle" || status === "error";
    select.disabled = status === "loading" || !select.value;
    cameraMini.hidden = status !== "ready" || !showCamera.checked;
    if (status !== "ready") {
      for (const player of players) { player.input = emptyInputState(); player.lastSeen = -Infinity; }
      for (const fighter of battle.fighters) fighter.guard = false;
    }
    notice.hidden = status !== "error";
    if (status === "error") {
      notice.textContent = message;
      mode = "title"; overlay.hidden = false; startButton.disabled = false;
      startButton.textContent = "もう一度接続する";
    }
  },
  devices(devices, active) {
    select.replaceChildren(...devices.map((device, index) => {
      const option = document.createElement("option"); option.value = device.deviceId;
      option.textContent = device.label || `カメラ ${index + 1}`; return option;
    })); select.value = active;
  },
});

function recognize(poses: Pose[], timestamp: number): void {
  const slots = assignUpperBodySlots(poses);
  const attacks: Array<{ player: Player; move: Action }> = [];
  players.forEach((player, index) => {
    const pose = slots[index];
    const tracked = !!pose && hasVisibleUpperBody(pose);
    if (tracked) player.lastSeen = timestamp;
    const detected = tracked ? recognizeUpperBody(pose!, player.input.candidate ?? player.input.confirmed) : null;
    const { state, event } = updateUpperBodyInput(player.input, detected, tracked, timestamp);
    player.input = state;
    if (!demo) battle.fighters[index]!.guard = state.confirmed === "ARMS_CROSSED";
    if (event && event !== "ARMS_CROSSED") attacks.push({ player: index as Player, move: event });
  });
  if (mode === "fight" && !demo && available(timestamp) && !settings.open) {
    for (const attack of attacks) inputAction(battle, attack.player, attack.move);
  }
}
function available(now: number): boolean {
  return demo || (cameraStatus === "ready" && players.every(player => now - player.lastSeen < 700));
}
function beginMatch(useDemo: boolean): void {
  if (useDemo) camera.stop();
  demo = useDemo;
  battle = createBattle(); mode = "waiting"; countdown = 3000; readySince = null;
  announcementUntil = 0;
  for (const player of players) {
    player.input = emptyInputState(); player.textUntil = 0; player.effectUntil = 0; player.burstUntil = 0; player.counterHitUntil = 0;
    player.fighter.className = player === players[0] ? "fighter fighter-one" : "fighter fighter-two";
  }
  demoGuards.fill(false);
  overlay.hidden = true; notice.hidden = true; settings.open = false;
  if (!useDemo && cameraStatus !== "ready") void camera.start(select.value || undefined);
}
function title(): void {
  mode = "title"; battle = createBattle(); overlay.hidden = false;
  startButton.textContent = "対戦スタート"; announcement.textContent = "";
  el("start-hint").textContent = "2人でカメラの前に立ってください";
  for (const player of players) { player.input = emptyInputState(); player.textUntil = 0; player.effectUntil = 0; player.burstUntil = 0; player.counterHitUntil = 0; }
  demoGuards.fill(false); settings.open = false;
}
startButton.addEventListener("click", () => beginMatch(mode === "ended" && demo));
el("demo-match").addEventListener("click", () => beginMatch(true));
el("reset-match").addEventListener("click", title);
stopButton.addEventListener("click", () => { camera.stop(); title(); });
select.addEventListener("change", () => { title(); void camera.start(select.value); });
showCamera.addEventListener("change", () => { cameraMini.hidden = !showCamera.checked || cameraStatus !== "ready"; });
window.addEventListener("pagehide", () => camera.stop());
window.addEventListener("beforeunload", () => camera.dispose());
document.addEventListener("visibilitychange", () => {
  lastFrame = performance.now();
  demoGuards.fill(false);
  if (document.hidden && !demo) { camera.stop(); title(); }
});
window.addEventListener("blur", () => demoGuards.fill(false));
const keys: Record<string, { player: Player; move: Action }> = {
  a: { player: 0, move: "LEFT_HAND_UP" }, s: { player: 0, move: "RIGHT_HAND_UP" }, d: { player: 0, move: "BOTH_HANDS_UP" },
  q: { player: 0, move: "ARMS_OPEN" }, w: { player: 0, move: "ONE_ARM_OUT" }, e: { player: 0, move: "L_SHAPE" },
  u: { player: 1, move: "ARMS_OPEN" }, i: { player: 1, move: "ONE_ARM_OUT" }, o: { player: 1, move: "L_SHAPE" },
  j: { player: 1, move: "LEFT_HAND_UP" }, k: { player: 1, move: "RIGHT_HAND_UP" }, l: { player: 1, move: "BOTH_HANDS_UP" },
};
window.addEventListener("keydown", event => {
  if (!demo || mode !== "fight" || settings.open || event.repeat) return;
  if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
  const key = event.key.toLowerCase();
  if (key === "f") demoGuards[0] = true;
  if (key === ";") demoGuards[1] = true;
  if (keys[key]) inputAction(battle, keys[key].player, keys[key].move);
});
window.addEventListener("keyup", event => {
  if (event.key.toLowerCase() === "f") demoGuards[0] = false;
  if (event.key === ";") demoGuards[1] = false;
});

let lastFrame = performance.now();
function tick(now: number): void {
  const delta = now - lastFrame; lastFrame = now;
  const ready = available(now);
  const paused = settings.open || document.hidden || !ready;
  if (mode === "waiting") {
    announcement.textContent = demo ? "READY" : cameraStatus !== "ready" ? "カメラを接続中…" : "2人で左右に立ってください";
    if (ready && !settings.open) {
      readySince ??= now;
      if (now - readySince >= 500) mode = "countdown";
    } else readySince = null;
  } else if (mode === "countdown") {
    if (!paused) countdown -= Math.min(delta, 250);
    announcement.textContent = paused ? settings.open ? "PAUSE" : "2人を確認しています" : String(Math.max(1, Math.ceil(countdown / 1000)));
    if (countdown <= 0) {
      mode = "fight"; announcement.textContent = "FIGHT!"; announcementUntil = now + 800;
      for (const player of players) player.input = emptyInputState();
    }
  } else if (mode === "fight") {
    if (demo) battle.fighters.forEach((fighter, index) => { fighter.guard = demoGuards[index]!; });
    if (!paused) advanceBattle(battle, delta);
    if (paused) announcement.textContent = settings.open || document.hidden ? "PAUSE" : "2人を確認しています";
    else if (now >= announcementUntil) announcement.textContent = "";
    if (battle.phase === "ended") {
      mode = "ended";
      announcement.textContent = battle.winner === "draw" ? "DRAW" : battle.fighters.some(f => f.hp === 0) ? "K.O.!" : "TIME UP";
      announcementUntil = now + 1500;
    }
  } else if (mode === "ended" && now >= announcementUntil) {
    announcement.textContent = battle.winner === "draw" ? "DRAW" : `PLAYER ${Number(battle.winner) + 1} WIN`;
    overlay.hidden = false; overlay.classList.add("rematch");
    startButton.textContent = "もう一度対戦";
    el("start-hint").textContent = "";
  }
  if (mode !== "ended") overlay.classList.remove("rematch");
  for (const event of battle.events.splice(0)) {
    const attacker = players[event.player]!;
    if (event.kind === "attack" && event.move !== "L_SHAPE") continue;
    attacker.text.dataset.kind = event.kind;
    if (event.kind === "denied" || event.kind === "burst" || event.kind === "counter-ready" ||
      (event.kind === "attack" && event.move === "L_SHAPE")) {
      attacker.text.textContent = event.kind === "denied" ? event.message ?? "使用できません" :
        event.kind === "burst" ? "BURST!" : event.kind === "counter-ready" ? "COUNTER READY" : "SPECIAL!";
      attacker.textUntil = battle.time + (event.kind === "counter-ready" ? 500 : 900);
      if (event.kind === "burst") {
        attacker.burstUntil = battle.time + 650; shakeUntil = now + 160;
        attacker.effectUntil = 0;
        attacker.fighter.classList.remove("impact", "blocked");
        const opponent = players[1 - event.player]!;
        opponent.textUntil = 0;
      }
      continue;
    }
    if (event.kind === "attack") continue;
    if (event.kind === "counter") attacker.counterHitUntil = battle.time + 350;
    const defender = players[1 - event.player]!;
    defender.effectUntil = battle.time + 260;
    defender.fighter.classList.remove("impact", "blocked"); void defender.fighter.offsetWidth;
    defender.fighter.classList.add(event.kind === "block" ? "blocked" : "impact");
    attacker.text.textContent = event.kind === "counter" ? "COUNTER!" : event.kind === "block" ? "GUARD" : event.kind === "break" ? "GUARD BREAK" : event.combo > 1 ? `${event.combo} HIT COMBO` : `${event.damage}`;
    attacker.textUntil = battle.time + 800;
    if (event.kind !== "block") shakeUntil = now + (event.move === "BOTH_HANDS_UP" || event.move === "L_SHAPE" ? 220 : 110);
  }
  arena.classList.toggle("shake", now < shakeUntil && mode === "fight");
  arena.dataset.mode = mode;
  el("timer").textContent = String(Math.ceil(battle.remaining / 1000)).padStart(2, "0");
  players.forEach((player, index) => {
    const fighter = battle.fighters[index]!;
    player.hp.textContent = String(fighter.hp); player.fill.style.width = `${fighter.hp}%`;
    player.health.setAttribute("aria-valuenow", String(fighter.hp));
    player.health.classList.toggle("danger", fighter.hp <= 25);
    player.meterFill.style.width = `${fighter.meter}%`;
    player.meterValue.textContent = String(fighter.meter);
    player.meter.setAttribute("aria-valuenow", String(fighter.meter));
    player.meter.classList.toggle("burst-ready", fighter.meter >= 50);
    player.meter.classList.toggle("super-ready", fighter.meter >= 100);
    player.sensor.classList.toggle("active", demo || (cameraStatus === "ready" && now - player.lastSeen < 700));
    player.sensor.title = demo ? "デモ操作" : now - player.lastSeen < 700 ? "認識中" : "未検出";
    const attacking = mode === "fight" && !!fighter.attack && !fighter.attack.blocked;
    player.fighter.classList.toggle("attacking", attacking);
    player.fighter.classList.toggle("heavy", attacking && fighter.attack?.move === "BOTH_HANDS_UP");
    player.fighter.classList.toggle("special", attacking && fighter.attack?.move === "L_SHAPE");
    player.fighter.classList.toggle("bursting", mode === "fight" && battle.time < player.burstUntil);
    player.fighter.classList.toggle("countering", mode === "fight" && fighter.counterUntil > battle.time);
    player.fighter.classList.toggle("counter-hit", mode === "fight" && battle.time < player.counterHitUntil);
    player.fighter.classList.toggle("recovering", mode === "fight" && fighter.counterUntil <= battle.time && fighter.recoveryUntil > battle.time);
    player.fighter.classList.toggle("guarding", mode === "fight" && isGuarding(battle, index as Player));
    player.fighter.classList.toggle("hurt", mode === "fight" && fighter.stunnedUntil > battle.time && !isGuarding(battle, index as Player));
    player.fighter.classList.toggle("defeated", mode === "ended" && battle.winner !== "draw" && battle.winner !== index);
    player.fighter.classList.toggle("victory", mode === "ended" && battle.winner === index);
    if (battle.time >= player.effectUntil) player.fighter.classList.remove("impact", "blocked");
    player.text.hidden = battle.time >= player.textUntil || mode === "title";
  });
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
