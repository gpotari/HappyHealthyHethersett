import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, catchError, map, of, tap, throwError } from 'rxjs';
import { EventItem } from '../models/event-item';

@Injectable({ providedIn: 'root' })
export class EventsService {
  private readonly apiUrl = '/api/events';
  private readonly authUrl = '/api/auth';
  private readonly fallbackUrl = 'assets/data/events.json';
  private adminPassword = '';
  private readonly eventsSubject = new BehaviorSubject<EventItem[]>([]);
  readonly events$ = this.eventsSubject.asObservable();

  constructor(private http: HttpClient) {
    this.init();
  }

  getSnapshot(): EventItem[] {
    return this.eventsSubject.value.map((event) => ({ ...event }));
  }

  setEvents(events: EventItem[]) {
    if (!this.adminPassword) {
      return throwError(() => new Error('Admin password not set.'));
    }
    const normalized = this.sortEvents(events);
    return this.http
      .put<EventItem[]>(this.apiUrl, normalized, { headers: this.authHeaders() })
      .pipe(
        map((saved) => this.sortEvents(saved)),
        tap((saved) => this.eventsSubject.next(saved))
      );
  }

  verifyPassword(password: string) {
    return this.http
      .post<{ ok: boolean }>(this.authUrl, {}, { headers: this.authHeaders(password) })
      .pipe(
        tap(() => {
          this.adminPassword = password;
        })
      );
  }

  private init(): void {
    this.loadEvents().subscribe();
  }

  loadEvents() {
    return this.http.get<EventItem[]>(this.apiUrl).pipe(
      catchError(() => this.http.get<EventItem[]>(this.fallbackUrl)),
      catchError(() => of([])),
      map((events) => this.sortEvents(events)),
      tap((events) => this.eventsSubject.next(events))
    );
  }

  private sortEvents(events: EventItem[]): EventItem[] {
    return [...events].sort((a, b) => `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`));
  }

  private authHeaders(password = this.adminPassword): HttpHeaders {
    return new HttpHeaders({ 'x-admin-password': password });
  }
}
