import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { WeatherForecast } from '../models/weather-forecast';

export interface WeatherForecastRequest {
  date: string;
  time?: string;
  lat?: number;
  lng?: number;
}

@Injectable({ providedIn: 'root' })
export class WeatherForecastService {
  private readonly apiUrl = '/api/weather/forecast';

  constructor(private http: HttpClient) {}

  getForecast(request: WeatherForecastRequest) {
    let params = new HttpParams().set('date', request.date);
    if (request.time?.trim()) {
      params = params.set('time', request.time.trim());
    }
    if (Number.isFinite(request.lat)) {
      params = params.set('lat', String(request.lat));
    }
    if (Number.isFinite(request.lng)) {
      params = params.set('lng', String(request.lng));
    }

    return this.http.get<WeatherForecast>(this.apiUrl, { params }).pipe(
      catchError(() =>
        of({
          available: false,
          status: 'unavailable',
          summary: 'Forecast unavailable'
        } satisfies WeatherForecast)
      )
    );
  }
}
