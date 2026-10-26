'use client';

import React, { useState } from 'react';
import { AlertOctagon, CheckCircle2, Volume2, VolumeX, ShieldAlert, Phone, MapPin, Clock } from 'lucide-react';
import { SosIncident } from '../types';
import { api } from '../lib/api';
import { emergencyAudio } from '../lib/audio';

interface SosAlertDeskProps {
  activeSos: SosIncident[];
  historicalSos: SosIncident[];
  onRefresh: () => void;
}

export default function SosAlertDesk({
  activeSos,
  historicalSos,
  onRefresh,
}: SosAlertDeskProps) {
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [resolutionModalIncident, setResolutionModalIncident] = useState<SosIncident | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');

  const toggleAudio = () => {
    if (!isAudioMuted) {
      emergencyAudio.stopEmergencySiren();
      setIsAudioMuted(true);
    } else {
      setIsAudioMuted(false);
      if (activeSos.length > 0) {
        emergencyAudio.startEmergencySiren();
      }
    }
  };

  const handleAcknowledge = async (sosId: string) => {
    setProcessingId(sosId);
    try {
      await api.acknowledgeSos(sosId);
      onRefresh();
    } catch (err: unknown) {
      alert((err as Error).message || 'Failed to acknowledge SOS');
    } finally {
      setProcessingId(null);
    }
  };

  const handleResolveSubmit = async () => {
    if (!resolutionModalIncident) return;
    setProcessingId(resolutionModalIncident.id);
    try {
      await api.resolveSos(resolutionModalIncident.id, resolutionNotes);
      setResolutionModalIncident(null);
      setResolutionNotes('');
      emergencyAudio.stopEmergencySiren();
      onRefresh();
    } catch (err: unknown) {
      alert((err as Error).message || 'Failed to resolve SOS');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <span className="flex h-3 w-3 relative">
              {activeSos.length > 0 && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              )}
              <span className={`relative inline-flex rounded-full h-3 w-3 ${activeSos.length > 0 ? 'bg-red-500' : 'bg-emerald-500'}`}></span>
            </span>
            <span>Emergency Safety &amp; SOS Command Desk</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time emergency broadcast monitoring with instant officer acknowledgment and incident resolution.
          </p>
        </div>

        {/* Audio Mute/Unmute */}
        <button
          onClick={toggleAudio}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition cursor-pointer ${
            isAudioMuted
              ? 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
              : 'bg-red-600/20 text-red-300 border-red-500/40 hover:bg-red-600/30'
          }`}
        >
          {isAudioMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4 animate-bounce" />}
          <span>{isAudioMuted ? 'Alarm Muted' : 'Alarm Active'}</span>
        </button>
      </div>

      {/* Active Incidents Banner / Grid */}
      {activeSos.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-red-400 flex items-center gap-1.5">
            <AlertOctagon className="h-4 w-4" />
            <span>Active Emergency Incidents Requiring Response ({activeSos.length})</span>
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeSos.map((incident) => {
              const isAcknowledged = incident.status === 'ACKNOWLEDGED';
              const isProcessing = processingId === incident.id;

              return (
                <div
                  key={incident.id}
                  className="rounded-2xl p-5 border border-red-500/60 bg-gradient-to-br from-red-950/40 to-slate-900/90 shadow-2xl sos-alert-pulse space-y-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-500 text-white">
                        {incident.status}
                      </span>
                      <h3 className="text-lg font-bold text-white mt-1.5">{incident.student_name || 'Student Alert'}</h3>
                      <p className="text-xs text-slate-300 flex items-center gap-1.5">
                        <Phone className="h-3 w-3 text-red-400" />
                        <span>{incident.student_phone || 'Emergency Signal'}</span>
                      </p>
                    </div>

                    <div className="text-right text-[11px] text-slate-400">
                      <div className="flex items-center gap-1 text-red-400 font-semibold justify-end">
                        <Clock className="h-3.5 w-3.5" />
                        <span>{new Date(incident.triggered_at).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-[10px] mt-0.5">{new Date(incident.triggered_at).toLocaleDateString()}</p>
                    </div>
                  </div>

                  {/* Coordinates & Accuracy */}
                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between text-xs text-slate-300">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-red-400" />
                      <span>
                        {incident.latitude ? `${incident.latitude.toFixed(5)}, ${incident.longitude?.toFixed(5)}` : 'Pending GPS Fix'}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400 font-medium">
                      &plusmn;{incident.accuracy_meters || 5}m accuracy
                    </span>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 pt-1">
                    {!isAcknowledged ? (
                      <button
                        onClick={() => handleAcknowledge(incident.id)}
                        disabled={isProcessing}
                        className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition shadow-lg shadow-amber-500/20 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <ShieldAlert className="h-4 w-4" />
                        <span>{isProcessing ? 'Acknowledging...' : 'Acknowledge & Dispatch'}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => setResolutionModalIncident(incident)}
                        className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition shadow-lg shadow-emerald-600/20 cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        <span>Resolve Incident</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Historical Incidents Table */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">
          Past Incidents Audit Log
        </h3>

        <div className="rounded-2xl glass-card border border-slate-800 overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/90 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Student</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Coordinates</th>
                  <th className="py-3 px-4">Triggered Time</th>
                  <th className="py-3 px-4">Resolved Time</th>
                  <th className="py-3 px-4">Resolution Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200">
                {historicalSos.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-500">
                      No historical incident logs recorded for this campus.
                    </td>
                  </tr>
                ) : (
                  historicalSos.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-800/30 transition">
                      <td className="py-3.5 px-4 font-bold text-white">
                        {item.student_name || 'Student'}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            item.status === 'RESOLVED'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-300">
                        {item.latitude ? `${item.latitude.toFixed(4)}, ${item.longitude?.toFixed(4)}` : 'N/A'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-400">
                        {new Date(item.triggered_at).toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4 text-slate-400">
                        {item.resolved_at ? new Date(item.resolved_at).toLocaleString() : 'N/A'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-400 max-w-xs truncate">
                        {item.resolution_notes || 'Resolved by safety patrol'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Incident Resolution Modal */}
      {resolutionModalIncident && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl glass-panel border border-slate-700 p-6 space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Resolve Emergency Incident</h3>
            <p className="text-xs text-slate-300">
              Confirm resolution for <strong>{resolutionModalIncident.student_name}</strong>. Provide safety notes for the official audit record.
            </p>

            <textarea
              rows={3}
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              placeholder="e.g. Officer reached site. Student confirmed safe and escorted back to campus."
              className="w-full p-3 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setResolutionModalIncident(null)}
                className="px-4 py-2 rounded-xl border border-slate-700 text-slate-300 hover:text-white text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleResolveSubmit}
                disabled={processingId !== null}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/20"
              >
                Confirm Resolution
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
