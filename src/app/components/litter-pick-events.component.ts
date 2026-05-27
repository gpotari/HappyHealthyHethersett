import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { catchError, of, Subscription } from 'rxjs';
import { LitterPickArea, LitterPickEvent } from '../models/litter-pick-event';
import { PhotoAttachment } from '../models/photo-attachment';
import { CurrentUser } from '../models/user';
import { AuthService } from '../services/auth.service';
import { LitterPickEventsService } from '../services/litter-pick-events.service';
import { PushNotificationsService, PushReminderResultReason } from '../services/push-notifications.service';
import { HETHERSETT_BOUNDARY, HETHERSETT_MAP_BOUNDS, MapPoint } from '../data/hethersett-boundary';

type NotificationTestState = 'idle' | 'sending' | 'sent' | 'failed';

@Component({
  selector: 'app-litter-pick-events',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './litter-pick-events.component.html'
})
export class LitterPickEventsComponent implements OnInit, OnDestroy {
  private readonly defaultMeetingPointLabel = 'Hethersett Methodist Church';
  private readonly mapBoundaryPoints = this.createBoundaryPoints();
  private readonly coverageSamplePoints = this.createCoverageSamplePoints();
  litterPicks: LitterPickEvent[] = [];
  currentUser: CurrentUser | null = null;
  loading = true;
  error = '';
  attendanceUpdating: Record<string, boolean> = {};
  notificationTestState: Record<string, NotificationTestState> = {};
  notificationTestMessage: Record<string, string> = {};
  activeHistoryPopover = '';
  activeGalleryEvent: LitterPickEvent | null = null;
  activeGalleryIndex = 0;
  completedLitterPickIndex = 0;
  private userSubscription?: Subscription;

  constructor(
    private authService: AuthService,
    private litterPickEventsService: LitterPickEventsService,
    private pushNotificationsService: PushNotificationsService
  ) {}

