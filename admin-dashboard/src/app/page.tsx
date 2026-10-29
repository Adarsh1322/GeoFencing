'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Navbar from '../components/Navbar';
import Sidebar, { ActiveTab } from '../components/Sidebar';
import StatsCards from '../components/StatsCards';
import CampusMap from '../components/CampusMap';
import PendingApprovals from '../components/PendingApprovals';
import SosAlertDesk from '../components/SosAlertDesk';
import AttendanceAudit from '../components/AttendanceAudit';
import SosTakeoverModal from '../components/SosTakeoverModal';
import LoginModal from '../components/LoginModal';
import { api, getStoredAdmin, getStoredToken } from '../lib/api';
import { connectDashboardSocket, disconnectDashboardSocket } from '../lib/socket';
import { emergencyAudio } from '../lib/audio';
import { AdminUser, Campus, DashboardStudent, PendingStudent, SosIncident } from '../types';

export default function AdminDashboardPage() {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [selectedCampusId, setSelectedCampusId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<ActiveTab>('map');
  const [students, setStudents] = useState<DashboardStudent[]>([]);
  const [pendingStudents, setPendingStudents] = useState<PendingStudent[]>([]);
  const [activeSos, setActiveSos] = useState<SosIncident[]>([]);
  const [historicalSos, setHistoricalSos] = useState<SosIncident[]>([]);
  const [sosError, setSosError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [takeoverIncident, setTakeoverIncident] = useState<SosIncident | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Restore Admin Session on Mount
  useEffect(() => {
    const savedAdmin = getStoredAdmin();
    const token = getStoredToken();
    if (savedAdmin && token) {
      setAdmin(savedAdmin);
    }
    setIsInitializing(false);
  }, []);

  // Fetch Campuses once logged in
  useEffect(() => {
    if (!admin) return;

    api.getCampuses().then((res) => {
      const list = res.campuses || [];
      setCampuses(list);
      if (list.length > 0 && !selectedCampusId) {
        // Prioritize Lovely Professional University (LPU / CSEU)
        const lpu = list.find((c) => c.code === 'LPU' || c.code === 'CSEU' || c.name.toLowerCase().includes('lovely'));
        setSelectedCampusId(lpu ? lpu.id : list[0].id);
      }
    }).catch((err) => {
      console.warn('Failed to load campuses:', err);
    });
  }, [admin]);

  // Refresh All Data for Selected Campus
  const refreshData = useCallback(async () => {
    if (!admin || !selectedCampusId) return;

    try {
      const [studentsRes, pendingRes, sosRes, incidentsRes] = await Promise.all([
        api.getDashboardStudents(selectedCampusId).catch(() => ({ students: [] })),
        api.getPendingStudents(selectedCampusId).catch(() => ({ pendingStudents: [] })),
        api.getActiveSos(selectedCampusId)
          .then((res) => {
            setSosError(null);
            return res;
          })
          .catch((err) => {
            const msg = (err as Error).message || 'Unable to connect to SOS dispatch service';
            setSosError(msg);
            return null;
          }),
        api.getDashboardIncidents(selectedCampusId).catch(() => ({ sosIncidents: [] })),
      ]);

      setStudents(studentsRes.students || []);
      setPendingStudents(pendingRes.pendingStudents || []);

      if (sosRes && Array.isArray(sosRes.incidents)) {
        const activeList = sosRes.incidents.filter(
          (s) =>
            s.campus_id === selectedCampusId &&
            (s.status === 'RECEIVED' || s.status === 'ACKNOWLEDGED')
        );
        setActiveSos(activeList);
      }

      const pastList = (incidentsRes.sosIncidents || []).filter(
        (s) => s.campus_id === selectedCampusId
      );
      setHistoricalSos(pastList);
    } catch (err) {
      console.warn('Error refreshing dashboard data:', err);
    }
  }, [admin, selectedCampusId]);

  // Trigger refresh on campus change & set up interval
  useEffect(() => {
    if (!admin || !selectedCampusId) return;
    void refreshData();
    const interval = setInterval(() => {
      void refreshData();
    }, 10000);
    return () => clearInterval(interval);
  }, [admin, selectedCampusId, refreshData]);

  // Socket.IO real-time connection
  useEffect(() => {
    const token = getStoredToken();
    if (!admin || !token || !selectedCampusId) return;

    const socket = connectDashboardSocket(token, selectedCampusId);

    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    // 1. Real-time location updates
    socket.on('location_update', (data: any) => {
      setStudents((prev) => {
        const studentId = data.studentId || data.student_user_id;
        const exists = prev.some((s) => s.id === studentId);
        if (exists) {
          return prev.map((s) =>
            s.id === studentId
              ? {
                  ...s,
                  latitude: data.latitude,
                  longitude: data.longitude,
                  accuracy_meters: data.accuracy_meters,
                  geofence_status: data.is_inside_geofence ? 'INSIDE' : 'OUTSIDE',
                  captured_at: data.captured_at || new Date().toISOString(),
                  freshness_status: 'ONLINE',
                }
              : s
          );
        }
        return prev;
      });
    });

    // 2. Real-time SOS triggers
    socket.on('sos_received', (sosData: SosIncident) => {
      setActiveSos((prev) => {
        const exists = prev.some((s) => s.id === sosData.id);
        if (!exists) {
          return [sosData, ...prev];
        }
        return prev;
      });
      // Start emergency audio alert & display takeover modal
      emergencyAudio.startEmergencySiren();
      setTakeoverIncident(sosData);
    });

    // 3. SOS Acknowledged
    socket.on('sos_acknowledged', (sosData: SosIncident) => {
      setActiveSos((prev) =>
        prev.map((s) => (s.id === sosData.id ? { ...s, status: 'ACKNOWLEDGED' } : s))
      );
    });

    // 4. SOS Resolved
    socket.on('sos_resolved', (sosData: SosIncident) => {
      setActiveSos((prev) => prev.filter((s) => s.id !== sosData.id));
      setHistoricalSos((prev) => [sosData, ...prev]);
      if (takeoverIncident?.id === sosData.id) {
        setTakeoverIncident(null);
      }
      emergencyAudio.stopEmergencySiren();
    });

    return () => {
      disconnectDashboardSocket();
      setIsConnected(false);
    };
  }, [admin, selectedCampusId]);

  const handleLogout = () => {
    api.logout();
    setAdmin(null);
    disconnectDashboardSocket();
    emergencyAudio.stopEmergencySiren();
  };

  const selectedCampus = campuses.find((c) => c.id === selectedCampusId) || campuses[0] || null;

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-[#070a13] flex flex-col items-center justify-center text-slate-400 text-sm gap-3">
        <div className="h-8 w-8 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
        <span className="font-semibold text-slate-300">Initializing CampusSafe Operations Console...</span>
      </div>
    );
  }

  // Dedicated Login Screen when not authenticated
  if (!admin) {
    return (
      <LoginModal
        onSuccess={(loggedInAdmin) => {
          setAdmin(loggedInAdmin);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#070b12] text-slate-100">

      {/* Top Navbar */}
      <Navbar
        admin={admin}
        campuses={campuses}
        selectedCampusId={selectedCampusId}
        onSelectCampus={setSelectedCampusId}
        activeSosCount={activeSos.length}
        isConnected={isConnected}
        onLogout={handleLogout}
        onOpenSosModal={() => {
          if (activeSos.length > 0) {
            setTakeoverIncident(activeSos[0]);
          } else {
            setActiveTab('sos');
          }
        }}
      />

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Navigation Sidebar */}
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          pendingCount={pendingStudents.length}
          activeSosCount={activeSos.length}
        />

        {/* Viewport Content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6">
          {/* Top Quick Stats Metrics */}
          <StatsCards
            students={students}
            pendingStudents={pendingStudents}
            activeSos={activeSos}
            onSelectTab={setActiveTab}
          />

          {/* Emergency SOS Communication Error Banner */}
          {sosError && (
            <div className="flex items-center justify-between p-3.5 sm:p-4 rounded-2xl bg-red-500/15 border border-red-500/40 text-red-300 shadow-md">
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-ping" />
                <span className="text-xs font-bold">
                  Emergency Dispatch Notice: {sosError}. Live incident feed may be degraded.
                </span>
              </div>
              <button
                onClick={refreshData}
                className="px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs transition cursor-pointer"
              >
                Retry Dispatch Sync
              </button>
            </div>
          )}

          {/* Pending Verification Notice Banner */}
          {pendingStudents.length > 0 && (
            <div className="flex items-center justify-between p-3.5 sm:p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 shadow-md">
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-ping" />
                <span className="text-xs font-bold">
                  Action Required: {pendingStudents.length} student membership request{pendingStudents.length > 1 ? 's' : ''} pending institutional approval.
                </span>
              </div>
              <button
                onClick={() => setActiveTab('approvals')}
                className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition cursor-pointer"
              >
                Review Now &rarr;
              </button>
            </div>
          )}

          {/* Active Tab View */}
          {activeTab === 'map' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-extrabold text-white tracking-tight">
                    {selectedCampus?.name || 'Campus'} • Live Geofence Monitoring
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Real-time GPS fixes rendered over official campus geofence perimeter polygon.
                  </p>
                </div>
              </div>
              <CampusMap
                campus={selectedCampus}
                students={students}
                activeSos={activeSos}
                onRefresh={refreshData}
              />
            </div>
          )}

          {activeTab === 'approvals' && (
            <PendingApprovals
              pendingStudents={pendingStudents}
              onRefresh={refreshData}
            />
          )}

          {activeTab === 'sos' && (
            <SosAlertDesk
              activeSos={activeSos}
              historicalSos={historicalSos}
              onRefresh={refreshData}
            />
          )}

          {activeTab === 'attendance' && (
            <AttendanceAudit
              students={students}
              campusName={selectedCampus?.name || 'Campus'}
            />
          )}

          {activeTab === 'incidents' && (
            <SosAlertDesk
              activeSos={activeSos}
              historicalSos={historicalSos}
              onRefresh={refreshData}
            />
          )}
        </main>
      </div>

      {/* Emergency Takeover Modal */}
      <SosTakeoverModal
        incident={takeoverIncident}
        onClose={() => setTakeoverIncident(null)}
        onAcknowledge={async (id) => {
          await api.acknowledgeSos(id);
          refreshData();
        }}
        onResolve={async (id) => {
          await api.resolveSos(
            id,
            'Officer dispatched and resolved incident via emergency takeover console. Student confirmed safe.',
            selectedCampusId
          );
          setTakeoverIncident(null);
          refreshData();
        }}
      />
    </div>
  );
}
