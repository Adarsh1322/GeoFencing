'use client';

import React from 'react';
import { MapPin, UserCheck, AlertOctagon, ClipboardList, History, ShieldAlert } from 'lucide-react';

export type ActiveTab = 'map' | 'approvals' | 'sos' | 'attendance' | 'incidents';

interface SidebarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  pendingCount: number;
  activeSosCount: number;
}

export default function Sidebar({
  activeTab,
  onTabChange,
  pendingCount,
  activeSosCount,
}: SidebarProps) {
  const navItems: { id: ActiveTab; label: string; icon: React.ReactNode; badge?: number; badgeColor?: string }[] = [
    {
      id: 'map',
      label: 'Live Geofence Map',
      icon: <MapPin className="h-4 w-4" />,
    },
    {
      id: 'sos',
      label: 'Emergency SOS Desk',
      icon: <AlertOctagon className="h-4 w-4" />,
      badge: activeSosCount > 0 ? activeSosCount : undefined,
      badgeColor: 'bg-red-500 text-white animate-pulse',
    },
    {
      id: 'approvals',
      label: 'Student Approvals',
      icon: <UserCheck className="h-4 w-4" />,
      badge: pendingCount > 0 ? pendingCount : undefined,
      badgeColor: 'bg-amber-500 text-slate-950 font-bold',
    },
    {
      id: 'attendance',
      label: 'Attendance & Logs',
      icon: <ClipboardList className="h-4 w-4" />,
    },
    {
      id: 'incidents',
      label: 'Incident History',
      icon: <History className="h-4 w-4" />,
    },
  ];

  return (
    <aside className="w-64 shrink-0 glass-panel border-r border-slate-800/80 p-4 flex flex-col justify-between hidden md:flex">
      <div className="space-y-6">
        <div>
          <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
            Operations Console
          </p>
          <nav className="space-y-1.5">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-semibold transition cursor-pointer ${
                    isActive
                      ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30 shadow-md shadow-blue-500/10'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={isActive ? 'text-blue-400' : 'text-slate-400'}>{item.icon}</span>
                    <span>{item.label}</span>
                  </div>
                  {item.badge !== undefined && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-bold shadow-sm ${
                        item.badgeColor || 'bg-blue-500 text-white'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Quick Safety Guideline Card */}
        <div className="p-3.5 rounded-2xl glass-card border border-blue-500/20 bg-gradient-to-b from-blue-950/30 to-slate-900/60">
          <div className="flex items-center gap-2 mb-2 text-blue-400 font-semibold text-xs">
            <ShieldAlert className="h-4 w-4" />
            <span>Geofence Protocol</span>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-400">
            Attendance automatically verifies only inside the active 100m geofence perimeter. Out-of-bounds telemetry triggers guardian notifications.
          </p>
        </div>
      </div>

      {/* Footer Info */}
      <div className="pt-4 border-t border-slate-800/80 text-[10px] text-slate-500 text-center">
        <p className="font-medium">CampusSafe v1.0 • MCA Major Project</p>
        <p className="text-slate-600">PostGIS + React Native Engine</p>
      </div>
    </aside>
  );
}
