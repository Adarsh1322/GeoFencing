import { calculateDistanceInMeters } from '../src/utils/distance';

describe('calculateDistanceInMeters', () => {
  const officeLocation = {
    latitude: 37.78825,
    longitude: -122.4324,
  };

  test('returns 0 when comparing the exact same coordinates', () => {
    const distance = calculateDistanceInMeters(officeLocation, officeLocation);
    expect(distance).toBe(0);
  });

  test('correctly calculates distance for point ~50m away', () => {
    // 0.00045 degrees latitude is approx 50 meters
    const nearbyLocation = {
      latitude: officeLocation.latitude + 0.00045,
      longitude: officeLocation.longitude,
    };
    const distance = calculateDistanceInMeters(nearbyLocation, officeLocation);
    expect(distance).toBeGreaterThanOrEqual(45);
    expect(distance).toBeLessThanOrEqual(55);
  });

  test('correctly calculates distance for point ~250m away', () => {
    const distantLocation = {
      latitude: officeLocation.latitude + 0.00225,
      longitude: officeLocation.longitude,
    };
    const distance = calculateDistanceInMeters(distantLocation, officeLocation);
    expect(distance).toBeGreaterThan(200);
    expect(distance).toBeLessThan(300);
  });

  test('returns null when any coordinate is missing or invalid', () => {
    expect(calculateDistanceInMeters(null, officeLocation)).toBeNull();
    expect(calculateDistanceInMeters(officeLocation, null)).toBeNull();
    expect(calculateDistanceInMeters({}, officeLocation)).toBeNull();
    expect(calculateDistanceInMeters({ latitude: 'invalid', longitude: 10 }, officeLocation)).toBeNull();
  });
});
