import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, catchError, map, of, tap } from 'rxjs';
import { EventItem } from '../models/event-item';

export interface EventAttendanceResponse {
  eventId: string;
  attending: boolean;
}

@Injectable({ providedIn: 'root' })
export class EventsService {
  private readonly apiUrl = '/api/events';
  private readonly fallbackUrl = 'assets/data/events.json';
  private readonly eventsSubject = new BehaviorSubject<EventItem[]>([]);
  readonly events$ = this.eventsSubject.asObservable();

  constructor(private http: HttpClient) {
    this.init();
  }

  getSnapshot(): EventItem[] {
    return this.eventsSubject.value.map((event) => this.cloneEvent(event));
  }

  setEvents(events: EventItem[]) {
    const normalized = this.sortEvents(events.map((event) => this.cloneEvent(event)));
    return this.http
      .put<EventItem[]>(this.apiUrl, normalized, { withCredentials: true })
      .pipe(
        map((saved) => this.sortEvents(saved.map((event) => this.cloneEvent(event)))),
        tap((saved) => this.eventsSubject.next(saved))
      );
  }

  private init(): void {
    this.loadEvents().subscribe();
  }

  loadEvents() {
    return this.http.get<EventItem[]>(this.apiUrl, { withCredentials: true }).pipe(
      catchError(() => this.http.get<EventItem[]>(this.fallbackUrl)),
      catchError(() => of([])),
      map((events) => this.sortEvents(events.map((event) => this.cloneEvent(event)))),
      tap((events) => this.eventsSubject.next(events))
    );
  }

  loadMyAttendance() {
    return this.http
      .get<{ eventIds: string[] }>(`${this.apiUrl}/attendance`, { withCredentials: true })
      .pipe(map((response) => new Set(response.eventIds || [])));
  }

  setAttendance(eventId: string, attending: boolean) {
    return this.http.put<EventAttendanceResponse>(
      `${this.apiUrl}/${encodeURIComponent(eventId)}/attendance`,
      { attending },
      { withCredentials: true }
    );
  }

  private cloneEvent(event: EventItem): EventItem {
    return {
      ...event,
      photos: (event.photos || []).map((photo) => ({ ...photo }))
    };
  }

  private sortEvents(events: EventItem[]): EventItem[] {
    return [...events].sort((a, b) => `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`));
  }
}
