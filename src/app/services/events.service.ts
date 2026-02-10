import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, catchError, of } from 'rxjs';
import { EventItem } from '../models/event-item';

@Injectable({ providedIn: 'root' })
export class EventsService {
  private readonly storageKey = 'hhh_events';
  private readonly eventsSubject = new BehaviorSubject<EventItem[]>([]);
  readonly events$ = this.eventsSubject.asObservable();

  constructor(private http: HttpClient) {
    this.init();
  }

  getSnapshot(): EventItem[] {
    return this.eventsSubject.value.map((event) => ({ ...event }));
  }

  setEvents(events: EventItem[]): void {
    const normalized = this.sortEvents(events);
    this.eventsSubject.next(normalized);
    this.writeStorage(normalized);
  }

  resetToDefaults(): void {
    this.fetchFromAssets();
  }

  private init(): void {
    const stored = this.readStorage();
    if (stored) {
      this.eventsSubject.next(this.sortEvents(stored));
      return;
    }
    this.fetchFromAssets();
  }

  private fetchFromAssets(): void {
    this.http
      .get<EventItem[]>('assets/data/events.json')
      .pipe(catchError(() => of([])))
      .subscribe((events) => {
        const normalized = this.sortEvents(events);
        this.eventsSubject.next(normalized);
        this.writeStorage(normalized);
      });
  }

  private sortEvents(events: EventItem[]): EventItem[] {
    return [...events].sort((a, b) => `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`));
  }

  private readStorage(): EventItem[] | null {
    if (typeof window === 'undefined') {
      return null;
    }
    const raw = window.localStorage.getItem(this.storageKey);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as EventItem[];
      if (!Array.isArray(parsed)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private writeStorage(events: EventItem[]): void {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(this.storageKey, JSON.stringify(events));
  }
}
