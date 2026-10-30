package com.attendanceapp.tracking

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * React Native Bridge Module for CampusSafe Background Tracking Service.
 */
class CampusSafeTrackingModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "CampusSafeTrackingModule"
        private const val TAG = "CampusSafeTrackingMod"

        private var activeReactContext: ReactApplicationContext? = null

        fun emitLocationCaptured(
            sessionId: String,
            studentUserId: String?,
            seqNo: Long,
            latitude: Double,
            longitude: Double,
            accuracy: Float,
            capturedAt: String
        ) {
            try {
                val params = Arguments.createMap().apply {
                    putString("sessionId", sessionId)
                    putString("studentUserId", studentUserId)
                    putDouble("seqNo", seqNo.toDouble())
                    putDouble("latitude", latitude)
                    putDouble("longitude", longitude)
                    putDouble("accuracy", accuracy.toDouble())
                    putString("capturedAt", capturedAt)
                }
                activeReactContext
                    ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    ?.emit("onLocationCaptured", params)
            } catch (e: Exception) {
                Log.w(TAG, "Could not emit onLocationCaptured to JS: ${e.message}")
            }
        }

        fun emitJourneyStopped(sessionId: String, isExplicitUserAction: Boolean) {
            try {
                val params = Arguments.createMap().apply {
                    putString("sessionId", sessionId)
                    putBoolean("isExplicitUserAction", isExplicitUserAction)
                }
                activeReactContext
                    ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    ?.emit("onJourneyStopped", params)
            } catch (e: Exception) {
                Log.w(TAG, "Could not emit onJourneyStopped to JS: ${e.message}")
            }
        }
    }

    override fun initialize() {
        super.initialize()
        activeReactContext = reactContext
    }

    override fun invalidate() {
        if (activeReactContext == reactContext) {
            activeReactContext = null
        }
        super.invalidate()
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun startTracking(options: ReadableMap, promise: Promise) {
        val sessionId = options.getString("sessionId")
        val studentUserId = if (options.hasKey("studentUserId")) options.getString("studentUserId") else null
        val campusId = if (options.hasKey("campusId")) options.getString("campusId") else null

        if (sessionId.isNullOrEmpty()) {
            promise.reject("INVALID_PARAMS", "sessionId is required to start background tracking")
            return
        }

        // Validate location permissions
        val hasFine = ContextCompat.checkSelfPermission(
            reactContext,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val hasCoarse = ContextCompat.checkSelfPermission(
            reactContext,
            Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        if (!hasFine && !hasCoarse) {
            promise.reject("PERMISSION_DENIED", "Location permissions (fine or coarse) are not granted")
            return
        }

        // Check foreground service permission on Android 14+ (API 34+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val hasFgLocation = ContextCompat.checkSelfPermission(
                reactContext,
                Manifest.permission.FOREGROUND_SERVICE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
            if (!hasFgLocation) {
                promise.reject(
                    "SECURITY_EXCEPTION",
                    "FOREGROUND_SERVICE_LOCATION permission is required on Android 14+"
                )
                return
            }
        }

        try {
            val intent = Intent(reactContext, CampusSafeLocationService::class.java).apply {
                action = CampusSafeLocationService.ACTION_START
                putExtra(CampusSafeLocationService.EXTRA_SESSION_ID, sessionId)
                putExtra(CampusSafeLocationService.EXTRA_STUDENT_USER_ID, studentUserId)
                putExtra(CampusSafeLocationService.EXTRA_CAMPUS_ID, campusId)
            }
            ContextCompat.startForegroundService(reactContext, intent)

            val result = Arguments.createMap().apply {
                putBoolean("success", true)
                putBoolean("isTracking", true)
                putString("sessionId", sessionId)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start CampusSafeLocationService: ${e.message}", e)
            promise.reject("START_SERVICE_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun stopTracking(options: ReadableMap?, promise: Promise) {
        val sessionId = options?.getString("sessionId") ?: CampusSafeLocationService.activeSessionId

        try {
            val intent = Intent(reactContext, CampusSafeLocationService::class.java).apply {
                action = CampusSafeLocationService.ACTION_STOP
                putExtra(CampusSafeLocationService.EXTRA_SESSION_ID, sessionId)
            }
            reactContext.startService(intent)

            val result = Arguments.createMap().apply {
                putBoolean("success", true)
                putBoolean("isTracking", false)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to stop CampusSafeLocationService: ${e.message}", e)
            promise.reject("STOP_SERVICE_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun isTrackingRunning(promise: Promise) {
        val result = Arguments.createMap().apply {
            putBoolean("isRunning", CampusSafeLocationService.isRunning)
            putString("activeSessionId", CampusSafeLocationService.activeSessionId)
        }
        promise.resolve(result)
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN Event Emitter calls
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RN Event Emitter calls
    }
}

