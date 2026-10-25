package com.novelwriter.app;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Where the phone keeps the library and the pairing.
 *
 * JSON in SharedPreferences rather than SQLite on purpose: a library of a few
 * hundred thousand characters is a couple of hundred KB, the whole thing is
 * rewritten by every sync anyway (book-level LWW needs both sides whole), and
 * SharedPreferences gives atomic apply() for free. A database would add a schema
 * to migrate for no benefit at this size.
 *
 * The pairing secret is stored in its own preference key, never in the library
 * JSON: the library travels over the LAN and through the sync mirror, and a
 * secret that rides along with the payload it authenticates is a secret that
 * eventually gets logged.
 */
public final class Store {

    private static final String PREFS = "novel-writer";
    private static final String KEY_LIBRARY = "library";
    private static final String KEY_DEVICE_ID = "deviceId";
    private static final String KEY_DEVICE_NAME = "deviceName";
    private static final String KEY_HOST_ID = "hostId";
    private static final String KEY_HOST_NAME = "hostName";
    private static final String KEY_HOST_ADDRESS = "hostAddress";
    private static final String KEY_HOST_PORT = "hostPort";
    private static final String KEY_SECRET = "secret";

    /**
     * One lock for every instance.
     *
     * Each caller news up its own Store (the list, the editor, the sync thread,
     * the service), so a per-instance `synchronized` guarded nothing at all: the
     * UI's load → edit → save and the sync thread's whole-library save raced, and
     * whichever wrote last won. Sharing one object across instances is what makes
     * "read the library, change it, write it back" safe against a concurrent
     * sync write of the same file.
     */
    private static final Object LOCK = new Object();

    private final SharedPreferences prefs;

