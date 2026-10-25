import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database.js';
import { Campus, MonitoringSchedule } from '../types/index.js';

export async function listCampuses(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const resList = await query<Campus>(
      'SELECT id, name, code, center_lat, center_lon, radius_meters, timezone, is_active FROM campuses WHERE is_active = true;'
    );
    res.json({ campuses: resList.rows });
  } catch (err) {
    next(err);
  }
}

export async function getCampusById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const campusRes = await query<Campus>('SELECT * FROM campuses WHERE id = $1;', [id]);
    if (campusRes.rowCount === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Campus not found' } });
      return;
    }

    const schedRes = await query<MonitoringSchedule>(
      'SELECT day_of_week, start_time, end_time, is_active FROM monitoring_schedules WHERE campus_id = $1 ORDER BY day_of_week ASC;',
      [id]
    );

    res.json({
      campus: campusRes.rows[0],
      schedules: schedRes.rows,
    });
  } catch (err) {
    next(err);
  }
}
