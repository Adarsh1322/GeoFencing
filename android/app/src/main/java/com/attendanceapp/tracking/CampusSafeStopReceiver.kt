package com.attendanceapp.tracking

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * BroadcastReceiver triggered by the "Stop Journey" action in the ongoing notification.
 */
class CampusSafeStopReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "CampusSafeStopReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val sessionId = intent.getStringExtra(CampusSafeLocationService.EXTRA_SESSION_ID)
        Log.i(TAG, "Received Stop Journey action from notification for session: $sessionId")

        val stopIntent = Intent(context, CampusSafeLocationService::class.java).apply {
            action = CampusSafeLocationService.ACTION_STOP
            putExtra(CampusSafeLocationService.EXTRA_SESSION_ID, sessionId)
        }
        context.startService(stopIntent)
    }
}

