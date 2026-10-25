import { GeoJsonMultiPolygon, GeofenceStatus } from '../types/index.js';

const EARTH_RADIUS_METERS = 6371000;

/**
 * Calculates Haversine distance in meters between two WGS84 coordinates.
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Standard ray-casting algorithm to test if a point (lon, lat) is inside a single ring of vertices.
 * ring vertices are [ [lon, lat], ... ]
 */
function isPointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Tests if (lon, lat) is inside a GeoJSON Polygon (exterior ring minus any holes).
 */
function isPointInPolygon(lon: number, lat: number, rings: number[][][]): boolean {
  if (rings.length === 0) return false;
  // Exterior ring
  if (!isPointInRing(lon, lat, rings[0])) {
    return false;
  }
  // Check interior rings (holes)
  for (let i = 1; i < rings.length; i++) {
    if (isPointInRing(lon, lat, rings[i])) {
      return false; // Point is inside a hole!
    }
  }
  return true;
}

/**
 * Minimum distance from point P to line segment AB in meters.
 */
function distanceToSegmentMeters(
  lat: number,
  lon: number,
  latA: number,
  lonA: number,
  latB: number,
  lonB: number
): number {
  // Convert to local meter coordinates relative to point A
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const avgLat = toRad((latA + latB) / 2);
  const metersPerDegLat = 111132.95;
  const metersPerDegLon = 111412.84 * Math.cos(avgLat);

  const px = (lon - lonA) * metersPerDegLon;
  const py = (lat - latA) * metersPerDegLat;
  const bx = (lonB - lonA) * metersPerDegLon;
  const by = (latB - latA) * metersPerDegLat;

  const segmentLengthSq = bx * bx + by * by;
  if (segmentLengthSq === 0) {
    return haversineDistanceMeters(lat, lon, latA, lonA);
  }

  // Projection scalar t on segment AB
  let t = (px * bx + py * by) / segmentLengthSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = t * bx;
  const closestY = t * by;

  const dx = px - closestX;
  const dy = py - closestY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculates distance from point to closest boundary ring edge in meters.
 */
export function distanceToBoundaryMeters(
  lat: number,
  lon: number,
  boundary: GeoJsonMultiPolygon
): number {
  let minDistance = Infinity;

  for (const polygon of boundary.coordinates) {
    for (const ring of polygon) {
      for (let i = 0; i < ring.length - 1; i++) {
        const p1 = ring[i];
        const p2 = ring[i + 1];
        const dist = distanceToSegmentMeters(lat, lon, p1[1], p1[0], p2[1], p2[0]);
        if (dist < minDistance) {
          minDistance = dist;
        }
      }
    }
  }

  return minDistance;
}

/**
 * Evaluates whether a coordinate is INSIDE, OUTSIDE_NEAR (within buffer), or OUTSIDE.
 */
export function evaluateGeofenceStatus(
  latitude: number,
  longitude: number,
  boundary: GeoJsonMultiPolygon,
  bufferMeters = 20
): GeofenceStatus {
  // 1. Check if inside any polygon
  for (const polygon of boundary.coordinates) {
    if (isPointInPolygon(longitude, latitude, polygon)) {
      return 'INSIDE';
    }
  }

  // 2. If outside, check if within the buffer distance
  const dist = distanceToBoundaryMeters(latitude, longitude, boundary);
  if (dist <= bufferMeters) {
    return 'OUTSIDE_NEAR';
  }

  return 'OUTSIDE';
}
