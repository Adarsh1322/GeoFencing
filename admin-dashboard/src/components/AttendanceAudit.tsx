'use client';

import React, { useState } from 'react';
import { Download, Search, CheckCircle2, AlertTriangle, Clock, MapPin, Compass } from 'lucide-react';
import { DashboardStudent } from '../types';

interface AttendanceAuditProps {
  students: DashboardStudent[];
  campusName: string;
}

export default function AttendanceAudit({ students, campusName }: AttendanceAuditProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'INSIDE' | 'OUTSIDE'>('ALL');

  const filtered = students.filter((s) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      s.full_name.toLowerCase().includes(q) ||
      s.email.toLowerCase().includes(q) ||
      (s.roll_number && s.roll_number.toLowerCase().includes(q));

    if (!matchesSearch) return false;
    if (statusFilter === 'INSIDE') return s.geofence_status === 'INSIDE';
    if (statusFilter === 'OUTSIDE') return s.geofence_status === 'OUTSIDE';
    return true;
  });

  const handleExportCSV = () => {
    const headers = ['Full Name', 'Roll Number', 'Email', 'Geofence Status', 'Freshness', 'Latitude', 'Longitude', 'Accuracy (m)', 'Captured At'];
    const rows = filtered.map((s) => [
      `"${s.full_name}"`,
      `"${s.roll_number || 'N/A'}"`,
      `"${s.email}"`,
      `"${s.geofence_status || 'UNKNOWN'}"`,
      `"${s.freshness_status}"`,
      s.latitude || '',
      s.longitude || '',
      s.accuracy_meters || '',
      s.captured_at ? `"${new Date(s.captured_at).toISOString()}"` : '""',
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `CampusSafe_Attendance_${campusName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <span>Attendance &amp; Telemetry Audit Log</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Cryptographically timestamped location fixes and verified attendance punches for {campusName}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Status Filter */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900 border border-slate-700/60 text-xs">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                statusFilter === 'ALL' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              All ({students.length})
            </button>
            <button
              onClick={() => setStatusFilter('INSIDE')}
              className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                statusFilter === 'INSIDE' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-emerald-400'
              }`}
            >
              Inside 100m
            </button>
            <button
              onClick={() => setStatusFilter('OUTSIDE')}
              className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                statusFilter === 'OUTSIDE' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-amber-400'
              }`}
            >
              Outside
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search student or roll..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 rounded-xl bg-slate-900/80 border border-slate-700/60 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-52"
            />
          </div>

          {/* Export CSV */}
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/40 text-xs font-bold transition shadow-md shadow-blue-500/10 cursor-pointer"
          >
            <Download className="h-4 w-4" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl glass-card border border-slate-800 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/90 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Student Details</th>
                <th className="py-3 px-4">Roll Number</th>
                <th className="py-3 px-4">Geofence Status</th>
                <th className="py-3 px-4">Coordinates &amp; Accuracy</th>
                <th className="py-3 px-4">Telemetry Freshness</th>
                <th className="py-3 px-4">Last Captured</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-200">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    No student attendance records matched your filter.
                  </td>
                </tr>
              ) : (
                filtered.map((student) => {
                  const isInside = student.geofence_status === 'INSIDE';
                  return (
                    <tr key={student.id} className="hover:bg-slate-800/30 transition">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-white">{student.full_name}</div>
                        <div className="text-[11px] text-slate-400">{student.email}</div>
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-blue-400">
                        {student.roll_number || 'N/A'}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isInside
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          }`}
                        >
                          {isInside ? (
                            <>
                              <CheckCircle2 className="h-3 w-3" />
                              VERIFIED INSIDE
                            </>
                          ) : (
                            <>
                              <Compass className="h-3 w-3" />
                              OUTSIDE 100M
                            </>
                          )}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-300">
                        {student.latitude ? (
                          <div className="flex items-center gap-1.5">
                            <MapPin className="h-3.5 w-3.5 text-slate-500" />
                            <span>
                              {student.latitude.toFixed(5)}, {student.longitude?.toFixed(5)} (&plusmn;{student.accuracy_meters || 10}m)
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-500 italic">No GPS Fix</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`font-semibold text-[11px] ${
                            student.freshness_status === 'ONLINE'
                              ? 'text-emerald-400'
                              : student.freshness_status === 'DELAYED'
                              ? 'text-amber-400'
                              : 'text-slate-500'
                          }`}
                        >
                          {student.freshness_status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-400">
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3 w-3 text-slate-500" />
                          <span>{student.captured_at ? new Date(student.captured_at).toLocaleTimeString() : 'N/A'}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
