package com.novelwriter.app;

import android.content.Context;
import android.net.wifi.WifiManager;

/**
 * Holds a MulticastLock while we listen for a UDP beacon.
 *
 * Android's Wi-Fi power saving filters broadcast and multicast packets addressed
 * to the phone unless an app takes this lock. Without it the beacon usually
 * arrives while the screen is on and the app is in the foreground — and then
 * silently disappears once the screen goes off or the app is backgrounded, which
 * is precisely the "有时候能连上，有时候怎么点都不行" pattern: it is not random,
 * it tracks whether the radio happened to be awake.
 *
 * Held only around the discovery window (a few seconds), never for the life of
 * the process: a permanent lock costs battery for nothing.
 */
final class Multicast {

    private final WifiManager.MulticastLock lock;

    private Multicast(WifiManager.MulticastLock lock) {
        this.lock = lock;
    }

    /** Returns a no-op handle on devices where Wi-Fi is absent or the lock fails. */
    static Multicast acquire(Context context) {
        if (context == null) return new Multicast(null);
        try {
            WifiManager manager = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (manager == null) return new Multicast(null);
            WifiManager.MulticastLock lock = manager.createMulticastLock("novel-writer-discovery");
            lock.setReferenceCounted(true);
            lock.acquire();
            return new Multicast(lock);
        } catch (Exception error) {
            // Some ROMs throw here without the permission; discovery still works
            // while the screen is on, so this must never break the sync path.
            return new Multicast(null);
        }
    }

    void release() {
        if (lock == null) return;
        try {
            if (lock.isHeld()) lock.release();
        } catch (Exception error) {
            /* the radio may have been torn down under us */
        }
    }
}
