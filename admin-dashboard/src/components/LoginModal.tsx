'use client';

import React, { useState } from 'react';
import { Shield, Lock, Mail, AlertCircle, ArrowRight, CheckCircle2, Server, Globe2 } from 'lucide-react';
import { api } from '../lib/api';
import { AdminUser } from '../types';

interface LoginModalProps {
  onSuccess: (admin: AdminUser) => void;
}

export default function LoginModal({ onSuccess }: LoginModalProps) {
  const [email, setEmail] = useState('admin@campussafe.edu');
  const [password, setPassword] = useState('Password123!');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const performLogin = async (loginEmail: string, loginPass: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.login(loginEmail, loginPass);
      onSuccess(res.user);
    } catch (err: unknown) {
      setError((err as Error).message || 'Invalid administrator credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await performLogin(email, password);
  };

  const handleQuickLogin = async (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('Password123!');
    await performLogin(demoEmail, 'Password123!');
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6 bg-[#070a13] text-slate-100 relative overflow-hidden select-none">
      {/* Dynamic Background Glow Elements */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-blue-600/15 rounded-full blur-[128px] pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-indigo-600/15 rounded-full blur-[128px] pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b0f_1px,transparent_1px),linear-gradient(to_bottom,#1e293b0f_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none" />

      {/* Main Card */}
      <div className="relative w-full max-w-lg rounded-3xl bg-slate-900/80 border border-slate-800 backdrop-blur-2xl p-6 sm:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.6)] space-y-7 z-10">
        
        {/* Brand & Title */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-500 shadow-xl shadow-blue-500/25 ring-4 ring-blue-500/20">
            <Shield className="h-8 w-8 text-white" />
          </div>

          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              CampusSafe
            </h1>
            <p className="text-xs sm:text-sm font-semibold text-blue-400 mt-1 uppercase tracking-wider">
              College Security &amp; Safety Desk Console
            </p>
          </div>

          <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
            Real-time PostGIS Geofence Perimeter Monitoring, Student Membership Verification &amp; Emergency SOS Command
          </p>
        </div>

        {/* System Status Pill */}
        <div className="flex items-center justify-center gap-3 px-3.5 py-1.5 rounded-full bg-slate-950/80 border border-slate-800 text-[11px] font-medium text-slate-300">
          <div className="flex items-center gap-1.5 text-emerald-400">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="font-semibold">Backend Connected (Port 4000)</span>
          </div>
          <span className="text-slate-600">•</span>
          <div className="flex items-center gap-1 text-slate-400">
            <Server className="h-3 w-3 text-blue-400" />
            <span>PostGIS Active</span>
          </div>
        </div>

        {error && (
          <div className="p-3.5 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center gap-3 text-xs text-red-300 font-semibold animate-shake">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
              <span>Admin Official Email</span>
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@campussafe.edu"
                className="w-full pl-10 pr-4 py-3 rounded-2xl bg-slate-950/90 border border-slate-700/80 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 font-medium transition"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
              <span>Access Password</span>
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-10 pr-4 py-3 rounded-2xl bg-slate-950/90 border border-slate-700/80 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 font-medium transition"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-sm tracking-wide transition shadow-lg shadow-blue-600/30 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2 group"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                <span>Verifying Administrator Token...</span>
              </span>
            ) : (
              <>
                <span>Sign In to Safety Command Desk</span>
                <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>
        </form>

        {/* 1-Click Demo Accounts Section */}
        <div className="pt-5 border-t border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            <span>Instant Demo Logins (1-Click)</span>
            <span className="text-emerald-400 font-semibold text-[10px]">Pre-seeded Roles</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={loading}
              onClick={() => handleQuickLogin('admin@campussafe.edu')}
              className="p-3 rounded-2xl bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-blue-500/50 text-left transition cursor-pointer group shadow-sm flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <p className="font-bold text-slate-200 text-xs group-hover:text-blue-400 transition">
                    Prof. Rajesh Sharma
                  </p>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-semibold">
                    CSEU
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">Director &amp; Campus Admin</p>
              </div>
              <span className="text-[10px] text-blue-400/80 font-medium mt-2 flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                Log in as CSEU &rarr;
              </span>
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() => handleQuickLogin('admin@metro.edu')}
              className="p-3 rounded-2xl bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/50 text-left transition cursor-pointer group shadow-sm flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <p className="font-bold text-slate-200 text-xs group-hover:text-indigo-400 transition">
                    Chief Officer Roy
                  </p>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-semibold">
                    MPI
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">Campus Security Head</p>
              </div>
              <span className="text-[10px] text-indigo-400/80 font-medium mt-2 flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                Log in as MPI &rarr;
              </span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
