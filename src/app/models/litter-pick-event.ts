import { PhotoAttachment } from './photo-attachment';

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
  description?: string;
  meetingPoint?: string;
  meetingPointLat?: number;
  meetingPointLng?: number;
  capacity?: number;
  registeredCount?: number;
  isAttending?: boolean;
  whatToBring?: string;
  equipmentProvided?: string;
  difficulty?: 'Easy' | 'Moderate' | 'Challenging' | string;
  familyFriendly?: boolean;
  accessibilityNotes?: string;
  weatherPlan?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  bagsGoal?: number;
  volunteersGoal?: number;
  notes?: string;
  status: LitterPickStatus;
  areas: LitterPickArea[];
  photos?: PhotoAttachment[];
  createdAt?: string;
  updatedAt?: string;
}
