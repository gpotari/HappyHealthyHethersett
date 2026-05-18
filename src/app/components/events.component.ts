import { Component } from '@angular/core';
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

  constructor(private eventsService: EventsService) {}

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

  private filterUpcoming(events: EventItem[]): EventItem[] {
    const now = new Date();
    return events.filter((event) => new Date(`${event.date}T${event.start}:00`) >= now);
  }
}
