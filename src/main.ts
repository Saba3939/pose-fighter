import "./style.css";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import {
  POSE_CONNECTIONS,
  assignPlayerSlots,
  hasVisibleFullBody,
} from "./pose";
import {
  EMPTY_POSE_HOLD_STATE,
  POSE_LABELS,
  recognizePose,
  updatePoseHold,
} from "./pose-recognition";
import type { PoseHoldState } from "./pose-recognition";
import type { Pose, PoseLandmark } from "./types";

const PLAYER_COLORS = ["#38f2ff", "#ff3ea5"] as const;
const VISIBILITY_THRESHOLD = 0.5;

const video = element<HTMLVideoElement>("camera-video");
const canvas = element<HTMLCanvasElement>("skeleton-canvas");
const context = canvasContext(canvas);
const cameraStage = element<HTMLDivElement>("camera-stage");
const emptyState = element<HTMLDivElement>("empty-state");
const startButton = element<HTMLButtonElement>("start-camera");
const stopButton = element<HTMLButtonElement>("stop-camera");
const cameraSelect = element<HTMLSelectElement>("camera-select");
const mirrorToggle = element<HTMLInputElement>("mirror-toggle");
const systemStatus = element<HTMLDivElement>("system-status");
const systemStatusText = element<HTMLSpanElement>("system-status-text");
const notice = element<HTMLParagraphElement>("notice");
const cameraResolution = element<HTMLElement>("camera-resolution");
const inferenceFps = element<HTMLElement>("inference-fps");
const inferenceLatency = element<HTMLElement>("inference-latency");
const poseCount = element<HTMLElement>("pose-count");
const playerOneCard = element<HTMLElement>("player-one-card");
const playerTwoCard = element<HTMLElement>("player-two-card");
const playerOneStatus = element<HTMLElement>("player-one-status");
const playerTwoStatus = element<HTMLElement>("player-two-status");
const playerOnePose = element<HTMLElement>("player-one-pose");
const playerTwoPose = element<HTMLElement>("player-two-pose");
const playerOneHold = element<HTMLElement>("player-one-hold");
const playerTwoHold = element<HTMLElement>("player-two-hold");

let mediaStream: MediaStream | null = null;
let poseLandmarker: PoseLandmarker | null = null;
let modelReady = false;
let inferencePending = false;
let cameraActive = false;
let lastPoses: Pose[] = [];
let completedInferenceTimes: number[] = [];
let poseHoldStates: [PoseHoldState, PoseHoldState] = createEmptyHoldStates();

startButton.addEventListener("click", () => {
  void startCamera();
});

stopButton.addEventListener("click", stopCamera);

cameraSelect.addEventListener("change", () => {
  if (cameraSelect.value) {
    void startCamera(cameraSelect.value, false);
  }
});

mirrorToggle.addEventListener("change", () => {
  cameraStage.classList.toggle("is-mirrored", mirrorToggle.checked);
  lastPoses = assignPlayerSlots(lastPoses, mirrorToggle.checked);
  drawSkeletons(lastPoses);
  updatePlayerStatus(lastPoses);
  resetPoseRecognition();
});

window.addEventListener("beforeunload", () => {
  stopMediaTracks();
  poseLandmarker?.close();
});

if (!window.isSecureContext) {
  setSystemStatus("error", "安全な接続が必要です");
  setNotice("カメラを使用するにはlocalhostまたはHTTPSで開いてください。", true);
  startButton.disabled = true;
} else if (!navigator.mediaDevices?.getUserMedia) {
  setSystemStatus("error", "カメラAPI非対応");
  setNotice("このブラウザはカメラ入力に対応していません。Chromeで開いてください。", true);
  startButton.disabled = true;
} else {
  void initializePoseLandmarker();
  requestAnimationFrame(inferenceLoop);
}

