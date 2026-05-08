export interface LitterReport {
  id?: string;
  createdAt?: string;
  locationLabel: string;
  lat: number;
  lng: number;
  amount?: string;
  comment?: string;
  contact?: string;
  mapLink?: string;
}
