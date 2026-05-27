import { PhotoAttachment } from './photo-attachment';

export type LitterReportState = 'new' | 'addressed';

export interface LitterReport {
  id?: string;
  createdAt?: string;
  state?: LitterReportState;
  locationLabel: string;
  lat: number;
  lng: number;
  amount?: string;
  comment?: string;
  contact?: string;
  mapLink?: string;
  photos?: PhotoAttachment[];
}
