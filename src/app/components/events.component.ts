import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import { map, Subscription } from 'rxjs';
import { EventItem } from '../models/event-item';
import { CurrentUser } from '../models/user';
import { AuthService } from '../services/auth.service';
import { EventsService } from '../services/events.service';

@Component({
  selector: 'app-events',
  standalone: true,
  imports: [AsyncPipe, NgFor, NgIf],
  templateUrl: './events.component.html'
})
export class EventsComponent implements OnInit, OnDestroy {
  readonly events$ = this.eventsService.events$.pipe(
    map((events) => this.filterUpcoming(events))
  );
  currentUser: CurrentUser | null = null;
  attendanceUpdating: Record<string, boolean> = {};
  activeImageUrl = '';
  activeImageAlt = '';
  activeHistoryPopover = '';
  private attendingEventIds = new Set<string>();
  private userSubscription?: Subscription;

  constructor(
    private authService: AuthService,
    private eventsService: EventsService
  ) {}

  ngOnInit(): void {
    this.userSubscription = this.authService.user$.subscribe((user) => {
      const previousUserId = this.currentUser?.id || null;
      this.currentUser = user;
      if (previousUserId !== (user?.id || null)) {
        if (!user) {
          this.attendingEventIds = new Set<string>();
        } else {
          this.loadAttendanceState();
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.userSubscription?.unsubscribe();
  }

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

  isAttending(event: EventItem): boolean {
    const eventId = this.eventId(event);
    return Boolean(this.currentUser && eventId && this.attendingEventIds.has(eventId));
  }

  attendanceButtonLabel(event: EventItem): string {
    const eventId = this.eventId(event);
    if (eventId && this.attendanceUpdating[eventId]) {
      return 'Saving...';
    }

    return this.isAttending(event) ? 'Counted in' : 'Count me in';
  }

  attendanceDisplayLabel(event: EventItem): string {
    if (!this.currentUser) {
      return 'Sign in to join';
    }

    if (!this.eventId(event)) {
      return 'Join unavailable';
    }

    return this.attendanceButtonLabel(event);
  }

  isAttendanceUpdating(event: EventItem): boolean {
    const eventId = this.eventId(event);
    return Boolean(eventId && this.attendanceUpdating[eventId]);
  }

  attendanceAriaLabel(event: EventItem): string {
    if (!this.eventId(event)) {
      return 'Sign-ups are unavailable for this event';
    }

    if (!this.currentUser) {
      return 'Sign in to tell organisers you plan to come';
    }

    return this.isAttending(event)
      ? 'Tell organisers you can no longer come'
      : 'Tell organisers you plan to come';
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

  downloadCalendar(event: EventItem): void {
    const title = event.title?.trim() || 'Happy Healthy Hethersett event';
    const location = event.location?.trim() || '';
    const description = [event.description?.trim(), event.note?.trim(), event.ctaHref?.trim()]
      .filter(Boolean)
      .join('\n');
    const start = this.calendarTimestamp(event.date, event.start || '09:00');
    const end = this.calendarTimestamp(event.date, event.end || event.start || '10:00');
    const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const uidSource = this.eventId(event) || `${this.slug(title)}-${event.date || 'date-tbc'}`;
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Happy Healthy Hethersett//Event//EN',
      'BEGIN:VEVENT',
      `UID:${this.escapeCalendarText(uidSource)}@happyhealthyhethersett`,
      `DTSTAMP:${now}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${this.escapeCalendarText(title)}`,
      `LOCATION:${this.escapeCalendarText(location)}`,
      `DESCRIPTION:${this.escapeCalendarText(description)}`,
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.slug(title)}.ics`;
    link.click();
    URL.revokeObjectURL(url);
  }

  toggleAttendance(event: EventItem): void {
    const eventId = this.eventId(event);
    if (!this.currentUser || !eventId || this.attendanceUpdating[eventId]) {
      return;
    }

    const attending = !this.isAttending(event);
    this.attendanceUpdating = { ...this.attendanceUpdating, [eventId]: true };
    this.eventsService.setAttendance(eventId, attending).subscribe({
      next: (response) => {
        const nextAttendingEventIds = new Set(this.attendingEventIds);
        if (response.attending) {
          nextAttendingEventIds.add(response.eventId);
        } else {
          nextAttendingEventIds.delete(response.eventId);
        }
        this.attendingEventIds = nextAttendingEventIds;
        this.attendanceUpdating = { ...this.attendanceUpdating, [eventId]: false };
      },
      error: () => {
        this.attendanceUpdating = { ...this.attendanceUpdating, [eventId]: false };
      }
    });
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

  private calendarTimestamp(date: string, time: string): string {
    const [year, month, day] = (date || '').split('-').map(Number);
    const [hour, minute] = (time || '').split(':').map(Number);
    const local = new Date(year || 1970, (month || 1) - 1, day || 1, hour || 0, minute || 0);
    return local.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  private escapeCalendarText(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/\r?\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
  }

  private eventId(event: EventItem): string {
    return event.id?.trim() || '';
  }

  private slug(value: string): string {
    return (
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'event'
    );
  }

  private loadAttendanceState(): void {
    this.eventsService.loadMyAttendance().subscribe({
      next: (eventIds) => {
        this.attendingEventIds = eventIds;
      },
      error: () => {
        this.attendingEventIds = new Set<string>();
      }
    });
  }
}
