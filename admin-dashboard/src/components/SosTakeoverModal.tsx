'use client';

import React from 'react';
import { AlertTriangle, Phone, MapPin, CheckCircle2, ShieldAlert, X, ExternalLink } from 'lucide-react';
import { SosIncident } from '../types';
import { api } from '../lib/api';
import { emergencyAudio } from '../lib/audio';

interface SosTakeoverModalProps {
  incident: SosIncident | null;
  onClose: () => void;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
}

export default function SosTakeoverModal({
  incident,
  onClose,
  onAcknowledge,
  onResolve,
}: SosTakeoverModalProps) {
  if (!incident) return null;

  const isAcknowledged = incident.status === 'ACKNOWLEDGED';
  const mapsUrl = incident.latitude && incident.longitude
    ? `https://www.google.com/maps?q=${incident.latitude},${incident.longitude}`
    : '#';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-3xl p-6 glass-panel border border-red-500/80 shadow-2xl sos-alert-pulse space-y-5">
        
        {/* Top Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-red-600/30 border border-red-500 text-red-400">
              <AlertTriangle className="h-6 w-6 animate-bounce" />
            </div>
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-red-400">
                CRITICAL EMERGENCY ALERT
              </span>
              <h3 className="text-xl font-extrabold text-white">Student SOS Signal Received</h3>
            </div>
          </div>

          <button
            onClick={() => {
              emergencyAudio.stopEmergencySiren();
              onClose();
            }}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/60 transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Student Details Card */}
        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400">Student Name</p>
              <h4 className="text-base font-bold text-white">{incident.student_name || 'Emergency Trigger'}</h4>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">Trigger Type</p>
              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
                {incident.trigger_type}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800/80 text-xs">
            <div>
              <span className="text-slate-500">Contact Number:</span>
              <p className="font-semibold text-slate-200 flex items-center gap-1.5 mt-0.5">
                <Phone className="h-3.5 w-3.5 text-blue-400" />
                <span>{incident.student_phone || 'Emergency Direct'}</span>
              </p>
            </div>
            <div>
              <span className="text-slate-500">Timestamp:</span>
              <p className="font-semibold text-slate-200 mt-0.5">
                {new Date(incident.triggered_at).toLocaleTimeString()}
              </p>
            </div>
          </div>
        </div>

        {/* GPS Fix Card */}
        <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800/90 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <MapPin className="h-5 w-5 text-red-500 shrink-0" />
            <div>
              <p className="font-mono font-bold text-white">
                {incident.latitude ? `${incident.latitude.toFixed(6)}, ${incident.longitude?.toFixed(6)}` : 'Resolving GPS...'}
              </p>
              <p className="text-[11px] text-slate-500">&plusmn;{incident.accuracy_meters || 5}m horizontal accuracy</p>
            </div>
          </div>

          {incident.latitude && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-500/30 font-bold text-xs transition"
            >
              <span>Maps</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          {!isAcknowledged ? (
            <button
              onClick={() => {
                onAcknowledge(incident.id);
                emergencyAudio.stopEmergencySiren();
              }}
              className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm transition shadow-lg shadow-amber-500/20 cursor-pointer flex items-center justify-center gap-2"
            >
              <ShieldAlert className="h-4 w-4" />
              <span>Acknowledge &amp; Dispatch Patrol</span>
            </button>
          ) : (
            <button
              onClick={() => {
                onResolve(incident.id);
                emergencyAudio.stopEmergencySiren();
              }}
              className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm transition shadow-lg shadow-emerald-600/20 cursor-pointer flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Resolve &amp; Close Incident</span>
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
