export interface BoundaryCoordinate {
  lat: number;
  lng: number;
}

export interface MapPoint {
  x: number;
  y: number;
}

export const HETHERSETT_BOUNDARY_SOURCE =
  'Approximate Hethersett village coverage boundary, extended north to Little Melton Road and west around New Road for litter-pick planning.';

export const HETHERSETT_MAP_BOUNDS = {
  minLat: 52.591,
  maxLat: 52.6048,
  minLng: 1.164,
  maxLng: 1.1974
};

export const HETHERSETT_BOUNDARY: BoundaryCoordinate[] = [
  { lat: 52.6051, lng: 1.1574 },
  { lat: 52.607, lng: 1.1692 },
  { lat: 52.6085, lng: 1.1767 },
  { lat: 52.6091, lng: 1.1852 },
  { lat: 52.609, lng: 1.1968 },
  { lat: 52.6075, lng: 1.2007 },
  { lat: 52.6043, lng: 1.2002 },
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
  { lat: 52.595, lng: 1.1616 },
  { lat: 52.5972, lng: 1.1587 },
  { lat: 52.5995, lng: 1.1578 },
  { lat: 52.6021, lng: 1.1573 },
  { lat: 52.604, lng: 1.1572 }
];
