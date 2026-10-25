package com.novelwriter.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Brings the sync service back after a reboot or when Wi-Fi comes back.
 *
 * Without this the pairing would only work until the phone restarts — the service
 * returns START_NOT_STICKY, so Android does not resurrect it, and the user would
 * have to open the app to get syncing again. That is precisely the "I have not
 * opened the app in two days so nothing synced" complaint the foreground service
 * exists to prevent.
 *
 * Both intents are checked rather than trusted: any other sender can also fire a
 * broadcast, and starting a foreground service from an empty intent would show a
 * notification for no reason.
 */
public final class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        // `supplicant` is the real action name; the misspelt `supply` that used to
        // sit in both the manifest and here matched nothing, so a phone that lost
        // and regained Wi-Fi never brought the service back.
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
            && !"android.net.wifi.supplicant.STATE_CHANGE".equals(action)
            && !android.net.wifi.WifiManager.NETWORK_STATE_CHANGED_ACTION.equals(action)) {
            return;
        }
        // Only paired devices have anything to talk to; asking for a foreground
        // service before pairing would put a permanent notification on a phone
        // that has never seen the desktop.
        if (!new Store(context).paired()) return;
        try {
            SyncService.start(context);
        } catch (Exception ignored) {
            // Android 12+ refuses a foreground-service start from the background
            // in some OEM builds; the next app open starts it again.
        }
    }
}
