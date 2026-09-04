import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@attendance_records';

/**
 * Retrieves all stored attendance records from local storage.
 * Safely handles missing, empty, or corrupted data.
 */
export async function getAttendanceRecords() {
  try {
    const rawData = await AsyncStorage.getItem(STORAGE_KEY);
    if (!rawData) {
      return [];
    }

    const records = JSON.parse(rawData);
    if (!Array.isArray(records)) {
      return [];
    }

    // Return records sorted in reverse chronological order (newest first)
    return records.sort(
      (a, b) => new Date(b.checkedInAt).getTime() - new Date(a.checkedInAt).getTime()
    );
  } catch (error) {
    throw new Error('Failed to load attendance records from storage');
  }
}

/**
 * Appends a new attendance record to local storage.
 */
export async function saveAttendanceRecord(newRecord) {
  try {
    const currentRecords = await getAttendanceRecords();
    const updatedRecords = [newRecord, ...currentRecords];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedRecords));
    return updatedRecords;
  } catch (error) {
    throw new Error('Failed to save attendance record to storage');
  }
}

/**
 * Clears all attendance records from local storage.
 */
export async function clearAttendanceRecords() {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    throw new Error('Failed to clear attendance records from storage');
  }
}