async function initializePoseLandmarker(): Promise<void> {
  const timeoutId = window.setTimeout(() => {
    if (!modelReady) {
      setSystemStatus("error", "姿勢モデル読込タイムアウト");
      setNotice(
        "姿勢モデルを20秒以内に初期化できませんでした。ページを再読み込みしてください。",
        true,
      );
    }
  }, 20_000);

  try {
    setSystemStatus("loading", "MediaPipe WASMを読み込み中...");
    const wasmRoot = new URL("/mediapipe/wasm", window.location.origin).toString();
    const vision = await FilesetResolver.forVisionTasks(wasmRoot);

    setSystemStatus("loading", "姿勢モデルを初期化中...");
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "/models/pose_landmarker_full.task",
      },
      runningMode: "VIDEO",
      numPoses: 2,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });

    modelReady = true;
    setSystemStatus("ready", "姿勢モデル準備完了");
    if (cameraActive) {
      setNotice("2人の全身が映る位置に立ってください。");
    }
  } catch (error) {
    setSystemStatus("error", "姿勢モデル読込エラー");
    setNotice(`姿勢モデルを初期化できません: ${errorMessage(error)}`, true);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function startCamera(
  requestedDeviceId?: string,
  selectPreferredCamera = true,
): Promise<void> {
  startButton.disabled = true;
  setNotice("カメラへの接続を待っています...");
  stopMediaTracks();

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: requestedDeviceId ? { exact: requestedDeviceId } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      },
    });

    video.srcObject = mediaStream;
    await waitForVideoMetadata(video);
    await video.play();
    cameraActive = true;

    const devices = await refreshCameraOptions();
    const activeDeviceId = mediaStream.getVideoTracks()[0]?.getSettings().deviceId;
    const preferredCamera = devices.find((device) =>
      device.label.toLowerCase().includes("emeet"),
    );

    if (
      selectPreferredCamera &&
      preferredCamera?.deviceId &&
      preferredCamera.deviceId !== activeDeviceId
    ) {
      await startCamera(preferredCamera.deviceId, false);
      return;
    }

    if (activeDeviceId) {
      cameraSelect.value = activeDeviceId;
    }

    syncCanvasSize();
    emptyState.hidden = true;
    stopButton.disabled = false;
    cameraSelect.disabled = devices.length === 0;
    cameraResolution.textContent = `${video.videoWidth}×${video.videoHeight}`;
    setNotice(
      modelReady
        ? "2人の全身が映る位置に立ってください。"
        : "カメラ接続完了。姿勢モデルの読み込みを待っています。",
    );
  } catch (error) {
    cameraActive = false;
    startButton.disabled = false;
    stopButton.disabled = true;
    setNotice(cameraErrorMessage(error), true);
  }
}

function stopCamera(): void {
  cameraActive = false;
  inferencePending = false;
  lastPoses = [];
  completedInferenceTimes = [];
  resetPoseRecognition();
  stopMediaTracks();
  video.srcObject = null;
  clearCanvas();
  emptyState.hidden = false;
  startButton.disabled = false;
  stopButton.disabled = true;
  cameraSelect.disabled = true;
  cameraResolution.textContent = "--";
  inferenceFps.textContent = "0 FPS";
  inferenceLatency.textContent = "-- ms";
  poseCount.textContent = "0 / 2";
  setPlayerCard(playerOneCard, playerOneStatus, "待機中", "idle");
  setPlayerCard(playerTwoCard, playerTwoStatus, "待機中", "idle");
  setNotice("カメラを停止しました。映像は保存されていません。");
}

function stopMediaTracks(): void {
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
}

async function refreshCameraOptions(): Promise<MediaDeviceInfo[]> {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
    (device) => device.kind === "videoinput",
  );

  cameraSelect.replaceChildren();
  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `カメラ ${index + 1}`;
    cameraSelect.append(option);
  });

  return devices;
}

async function inferenceLoop(): Promise<void> {
  requestAnimationFrame(inferenceLoop);

  if (
    !cameraActive ||
    !modelReady ||
    !poseLandmarker ||
    inferencePending ||
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
  ) {
    return;
  }

  inferencePending = true;

  try {
    const startedAt = performance.now();
    const result = poseLandmarker.detectForVideo(video, startedAt);
    const poses: Pose[] = result.landmarks.map((landmarks) =>
      landmarks.map((landmark) => ({
        x: landmark.x,
        y: landmark.y,
        z: landmark.z,
        visibility: landmark.visibility,
      })),
    );

    lastPoses = assignPlayerSlots(poses, mirrorToggle.checked);
    drawSkeletons(lastPoses);
    updatePlayerStatus(lastPoses);
    updatePoseRecognition(lastPoses, performance.now());
    updateMetrics(performance.now() - startedAt, lastPoses.length);
  } catch (error) {
    setSystemStatus("error", "姿勢推定エラー");
    setNotice(`姿勢推定を実行できません: ${errorMessage(error)}`, true);
  } finally {
    inferencePending = false;
  }
}

function drawSkeletons(poses: Pose[]): void {
  syncCanvasSize();
  clearCanvas();

  poses.forEach((pose, playerIndex) => {
    const color = PLAYER_COLORS[playerIndex] ?? "#ffffff";
    drawPose(pose, color);
  });
}

function drawPose(pose: Pose, color: string): void {
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = Math.max(3, canvas.width / 320);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.shadowColor = color;
  context.shadowBlur = 8;

  for (const [startIndex, endIndex] of POSE_CONNECTIONS) {
    const start = pose[startIndex];
    const end = pose[endIndex];
    if (!isVisible(start) || !isVisible(end)) continue;

    context.beginPath();
    context.moveTo(start.x * canvas.width, start.y * canvas.height);
    context.lineTo(end.x * canvas.width, end.y * canvas.height);
    context.stroke();
  }

  const radius = Math.max(4, canvas.width / 220);
  for (const landmark of pose) {
    if (!isVisible(landmark)) continue;
    context.beginPath();
    context.arc(
      landmark.x * canvas.width,
      landmark.y * canvas.height,
      radius,
      0,
      Math.PI * 2,
    );
    context.fill();
  }

  context.restore();
}

