import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { LitterReport } from '../models/litter-report';

@Injectable({ providedIn: 'root' })
export class LitterReportsService {
  private readonly apiUrl = '/api/litter-reports';

  constructor(private http: HttpClient) {}

  submitReport(report: LitterReport) {
    return this.http.post<LitterReport>(this.apiUrl, report);
  }

  loadReports() {
    return this.http.get<LitterReport[]>(this.apiUrl, { withCredentials: true }).pipe(
      map((reports) =>
        [...reports].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
      )
    );
  }
}
