// Earth's mean radius in meters according to WGS84 standard
const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculates great-circle distance between two geographic coordinates
 * using the Haversine formula, returning the distance in meters.
 */
export function calculateDistanceInMeters(coordA, coordB) {
  if (!coordA || !coordB) {
    return null;
  }

  const latA = coordA.latitude;
  const lonA = coordA.longitude;
  const latB = coordB.latitude;
  const lonB = coordB.longitude;

  if (
    typeof latA !== 'number' ||
    typeof lonA !== 'number' ||
    typeof latB !== 'number' ||
    typeof lonB !== 'number'
  ) {
    return null;
  }

  const deltaLat = toRadians(latB - latA);
  const deltaLon = toRadians(lonB - lonA);

  const latRadA = toRadians(latA);
  const latRadB = toRadians(latB);

  const sinHalfDeltaLat = Math.sin(deltaLat / 2);
  const sinHalfDeltaLon = Math.sin(deltaLon / 2);

  const centralAngleTerm =
    sinHalfDeltaLat * sinHalfDeltaLat +
    Math.cos(latRadA) * Math.cos(latRadB) * sinHalfDeltaLon * sinHalfDeltaLon;

  const angularDistance =
    2 * Math.atan2(Math.sqrt(centralAngleTerm), Math.sqrt(1 - centralAngleTerm));

  return Math.round(EARTH_RADIUS_METERS * angularDistance);
}
