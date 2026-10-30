package com.attendanceapp.tracking

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.attendanceapp.MainActivity
import com.attendanceapp.R
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Android Native Foreground Location Service for CampusSafe Safe Journeys.
 *
 * Runs with `foregroundServiceType="location"`, displays an ongoing notification
 * with a "Stop Journey" action, and durably writes location points into SQLite.
 */
class CampusSafeLocationService : Service() {

    companion object {
        private const val TAG = "CampusSafeLocationService"
        const val CHANNEL_ID = "campussafe_journey_channel"
        const val NOTIFICATION_ID = 9001

        const val ACTION_START = "com.attendanceapp.tracking.ACTION_START"
        const val ACTION_STOP = "com.attendanceapp.tracking.ACTION_STOP"

        const val EXTRA_SESSION_ID = "extra_session_id"
        const val EXTRA_STUDENT_USER_ID = "extra_student_user_id"
        const val EXTRA_CAMPUS_ID = "extra_campus_id"

        @Volatile
        var isRunning: Boolean = false
            private set

        @Volatile
        var activeSessionId: String? = null
            private set
    }

    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var dbHelper: CampusSafeDbHelper
    private var locationCallback: LocationCallback? = null

    private var currentSessionId: String? = null
    private var currentStudentUserId: String? = null
    private var currentCampusId: String? = null

    override fun onCreate() {
        super.onCreate()
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        dbHelper = CampusSafeDbHelper(this)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) {
            Log.w(TAG, "Service started with null intent")
            return START_NOT_STICKY
        }

        val action = intent.action
        Log.d(TAG, "onStartCommand action: $action")

        when (action) {
            ACTION_START -> {
                val sessionId = intent.getStringExtra(EXTRA_SESSION_ID)
                val studentUserId = intent.getStringExtra(EXTRA_STUDENT_USER_ID)
                val campusId = intent.getStringExtra(EXTRA_CAMPUS_ID)

                if (sessionId.isNullOrEmpty()) {
                    Log.e(TAG, "Cannot start tracking: sessionId is missing")
                    stopSelf()
                    return START_NOT_STICKY
                }

                // Prevent duplicate tracking if already tracking this session
                if (isRunning && currentSessionId == sessionId) {
                    Log.d(TAG, "Tracking already running for session: $sessionId. Ignoring duplicate start.")
                    return START_STICKY
                }

                currentSessionId = sessionId
                currentStudentUserId = studentUserId
                currentCampusId = campusId

                startForegroundTracking(sessionId)
            }
            ACTION_STOP -> {
                val stoppedSessionId = intent.getStringExtra(EXTRA_SESSION_ID) ?: currentSessionId
                stopForegroundTracking(stoppedSessionId, isExplicitUserAction = true)
            }
            else -> {
                Log.w(TAG, "Unknown action: $action")
            }
        }

        return START_NOT_STICKY
    }

    private fun startForegroundTracking(sessionId: String) {
        val notification = buildOngoingNotification("Safe Campus Journey Active", "Sharing live location with Campus Safety")

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceCompat.startForeground(
                    this,
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            isRunning = true
            activeSessionId = sessionId
        } catch (e: Exception) {
            Log.e(TAG, "Fatal: Failed to start foreground service: ${e.message}", e)
            stopSelf()
            return
        }

        requestNativeLocationUpdates()
    }

    private fun requestNativeLocationUpdates() {
        // Clean up previous callback if any
        locationCallback?.let {
            fusedLocationClient.removeLocationUpdates(it)
        }

        val locationRequest = LocationRequest.create().apply {
            priority = Priority.PRIORITY_HIGH_ACCURACY
            interval = 5000L
            fastestInterval = 2000L
            smallestDisplacement = 1f
        }

        val callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val location: Location = result.lastLocation ?: return
                onLocationFixReceived(location)
            }
        }

        try {
            fusedLocationClient.requestLocationUpdates(
                locationRequest,
                callback,
                Looper.getMainLooper()
            )
            locationCallback = callback
            Log.i(TAG, "FusedLocation updates registered successfully for session $currentSessionId")
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException: Location permission missing when starting updates: ${e.message}")
            stopForegroundTracking(currentSessionId, isExplicitUserAction = false)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to request location updates: ${e.message}")
        }
    }

    private fun onLocationFixReceived(location: Location) {
        val sessionId = currentSessionId ?: return
        val studentUserId = currentStudentUserId

        val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val capturedAtIso = isoFormat.format(Date(location.time))

        try {
            // 1. Durably persist into SQLite location_queue
            val seqNo = dbHelper.insertLocationPoint(
                sessionId = sessionId,
                studentUserId = studentUserId,
                latitude = location.latitude,
                longitude = location.longitude,
                accuracy = location.accuracy,
                capturedAtIso = capturedAtIso
            )

            if (seqNo > 0) {
                // 2. Dispatch event to React Native JavaScript runtime if active
                CampusSafeTrackingModule.emitLocationCaptured(
                    sessionId = sessionId,
                    studentUserId = studentUserId,
                    seqNo = seqNo,
                    latitude = location.latitude,
                    longitude = location.longitude,
                    accuracy = location.accuracy,
                    capturedAt = capturedAtIso
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to persist location fix in SQLite: ${e.message}", e)
        }
    }

    private fun stopForegroundTracking(sessionId: String?, isExplicitUserAction: Boolean) {
        Log.i(TAG, "Stopping foreground tracking for session: $sessionId")

        locationCallback?.let {
            fusedLocationClient.removeLocationUpdates(it)
            locationCallback = null
        }

        if (sessionId != null) {
            val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }
            val endedAtIso = isoFormat.format(Date())
            dbHelper.stopSession(sessionId, endedAtIso)

            // Notify React Native JS
            CampusSafeTrackingModule.emitJourneyStopped(sessionId, isExplicitUserAction)
        }

        isRunning = false
        activeSessionId = null
        currentSessionId = null
        currentStudentUserId = null
        currentCampusId = null

        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = "CampusSafe Safe Journey"
            val descriptionText = "Displays ongoing tracking status for your safe campus journey"
            val importance = NotificationManager.IMPORTANCE_LOW
            val channel = NotificationChannel(CHANNEL_ID, name, importance).apply {
                description = descriptionText
                setShowBadge(false)
            }
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun buildOngoingNotification(title: String, content: String): Notification {
        // Tap notification to open app
        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val openAppPendingIntent = PendingIntent.getActivity(
            this,
            0,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Action: Stop Journey
        val stopIntent = Intent(this, CampusSafeStopReceiver::class.java).apply {
            putExtra(EXTRA_SESSION_ID, currentSessionId)
        }
        val stopPendingIntent = PendingIntent.getBroadcast(
            this,
            1,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(content)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setAutoCancel(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(openAppPendingIntent)
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                "Stop Journey",
                stopPendingIntent
            )
            .build()
    }

    override fun onDestroy() {
        Log.i(TAG, "CampusSafeLocationService onDestroy called")
        locationCallback?.let {
            fusedLocationClient.removeLocationUpdates(it)
            locationCallback = null
        }
        isRunning = false
        activeSessionId = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
