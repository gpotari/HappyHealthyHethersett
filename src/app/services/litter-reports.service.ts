import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { LitterReport, LitterReportState } from '../models/litter-report';

@Injectable({ providedIn: 'root' })
export class LitterReportsService {
  private readonly apiUrl = '/api/litter-reports';

  constructor(private http: HttpClient) {}

  submitReport(report: LitterReport) {
    return this.http.post<LitterReport>(this.apiUrl, report);
  }

  submitReportWithProgress(report: LitterReport) {
    return this.http.post<LitterReport>(this.apiUrl, report, {
      observe: 'events',
      reportProgress: true
    });
  }

  loadReports() {
    return this.http
      .get<LitterReport[]>(this.apiUrl, { withCredentials: true })
      .pipe(map((reports) => this.sortReports(reports)));
  }

  updateReportState(id: string, state: LitterReportState) {
    return this.http.put<LitterReport>(
      `${this.apiUrl}/${encodeURIComponent(id)}/state`,
      { state },
      { withCredentials: true }
    );
  }

  deleteReport(id: string) {
    return this.http.delete<void>(`${this.apiUrl}/${encodeURIComponent(id)}`, { withCredentials: true });
  }

  private sortReports(reports: LitterReport[]): LitterReport[] {
    return [...reports].sort((a, b) => {
      const stateComparison = this.stateRank(a) - this.stateRank(b);
      if (stateComparison !== 0) {
        return stateComparison;
      }

      return String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
    });
  }

  private stateRank(report: LitterReport): number {
    return report.state === 'addressed' ? 1 : 0;
  }
}
