export interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export type Pose = PoseLandmark[];
