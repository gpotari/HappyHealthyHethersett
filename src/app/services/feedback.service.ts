import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { FeedbackMessage } from '../models/feedback-message';

@Injectable({ providedIn: 'root' })
export class FeedbackService {
  private readonly apiUrl = '/api/feedback';

  constructor(private http: HttpClient) {}

  loadFeedback() {
    return this.http.get<FeedbackMessage[]>(this.apiUrl, { withCredentials: true }).pipe(
      map((messages) =>
        [...messages].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
      )
    );
  }

  deleteFeedback(id: string) {
    return this.http.delete<void>(`${this.apiUrl}/${encodeURIComponent(id)}`, { withCredentials: true });
  }
}
