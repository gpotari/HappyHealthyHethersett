import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { catchError, of, Subscription } from 'rxjs';
import { LitterPickEvent } from '../models/litter-pick-event';
import { CurrentUser } from '../models/user';
import { AuthService } from '../services/auth.service';
import { LitterPickEventsService } from '../services/litter-pick-events.service';

@Component({
  selector: 'app-litter-pick-events',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './litter-pick-events.component.html'
})
export class LitterPickEventsComponent implements OnInit, OnDestroy {
  private readonly defaultMeetingPointLabel = 'Hethersett Methodist Church';
  litterPicks: LitterPickEvent[] = [];
  currentUser: CurrentUser | null = null;
  loading = true;
  error = '';
  attendanceUpdating: Record<string, boolean> = {};
  private userSubscription?: Subscription;

  constructor(
    private authService: AuthService,
    private litterPickEventsService: LitterPickEventsService
  ) {}

  ngOnInit(): void {
    this.userSubscription = this.authService.user$.subscribe((user) => {
      const previousUserId = this.currentUser?.id || null;
      this.currentUser = user;
      if (previousUserId !== (user?.id || null)) {
        if (!user) {
          this.litterPicks = this.litterPicks.map((event) => ({ ...event, isAttending: false }));
        } else if (this.litterPicks.length) {
          this.loadAttendanceState();
        }
      }
    });
    this.litterPickEventsService
      .loadPublicEvents()
      .pipe(
        catchError(() => {
          this.error = 'Litter pick events are not available right now.';
          return of([]);
        })
      )
      .subscribe((events) => {
        this.litterPicks = this.upcomingOpenEvents(events);
        this.loading = false;
        if (this.currentUser) {
          this.loadAttendanceState();
        }
      });
  }

  ngOnDestroy(): void {
    this.userSubscription?.unsubscribe();
  }

  formatDate(event: LitterPickEvent): string {
    if (!event.date) {
      return 'Date to be confirmed';
    }

    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    })
      .format(new Date(`${event.date}T12:00:00`))
      .replace(',', '');
  }

  dateTile(event: LitterPickEvent): { day: string; month: string } {
    if (!event.date) {
      return { day: 'TBC', month: '' };
    }

    const date = new Date(`${event.date}T12:00:00`);
    return {
      day: new Intl.DateTimeFormat('en-GB', { day: 'numeric' }).format(date),
      month: new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(date)
    };
  }

  timeRange(event: LitterPickEvent): string {
    const start = event.start?.trim();
    const end = event.end?.trim();
    if (start && end) {
      return `${start} to ${end}`;
    }
    return start || end || 'Time to be confirmed';
  }

  shortDescription(event: LitterPickEvent): string {
    return (
      event.description?.trim() ||
      event.notes?.trim() ||
      'Join neighbours for a friendly community litter pick around Hethersett. Every bag helps make the village cleaner and greener.'
    );
  }

  providedText(): string {
    return 'Bags and litter pickers will be provided.';
  }

  badges(event: LitterPickEvent): string[] {
    const badges = ['Everyone welcome', 'Bags provided', 'Pickers provided'];
    if (event.accessibilityNotes?.trim()) {
      badges.push('Accessibility notes');
    }
    return badges;
  }

  meetingPoint(event: LitterPickEvent): string {
    const meetingPoint = event.meetingPoint?.trim();
    if (!meetingPoint) {
      return 'Meeting point to be confirmed';
    }

    return meetingPoint.toLowerCase() === 'selected meeting point'
      ? this.defaultMeetingPointLabel
      : meetingPoint;
  }

  primaryPhoto(event: LitterPickEvent): string {
    return event.photos?.[0]?.dataUrl || '';
  }

  contactEmail(event: LitterPickEvent): string {
    const email = event.contactEmail?.trim() || '';
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
  }

  contactHref(event: LitterPickEvent): string {
    const email = this.contactEmail(event);
    if (email) {
      return `mailto:${email}`;
    }
    return '#contact';
  }

  contactLabel(event: LitterPickEvent): string {
    if (this.contactEmail(event)) {
      return event.contactName?.trim() ? `Email ${event.contactName}` : 'Email organiser';
    }

    return 'Join this litter pick';
  }

  attendanceButtonLabel(event: LitterPickEvent): string {
    if (this.attendanceUpdating[event.id]) {
      return 'Saving...';
    }

    return event.isAttending ? 'Counted in' : 'Count me in';
  }

  attendanceAriaLabel(event: LitterPickEvent): string {
    if (!this.currentUser) {
      return 'Sign in to tell organisers you plan to come';
    }

    return event.isAttending
      ? 'Tell organisers you can no longer come'
      : 'Tell organisers you plan to come';
  }

  toggleAttendance(event: LitterPickEvent): void {
    if (!this.currentUser || this.attendanceUpdating[event.id]) {
      return;
    }

    const attending = !event.isAttending;
    this.attendanceUpdating = { ...this.attendanceUpdating, [event.id]: true };
    this.litterPickEventsService.setAttendance(event.id, attending).subscribe({
      next: (response) => {
        this.litterPicks = this.litterPicks.map((item) =>
          item.id === event.id
            ? {
                ...item,
                isAttending: response.attending
              }
            : item
        );
        this.attendanceUpdating = { ...this.attendanceUpdating, [event.id]: false };
      },
      error: () => {
        this.attendanceUpdating = { ...this.attendanceUpdating, [event.id]: false };
      }
    });
  }

  downloadCalendar(event: LitterPickEvent): void {
    const title = 'Community litter pick';
    const description = [
      this.shortDescription(event),
      `Meeting point: ${this.meetingPoint(event)}`,
      this.providedText(),
      event.weatherPlan?.trim() || ''
    ]
      .filter(Boolean)
      .join('\n');
    const start = this.calendarTimestamp(event.date, event.start || '10:00');
    const end = this.calendarTimestamp(event.date, event.end || event.start || '12:00');
    const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Happy Healthy Hethersett//Litter Pick//EN',
      'BEGIN:VEVENT',
      `UID:${this.slug(title)}-${event.date || 'date-tbc'}@happyhealthyhethersett`,
      `DTSTAMP:${now}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${this.escapeCalendarText(title)}`,
      `LOCATION:${this.escapeCalendarText(this.meetingPoint(event))}`,
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

  private loadAttendanceState(): void {
    this.litterPickEventsService.loadMyAttendance().subscribe({
      next: (eventIds) => {
        this.litterPicks = this.litterPicks.map((event) => ({
          ...event,
          isAttending: eventIds.has(event.id)
        }));
      },
      error: () => {
        this.litterPicks = this.litterPicks.map((event) => ({ ...event, isAttending: false }));
      }
    });
  }

  private upcomingOpenEvents(events: LitterPickEvent[]): LitterPickEvent[] {
    const now = new Date();
    return events
      .filter((event) => event.status === 'open' && this.eventEndDate(event) >= now)
      .sort((a, b) => `${a.date}T${a.start || ''}`.localeCompare(`${b.date}T${b.start || ''}`));
  }

  private eventEndDate(event: LitterPickEvent): Date {
    if (!event.date) {
      return new Date(8640000000000000);
    }
    return new Date(`${event.date}T${event.end || event.start || '23:59'}:00`);
  }

  private calendarTimestamp(date: string, time: string): string {
    const [year, month, day] = (date || '').split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
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

  private slug(value: string): string {
    return (
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'litter-pick'
    );
  }
}
