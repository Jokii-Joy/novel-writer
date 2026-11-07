package com.novelwriter.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * R72: the 修改建议 run, moved off the Activity and into a foreground service.
 *
 * Why it has to be a service: a model call on a chapter takes one to three
 * minutes. While it runs the writer will put the phone down, switch apps, or
 * press Home — and an Activity-owned thread is exactly what Android kills (or
 * whose result the Activity throws away when it comes back with
 * `isFinishing()`). The symptom the writer reported was precisely that: "the
 * moment I leave this screen it ends".
 *
 * The service owns the request from start to finish and writes its state into
 * `Store.reviseJob()` — a small JSON blob with `running / done / error /
 * canceled`, the block counter, and the advice. The editor reads that blob, so
 * the dialog can disappear and come back without the run noticing.
 *
 * Cancellation is a single explicit action: the ✕ in the dialog (or the
 * notification's 停止 button) sends {@link #ACTION_STOP}. Nothing else stops it.
 * Leaving the app, pressing Back, or rotating does not.
 */
public final class ReviseService extends Service {

    public static final String ACTION_START = "com.novelwriter.app.REVISE_START";
    public static final String ACTION_STOP = "com.novelwriter.app.REVISE_STOP";

    private static final String CHANNEL = "novel-writer-revise";
    private static final int NOTIFICATION_ID = 4132;
    /** The finished-result notification; a different id so it outlives the foreground card. */
    private static final int DONE_ID = 4133;

    private volatile boolean working = false;
    /** The run's start, kept across the progress rewrites so the editor's clock survives a resume. */
    private long jobStartedAt = 0;

    /** Builds the start intent; the extras are the whole request. */
    public static Intent startIntent(Context context, String bookId, String chapterId, String title,
                                     int base, String text, String focus, String note,
                                     String provider, String model, boolean scoped) {
        Intent intent = new Intent(context, ReviseService.class);
        intent.setAction(ACTION_START);
        intent.putExtra("bookId", bookId);
        intent.putExtra("chapterId", chapterId);
        intent.putExtra("title", title == null ? "" : title);
        intent.putExtra("base", base);
        intent.putExtra("text", text);
        intent.putExtra("focus", focus);
        intent.putExtra("note", note);
        intent.putExtra("provider", provider);
        intent.putExtra("model", model);
        intent.putExtra("scoped", scoped);
        return intent;
    }

    public static void begin(Context context, Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
        else context.startService(intent);
    }

    /** The only way to stop a run. */
    public static void stop(Context context) {
        Intent intent = new Intent(context, ReviseService.class);
        intent.setAction(ACTION_STOP);
        try {
            context.startService(intent);
        } catch (Exception ignored) {
            // Service already gone: the request is gone with it.
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        // A foreground service must post within seconds of creation.
        startForeground(NOTIFICATION_ID, buildNotification("准备中…", 0, 0));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_STOP.equals(intent.getAction())) {
            SyncEngine.cancelAi();
            Store store = new Store(this);
            // Keep the identity of the job being stopped: the editor's poller
            // only reacts to a job that names its own chapter, and a bare
            // `canceled` blob would leave the dialog up forever.
            JSONObject current = parse(store.reviseJob());
            if (current != null) {
                put(current, "state", "canceled");
                store.setReviseJob(current);
            }
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!ACTION_START.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (working) {
            // One run at a time — the host enforces it too, with a 429.
            return START_NOT_STICKY;
        }
        working = true;
        jobStartedAt = System.currentTimeMillis();
        runJob(intent);
        return START_NOT_STICKY;
    }

    private void runJob(Intent intent) {
        final String bookId = str(intent.getStringExtra("bookId"));
        final String chapterId = str(intent.getStringExtra("chapterId"));
        final String title = str(intent.getStringExtra("title"));
        final int base = intent.getIntExtra("base", 0);
        final String text = str(intent.getStringExtra("text"));
        final String focus = str(intent.getStringExtra("focus"));
        final String note = str(intent.getStringExtra("note"));
        final String provider = str(intent.getStringExtra("provider"));
        final String model = str(intent.getStringExtra("model"));
        final boolean scoped = intent.getBooleanExtra("scoped", false);
        final Store store = new Store(this);

        new Thread(() -> {
            SyncEngine.clearCancel();
            store.setReviseJob(job("running", intent, 0, 0));
            try {
                SyncEngine.AiOutcome outcome = SyncEngine.reviseStream(
                    getApplicationContext(), text, focus, note, provider, model,
                    (done, total) -> {
                        store.setReviseJob(job("running", intent, done, total));
                        updateNotification("正在读第 " + Math.min(done + 1, Math.max(total, 1)) + " / " + Math.max(total, 1) + " 批…", done, total);
                    });
                // Transport-shaped failure: the streaming path came back empty —
                // one plain request is worth trying before giving up.
                if (!outcome.ok && !outcome.canceled && isTransportFailure(outcome)) {
                    outcome = SyncEngine.revise(getApplicationContext(), text, focus, note, provider, model);
                }
                if (outcome.canceled) {
                    store.setReviseJob(job("canceled", intent, 0, 0));
                    return;
                }
                if (!outcome.ok) {
                    JSONObject failed = job("error", intent, 0, 0);
                    put(failed, "message", outcome.message);
                    put(failed, "code", outcome.code);
                    store.setReviseJob(failed);
                    notifyResult("没有取到建议：" + outcome.message);
                    return;
                }
                JSONArray list = outcome.suggestions;
                JSONObject done = job("done", intent, 1, 1);
                put(done, "advice", list == null ? "[]" : list.toString());
                put(done, "empty", outcome.empty);
                if (scoped) put(done, "base", base);
                store.setReviseJob(done);
                // A second, ordinary notification outlives the foreground one:
                // the writer may be in another app when the advice lands, and
                // the whole point of the service is that they can come back to
                // it. `stopForeground(true)` below clears only the progress card.
                notifyResult(list == null || list.length() == 0
                    ? "读完了，这一遍没有建议"
                    : "建议已就绪：" + list.length() + " 条");
            } catch (Exception error) {
                JSONObject failed = job("error", intent, 0, 0);
                put(failed, "message", error.getMessage() == null ? "运行失败" : error.getMessage());
                store.setReviseJob(failed);
            } finally {
                working = false;
                stopForeground(true);
                stopSelf();
            }
        }, "nw-revise-job").start();
    }

    private static boolean isTransportFailure(SyncEngine.AiOutcome outcome) {
        return outcome != null && !outcome.ok
            && ("bad-answer".equals(outcome.code) || "unreachable".equals(outcome.code) || outcome.code.isEmpty());
    }

    /** The job blob. `advice`/`message` are added by the caller as needed. */
    private JSONObject job(String state, Intent intent, int done, int total) {
        JSONObject out = new JSONObject();
        try {
            out.put("state", state);
            out.put("bookId", str(intent.getStringExtra("bookId")));
            out.put("chapterId", str(intent.getStringExtra("chapterId")));
            out.put("title", str(intent.getStringExtra("title")));
            out.put("base", intent.getIntExtra("base", 0));
            out.put("done", done);
            out.put("total", total);
            out.put("startedAt", jobStartedAt > 0 ? jobStartedAt : System.currentTimeMillis());
        } catch (Exception ignored) {
            /* JSONObject.put throws only on non-finite numbers */
        }
        return out;
    }

    private Intent intentOrCurrent(Intent intent) {
        return intent;
    }

    private static JSONObject parse(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception error) {
            return null;
        }
    }

    private static void put(JSONObject object, String key, Object value) {
        try {
            object.put(key, value);
        } catch (Exception ignored) {
            /* same */
        }
    }

    private static String str(String value) {
        return value == null ? "" : value;
    }

    // ------------------------------------------------------------ notification

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "修改建议", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("正在让电脑读这一章");
        channel.setShowBadge(true);
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification(String text, int done, int total) {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getActivity(this, 0, open, flags);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL)
            : new Notification.Builder(this);
        builder
            .setContentTitle("修改建议")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .setContentIntent(pending)
            .setPriority(Notification.PRIORITY_LOW);
        if (total > 1) builder.setProgress(total, done, false);
        else builder.setProgress(0, 0, true);
        return builder.build();
    }

    private void updateNotification(String text, int done, int total) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        manager.notify(NOTIFICATION_ID, buildNotification(text, done, total));
    }

    /** A dismissible card that survives the run: 「建议已就绪」 while you are elsewhere. */
    private void notifyResult(String text) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getActivity(this, 1, open, flags);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL)
            : new Notification.Builder(this);
        builder
            .setContentTitle("修改建议")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(false)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setPriority(Notification.PRIORITY_DEFAULT);
        manager.notify(DONE_ID, builder.build());
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
