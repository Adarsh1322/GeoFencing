'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Campus, DashboardStudent, SosIncident } from '../types';
import { Layers, ZoomIn, AlertTriangle, ShieldCheck, Compass, RefreshCw } from 'lucide-react';

interface CampusMapProps {
  campus: Campus | null;
  students: DashboardStudent[];
  activeSos: SosIncident[];
  onSelectStudent?: (student: DashboardStudent) => void;
  onRefresh?: () => void;
}

export default function CampusMap({
  campus,
  students,
  activeSos,
  onSelectStudent,
  onRefresh,
}: CampusMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const [filter, setFilter] = useState<'ALL' | 'INSIDE' | 'OUTSIDE' | 'SOS'>('ALL');
  const [isMapReady, setIsMapReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainerRef.current) return;

    let map: any = null;

    const initMap = async () => {
      const L = (await import('leaflet')).default;

      // Default center: Campus coordinates or Delhi NCR default
      const defaultLat = campus?.center_lat || 28.545;
      const defaultLng = (campus as any)?.center_lon || campus?.center_lng || 77.272;

      const container = mapContainerRef.current;
      if (!container || (container as any)._leaflet_id) {
        return;
      }

      map = L.map(container, {
        center: [defaultLat, defaultLng],
        zoom: 16,
        zoomControl: false,
      });

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      // Esri Dark Gray Canvas Base (Official GIS standard, zero watermark, free)
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: '&copy; Esri, DeLorme, NAVTEQ',
          maxZoom: 18,
        }
      ).addTo(map);

      // Esri Reference Labels Overlay
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 18,
        }
      ).addTo(map);

      mapInstanceRef.current = map;
      setIsMapReady(true);
    };

    initMap();

    return () => {
      if (map) {
        map.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [campus?.id]);

  // Update Geofence Polygon and Student Markers
  useEffect(() => {
    if (!isMapReady || !mapInstanceRef.current || typeof window === 'undefined') return;

    const updateLayers = async () => {
      const L = (await import('leaflet')).default;
      const map: any = mapInstanceRef.current;

      // Clear existing vector layers & markers except base tiles
      map.eachLayer((layer: any) => {
        if (!layer._url) {
          map.removeLayer(layer);
        }
      });

      // 1. Draw Campus Geofence Polygon
      if (campus?.geofence_polygon?.coordinates?.[0]) {
        const rawCoords = campus.geofence_polygon.coordinates[0];
        // Convert [lng, lat] to [lat, lng]
        const latLngs: [number, number][] = rawCoords.map((c) => [c[1], c[0]] as [number, number]);

        const polygon = L.polygon(latLngs as any, {
          color: '#10b981',
          weight: 2.5,
          opacity: 0.9,
          fillColor: '#10b981',
          fillOpacity: 0.12,
          dashArray: '6, 6',
        }).addTo(map);

        polygon.bindTooltip(
          `<strong>${campus.name}</strong><br/><span style="color:#10b981">Verified 100m Geofence Perimeter</span>`,
          { sticky: true, className: 'glass-card text-xs text-white' }
        );

        // Center view on campus
        if (students.length === 0) {
          map.fitBounds(polygon.getBounds(), { padding: [40, 40] });
        }
      }

      // 2. Plot Students
      const sosStudentIds = new Set(activeSos.map((s) => s.student_user_id));

      const filteredStudents = students.filter((s) => {
        if (!s.latitude || !s.longitude) return false;
        if (filter === 'SOS') return sosStudentIds.has(s.id);
        if (filter === 'INSIDE') return s.geofence_status === 'INSIDE';
        if (filter === 'OUTSIDE') return s.geofence_status === 'OUTSIDE';
        return true;
      });

      filteredStudents.forEach((student) => {
        if (!student.latitude || !student.longitude) return;

        const isSos = sosStudentIds.has(student.id);
        const isInside = student.geofence_status === 'INSIDE';

        let markerColor = '#10b981'; // Green
        let markerClass = 'border-emerald-400 bg-emerald-500';
        let pulseClass = 'bg-emerald-400';

        if (isSos) {
          markerColor = '#ef4444'; // Red
          markerClass = 'border-red-400 bg-red-600 animate-bounce';
          pulseClass = 'bg-red-500 animate-ping';
        } else if (!isInside) {
          markerColor = '#f59e0b'; // Amber
          markerClass = 'border-amber-400 bg-amber-500';
          pulseClass = 'bg-amber-400';
        }

        const iconHtml = `
          <div class="relative flex items-center justify-center w-8 h-8">
            <span class="absolute w-6 h-6 rounded-full opacity-75 ${pulseClass}"></span>
            <div class="relative w-4 h-4 rounded-full border-2 border-white shadow-md ${markerClass}"></div>
          </div>
        `;

        const customIcon = L.divIcon({
          html: iconHtml,
          className: 'custom-student-marker',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });

        const marker = L.marker([student.latitude, student.longitude], {
          icon: customIcon,
        }).addTo(map);

        const popupContent = `
          <div style="font-family: inherit; min-width: 200px; padding: 4px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
              <strong style="color: #ffffff; font-size: 14px;">${student.full_name}</strong>
              <span style="font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 999px; background: ${
                isSos ? 'rgba(239,68,68,0.2)' : isInside ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'
              }; color: ${markerColor};">
                ${isSos ? 'EMERGENCY SOS' : isInside ? 'INSIDE GEOFENCE' : 'OUTSIDE PERIMETER'}
              </span>
            </div>
            <p style="margin: 0; color: #94a3b8; font-size: 11px;">Roll No: <strong style="color: #cbd5e1;">${student.roll_number || 'N/A'}</strong></p>
            <p style="margin: 0; color: #94a3b8; font-size: 11px;">Email: ${student.email}</p>
            <p style="margin: 0; color: #94a3b8; font-size: 11px;">GPS Accuracy: &plusmn;${student.accuracy_meters || 10}m</p>
            <p style="margin: 0; color: #94a3b8; font-size: 11px;">Freshness: <strong style="color: ${student.freshness_status === 'ONLINE' ? '#10b981' : '#f59e0b'};">${student.freshness_status}</strong></p>
            <div style="margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 10px; color: #64748b;">
              Captured: ${student.captured_at ? new Date(student.captured_at).toLocaleTimeString() : 'N/A'}
            </div>
          </div>
        `;

        marker.bindPopup(popupContent);
      });
    };

    updateLayers();
  }, [isMapReady, campus, students, activeSos, filter]);

  const handleResetView = async () => {
    if (!mapInstanceRef.current) return;
    const map: any = mapInstanceRef.current;
    const centerLon = (campus as any)?.center_lon || campus?.center_lng || 77.272;
    if (campus?.center_lat && centerLon) {
      map.setView([campus.center_lat, centerLon], 16, { animate: true });
    }
  };

  return (
    <div className="relative w-full h-[600px] lg:h-[650px] rounded-3xl overflow-hidden glass-card border border-slate-800 shadow-2xl isolate z-0">
      {/* Map Filter Controls Bar */}
      <div className="absolute top-4 left-4 z-20 flex flex-wrap items-center gap-2 p-2 rounded-2xl glass-panel border border-slate-700/60 shadow-xl">
        <button
          onClick={() => setFilter('ALL')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
            filter === 'ALL' ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' : 'text-slate-400 hover:text-white'
          }`}
        >
          All ({students.length})
        </button>
        <button
          onClick={() => setFilter('INSIDE')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
            filter === 'INSIDE' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/20' : 'text-slate-400 hover:text-emerald-400'
          }`}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Inside Geofence
        </button>
        <button
          onClick={() => setFilter('OUTSIDE')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
            filter === 'OUTSIDE' ? 'bg-amber-600 text-white shadow-md shadow-amber-500/20' : 'text-slate-400 hover:text-amber-400'
          }`}
        >
          <Compass className="h-3.5 w-3.5" />
          Outside Perimeter
        </button>
        <button
          onClick={() => setFilter('SOS')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
            filter === 'SOS' ? 'bg-red-600 text-white shadow-md shadow-red-500/20' : 'text-slate-400 hover:text-red-400'
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          SOS Only ({activeSos.length})
        </button>
      </div>

      {/* Floating Action Buttons */}
      <div className="absolute top-4 right-4 z-[500] flex items-center gap-2">
        {onRefresh && (
          <button
            onClick={onRefresh}
            title="Refresh Telemetry"
            className="p-2.5 rounded-xl glass-panel border border-slate-700/60 text-slate-300 hover:text-white hover:border-slate-500 transition shadow-lg cursor-pointer"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={handleResetView}
          title="Reset Campus View"
          className="flex items-center gap-2 px-3 py-2 rounded-xl glass-panel border border-slate-700/60 text-xs font-semibold text-slate-200 hover:text-white transition shadow-lg cursor-pointer"
        >
          <ZoomIn className="h-4 w-4 text-blue-400" />
          <span className="hidden sm:inline">Center Campus</span>
        </button>
      </div>

      {/* Map Legend (Bottom Left) */}
      <div className="absolute bottom-4 left-4 z-[500] p-3 rounded-2xl glass-panel border border-slate-800 text-[11px] space-y-1.5 shadow-xl hidden sm:block">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
          <span className="text-slate-300 font-medium">Inside 100m Geofence</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500"></span>
          <span className="text-slate-300 font-medium">Outside Campus (Monitored)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-ping"></span>
          <span className="text-red-300 font-bold">Active Emergency SOS</span>
        </div>
      </div>

      {/* Leaflet DOM container */}
      <div ref={mapContainerRef} className="w-full h-full" />
    </div>
  );
}
