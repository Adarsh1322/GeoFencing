import { DateTime } from 'luxon';
import { query } from '../config/database.js';
import { Campus, MonitoringSchedule } from '../types/index.js';

export interface ScheduleValidationResult {
  isWithinHours: boolean;
  campusTimezone: string;
  currentCampusTime: string;
  scheduledEndTime: Date;
  reason?: string;
}

export async function validateCampusSchedule(
  campusId: string,
  requestedDurationMinutes = 120
): Promise<ScheduleValidationResult> {
  // 1. Fetch campus
  const campusRes = await query<Campus>('SELECT * FROM campuses WHERE id = $1;', [campusId]);
  if (campusRes.rowCount === 0) {
    throw new Error('CAMPUS_NOT_FOUND');
  }
  const campus = campusRes.rows[0];
  const timezone = campus.timezone || 'Asia/Kolkata';

  // 2. Current time in campus timezone
  const nowInCampus = DateTime.now().setZone(timezone);
  // Luxon weekday: 1=Mon ... 7=Sun. Our DB schedule: 0=Sun, 1=Mon ... 6=Sat
  const dayOfWeekDb = nowInCampus.weekday === 7 ? 0 : nowInCampus.weekday;

  // 3. Fetch schedule for today
  const schedRes = await query<MonitoringSchedule>(
    `SELECT * FROM monitoring_schedules
     WHERE campus_id = $1 AND day_of_week = $2 AND is_active = true;`,
    [campusId, dayOfWeekDb]
  );

  if (schedRes.rowCount === 0) {
    return {
      isWithinHours: false,
      campusTimezone: timezone,
      currentCampusTime: nowInCampus.toFormat('HH:mm:ss'),
      scheduledEndTime: nowInCampus.toJSDate(),
      reason: 'No active monitoring schedule configured for this day',
    };
  }

  const schedule = schedRes.rows[0];

  // Parse start_time and end_time for today
  const [startHour, startMin] = schedule.start_time.split(':').map(Number);
  const [endHour, endMin] = schedule.end_time.split(':').map(Number);

  const startDateTime = nowInCampus.set({
    hour: startHour,
    minute: startMin,
    second: 0,
    millisecond: 0,
  });
  const endDateTime = nowInCampus.set({
    hour: endHour,
    minute: endMin,
    second: 0,
    millisecond: 0,
  });

  const isWithinHours = nowInCampus >= startDateTime && nowInCampus < endDateTime;

  if (!isWithinHours) {
    return {
      isWithinHours: false,
      campusTimezone: timezone,
      currentCampusTime: nowInCampus.toFormat('HH:mm:ss'),
      scheduledEndTime: nowInCampus.toJSDate(),
      reason: `Outside monitoring hours (${schedule.start_time} - ${schedule.end_time} ${timezone})`,
    };
  }

  // Calculate scheduled end time: min(requested duration, schedule end time)
  const requestedEnd = nowInCampus.plus({ minutes: requestedDurationMinutes });
  const finalEnd = requestedEnd < endDateTime ? requestedEnd : endDateTime;

  return {
    isWithinHours: true,
    campusTimezone: timezone,
    currentCampusTime: nowInCampus.toFormat('HH:mm:ss'),
    scheduledEndTime: finalEnd.toJSDate(),
  };
}
