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
        // Prioritize CSEU or admin's first campus
        setSelectedCampusId(list[0].id);
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
        api.getActiveSos().catch(() => ({ activeSos: [] })),
        api.getDashboardIncidents(selectedCampusId).catch(() => ({ sosIncidents: [] })),
      ]);

      setStudents(studentsRes.students || []);
      setPendingStudents(pendingRes.pendingStudents || []);

      const activeList = (sosRes.activeSos || []).filter(
        (s) => s.campus_id === selectedCampusId && (s.status === 'PENDING' || s.status === 'ACKNOWLEDGED')
      );
      setActiveSos(activeList);

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
    refreshData();
    const interval = setInterval(refreshData, 10000);
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
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 text-sm">
        Initializing CampusSafe Operations Console...
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#070b12] text-slate-100">
      {/* If not logged in, show Login Modal */}
      {!admin && (
        <LoginModal
          onSuccess={(loggedInAdmin) => {
            setAdmin(loggedInAdmin);
          }}
        />
      )}

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
          await api.resolveSos(id);
          setTakeoverIncident(null);
          refreshData();
        }}
      />
    </div>
  );
}
