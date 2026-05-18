import { PhotoAttachment } from './photo-attachment';

export interface FeedbackMessage {
  id: string;
  createdAt: string;
  name: string;
  email: string;
  subject?: string;
  message: string;
  photos?: PhotoAttachment[];
}