    public Store(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---------------------------------------------------------------- library

    public Library library() {
        synchronized (LOCK) {
            String raw = prefs.getString(KEY_LIBRARY, "");
            if (raw == null || raw.isEmpty()) return new Library();
            try {
                return Library.fromJson(new org.json.JSONObject(raw));
            } catch (Exception error) {
                // A corrupt blob must not brick the app: an empty library is
                // recoverable by syncing, a crash loop is not.
                return new Library();
            }
        }
    }

    public void save(Library library) {
        synchronized (LOCK) {
            prefs.edit().putString(KEY_LIBRARY, library.toJson().toString()).apply();
        }
    }

    /**
     * Read → change → write, off the UI thread.
     *
     * Parsing the library and serialising it back is O(whole library). Doing that
     * on the main thread every time typing pauses (the editor's 1.2 s save) is a
     * visible hitch on a big library, and it is exactly the kind of work that has
     * no business competing with a scroll. The lock is taken inside the worker, so
     * a sync landing at the same moment still cannot be lost.
     */
    public interface Mutator {
        /** Returns true when something changed and the library must be written. */
        boolean apply(Library library);
    }

    private static final java.util.concurrent.ExecutorService IO =
        java.util.concurrent.Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "nw-store");
            thread.setDaemon(true);
            return thread;
        });

    private static final android.os.Handler MAIN =
        new android.os.Handler(android.os.Looper.getMainLooper());

    public void updateInBackground(Mutator mutator, java.util.function.Consumer<Boolean> done) {
        IO.execute(() -> {
            boolean changed = false;
            synchronized (LOCK) {
                Library current = library();
                changed = mutator.apply(current);
                if (changed) save(current);
            }
            if (done != null) {
                final boolean result = changed;
                MAIN.post(() -> done.accept(result));
            }
        });
    }

    /** Folds a library from the desktop into the stored one, under the lock. */
    public Library mergeSave(Library incoming) {
        if (incoming == null) return library();
        synchronized (LOCK) {
            Library current = library();
            current.mergeIn(incoming);
            save(current);
            return current;
        }
    }

    // --------------------------------------------------------------- identity

    /**
     * The identity every request is signed under.
     *
     * Generated once and then read back, so two threads racing on first launch
     * must not each mint a UUID: whichever lost would have paired with an id the
     * file does not contain, and every later request would be "peer-unknown" with
     * no way out except re-pairing.
     */
    public String deviceId() {
        synchronized (LOCK) {
            String id = prefs.getString(KEY_DEVICE_ID, "");
            if (id == null || id.isEmpty()) {
                id = java.util.UUID.randomUUID().toString();
                prefs.edit().putString(KEY_DEVICE_ID, id).apply();
            }
            return id;
        }
    }

    public String deviceName() {
        synchronized (LOCK) {
            String name = prefs.getString(KEY_DEVICE_NAME, "");
            if (name == null || name.isEmpty()) {
                name = android.os.Build.MODEL == null ? "手机" : android.os.Build.MODEL;
                prefs.edit().putString(KEY_DEVICE_NAME, name).apply();
            }
            return name;
        }
    }

    /**
     * A public key for the pairing handshake.
     *
     * The desktop signs with a real Ed25519 key; Android would need
     * `java.security` key generation plus a PEM bridge, and nothing downstream
     * verifies this value — `verifyPeer` authenticates with the shared secret, not
     * the key. Sending a stable random string keeps the contract's shape (a
     * non-empty publicKey is required to pair) without pretending to a guarantee
     * the protocol does not use.
     */
    public String publicKey() {
        synchronized (LOCK) {
            String key = prefs.getString("publicKey", "");
            if (key == null || key.isEmpty()) {
                byte[] bytes = new byte[32];
                new java.security.SecureRandom().nextBytes(bytes);
                key = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP | android.util.Base64.URL_SAFE);
                prefs.edit().putString("publicKey", key).apply();
            }
            return key;
        }
    }

    // --------------------------------------------------------------- pairing

    public boolean paired() {
        String secret = prefs.getString(KEY_SECRET, "");
        return secret != null && !secret.isEmpty();
    }

    public String secret() {
        return prefs.getString(KEY_SECRET, "");
    }

    public String hostId() {
        return prefs.getString(KEY_HOST_ID, "");
    }

    public String hostName() {
        String name = prefs.getString(KEY_HOST_NAME, "");
        return name == null || name.isEmpty() ? "电脑" : name;
    }

    public int hostPort() {
        return prefs.getInt(KEY_HOST_PORT, 0);
    }

    /**
     * Remembers a host, trying every address it answered on.
     *
     * Stored as a comma-separated list because one desktop usually has several —
     * Wi-Fi, an Ethernet dock, a VPN — and which one works changes with where the
     * laptop is. Keeping the first as "current" keeps the common case (same
     * Wi-Fi) a single connect attempt; the rest are fallbacks for when the user
     * moves the machine.
     */
    public void setHost(String id, String name, String address, int port) {
        prefs.edit()
            .putString(KEY_HOST_ID, id == null ? "" : id)
            .putString(KEY_HOST_NAME, name == null ? "" : name)
            .putString(KEY_HOST_ADDRESS, address == null ? "" : address)
            .putInt(KEY_HOST_PORT, port)
            .apply();
    }

    public String hostAddress() {
        return prefs.getString(KEY_HOST_ADDRESS, "");
    }

    public void setSecret(String secret) {
        prefs.edit().putString(KEY_SECRET, secret == null ? "" : secret).apply();
    }

    public void updateAddress(String address, int port) {
        prefs.edit()
            .putString(KEY_HOST_ADDRESS, address == null ? "" : address)
            .putInt(KEY_HOST_PORT, port)
            .apply();
    }

    /** When this phone last completed a sync — shown on the list header. */
    public long lastSyncAt() {
        return prefs.getLong("lastSyncAt", 0L);
    }

    public void markSynced() {
        prefs.edit().putLong("lastSyncAt", System.currentTimeMillis()).apply();
    }

    // ------------------------------------------------------------- 阅读与显示

    /**
     * The editor's body text size, in sp.
     *
     * 19 sp rather than the 17 this shipped with: 17 is the size of a chat
     * message, not of a page you read for an hour. Kept in preferences so the
     * choice survives the activity, the process and the 白天/黑夜 recreate.
     */
    public float editTextSize() {
        float size = prefs.getFloat("editTextSize", 19f);
        return size < 14f || size > 34f ? 19f : size;
    }

    public void setEditTextSize(float size) {
        prefs.edit().putFloat("editTextSize", size).apply();
    }

    // ---------------------------------------------------------- 书级同步标记

    /**
     * Book id → the updatedAt this phone had *when it last synced that book*.
     *
     * "Did this book sync" cannot be read off the library alone: after an edit the
     * book is simply newer than the mirror, which is also what a book that never
     * synced looks like. Remembering the timestamp at the moment the sync landed
     * turns the comparison into three honest answers — 已同步 / 有改动待同步 /
     * 从未同步 — without adding a field to the wire protocol.
     */
    private org.json.JSONObject syncMarks() {
        String raw = prefs.getString("syncedBooks", "{}");
        try {
            return new org.json.JSONObject(raw == null || raw.isEmpty() ? "{}" : raw);
        } catch (Exception error) {
            return new org.json.JSONObject();
        }
    }

    /** Called once per successful sync, with the merged library. */
    public void markBooksSynced(Library library) {
        if (library == null) return;
        synchronized (LOCK) {
            org.json.JSONObject marks = syncMarks();
            for (Library.Book book : library.books) {
                if (book == null || book.id == null) continue;
                try {
                    marks.put(book.id, book.updatedAt);
                } catch (Exception ignored) {
                    // A single malformed id must not lose the whole map.
                }
            }
            prefs.edit().putString("syncedBooks", marks.toString()).apply();
        }
    }

    public static final int SYNC_NEVER = 0;
    public static final int SYNC_DONE = 1;
    public static final int SYNC_PENDING = 2;

    public int bookSyncState(String bookId, long updatedAt) {
        if (bookId == null || bookId.isEmpty()) return SYNC_NEVER;
        org.json.JSONObject marks = syncMarks();
        if (!marks.has(bookId)) return SYNC_NEVER;
        return marks.optLong(bookId, -1L) == updatedAt ? SYNC_DONE : SYNC_PENDING;
    }

    /**
     * Whether the "let it run in the background" prompt has been shown.
     *
     * Asked once, not on every launch: the permission dialog is dismissible and
     * the battery-optimisation screen is a full-screen system activity, so
     * repeating it on each start would be worse than a sync the user has to nudge
     * by opening the app.
     */
    public boolean backgroundAsked() {
        return prefs.getBoolean("backgroundAsked", false);
    }

    public void markBackgroundAsked() {
        prefs.edit().putBoolean("backgroundAsked", true).apply();
    }

    /**
     * Full unpair: drops the credential, the host identity and the mirror copy.
     *
     * The library stays, on purpose — unpairing is "stop talking to that
     * computer", not "delete my writing". Re-pairing later merges again.
     */
    public void unpair() {
        prefs.edit()
            .remove(KEY_SECRET)
            .remove(KEY_HOST_ID)
            .remove(KEY_HOST_NAME)
            .remove(KEY_HOST_ADDRESS)
            .remove(KEY_HOST_PORT)
            .apply();
    }
}
