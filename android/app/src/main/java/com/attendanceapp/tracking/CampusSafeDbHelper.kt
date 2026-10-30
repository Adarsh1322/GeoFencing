package com.attendanceapp.tracking

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.Log
import java.io.File
import java.util.UUID

/**
 * CampusSafe SQLite Database Helper for Native Background Tracking.
 *
 * Operates directly on the shared `campussafe.db` using SQLite WAL mode.
 * Enforces atomic monotonic sequence number allocation, fail-closed student
 * identity isolation, and durable persistence into `location_queue`.
 */
class CampusSafeDbHelper(private val context: Context) {

    companion object {
        private const val TAG = "CampusSafeDbHelper"
        private const val DB_NAME = "campussafe.db"
    }

    private fun getReadableOrWritableDatabase(): SQLiteDatabase {
        val dbFile: File = context.getDatabasePath(DB_NAME)
        if (!dbFile.exists()) {
            // Parent directory creation
            dbFile.parentFile?.mkdirs()
        }

        val db = SQLiteDatabase.openDatabase(
            dbFile.absolutePath,
            null,
            SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY
        )

        // Ensure WAL mode and busy timeout are configured on this connection
        try {
            db.execSQL("PRAGMA foreign_keys = ON;")
            db.execSQL("PRAGMA busy_timeout = 5000;")
        } catch (e: Exception) {
            Log.w(TAG, "Pragma configuration warning: ${e.message}")
        }

        return db
    }

    /**
     * Atomically allocates the next monotonic sequence number and enqueues a point into `location_queue`.
     * Validates student identity against `local_sessions` to prevent cross-account contamination.
     */
    @Synchronized
    fun insertLocationPoint(
        sessionId: String,
        studentUserId: String?,
        latitude: Double,
        longitude: Double,
        accuracy: Float,
        capturedAtIso: String
    ): Long {
        val db = getReadableOrWritableDatabase()

        db.beginTransactionNonExclusive()
        try {
            // 1. Verify parent session exists and validate student ownership
            var sessionStudentId: String? = null
            var sessionStatus: String? = null

            val sessionQuery = "SELECT student_user_id, status FROM local_sessions WHERE id = ? LIMIT 1;"
            db.rawQuery(sessionQuery, arrayOf(sessionId)).use { cursor ->
                if (cursor.moveToFirst()) {
                    sessionStudentId = cursor.getString(0)
                    sessionStatus = cursor.getString(1)
                } else {
                    throw IllegalStateException("Session not found in local_sessions: $sessionId")
                }
            }

            if (sessionStatus != "ACTIVE") {
                Log.w(TAG, "Ignoring location fix: session $sessionId is in status $sessionStatus (not ACTIVE)")
                return -1L
            }

            // Fail-closed identity check
            if (!sessionStudentId.isNullOrEmpty() && !studentUserId.isNullOrEmpty() && sessionStudentId != studentUserId) {
                throw SecurityException(
                    "Student identity mismatch: session owned by $sessionStudentId but fix reported for $studentUserId"
                )
            }

            val effectiveStudentId = studentUserId ?: sessionStudentId

            // 2. Atomically increment sequence counter in local_sessions
            db.execSQL("UPDATE local_sessions SET last_seq_no = last_seq_no + 1 WHERE id = ?;", arrayOf(sessionId))

            var allocatedSeq = 1L
            db.rawQuery("SELECT last_seq_no FROM local_sessions WHERE id = ? LIMIT 1;", arrayOf(sessionId)).use { cursor ->
                if (cursor.moveToFirst()) {
                    allocatedSeq = cursor.getLong(0)
                }
            }

            // 3. Insert point into location_queue
            val pointId = UUID.randomUUID().toString()
            val isQuarantined = if (!effectiveStudentId.isNullOrEmpty()) 0 else 1

            val values = ContentValues().apply {
                put("client_point_id", pointId)
                put("session_id", sessionId)
                put("student_user_id", effectiveStudentId)
                put("seq_no", allocatedSeq)
                put("latitude", latitude)
                put("longitude", longitude)
                put("accuracy_meters", accuracy)
                put("captured_at", capturedAtIso)
                put("status", "PENDING")
                put("is_quarantined", isQuarantined)
            }

            val insertResult = db.insertOrThrow("location_queue", null, values)
            if (insertResult == -1L) {
                throw IllegalStateException("Failed to insert point into location_queue")
            }

            db.setTransactionSuccessful()
            Log.d(TAG, "Persisted location fix seq=$allocatedSeq for session=$sessionId in SQLite")
            return allocatedSeq
        } finally {
            db.endTransaction()
            db.close()
        }
    }

    /**
     * Marks a local session as ENDED.
     */
    @Synchronized
    fun stopSession(sessionId: String, endedAtIso: String): Boolean {
        val db = getReadableOrWritableDatabase()
        try {
            val values = ContentValues().apply {
                put("status", "ENDED")
                put("ended_at", endedAtIso)
                put("needs_stop_sync", 1)
            }
            val rows = db.update("local_sessions", values, "id = ?", arrayOf(sessionId))
            return rows > 0
        } finally {
            db.close()
        }
    }

    /**
     * Checks if a session is currently marked ACTIVE.
     */
    @Synchronized
    fun isSessionActive(sessionId: String): Boolean {
        val db = getReadableOrWritableDatabase()
        try {
            db.rawQuery("SELECT status FROM local_sessions WHERE id = ? LIMIT 1;", arrayOf(sessionId)).use { cursor ->
                if (cursor.moveToFirst()) {
                    return cursor.getString(0) == "ACTIVE"
                }
            }
            return false
        } catch (e: Exception) {
            Log.w(TAG, "Could not check session active state: ${e.message}")
            return false
        } finally {
            db.close()
        }
    }
}

