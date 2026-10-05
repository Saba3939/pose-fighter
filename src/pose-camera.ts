import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Pose } from "./types";

export type CameraStatus = "idle" | "loading" | "ready" | "error";
interface CameraCallbacks {
  frame: (poses: Pose[], timestamp: number, inferenceMs: number) => void;
  status: (status: CameraStatus, message: string) => void;
  devices: (devices: MediaDeviceInfo[], active: string) => void;
}

export class PoseCamera {
  private stream: MediaStream | null = null;
  private model: PoseLandmarker | null = null;
  private modelPromise: Promise<PoseLandmarker> | null = null;
  private generation = 0;
  private animationFrame = 0;
  private disposed = false;

  constructor(private video: HTMLVideoElement, private callbacks: CameraCallbacks) {}

  async start(deviceId?: string): Promise<void> {
    this.stop(false);
    const generation = this.generation;
    const current = () => generation === this.generation && !this.disposed;
    this.callbacks.status("loading", "カメラの使用を許可してください");
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("カメラを使うにはChromeでlocalhostまたはHTTPSのページを開いてください。");
      }
      let stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 },
      } });
      if (!current()) { stream.getTracks().forEach((track) => track.stop()); return; }
      this.stream = stream;
      const devices = (await navigator.mediaDevices.enumerateDevices())
        .filter((device) => device.kind === "videoinput");
      if (!current()) return;
      const preferred = devices.find((device) => /emeet/i.test(device.label));
      if (!deviceId && preferred && preferred.deviceId !== stream.getVideoTracks()[0]?.getSettings().deviceId) {
        stream.getTracks().forEach((track) => track.stop());
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
          deviceId: { exact: preferred.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        } });
        if (!current()) { stream.getTracks().forEach((track) => track.stop()); return; }
        this.stream = stream;
      }
      this.callbacks.devices(devices, stream.getVideoTracks()[0]?.getSettings().deviceId ?? "");
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (!current()) return;
        this.stop(false);
        this.callbacks.status("error", "カメラとの接続が切れました。接続を確認して再開してください。");
      });
      this.video.srcObject = stream;
      await withTimeout(this.video.play(), 10_000, "カメラ映像を開始できませんでした。再試行してください。");
      if (!current()) return;
      this.callbacks.status("loading", "姿勢モデルを読み込んでいます…");
      const model = await withTimeout(this.loadModel(), 30_000, "モデルの読み込みがタイムアウトしました。再試行してください。");
      if (!current()) return;
      this.callbacks.status("ready", "肩と手首を映して、好きな技を出してみましょう");
      let lastVideoTime = -1;
      let lastFrameAt = performance.now();
      const loop = () => {
        if (!current()) return;
        try {
          const now = performance.now();
          if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && this.video.currentTime !== lastVideoTime) {
            lastVideoTime = this.video.currentTime;
            const result = model.detectForVideo(this.video, now);
            lastFrameAt = now;
            this.callbacks.frame(result.landmarks, now, performance.now() - now);
          } else if (now - lastFrameAt > 500) {
            this.callbacks.frame([], now, 0);
          }
          this.animationFrame = requestAnimationFrame(loop);
        } catch (error) {
          this.stop(false);
          this.callbacks.status("error", `認識を停止しました。再開してください。${errorMessage(error)}`);
        }
      };
      this.animationFrame = requestAnimationFrame(loop);
    } catch (error) {
      if (!current()) return;
      this.stop(false);
      this.callbacks.status("error", errorMessage(error));
    }
  }

  stop(notify = true): void {
    this.generation += 1;
    cancelAnimationFrame(this.animationFrame);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.callbacks.frame([], performance.now(), 0);
    if (notify) this.callbacks.status("idle", "カメラは停止中です。1人でも入力を試せます。");
  }

  dispose(): void {
    this.disposed = true;
    this.stop(false);
    this.model?.close();
    this.model = null;
  }

  private loadModel(): Promise<PoseLandmarker> {
    if (!this.modelPromise) {
      this.modelPromise = (async () => {
        const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        const model = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: "/models/pose_landmarker_full.task" },
          runningMode: "VIDEO", numPoses: 2,
          minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5, outputSegmentationMasks: false,
        });
        if (this.disposed) { model.close(); throw new Error("終了しました"); }
        this.model = model;
        return model;
      })().catch((error: unknown) => { this.modelPromise = null; throw error; });
    }
    return this.modelPromise;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(resolve, reject).finally(() => window.clearTimeout(timeout));
  });
}
function errorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return "カメラが許可されていません。ブラウザのサイト設定から許可して再開してください。";
    if (error.name === "NotFoundError") return "カメラが見つかりません。接続を確認してください。";
    if (error.name === "NotReadableError") return "カメラを開けません。他のアプリで使用していないか確認してください。";
    if (error.name === "OverconstrainedError") return "選択したカメラが使えません。別のカメラを選んでください。";
  }
  return error instanceof Error ? error.message : String(error);
}