  ngOnInit(): void {
    this.pushNotificationsService.loadConfig().subscribe();
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
        this.litterPicks = this.publicLitterPickEvents(events);
        this.normalizeCompletedStackIndex();
        this.loading = false;
        if (this.currentUser) {
          this.loadAttendanceState();
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

  @HostListener('document:keydown.escape')
  closeTopLayer(): void {
    if (this.activeGalleryEvent) {
      this.closePhotoGallery();
      return;
    }

    this.closeHistoryPopover();
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

  get upcomingLitterPicks(): LitterPickEvent[] {
    return this.litterPicks.filter((event) => this.isOpenForSignups(event));
  }

  get completedLitterPicks(): LitterPickEvent[] {
    return this.litterPicks.filter((event) => this.isResultEvent(event));
  }

  badges(event: LitterPickEvent): string[] {
    if (this.isResultEvent(event)) {
      const badges = ['Completed', this.hasRecordedResults(event) ? 'Results recorded' : 'Results pending'];
      if (this.resultTeamCount(event)) {
        badges.push(`${this.resultTeamCount(event)} team${this.resultTeamCount(event) === 1 ? '' : 's'}`);
      }
      return badges;
    }

    const badges = ['Everyone welcome', 'Bags provided', 'Pickers provided'];
    if (event.accessibilityNotes?.trim()) {
      badges.push('Accessibility notes');
    }
    return badges;
  }

  isOpenForSignups(event: LitterPickEvent): boolean {
    return this.isUpcomingOpenEventAt(event, new Date());
  }

  isResultEvent(event: LitterPickEvent): boolean {
    return !this.isOpenForSignups(event);
  }

  statusLabel(event: LitterPickEvent): string {
    if (this.isOpenForSignups(event)) {
      return 'Open';
    }

    return event.status === 'closed' ? 'Results' : 'Completed';
  }

  ribbonLabel(event: LitterPickEvent): string {
    return event.status === 'closed' ? 'Closed' : 'Past';
  }

  previousCompletedLitterPick(): void {
    this.stepCompletedLitterPick(-1);
  }

  nextCompletedLitterPick(): void {
    this.stepCompletedLitterPick(1);
  }

  completedStackPosition(index: number): number {
    const count = this.completedLitterPicks.length;
    if (!count) {
      return 0;
    }

    return (index - this.completedLitterPickIndex + count) % count;
  }

  cardTitle(event: LitterPickEvent): string {
    return this.isResultEvent(event) ? 'Community clean-up recap' : 'Community litter pick';
  }

  totalBags(event: LitterPickEvent): number {
    return (event.areas || []).reduce((total, area) => total + this.safeNumber(area.bags), 0);
  }

  totalVolunteers(event: LitterPickEvent): number {
    return (event.areas || []).reduce((total, area) => total + this.safeNumber(area.volunteers), 0);
  }

  resultTeamCount(event: LitterPickEvent): number {
    return (event.areas || []).length;
  }

  coveragePercent(event: LitterPickEvent): number {
    if (!this.coverageSamplePoints.length) {
      return 0;
    }

    const covered = this.coverageSamplePoints.filter((point) =>
      (event.areas || []).some((area) => this.isPointInsideArea(point, area))
    ).length;

    return Math.round((covered / this.coverageSamplePoints.length) * 100);
  }

  coveredAreaCount(event: LitterPickEvent): number {
    const coveredAreas = new Set<string>();

    (event.areas || []).forEach((area) => {
      const coverageItems = area.coverageItems || [];
      coverageItems.forEach((item) => coveredAreas.add(item.streetName || item.label || item.id));
      (area.streetNames || []).forEach((street) => coveredAreas.add(street));
      if (area.streets?.trim()) {
        area.streets
          .split(',')
          .map((street) => street.trim())
          .filter(Boolean)
          .forEach((street) => coveredAreas.add(street));
      }
      if (!coverageItems.length && !area.streetNames?.length && !area.streets?.trim()) {
        coveredAreas.add(area.id || area.label);
      }
    });

    return coveredAreas.size;
  }

  hasRecordedResults(event: LitterPickEvent): boolean {
    return this.totalBags(event) > 0 || this.totalVolunteers(event) > 0;
  }

  resultSummary(event: LitterPickEvent): string {
    if (!this.hasRecordedResults(event)) {
      return 'Results are being added by the organising team.';
    }

    const volunteers = this.totalVolunteers(event);
    const bags = this.totalBags(event);
    return `${this.plural(volunteers, 'volunteer')} helped collect ${this.plural(bags, 'bag')}.`;
  }

  resultAreas(event: LitterPickEvent): LitterPickArea[] {
    return [...(event.areas || [])]
      .sort(
        (a, b) =>
          this.safeNumber(b.bags) - this.safeNumber(a.bags) ||
          this.safeNumber(b.volunteers) - this.safeNumber(a.volunteers)
      )
      .slice(0, 3);
  }

  resultAreaSummary(area: LitterPickArea): string {
    return `${this.plural(this.safeNumber(area.bags), 'bag')} · ${this.plural(this.safeNumber(area.volunteers), 'volunteer')}`;
  }

  resultAreaDetail(area: LitterPickArea): string {
    return (area.streetNames || []).join(', ') || area.streets?.trim() || area.notes?.trim() || 'Covered area';
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
    return this.eventPhotos(event)[0]?.dataUrl || '';
  }

  eventPhotos(event: LitterPickEvent): PhotoAttachment[] {
    return (event.photos || []).filter((photo) => Boolean(photo.dataUrl?.trim()));
  }

  eventPhotoAlt(event: LitterPickEvent, index: number): string {
    const title = event.title?.trim() || 'Community litter pick';
    return `${title} photo ${index + 1}`;
  }

  trackPhoto(index: number, photo: PhotoAttachment): string {
    return photo.id || `${photo.fileName}-${index}`;
  }

  galleryButtonLabel(event: LitterPickEvent): string {
    const count = this.eventPhotos(event).length;
    return count === 1 ? 'View photo' : `View ${count} photos`;
  }

  galleryButtonAriaLabel(event: LitterPickEvent): string {
    const count = this.eventPhotos(event).length;
    return count === 1 ? 'View event photo' : `View ${count} event photos`;
  }

  openPhotoGallery(event: LitterPickEvent, index = 0): void {
    const photos = this.eventPhotos(event);
    if (!photos.length) {
      return;
    }

    this.activeHistoryPopover = '';
    this.activeGalleryEvent = event;
    this.activeGalleryIndex = Math.min(Math.max(index, 0), photos.length - 1);
  }

  closePhotoGallery(): void {
    this.activeGalleryEvent = null;
    this.activeGalleryIndex = 0;
  }

  activeGalleryPhotos(): PhotoAttachment[] {
    return this.activeGalleryEvent ? this.eventPhotos(this.activeGalleryEvent) : [];
  }

  activeGalleryPhoto(): PhotoAttachment | null {
    return this.activeGalleryPhotos()[this.activeGalleryIndex] || null;
  }

  setActiveGalleryPhoto(index: number): void {
    const photos = this.activeGalleryPhotos();
    if (!photos.length) {
      return;
    }

    this.activeGalleryIndex = Math.min(Math.max(index, 0), photos.length - 1);
  }

  previousGalleryPhoto(): void {
    const photos = this.activeGalleryPhotos();
    if (!photos.length) {
      return;
    }

    this.activeGalleryIndex = (this.activeGalleryIndex - 1 + photos.length) % photos.length;
  }

  nextGalleryPhoto(): void {
    const photos = this.activeGalleryPhotos();
    if (!photos.length) {
      return;
    }

    this.activeGalleryIndex = (this.activeGalleryIndex + 1) % photos.length;
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

  creatorName(event: LitterPickEvent): string {
    return event.createdBy?.displayName?.trim() || 'Happy Healthy Hethersett';
  }

  creatorAvatar(event: LitterPickEvent): string {
    return event.createdBy?.avatarDataUrl || '';
  }

  creatorInitials(event: LitterPickEvent): string {
    const parts = this.creatorName(event)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    return (parts.map((part) => part[0]).join('') || 'HH').toUpperCase();
  }

  updaterName(event: LitterPickEvent): string {
    return event.updatedBy?.displayName?.trim() || 'Happy Healthy Hethersett';
  }

  updaterAvatar(event: LitterPickEvent): string {
    return event.updatedBy?.avatarDataUrl || '';
  }

  updaterInitials(event: LitterPickEvent): string {
    const parts = this.updaterName(event)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    return (parts.map((part) => part[0]).join('') || 'HH').toUpperCase();
  }

  createdMeta(event: LitterPickEvent): string {
    const date = this.formatCreatedAt(event.createdAt);
    return date ? `Created by ${this.creatorName(event)} · ${date}` : `Created by ${this.creatorName(event)}`;
  }

  updatedMeta(event: LitterPickEvent): string {
    const date = this.formatCreatedAt(event.updatedAt);
    return date ? `Updated by ${this.updaterName(event)} · ${date}` : `Updated by ${this.updaterName(event)}`;
  }

  creatorHistoryLabel(event: LitterPickEvent): string {
    const date = this.formatCreatedAt(event.createdAt);
    if (this.showUpdatedMeta(event) && !this.showUpdaterAvatar(event)) {
      const editedDate = this.formatCreatedAt(event.updatedAt);
      return editedDate
        ? `Created and edited by ${this.creatorName(event)}. Edited on ${editedDate}`
        : `Created and edited by ${this.creatorName(event)}`;
    }

    return date ? `Created by ${this.creatorName(event)} on ${date}` : `Created by ${this.creatorName(event)}`;
  }

  updaterHistoryLabel(event: LitterPickEvent): string {
    const date = this.formatCreatedAt(event.updatedAt);
    return date ? `Edited by ${this.updaterName(event)} on ${date}` : `Edited by ${this.updaterName(event)}`;
  }

  showCreatedMeta(event: LitterPickEvent): boolean {
    return Boolean(event.createdAt || event.createdBy);
  }

  showUpdatedMeta(event: LitterPickEvent): boolean {
    if (!event.updatedAt && !event.updatedBy) {
      return false;
    }

    return !this.sameMeta(event.createdAt, event.updatedAt, event.createdBy?.id, event.updatedBy?.id);
  }

  showUpdaterAvatar(event: LitterPickEvent): boolean {
    if (!this.showUpdatedMeta(event)) {
      return false;
    }

    if (event.createdBy?.id && event.updatedBy?.id) {
      return event.createdBy.id !== event.updatedBy.id;
    }

    return this.creatorName(event) !== this.updaterName(event);
  }

  historyPopoverId(index: number, action: 'created' | 'edited'): string {
    return `litter-pick-history-${index}-${action}`;
  }

  isHistoryPopoverOpen(index: number, action: 'created' | 'edited'): boolean {
    return this.activeHistoryPopover === this.historyPopoverId(index, action);
  }

  toggleHistoryPopover(index: number, action: 'created' | 'edited', event: MouseEvent): void {
    event.stopPropagation();
    const id = this.historyPopoverId(index, action);
    this.activeHistoryPopover = this.activeHistoryPopover === id ? '' : id;
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

  testReminderLabel(event: LitterPickEvent): string {
    const state = this.notificationTestState[event.id] || 'idle';
    if (state === 'sending') {
      return 'Sending...';
    }
    if (state === 'sent') {
      return 'Test sent';
    }
    if (state === 'failed') {
      return 'Try test again';
    }
    return 'Send test reminder';
  }

  testReminderTitle(event: LitterPickEvent): string {
    const state = this.notificationTestState[event.id] || 'idle';
    return state === 'failed'
      ? this.notificationTestMessage[event.id] || 'The test reminder could not be sent. Check notification permission and try again.'
      : 'Send a test push notification to this browser now.';
  }

  toggleAttendance(event: LitterPickEvent): void {
    if (!this.currentUser || this.attendanceUpdating[event.id] || !this.isOpenForSignups(event)) {
      return;
    }

    const attending = !event.isAttending;
    this.attendanceUpdating = { ...this.attendanceUpdating, [event.id]: true };
    if (attending) {
      this.pushNotificationsService.enableLitterPickReminders().subscribe();
    }
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

  sendTestReminder(event: LitterPickEvent): void {
    const state = this.notificationTestState[event.id] || 'idle';
    if (!this.currentUser || state === 'sending') {
      return;
    }

    this.notificationTestState = { ...this.notificationTestState, [event.id]: 'sending' };
    this.notificationTestMessage = { ...this.notificationTestMessage, [event.id]: '' };
    this.pushNotificationsService.sendTestReminder().subscribe((result) => {
      this.notificationTestState = {
        ...this.notificationTestState,
        [event.id]: result.ok ? 'sent' : 'failed'
      };
      this.notificationTestMessage = {
        ...this.notificationTestMessage,
        [event.id]: result.ok
          ? 'Chrome accepted the notification display request. If no banner appears, check macOS notification settings for Google Chrome.'
          : this.notificationFailureMessage(result.reason)
      };
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

  private notificationFailureMessage(reason?: PushReminderResultReason): string {
    if (reason === 'unsupported') {
      return 'This browser does not support web push notifications.';
    }
    if (reason === 'permission-denied') {
      return 'Notifications are blocked for this site. Allow them in your browser settings, then try again.';
    }
    if (reason === 'permission-dismissed') {
      return 'Notification permission was not allowed, so the test could not be sent.';
    }
    if (reason === 'not-configured') {
      return 'Push notifications are not configured on the API. Restart the API after adding the VAPID keys.';
    }
    if (reason === 'subscription-failed') {
      return 'This browser could not create a push subscription. Check notification permission and try again.';
    }
    if (reason === 'display-timeout') {
      return 'The API sent the push, but this browser did not confirm displaying it. In Chrome, check macOS Notifications, Focus mode and Chrome site notification settings.';
    }
    if (reason === 'display-failed') {
      return 'This browser received the push but could not display the notification. Check Chrome and macOS notification settings.';
    }
    return 'The API could not send the test notification. Please check the API is running and try again.';
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

  private publicLitterPickEvents(events: LitterPickEvent[]): LitterPickEvent[] {
    const now = new Date();
    return [...events].sort((a, b) => {
      const aUpcoming = this.isUpcomingOpenEventAt(a, now);
      const bUpcoming = this.isUpcomingOpenEventAt(b, now);
      if (aUpcoming !== bUpcoming) {
        return aUpcoming ? -1 : 1;
      }

      const aTime = this.eventSortTime(a);
      const bTime = this.eventSortTime(b);
      return aUpcoming ? aTime - bTime : bTime - aTime;
    });
  }

  private stepCompletedLitterPick(delta: number): void {
    const count = this.completedLitterPicks.length;
    if (count <= 1) {
      return;
    }

    this.completedLitterPickIndex = (this.completedLitterPickIndex + delta + count) % count;
    this.activeHistoryPopover = '';
  }

  private normalizeCompletedStackIndex(): void {
    const count = this.completedLitterPicks.length;
    if (!count) {
      this.completedLitterPickIndex = 0;
      return;
    }

    this.completedLitterPickIndex = Math.min(this.completedLitterPickIndex, count - 1);
  }

  private isUpcomingOpenEventAt(event: LitterPickEvent, now: Date): boolean {
    return event.status === 'open' && this.eventEndDate(event) >= now;
  }

  private eventEndDate(event: LitterPickEvent): Date {
    if (!event.date) {
      return new Date(8640000000000000);
    }
    return new Date(`${event.date}T${event.end || event.start || '23:59'}:00`);
  }

  private eventSortTime(event: LitterPickEvent): number {
    if (!event.date) {
      return 0;
    }

    const date = new Date(`${event.date}T${event.start || '00:00'}:00`);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  private safeNumber(value?: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
  }

  private plural(value: number, singular: string): string {
    return `${value} ${singular}${value === 1 ? '' : 's'}`;
  }

  private createBoundaryPoints(): MapPoint[] {
    const bounds = HETHERSETT_MAP_BOUNDS;
    return HETHERSETT_BOUNDARY.map((point) => ({
      x: ((point.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100,
      y: ((bounds.maxLat - point.lat) / (bounds.maxLat - bounds.minLat)) * 100
    }));
  }

  private createCoverageSamplePoints(): MapPoint[] {
    const points: MapPoint[] = [];
    const bounds = this.boundaryPointBounds();
    const steps = 64;

    for (let row = 0; row < steps; row += 1) {
      for (let col = 0; col < steps; col += 1) {
        const point = {
          x: bounds.minX + ((col + 0.5) / steps) * (bounds.maxX - bounds.minX),
          y: bounds.minY + ((row + 0.5) / steps) * (bounds.maxY - bounds.minY)
        };
        if (this.isPointInPolygon(point, this.mapBoundaryPoints)) {
          points.push(point);
        }
      }
    }

    return points;
  }

  private boundaryPointBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    return {
      minX: Math.min(...this.mapBoundaryPoints.map((point) => point.x)),
      maxX: Math.max(...this.mapBoundaryPoints.map((point) => point.x)),
      minY: Math.min(...this.mapBoundaryPoints.map((point) => point.y)),
      maxY: Math.max(...this.mapBoundaryPoints.map((point) => point.y))
    };
  }

  private isPointInsideArea(point: MapPoint, area: LitterPickArea): boolean {
    return this.areaCoveragePolygons(area).some((polygon) => this.isPointInPolygon(point, polygon));
  }

  private areaCoveragePolygons(area: LitterPickArea): MapPoint[][] {
    const itemPolygons = this.coverageItemPolygons(area.coverageItems || []);
    if (itemPolygons.length) {
      return itemPolygons;
    }

    const coveragePolygons = (area.coveragePolygons || [])
      .map((polygon) => this.sanitizeAreaPoints(polygon || []))
      .filter((polygon) => polygon.length >= 3 && this.polygonArea(polygon) >= 0.2);
    if (coveragePolygons.length) {
      return coveragePolygons;
    }

    const legacyPoints = this.legacyAreaPoints(area);
    return legacyPoints.length ? [legacyPoints] : [];
  }

  private coverageItemPolygons(items: LitterPickArea['coverageItems']): MapPoint[][] {
    return (items || [])
      .map((item) => this.sanitizeAreaPoints(item.polygon || []))
      .filter((polygon) => polygon.length >= 3 && this.polygonArea(polygon) >= 0.2);
  }

  private sanitizeAreaPoints(points: MapPoint[]): MapPoint[] {
    const bounds = this.boundaryPointBounds();
    return points.map((point) => ({
      x: Number(this.clamp(point.x, bounds.minX, bounds.maxX).toFixed(2)),
      y: Number(this.clamp(point.y, bounds.minY, bounds.maxY).toFixed(2))
    }));
  }

  private legacyAreaPoints(area: LitterPickArea): MapPoint[] {
    const x = area.x ?? 0;
    const y = area.y ?? 0;
    const width = area.width ?? 0;
    const height = area.height ?? 0;

    if (!width || !height) {
      return [];
    }

    return [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height }
    ];
  }

  private isPointInPolygon(point: MapPoint, polygon: MapPoint[]): boolean {
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const current = polygon[i];
      const previous = polygon[j];
      const intersects =
        current.y > point.y !== previous.y > point.y &&
        point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
      if (intersects) {
        inside = !inside;
      }
    }

    return inside;
  }

  private polygonArea(points: MapPoint[]): number {
    let area = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      area += (points[j].x + points[i].x) * (points[j].y - points[i].y);
    }
    return Math.abs(area / 2);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
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
