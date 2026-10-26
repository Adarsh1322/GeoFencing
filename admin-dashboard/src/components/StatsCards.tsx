'use client';

import React from 'react';
import { Users, CheckCircle2, Compass, AlertOctagon, UserPlus } from 'lucide-react';
import { DashboardStudent, SosIncident, PendingStudent } from '../types';

interface StatsCardsProps {
  students: DashboardStudent[];
  pendingStudents: PendingStudent[];
  activeSos: SosIncident[];
  onSelectTab: (tab: 'map' | 'approvals' | 'sos' | 'attendance' | 'incidents') => void;
}

export default function StatsCards({
  students,
  pendingStudents,
  activeSos,
  onSelectTab,
}: StatsCardsProps) {
  const totalStudents = students.length;
  const insideGeofence = students.filter((s) => s.geofence_status === 'INSIDE').length;
  const outsideGeofence = students.filter((s) => s.geofence_status === 'OUTSIDE').length;
  const sosCount = activeSos.length;
  const pendingCount = pendingStudents.length;

  const cards = [
    {
      title: 'Enrolled Students',
      value: totalStudents,
      sub: `${insideGeofence} currently inside 100m geofence`,
      icon: <Users className="h-5 w-5 text-blue-400" />,
      border: 'border-blue-500/20',
      glow: 'shadow-blue-500/5',
      badgeColor: 'text-blue-400 bg-blue-500/10',
      action: () => onSelectTab('attendance'),
    },
    {
      title: 'Inside Campus (Safe)',
      value: insideGeofence,
      sub: `${totalStudents > 0 ? Math.round((insideGeofence / totalStudents) * 100) : 0}% of active campus population`,
      icon: <CheckCircle2 className="h-5 w-5 text-emerald-400" />,
      border: 'border-emerald-500/20',
      glow: 'shadow-emerald-500/5',
      badgeColor: 'text-emerald-400 bg-emerald-500/10',
      action: () => onSelectTab('map'),
    },
    {
      title: 'Outside Campus Perimeter',
      value: outsideGeofence,
      sub: 'Monitored via high-accuracy telemetry',
      icon: <Compass className="h-5 w-5 text-amber-400" />,
      border: 'border-amber-500/20',
      glow: 'shadow-amber-500/5',
      badgeColor: 'text-amber-400 bg-amber-500/10',
      action: () => onSelectTab('map'),
    },
    {
      title: 'Emergency SOS Alerts',
      value: sosCount,
      sub: sosCount > 0 ? 'High-priority emergency requires dispatch' : 'All student perimeters secure',
      icon: <AlertOctagon className="h-5 w-5 text-red-400" />,
      border: sosCount > 0 ? 'border-red-500/60 sos-alert-pulse' : 'border-red-500/20',
      glow: 'shadow-red-500/10',
      badgeColor: 'text-red-400 bg-red-500/10',
      action: () => onSelectTab('sos'),
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {cards.map((card, idx) => (
        <div
          key={idx}
          onClick={card.action}
          className={`glass-card glass-card-hover rounded-2xl p-4 cursor-pointer border ${card.border} shadow-lg ${card.glow}`}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{card.title}</span>
            <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800">{card.icon}</div>
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-3xl font-extrabold tracking-tight text-white">{card.value}</span>
            <span className="text-xs font-medium text-slate-400">students</span>
          </div>
          <p className="text-[11px] text-slate-400 truncate">{card.sub}</p>
        </div>
      ))}
    </div>
  );
}
