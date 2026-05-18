import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, map, tap } from 'rxjs';
import { LitterPickEvent } from '../models/litter-pick-event';

export interface LitterPickAttendanceResponse {
  eventId: string;
  attending: boolean;
}

@Injectable({ providedIn: 'root' })
export class LitterPickEventsService {
  private readonly apiUrl = '/api/litter-pick-events';
  private readonly publicApiUrl = '/api/public/litter-pick-events';
  private readonly eventsSubject = new BehaviorSubject<LitterPickEvent[]>([]);
  readonly events$ = this.eventsSubject.asObservable();

  constructor(private http: HttpClient) {}

  getSnapshot(): LitterPickEvent[] {
    return this.eventsSubject.value.map((event) => this.cloneEvent(event));
  }

  loadEvents() {
    return this.http
      .get<LitterPickEvent[]>(this.apiUrl, { withCredentials: true })
      .pipe(
        map((events) => this.sortEvents(events)),
        tap((events) => this.eventsSubject.next(events))
      );
  }

  loadPublicEvents() {
    return this.http
      .get<LitterPickEvent[]>(this.publicApiUrl)
      .pipe(map((events) => this.sortEvents(events, 'asc')));
  }

  loadMyAttendance() {
    return this.http
      .get<{ eventIds: string[] }>(`${this.apiUrl}/attendance`, { withCredentials: true })
      .pipe(map((response) => new Set(response.eventIds || [])));
  }

  setAttendance(eventId: string, attending: boolean) {
    return this.http.put<LitterPickAttendanceResponse>(
      `${this.apiUrl}/${encodeURIComponent(eventId)}/attendance`,
      { attending },
      { withCredentials: true }
    );
  }

  setEvents(events: LitterPickEvent[]) {
    const normalized = this.sortEvents(events);
    return this.http
      .put<LitterPickEvent[]>(this.apiUrl, normalized, { withCredentials: true })
      .pipe(
        map((saved) => this.sortEvents(saved)),
        tap((saved) => this.eventsSubject.next(saved))
      );
  }

  private sortEvents(events: LitterPickEvent[], direction: 'asc' | 'desc' = 'desc'): LitterPickEvent[] {
    return [...events]
      .map((event) => this.cloneEvent(event))
      .sort((a, b) => {
        const comparison = `${a.date}T${a.start || ''}`.localeCompare(`${b.date}T${b.start || ''}`);
        return direction === 'asc' ? comparison : -comparison;
      });
  }

  private cloneEvent(event: LitterPickEvent): LitterPickEvent {
    return {
      ...event,
      photos: (event.photos || []).map((photo) => ({ ...photo })),
      areas: (event.areas || []).map((area) => ({ ...area }))
    };
  }
}
