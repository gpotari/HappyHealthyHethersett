import { PhotoAttachment } from './photo-attachment';
import { EventCreator } from './event-creator';

export interface EventItem {
  id?: string;
  title: string;
  date: string;
  start: string;
  end: string;
  location?: string;
  description: string;
  ctaLabel?: string;
  ctaHref?: string;
  note?: string;
  phone?: string;
  imageUrl?: string;
  imageAlt?: string;
  photos?: PhotoAttachment[];
  createdAt?: string;
  createdBy?: EventCreator;
  updatedAt?: string;
  updatedBy?: EventCreator;
}
