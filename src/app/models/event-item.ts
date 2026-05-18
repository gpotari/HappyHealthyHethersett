import { PhotoAttachment } from './photo-attachment';

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
}