function updatePlayerStatus(poses: Pose[]): void {
  updateSinglePlayerStatus(poses[0], playerOneCard, playerOneStatus);
  updateSinglePlayerStatus(poses[1], playerTwoCard, playerTwoStatus);
}

function updatePoseRecognition(poses: Pose[], timestampMs: number): void {
  const displays = [
    { pose: playerOnePose, hold: playerOneHold },
    { pose: playerTwoPose, hold: playerTwoHold },
  ] as const;

  ([0, 1] as const).forEach((playerIndex) => {
    const display = displays[playerIndex];
    const detected = poses[playerIndex] ? recognizePose(poses[playerIndex]) : null;
    const previous = poseHoldStates[playerIndex];
    const next = updatePoseHold(previous, detected, timestampMs);
    poseHoldStates[playerIndex] = next;

    const poseId = next.confirmed ?? next.candidate;
    display.pose.textContent = poseId ? POSE_LABELS[poseId] : "---";
    display.pose.dataset.state = next.confirmed
      ? "confirmed"
      : next.candidate
        ? "holding"
        : "idle";
    display.hold.style.width = `${Math.round(next.progress * 100)}%`;
  });
}

function resetPoseRecognition(): void {
  poseHoldStates = createEmptyHoldStates();
  playerOnePose.textContent = "---";
  playerTwoPose.textContent = "---";
  playerOnePose.dataset.state = "idle";
  playerTwoPose.dataset.state = "idle";
  playerOneHold.style.width = "0%";
  playerTwoHold.style.width = "0%";
}

function createEmptyHoldStates(): [PoseHoldState, PoseHoldState] {
  return [
    { ...EMPTY_POSE_HOLD_STATE },
    { ...EMPTY_POSE_HOLD_STATE },
  ];
}

function updateSinglePlayerStatus(
  pose: Pose | undefined,
  card: HTMLElement,
  status: HTMLElement,
): void {
  if (!pose) {
    setPlayerCard(card, status, "未検出", "missing");
  } else if (hasVisibleFullBody(pose, VISIBILITY_THRESHOLD)) {
    setPlayerCard(card, status, "全身認識中", "active");
  } else {
    setPlayerCard(card, status, "全身を映してください", "partial");
  }
}

function setPlayerCard(
  card: HTMLElement,
  status: HTMLElement,
  text: string,
  state: "idle" | "missing" | "partial" | "active",
): void {
  card.dataset.state = state;
  status.textContent = text;
}

function updateMetrics(inferenceMs: number, detectedPoses: number): void {
  const now = performance.now();
  completedInferenceTimes.push(now);
  completedInferenceTimes = completedInferenceTimes.filter((time) => now - time <= 1000);
  inferenceFps.textContent = `${completedInferenceTimes.length} FPS`;
  inferenceLatency.textContent = `${Math.round(inferenceMs)} ms`;
  poseCount.textContent = `${detectedPoses} / 2`;
}

function syncCanvasSize(): void {
  if (!video.videoWidth || !video.videoHeight) return;
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
}

function clearCanvas(): void {
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function isVisible(landmark: PoseLandmark | undefined): landmark is PoseLandmark {
  return landmark !== undefined && (landmark.visibility ?? 1) >= VISIBILITY_THRESHOLD;
}

function setSystemStatus(state: "loading" | "ready" | "error", text: string): void {
  systemStatus.dataset.state = state;
  systemStatusText.textContent = text;
}

function setNotice(message: string, isError = false): void {
  notice.textContent = message;
  notice.classList.toggle("is-error", isError);
}

function waitForVideoMetadata(target: HTMLVideoElement): Promise<void> {
  if (target.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    target.addEventListener("loadedmetadata", () => resolve(), { once: true });
  });
}

function cameraErrorMessage(error: unknown): string {
  if (!(error instanceof DOMException)) {
    return `カメラを開始できません: ${String(error)}`;
  }

  switch (error.name) {
    case "NotAllowedError":
      return "カメラの使用が許可されていません。Chromeのサイト設定から許可してください。";
    case "NotFoundError":
      return "利用できるカメラが見つかりません。USB接続を確認してください。";
    case "NotReadableError":
      return "カメラを使用できません。他のアプリがカメラを使用していないか確認してください。";
    case "OverconstrainedError":
      return "選択したカメラは指定した映像設定に対応していません。";
    default:
      return `カメラを開始できません: ${error.message}`;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function element<T extends HTMLElement>(id: string): T {
  const target = document.getElementById(id);
  if (!target) throw new Error(`#${id} が見つかりません。`);
  return target as T;
}

function canvasContext(target: HTMLCanvasElement): CanvasRenderingContext2D {
  const value = target.getContext("2d");
  if (!value) throw new Error("Canvas 2Dを初期化できませんでした。");
  return value;
}
