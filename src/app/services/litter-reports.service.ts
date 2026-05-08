import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { map } from 'rxjs';
import { LitterReport } from '../models/litter-report';

@Injectable({ providedIn: 'root' })
export class LitterReportsService {
  private readonly apiUrl = '/api/litter-reports';
  private adminPassword = '';

  constructor(private http: HttpClient) {}

  setAdminPassword(password: string): void {
    this.adminPassword = password;
  }

  submitReport(report: LitterReport) {
    return this.http.post<LitterReport>(this.apiUrl, report);
  }

  loadReports() {
    return this.http.get<LitterReport[]>(this.apiUrl, { headers: this.authHeaders() }).pipe(
      map((reports) =>
        [...reports].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
      )
    );
  }

  private authHeaders(): HttpHeaders {
    return new HttpHeaders({ 'x-admin-password': this.adminPassword });
  }
}
