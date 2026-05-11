export type LitterPickStatus = 'open' | 'closed';

export interface LitterPickArea {
  id: string;
  label: string;
  points?: Array<{ x: number; y: number }>;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  stickerIcon?: string;
  stickerLabel?: string;
  stickerColor?: string;
  stickerTint?: string;
  stickerStroke?: string;
  bags: number;
  volunteers: number;
  notes?: string;
}

export interface LitterPickEvent {
  id: string;
  title: string;
  date: string;
  start?: string;
  end?: string;
  meetingPoint?: string;
  meetingPointLat?: number;
  meetingPointLng?: number;
  notes?: string;
  status: LitterPickStatus;
  areas: LitterPickArea[];
  createdAt?: string;
  updatedAt?: string;
}
