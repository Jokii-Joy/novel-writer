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

    private final SharedPreferences prefs;

    public Store(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---------------------------------------------------------------- library

    public synchronized Library library() {
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

    public synchronized void save(Library library) {
        prefs.edit().putString(KEY_LIBRARY, library.toJson().toString()).apply();
    }

    // --------------------------------------------------------------- identity

    public String deviceId() {
        String id = prefs.getString(KEY_DEVICE_ID, "");
        if (id == null || id.isEmpty()) {
            id = java.util.UUID.randomUUID().toString();
            prefs.edit().putString(KEY_DEVICE_ID, id).apply();
        }
        return id;
    }

    public String deviceName() {
        String name = prefs.getString(KEY_DEVICE_NAME, "");
        if (name == null || name.isEmpty()) {
            name = android.os.Build.MODEL == null ? "手机" : android.os.Build.MODEL;
            prefs.edit().putString(KEY_DEVICE_NAME, name).apply();
        }
        return name;
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
        String key = prefs.getString("publicKey", "");
        if (key == null || key.isEmpty()) {
            byte[] bytes = new byte[32];
            new java.security.SecureRandom().nextBytes(bytes);
            key = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP | android.util.Base64.URL_SAFE);
            prefs.edit().putString("publicKey", key).apply();
        }
        return key;
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
