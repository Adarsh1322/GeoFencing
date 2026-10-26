'use client';

import React, { useState } from 'react';
import { UserCheck, UserX, Clock, Search, Check, AlertCircle, RefreshCw } from 'lucide-react';
import { PendingStudent } from '../types';
import { api } from '../lib/api';

interface PendingApprovalsProps {
  pendingStudents: PendingStudent[];
  onRefresh: () => void;
}

export default function PendingApprovals({
  pendingStudents,
  onRefresh,
}: PendingApprovalsProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const filtered = pendingStudents.filter((s) => {
    const q = searchTerm.toLowerCase();
    return (
      s.student_name.toLowerCase().includes(q) ||
      s.student_email.toLowerCase().includes(q) ||
      s.roll_number.toLowerCase().includes(q) ||
      s.campus_name.toLowerCase().includes(q)
    );
  });

  const handleApprove = async (membershipId: string, studentName: string) => {
    setProcessingId(membershipId);
    setFeedback(null);
    try {
      await api.approveStudent(membershipId);
      setFeedback({
        type: 'success',
        message: `Successfully approved student: ${studentName}. Membership is now ACTIVE.`,
      });
      onRefresh();
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: (err as Error).message || 'Failed to approve student membership.',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (membershipId: string, studentName: string) => {
    if (!confirm(`Are you sure you want to reject registration for ${studentName}?`)) return;
    setProcessingId(membershipId);
    setFeedback(null);
    try {
      await api.rejectStudent(membershipId);
      setFeedback({
        type: 'success',
        message: `Student ${studentName} membership has been rejected.`,
      });
      onRefresh();
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: (err as Error).message || 'Failed to reject student membership.',
      });
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header and Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <span>Student Membership Verification</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              {pendingStudents.length} Pending
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Institutional verification required before students can punch attendance or access emergency beacons.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name, roll, email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 rounded-xl bg-slate-900/80 border border-slate-700/60 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-64"
            />
          </div>
          <button
            onClick={onRefresh}
            title="Refresh List"
            className="p-2 rounded-xl glass-card border border-slate-700/60 text-slate-300 hover:text-white transition cursor-pointer"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Status Feedback Notification */}
      {feedback && (
        <div
          className={`p-3.5 rounded-xl border flex items-center gap-3 text-xs font-semibold ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          {feedback.type === 'success' ? (
            <Check className="h-4 w-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Table of Pending Students */}
      <div className="rounded-2xl glass-card border border-slate-800 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/90 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Student Name</th>
                <th className="py-3 px-4">Roll Number</th>
                <th className="py-3 px-4">Campus</th>
                <th className="py-3 px-4">Contact</th>
                <th className="py-3 px-4">Requested Date</th>
                <th className="py-3 px-4 text-right">Verification Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-200">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    <UserCheck className="h-10 w-10 mx-auto mb-2 text-slate-600" />
                    <p className="font-semibold text-sm text-slate-400">All Student Registrations Cleared</p>
                    <p className="text-xs">No pending student verification requests found for this campus.</p>
                  </td>
                </tr>
              ) : (
                filtered.map((student) => {
                  const isProcessing = processingId === student.membership_id;
                  return (
                    <tr key={student.membership_id} className="hover:bg-slate-800/30 transition">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-white">{student.student_name}</div>
                        <div className="text-[11px] text-slate-400">{student.student_email}</div>
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-blue-400">
                        {student.roll_number || 'PENDING'}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 font-medium">
                          {student.campus_name}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-400">
                        {student.student_phone || 'Not Provided'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-400">
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3 w-3 text-slate-500" />
                          <span>{new Date(student.requested_at).toLocaleDateString()}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleReject(student.membership_id, student.student_name)}
                            disabled={isProcessing}
                            className="px-3 py-1.5 rounded-xl border border-red-500/30 text-red-400 hover:bg-red-500/10 font-bold text-xs transition disabled:opacity-50 cursor-pointer flex items-center gap-1"
                          >
                            <UserX className="h-3.5 w-3.5" />
                            <span>Reject</span>
                          </button>
                          <button
                            onClick={() => handleApprove(student.membership_id, student.student_name)}
                            disabled={isProcessing}
                            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition shadow-md shadow-emerald-600/20 disabled:opacity-50 cursor-pointer flex items-center gap-1"
                          >
                            <UserCheck className="h-3.5 w-3.5" />
                            <span>{isProcessing ? 'Verifying...' : 'Approve & Activate'}</span>
                          </button>
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
