jest.mock('@react-native-async-storage/async-storage', () => {
  let mockStorage = {};
  return {
    getItem: jest.fn(key => Promise.resolve(mockStorage[key] || null)),
    setItem: jest.fn((key, value) => {
      mockStorage[key] = value;
      return Promise.resolve();
    }),
    removeItem: jest.fn(key => {
      delete mockStorage[key];
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      mockStorage = {};
      return Promise.resolve();
    }),
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getAttendanceRecords,
  saveAttendanceRecord,
  clearAttendanceRecords,
} from '../src/storage/attendanceStorage';

describe('attendanceStorage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  test('returns empty array when no records exist', async () => {
    const records = await getAttendanceRecords();
    expect(records).toEqual([]);
  });

  test('saves and retrieves attendance records in reverse chronological order', async () => {
    const record1 = {
      id: '1',
      checkedInAt: '2026-09-03T10:00:00.000Z',
      latitude: 37.78825,
      longitude: -122.4324,
      distanceFromOffice: 15,
    };

    const record2 = {
      id: '2',
      checkedInAt: '2026-09-03T12:00:00.000Z',
      latitude: 37.78825,
      longitude: -122.4324,
      distanceFromOffice: 30,
    };

    await saveAttendanceRecord(record1);
    await saveAttendanceRecord(record2);

    const records = await getAttendanceRecords();
    expect(records.length).toBe(2);
    // Newest first: record2 (12:00) before record1 (10:00)
    expect(records[0].id).toBe('2');
    expect(records[1].id).toBe('1');
  });

  test('clears all attendance records successfully', async () => {
    await saveAttendanceRecord({
      id: '1',
      checkedInAt: '2026-09-03T10:00:00.000Z',
      distanceFromOffice: 20,
    });

    await clearAttendanceRecords();
    const records = await getAttendanceRecords();
    expect(records).toEqual([]);
  });
});
