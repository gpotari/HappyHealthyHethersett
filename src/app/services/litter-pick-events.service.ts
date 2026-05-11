import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, map, tap } from 'rxjs';
import { LitterPickEvent } from '../models/litter-pick-event';

@Injectable({ providedIn: 'root' })
export class LitterPickEventsService {
  private readonly apiUrl = '/api/litter-pick-events';
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

  setEvents(events: LitterPickEvent[]) {
    const normalized = this.sortEvents(events);
    return this.http
      .put<LitterPickEvent[]>(this.apiUrl, normalized, { withCredentials: true })
      .pipe(
        map((saved) => this.sortEvents(saved)),
        tap((saved) => this.eventsSubject.next(saved))
      );
  }

  private sortEvents(events: LitterPickEvent[]): LitterPickEvent[] {
    return [...events]
      .map((event) => this.cloneEvent(event))
      .sort((a, b) => `${b.date}T${b.start || ''}`.localeCompare(`${a.date}T${a.start || ''}`));
  }

  private cloneEvent(event: LitterPickEvent): LitterPickEvent {
    return {
      ...event,
      areas: (event.areas || []).map((area) => ({ ...area }))
    };
  }
}
