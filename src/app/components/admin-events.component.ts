import { Component } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EventItem } from '../models/event-item';
import { EventsService } from '../services/events.service';

@Component({
  selector: 'app-admin-events',
  standalone: true,
  imports: [FormsModule, NgFor, NgIf],
  templateUrl: './admin-events.component.html',
  styleUrl: './admin-events.component.css'
})
export class AdminEventsComponent {
  passwordInput = '';
  isUnlocked = false;
  errorMessage = '';
  statusMessage = '';
  events: EventItem[] = [];
  newEvent: EventItem = this.emptyEvent();
  showCreateForm = false;
  expandedIndex: number | null = null;
  isEditing = false;
  draftEvent: EventItem | null = null;

  constructor(private eventsService: EventsService) {}

  unlock(): void {
    this.errorMessage = '';
    const password = this.passwordInput.trim();
    if (!password) {
      this.errorMessage = 'Please enter the admin password.';
      return;
    }
    this.eventsService.verifyPassword(password).subscribe({
      next: () => {
        this.isUnlocked = true;
        this.passwordInput = '';
        this.eventsService.loadEvents().subscribe(() => {
          this.loadEvents();
        });
      },
      error: () => {
        this.errorMessage = 'Incorrect password. Please try again.';
      }
    });
  }

  addEvent(): void {
    this.statusMessage = '';
    if (!this.isEventValid(this.newEvent)) {
      this.errorMessage = 'Please complete all required fields and any CTA details before adding the event.';
      return;
    }
    this.errorMessage = '';
    const updated = [...this.events, { ...this.newEvent }];
    this.saveEvents(updated, 'Event added and saved.', () => {
      this.newEvent = this.emptyEvent();
      this.showCreateForm = false;
    });
  }

  deleteEvent(index: number): void {
    this.statusMessage = '';
    const updated = this.events.filter((_, i) => i !== index);
    this.saveEvents(updated, 'Event deleted and saved.', () => {
      this.expandedIndex = null;
      this.isEditing = false;
      this.draftEvent = null;
    });
  }

  saveChanges(): void {
    this.errorMessage = '';
    this.saveEvents(this.events, 'Events saved. The public page updates immediately.', () => {
      this.expandedIndex = null;
      this.isEditing = false;
      this.draftEvent = null;
    });
  }

  downloadJson(): void {
    const payload = JSON.stringify(this.events, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'events.json';
    anchor.click();
    URL.revokeObjectURL(url);
    this.statusMessage = 'Downloaded events.json.';
  }

  async uploadJson(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as EventItem[];
      if (!Array.isArray(parsed)) {
        throw new Error('Invalid file format');
      }
      const normalized = this.sortLatestFirst(parsed.map((item) => ({ ...item })));
      this.saveEvents(normalized, 'Events loaded from file and saved.');
    } catch {
      this.errorMessage = 'Unable to read that file. Please upload a valid events JSON.';
    } finally {
      input.value = '';
    }
  }

  async attachImage(event: Event, target: EventItem): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    try {
      const dataUrl = await this.readFileAsDataUrl(file);
      target.imageUrl = dataUrl;
      if (!target.imageAlt) {
        target.imageAlt = target.title || 'Event image';
      }
      this.statusMessage = 'Image attached.';
    } catch {
      this.errorMessage = 'Unable to read that image file.';
    } finally {
      input.value = '';
    }
  }

  removeImage(target: EventItem): void {
    target.imageUrl = '';
    target.imageAlt = '';
  }

  toggleCreateForm(): void {
    this.showCreateForm = !this.showCreateForm;
    if (this.showCreateForm) {
      this.expandedIndex = null;
      this.isEditing = false;
      this.draftEvent = null;
    }
    this.statusMessage = '';
    this.errorMessage = '';
  }

  isDataUrl(value?: string): boolean {
    return Boolean(value && value.startsWith('data:'));
  }

  toggleDetails(index: number): void {
    if (this.expandedIndex === index) {
      this.expandedIndex = null;
      this.isEditing = false;
      this.draftEvent = null;
      return;
    }
    this.expandedIndex = index;
    this.isEditing = false;
    this.draftEvent = { ...this.events[index] };
    this.showCreateForm = false;
    this.statusMessage = '';
    this.errorMessage = '';
  }

  closeDetails(): void {
    this.expandedIndex = null;
    this.isEditing = false;
    this.draftEvent = null;
  }

  startEdit(): void {
    if (!this.draftEvent) {
      return;
    }
    this.isEditing = true;
    this.statusMessage = '';
    this.errorMessage = '';
  }

  saveEdit(): void {
    if (this.expandedIndex === null || !this.draftEvent) {
      return;
    }
    if (!this.isEventValid(this.draftEvent)) {
      this.errorMessage = 'Please complete all required fields and any CTA details before saving.';
      return;
    }
    const updated = [...this.events];
    updated[this.expandedIndex] = { ...this.draftEvent };
    this.saveEvents(updated, 'Event updated and saved.', () => {
      this.expandedIndex = null;
      this.isEditing = false;
      this.draftEvent = null;
    });
  }

  isExpanded(index: number): boolean {
    return this.expandedIndex === index;
  }

  private loadEvents(): void {
    this.events = this.sortLatestFirst(this.eventsService.getSnapshot());
  }

  private saveEvents(
    updated: EventItem[],
    successMessage: string,
    afterSave?: () => void
  ): void {
    this.eventsService.setEvents(updated).subscribe({
      next: (events) => {
        this.events = this.sortLatestFirst(events);
        this.statusMessage = successMessage;
        if (afterSave) {
          afterSave();
        }
      },
      error: () => {
        this.errorMessage = 'Unable to save changes. Check the server or password.';
      }
    });
  }

  private emptyEvent(): EventItem {
    return {
      title: '',
      date: '',
      start: '',
      end: '',
      location: '',
      description: '',
      ctaLabel: '',
      ctaHref: '',
      note: '',
      phone: '',
      imageUrl: '',
      imageAlt: ''
    };
  }

  private isEventValid(event: EventItem): boolean {
    const hasCore =
      Boolean(event.title && event.date && event.start && event.end && event.description);
    const hasCta = Boolean(event.ctaLabel || event.ctaHref);
    const ctaIsValid = !hasCta || Boolean(event.ctaLabel && event.ctaHref);
    return hasCore && ctaIsValid;
  }

  private sortLatestFirst(events: EventItem[]): EventItem[] {
    return [...events].sort((a, b) => `${b.date}T${b.start}`.localeCompare(`${a.date}T${a.start}`));
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
}
