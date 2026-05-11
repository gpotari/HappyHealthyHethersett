export interface BoundaryCoordinate {
  lat: number;
  lng: number;
}

export interface MapPoint {
  x: number;
  y: number;
}

export const HETHERSETT_BOUNDARY_SOURCE =
  'Approximate Hethersett village boundary, trimmed to the north side of the main road for litter-pick coverage planning.';

export const HETHERSETT_BOUNDARY: BoundaryCoordinate[] = [
  { lat: 52.6045, lng: 1.1665 },
  { lat: 52.6048, lng: 1.1762 },
  { lat: 52.6043, lng: 1.1856 },
  { lat: 52.6039, lng: 1.1944 },
  { lat: 52.6026, lng: 1.1974 },
  { lat: 52.6013, lng: 1.194 },
  { lat: 52.6001, lng: 1.1913 },
  { lat: 52.5988, lng: 1.1888 },
  { lat: 52.5973, lng: 1.1862 },
  { lat: 52.596, lng: 1.1837 },
  { lat: 52.5948, lng: 1.181 },
  { lat: 52.5935, lng: 1.1782 },
  { lat: 52.5922, lng: 1.1754 },
  { lat: 52.591, lng: 1.1728 },
  { lat: 52.5922, lng: 1.1699 },
  { lat: 52.5938, lng: 1.1677 },
  { lat: 52.595, lng: 1.164 },
  { lat: 52.5972, lng: 1.1642 },
  { lat: 52.5992, lng: 1.1648 },
  { lat: 52.6012, lng: 1.1656 },
  { lat: 52.6029, lng: 1.1661 }
];
