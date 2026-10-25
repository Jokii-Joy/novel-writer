package com.novelwriter.app;

import android.app.Activity;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

/**
 * Turns "address + port + token" into a paired phone — the one place that does it.
 *
 * Both entry points share this: the manual form (the default now that typing
 * proved more reliable than pointing a camera at a screen) and the scanner.
 * The conversation itself is one POST, but every failure needs its own sentence:
 * a refused connection means "wrong Wi-Fi or the desktop has not started the
 * listener", 410 means "that code has expired", and a 200 with no secret means
 * the desktop is half-paired. Leaving that mapping in the UI classes would have
 * duplicated it twice, so it lives here and the activities only render it.
 */
public final class Pairing {

    /** Called on the main thread. `message` is empty exactly when `ok` is true. */
    public interface Callback {
        void done(boolean ok, String message);
    }

    private Pairing() {
    }

    /** Strips the decorations people paste: scheme, spaces, a trailing slash. */
    public static String cleanAddress(String raw) {
        String text = raw == null ? "" : raw.trim();
        if (text.startsWith("http://")) text = text.substring("http://".length());
        if (text.startsWith("https://")) text = text.substring("https://".length());
        while (text.endsWith("/")) text = text.substring(0, text.length() - 1);
        return text.trim();
    }

    /** The port to call when the typed address omits one. */
    public static int portOf(String address, int fallback) {
        int colon = address.lastIndexOf(':');
        if (colon <= 0) return fallback;
        try {
            int port = Integer.parseInt(address.substring(colon + 1).trim());
            return port > 0 && port < 65536 ? port : fallback;
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    /** The host part of "host:port" (or the whole string when there is no port). */
    public static String hostOf(String address) {
        int colon = address.lastIndexOf(':');
        return colon <= 0 ? address : address.substring(0, colon);
    }

    public static void run(Activity activity, final String address, final int port, final String token,
                           final String hostId, final String hostName, final Callback callback) {
        final Context app = activity.getApplicationContext();
        new Thread(() -> {
            boolean ok = false;
            String message = "";
            try {
                Store store = new Store(app);
                LanClient.Result result = LanClient.accept(address, port, token,
                    store.deviceId(), store.deviceName(), store.publicKey());
                if (result.ok) {
                    JSONObject data = result.data == null ? new JSONObject() : result.data;
                    String secret = data.optString("secret", "");
                    if (secret.isEmpty()) {
                        message = "电脑接受了配对，但没有下发密钥。请在电脑上重新生成配对码再试。";
                    } else {
                        store.setSecret(secret);
                        store.setHost(
                            isBlank(hostId) ? data.optString("deviceId", "") : hostId,
                            isBlank(hostName) ? data.optString("deviceName", "") : hostName,
                            address,
                            port);
                        // Fold the desktop's shelf in instead of replacing the
                        // stored one. Replacing is the obvious first sync, and it
                        // is also how a phone that wrote offline — or was unpaired
                        // for a while — loses those books: they are not in the
                        // reply, so they would never be pushed either.
                        JSONObject library = data.optJSONObject("library");
                        if (library != null) store.mergeSave(Library.fromJson(library));
                        SyncService.start(app);
                        ok = true;
                    }
                } else if (!result.reachable) {
                    message = "连不上 " + address + ":" + port
                        + "。确认手机和电脑连的是同一个 Wi-Fi，并且电脑上的「手机同步」已经打开。";
                } else if ("pair-denied".equals(result.code) || "pair-expired".equals(result.code)) {
                    message = "配对码不对，或者已经过期（有效期 5 分钟）。请在电脑上重新生成，再抄一次。";
                } else {
                    message = isBlank(result.message) ? "配对失败" : result.message;
                }
            } catch (Exception error) {
                message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            }
            final boolean finalOk = ok;
            final String finalMessage = message;
            new Handler(Looper.getMainLooper()).post(() -> callback.done(finalOk, finalMessage));
        }, "nw-pair").start();
    }

    private static boolean isBlank(String text) {
        return text == null || text.trim().isEmpty();
    }
}
