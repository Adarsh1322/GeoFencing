'use client';

import React from 'react';
import { Shield, Radio, AlertTriangle, LogOut, Building, User } from 'lucide-react';
import { AdminUser, Campus } from '../types';

interface NavbarProps {
  admin: AdminUser | null;
  campuses: Campus[];
  selectedCampusId: string;
  onSelectCampus: (id: string) => void;
  activeSosCount: number;
  isConnected: boolean;
  onLogout: () => void;
  onOpenSosModal?: () => void;
}

export default function Navbar({
  admin,
  campuses,
  selectedCampusId,
  onSelectCampus,
  activeSosCount,
  isConnected,
  onLogout,
  onOpenSosModal,
}: NavbarProps) {
  return (
    <header className="sticky top-0 z-40 w-full glass-panel border-b border-slate-800/80 px-4 lg:px-6 py-3">
      <div className="flex items-center justify-between gap-4">
        
        {/* Brand / Title */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold tracking-tight text-white text-lg">CampusSafe</span>
              <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                Safety Desk
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium">Real-time Geofenced Tracking & Emergency Operations</p>
          </div>
        </div>

        {/* Center: Campus Selector */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700/60 shadow-inner">
            <Building className="h-4 w-4 text-blue-400" />
            <span className="text-xs font-medium text-slate-400 hidden sm:inline">Active Campus:</span>
            <select
              value={selectedCampusId}
              onChange={(e) => onSelectCampus(e.target.value)}
              className="bg-transparent text-sm font-semibold text-slate-100 focus:outline-none cursor-pointer"
            >
              {campuses.map((c) => (
                <option key={c.id} value={c.id} className="bg-slate-900 text-slate-100">
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>

          {/* Real-time Socket Indicator */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs">
            <span className="relative flex h-2 w-2">
              {isConnected && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              )}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${isConnected ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
            </span>
            <span className={isConnected ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'}>
              {isConnected ? 'Live Telemetry' : 'Connecting...'}
            </span>
          </div>

          {/* Active Emergency Alert Button (if SOS active) */}
          {activeSosCount > 0 && (
            <button
              onClick={onOpenSosModal}
              className="sos-alert-pulse flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-red-600/20 border border-red-500 text-red-300 font-bold text-xs hover:bg-red-600/30 transition shadow-lg shadow-red-500/20 cursor-pointer"
            >
              <AlertTriangle className="h-4 w-4 text-red-400 animate-bounce" />
              <span>{activeSosCount} EMERGENCY ALERT{activeSosCount > 1 ? 'S' : ''}</span>
            </button>
          )}
        </div>

        {/* Right: Admin User & Logout */}
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-900/50 border border-slate-800">
            <div className="h-7 w-7 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300">
              <User className="h-4 w-4" />
            </div>
            <div className="text-left">
              <p className="text-xs font-semibold text-slate-200">{admin?.fullName || 'Chief Security Admin'}</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider">{admin?.role || 'CAMPUS_ADMIN'}</p>
            </div>
          </div>

          <button
            onClick={onLogout}
            title="Log Out"
            className="p-2 rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>

      </div>
    </header>
  );
}
