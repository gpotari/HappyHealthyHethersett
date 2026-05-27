import { Component, HostListener } from '@angular/core';
import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import { map } from 'rxjs';
import { EventItem } from '../models/event-item';
import { EventsService } from '../services/events.service';

@Component({
  selector: 'app-events',
  standalone: true,
  imports: [AsyncPipe, NgFor, NgIf],
  templateUrl: './events.component.html'
})
export class EventsComponent {
  readonly events$ = this.eventsService.events$.pipe(
    map((events) => this.filterUpcoming(events))
  );
  activeImageUrl = '';
  activeImageAlt = '';
  activeHistoryPopover = '';

  constructor(private eventsService: EventsService) {}

  @HostListener('document:click')
  closeHistoryPopover(): void {
    this.activeHistoryPopover = '';
  }

  formatEventDate(event: EventItem): string {
    const eventDate = new Date(`${event.date}T00:00:00`);
    const formatted = new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    })
      .format(eventDate)
      .replace(',', '');
    return `${formatted}, ${event.start} – ${event.end}`;
  }

  dateTile(event: EventItem): { day: string; month: string } {
    if (!event.date) {
      return { day: 'TBC', month: '' };
    }

    const eventDate = new Date(`${event.date}T00:00:00`);
    return {
      day: new Intl.DateTimeFormat('en-GB', { day: 'numeric' }).format(eventDate),
      month: new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(eventDate)
    };
  }

  formatDateTime(date: string, time: string): string {
    return `${date}T${time}`;
  }

  eventTypeLabel(event: EventItem): string {
    return event.location?.trim() ? 'Community event' : 'Village event';
  }

  ctaLabel(event: EventItem): string {
    return event.ctaLabel?.trim() || 'Learn more';
  }

  eventImageUrl(event: EventItem): string {
    return event.photos?.[0]?.dataUrl || event.imageUrl || '';
  }

  eventImageAlt(event: EventItem): string {
    return event.photos?.[0]?.fileName || event.imageAlt?.trim() || event.title;
  }

  creatorName(event: EventItem): string {
    return event.createdBy?.displayName?.trim() || 'Happy Healthy Hethersett';
  }

  creatorAvatar(event: EventItem): string {
    return event.createdBy?.avatarDataUrl || '';
  }

  creatorInitials(event: EventItem): string {
    const parts = this.creatorName(event)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    return (parts.map((part) => part[0]).join('') || 'HH').toUpperCase();
  }

  updaterName(event: EventItem): string {
    return event.updatedBy?.displayName?.trim() || 'Happy Healthy Hethersett';
  }

  updaterAvatar(event: EventItem): string {
    return event.updatedBy?.avatarDataUrl || '';
  }

  updaterInitials(event: EventItem): string {
    const parts = this.updaterName(event)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    return (parts.map((part) => part[0]).join('') || 'HH').toUpperCase();
  }

  createdMeta(event: EventItem): string {
    const date = this.formatCreatedAt(event.createdAt);
    return date ? `Created by ${this.creatorName(event)} · ${date}` : `Created by ${this.creatorName(event)}`;
  }

  updatedMeta(event: EventItem): string {
    const date = this.formatCreatedAt(event.updatedAt);
    return date ? `Updated by ${this.updaterName(event)} · ${date}` : `Updated by ${this.updaterName(event)}`;
  }

  creatorHistoryLabel(event: EventItem): string {
    const date = this.formatCreatedAt(event.createdAt);
    if (this.showUpdatedMeta(event) && !this.showUpdaterAvatar(event)) {
      const editedDate = this.formatCreatedAt(event.updatedAt);
      return editedDate
        ? `Created and edited by ${this.creatorName(event)}. Edited on ${editedDate}`
        : `Created and edited by ${this.creatorName(event)}`;
    }

    return date ? `Created by ${this.creatorName(event)} on ${date}` : `Created by ${this.creatorName(event)}`;
  }

  updaterHistoryLabel(event: EventItem): string {
    const date = this.formatCreatedAt(event.updatedAt);
    return date ? `Edited by ${this.updaterName(event)} on ${date}` : `Edited by ${this.updaterName(event)}`;
  }

  showCreatedMeta(event: EventItem): boolean {
    return Boolean(event.createdAt || event.createdBy);
  }

  showUpdatedMeta(event: EventItem): boolean {
    if (!event.updatedAt && !event.updatedBy) {
      return false;
    }

    return !this.sameMeta(event.createdAt, event.updatedAt, event.createdBy?.id, event.updatedBy?.id);
  }

  showUpdaterAvatar(event: EventItem): boolean {
    if (!this.showUpdatedMeta(event)) {
      return false;
    }

    if (event.createdBy?.id && event.updatedBy?.id) {
      return event.createdBy.id !== event.updatedBy.id;
    }

    return this.creatorName(event) !== this.updaterName(event);
  }

  historyPopoverId(index: number, action: 'created' | 'edited'): string {
    return `event-history-${index}-${action}`;
  }

  isHistoryPopoverOpen(index: number, action: 'created' | 'edited'): boolean {
    return this.activeHistoryPopover === this.historyPopoverId(index, action);
  }

  toggleHistoryPopover(index: number, action: 'created' | 'edited', event: MouseEvent): void {
    event.stopPropagation();
    const id = this.historyPopoverId(index, action);
    this.activeHistoryPopover = this.activeHistoryPopover === id ? '' : id;
  }

  openImage(event: EventItem): void {
    const imageUrl = this.eventImageUrl(event);
    if (!imageUrl) {
      return;
    }
    this.activeImageUrl = imageUrl;
    this.activeImageAlt = this.eventImageAlt(event);
  }

  closeImage(): void {
    this.activeImageUrl = '';
    this.activeImageAlt = '';
  }

  phoneLink(phone: string): string {
    return `tel:${phone.replace(/\s+/g, '')}`;
  }

  noteParts(event: EventItem): { before: string; after: string } {
    if (!event.note || !event.phone) {
      return { before: event.note ?? '', after: '' };
    }
    const index = event.note.indexOf(event.phone);
    if (index === -1) {
      return { before: event.note, after: '' };
    }
    return {
      before: event.note.slice(0, index),
      after: event.note.slice(index + event.phone.length)
    };
  }

  private formatCreatedAt(value?: string): string {
    if (!value) {
      return '';
    }

    const createdAt = new Date(value);
    if (Number.isNaN(createdAt.getTime())) {
      return '';
    }

    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(createdAt);
  }

  private sameMeta(createdAt?: string, updatedAt?: string, createdById?: string, updatedById?: string): boolean {
    const createdTime = createdAt ? new Date(createdAt).getTime() : Number.NaN;
    const updatedTime = updatedAt ? new Date(updatedAt).getTime() : Number.NaN;
    const sameTime = Number.isFinite(createdTime) && Number.isFinite(updatedTime) && Math.abs(createdTime - updatedTime) < 1000;
    const sameUser = (createdById || '') === (updatedById || '');
    return sameTime && sameUser;
  }

  private filterUpcoming(events: EventItem[]): EventItem[] {
    const now = new Date();
    return events.filter((event) => new Date(`${event.date}T${event.start}:00`) >= now);
  }
}
