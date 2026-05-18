import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule, NgForm, NgModel } from '@angular/forms';
import { PhotoAttachment } from '../models/photo-attachment';

type ContactFormModel = {
  name: string;
  email: string;
  subject: string;
  message: string;
  photos: PhotoAttachment[];
};

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './contact.component.html'
})
export class ContactComponent {
  readonly contactEmail = 'info@happyhealthyhethersett.org';
  readonly form: ContactFormModel = {
    name: '',
    email: '',
    subject: '',
    message: '',
    photos: []
  };
  submitting = false;
  submitAttempted = false;
  successMessage = '';
  errorMessage = '';

  constructor(private http: HttpClient) {}

  sendMessage(form: NgForm): void {
    this.submitAttempted = true;
    this.successMessage = '';
    this.errorMessage = '';

    if (form.invalid) {
      this.errorMessage = 'Please complete the highlighted fields before submitting.';
      return;
    }

    this.submitting = true;
    this.http.post<{ message?: string }>('/api/contact', this.form).subscribe({
      next: (response) => {
        this.successMessage = response.message || 'Thanks, your message has been saved for the team.';
        this.submitting = false;
        this.submitAttempted = false;
        form.resetForm({
          name: '',
          email: '',
          subject: '',
          message: ''
        });
        this.form.photos = [];
      },
      error: (error: HttpErrorResponse) => {
        this.errorMessage =
          error.error?.error ||
          error.error?.title ||
          `We could not save your message right now. Please email ${this.contactEmail} directly.`;
        this.submitting = false;
      }
    });
  }

  fieldInvalid(field: NgModel | null): boolean {
    return Boolean(field?.invalid && (field.touched || this.submitAttempted));
  }

  async attachPhotos(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    if (!files.length) {
      return;
    }

    this.errorMessage = '';
    try {
      const availableSlots = Math.max(0, 4 - this.form.photos.length);
      if (!availableSlots) {
        this.errorMessage = 'You can attach up to 4 photos.';
        return;
      }

      const photos = await Promise.all(
        files
          .filter((file) => file.type.startsWith('image/'))
          .slice(0, availableSlots)
          .map((file) => this.createPhotoAttachment(file))
      );

      if (!photos.length) {
        this.errorMessage = 'Please choose image files to attach.';
        return;
      }

      this.form.photos = [...this.form.photos, ...photos];
    } catch {
      this.errorMessage = 'Unable to read one of those photos.';
    } finally {
      input.value = '';
    }
  }

  removePhoto(index: number): void {
    this.form.photos = this.form.photos.filter((_, photoIndex) => photoIndex !== index);
  }

  private async createPhotoAttachment(file: File): Promise<PhotoAttachment> {
    return {
      fileName: file.name,
      contentType: file.type || 'image/jpeg',
      dataUrl: await this.readImageAsDataUrl(file)
    };
  }

  private readImageAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
}
