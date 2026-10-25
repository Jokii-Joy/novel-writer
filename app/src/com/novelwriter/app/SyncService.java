package com.novelwriter.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

/**
 * Keeps the two devices in step while the app is in the background.
 *
 * Product constraint: sync has to happen whether or not the app is on screen,
 * which on Android means a foreground service with a permanent notification.
 * Anything less (WorkManager, JobScheduler, plain alarms) gets deferred to
 * "sometime in the next 15 minutes" or killed outright on Chinese OEM ROMs, and
 * "I edited on the phone and the laptop showed the old text" is exactly the
 * failure the feature exists to prevent.
 *
 * The loop is deliberately dumb: every 45 seconds, push and pull. A push is one
 * HTTP round trip on the LAN (~10 ms), so the battery cost is the radio waking
 * up, not the payload. Backoff exists only for the unpaired/unreachable cases so
 * a phone away from home does not hammer a dead address.
 *
 * Note on Android 8+: a started service may not create its notification channel
 * lazily after startForeground is required, so the channel is created first
 * thing in onCreate.
 */
public final class SyncService extends Service {

    public static final String ACTION_SYNC = "com.novelwriter.app.SYNC";
    private static final String CHANNEL = "novel-writer-sync";
    private static final int NOTIFICATION_ID = 4128;
    private static final long INTERVAL_MS = 45_000;

    private Handler handler;
    private Runnable ticker;
    private volatile boolean working = false;
    private volatile boolean pending = false;
    private long lastSyncAt = 0;
    private String lastMessage = "";

    public static void start(Context context) {
        Intent intent = new Intent(context, SyncService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
        else context.startService(intent);
    }

    public static void stop(Context context) {
        context.stopService(new Intent(context, SyncService.class));
    }

    /** Asks for one immediate pass (used after an edit and from the UI button). */
    public static void requestSync(Context context) {
        Intent intent = new Intent(context, SyncService.class);
        intent.setAction(ACTION_SYNC);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
        else context.startService(intent);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        startForeground(NOTIFICATION_ID, buildNotification("正在与电脑同步", false));
        handler = new Handler(Looper.getMainLooper());
        ticker = new Runnable() {
            @Override
            public void run() {
                pass();
                handler.postDelayed(this, INTERVAL_MS);
            }
        };
        handler.post(ticker);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_SYNC.equals(intent.getAction())) {
            handler.post(this::pass);
        }
        // Not sticky on purpose: a service resurrected after a crash without the
        // activity would sit in the notification shade forever. BootReceiver
        // brings it back on the next boot instead.
        return START_NOT_STICKY;
    }

    /**
     * Runs one pass.
     *
     * A tap-to-sync that arrives while a pass is already running is remembered
     * rather than dropped: the pass in flight may have started before the edit
     * that prompted the tap, so returning immediately would leave that edit on the
     * phone for up to 45 seconds — long enough to close the app and assume it
     * synced.
     */
    private void pass() {
        if (working) {
            pending = true;
            return;
        }
        working = true;
        pending = false;
        new Thread(() -> {
            try {
                SyncEngine.Outcome outcome = SyncEngine.sync(getApplicationContext());
                lastSyncAt = System.currentTimeMillis();
                lastMessage = outcome.ok ? (outcome.merged > 0 ? "已同步 " + outcome.merged + " 处改动" : "已是最新") : outcome.message;
                updateNotification(outcome.ok);
            } finally {
                working = false;
                if (pending) {
                    pending = false;
                    handler.post(this::pass);
                }
            }
        }, "nw-sync").start();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "同步", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("在同一个 Wi-Fi 下自动同步书籍");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification(String text, boolean syncing) {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getActivity(this, 0, open, flags);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL)
            : new Notification.Builder(this);
        return builder
            .setContentTitle("精神空间")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(syncing)
            .setContentIntent(pending)
            .setPriority(Notification.PRIORITY_LOW)
            .build();
    }

    private void updateNotification(boolean ok) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        String text = !ok && lastMessage != null && !lastMessage.isEmpty()
            ? lastMessage
            : (lastSyncAt > 0 ? lastMessage : "等待同步");
        manager.notify(NOTIFICATION_ID, buildNotification(text, false));
    }

    @Override
    public void onDestroy() {
        if (handler != null && ticker != null) handler.removeCallbacks(ticker);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
