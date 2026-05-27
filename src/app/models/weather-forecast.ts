export type WeatherForecastStatus = 'available' | 'too-far' | 'past' | 'unavailable';

export interface WeatherForecast {
  available: boolean;
  status: WeatherForecastStatus;
  summary: string;
  date?: string;
  time?: string;
  temperatureC?: number | null;
  precipitationProbability?: number | null;
  windSpeedMph?: number | null;
  windGustMph?: number | null;
  weatherCode?: number | null;
  attribution?: string;
}
