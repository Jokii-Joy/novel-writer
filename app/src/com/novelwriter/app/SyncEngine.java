package com.novelwriter.app;

import android.content.Context;

import org.json.JSONObject;

/**
 * The one place that decides "where is the desktop, and can we talk to it".
 *
 * Both the UI (a manual "同步" tap) and the background service call into here, so
 * the reconnect rules live once. The order is deliberate:
 *
 *   1. the address we remembered — the common case, same Wi-Fi as last time;
 *      checked with a cheap GET /nw/v1/ping rather than a full library pull;
 *   2. if that fails, a UDP probe round (the laptop may have a new address);
 *   3. if the sync itself then fails without an answer, probe once more and
 *      retry — a DHCP lease can move between the ping and the push;
 *   4. if that fails too, give up quietly and let the next tick try again.
 *
 * Step 4 is the important one: an unreachable desktop is not an error the user
 * needs to see every 45 seconds. It surfaces only when they press the button.
 */
public final class SyncEngine {

    public static final class Outcome {
        public boolean ok;
        public boolean paired;
        public boolean reachable;
        public String message = "";
        public Library library;
        public int merged = 0;
    }

    /**
     * One sync at a time, process-wide.
     *
     * The background service already serialises its own ticks, but the button on
     * the main screen called `sync()` directly, so a tap landing on a tick ran two
     * lookups at once. They then fought over the same UDP socket and the second
     * answer was "找不到电脑" even though the desktop was fine. Locking here fixes
     * it for every caller instead of asking each one to remember.
     */
    private static final Object LOCK = new Object();

    private SyncEngine() {
    }

    /** How long to spend asking the LAN where the desktop is. */
    private static final long DISCOVERY_TIMEOUT_MS = 6000;

    /** Resolves a working address, updating the stored one when it moved. */
    private static String locate(Store store, boolean allowBeacon) {
        String address = store.hostAddress();
        int port = store.hostPort();
        if (!address.isEmpty() && port > 0) {
            // A GET ping, not a library pull: the old probe downloaded the whole
            // library just to ask "are you there", which on a busy link timed out
            // and made a perfectly reachable desktop look gone.
            LanClient.Result ping = LanClient.ping(address, port);
            if (ping.reachable && ping.ok) {
                // Refuse a stranger: a neighbour's desktop on the same LAN also
                // answers /nw/v1/ping, and syncing into it would be worse than
                // failing. An empty hostId means "paired before we stored one".
                String seen = ping.data == null ? "" : ping.data.optString("deviceId", "");
                String want = store.hostId();
                if (want.isEmpty() || seen.isEmpty() || want.equals(seen)) return address + ":" + port;
            }
        }
        if (!allowBeacon) return "";
        Discovery.Found found = Discovery.listen(store.context(), DISCOVERY_TIMEOUT_MS, store.hostId());
        if (found == null) return "";
        store.updateAddress(found.address, found.port);
        return found.address + ":" + found.port;
    }

    private static String host(String pair) {
        int cut = pair.lastIndexOf(':');
        return cut < 0 ? pair : pair.substring(0, cut);
    }

    private static int port(String pair) {
        int cut = pair.lastIndexOf(':');
        if (cut < 0) return 0;
        try {
            return Integer.parseInt(pair.substring(cut + 1));
        } catch (NumberFormatException error) {
            return 0;
        }
    }

    /**
     * Pushes the local library and stores whatever comes back.
     *
     * The phone never resolves conflicts itself: `mergeLibraries` on the desktop
     * owns the book-level last-write-wins rule, and it can only apply it if it
     * sees both sides. So the phone sends everything it has (tombstones included)
     * and trusts the answer. Doing the merge on both ends would let the two
     * disagree, and a disagreement about a deletion is a resurrected book.
     */
    public static Outcome sync(Context context) {
        synchronized (LOCK) {
            return syncLocked(context);
        }
    }

    private static Outcome syncLocked(Context context) {
        Store store = new Store(context);
        Outcome out = new Outcome();
        out.paired = store.paired();
        if (!out.paired) {
            out.message = "还没有配对";
            return out;
        }
        String pair = locate(store, true);
        if (pair.isEmpty()) {
            out.message = "找不到电脑，确认两台设备在同一个 Wi-Fi";
            return out;
        }
        out.reachable = true;
        Library library = store.library();
        LanClient.Result result = LanClient.sync(host(pair), port(pair), store.deviceId(), store.secret(), library);
        if (!result.ok && !result.reachable) {
            // The ping said yes but the sync itself did not get through: the
            // address is stale after all (a lease can move between the two
            // calls), so look it up again instead of failing on the first try.
            Discovery.Found found = Discovery.listen(store.context(), DISCOVERY_TIMEOUT_MS, store.hostId());
            if (found != null) {
                store.updateAddress(found.address, found.port);
                pair = found.address + ":" + found.port;
                result = LanClient.sync(host(pair), port(pair), store.deviceId(), store.secret(), library);
            }
        }
        if (!result.ok) {
            // A rejected signature means the desktop forgot us (data cleared,
            // re-paired elsewhere). Saying so beats a generic network error the
            // user would keep retrying.
            out.message = "peer-denied".equals(result.code) ? "这台电脑不再认识本机，请重新扫码配对" : (result.message.isEmpty() ? "同步失败" : result.message);
            return out;
        }
        JSONObject data = result.data == null ? null : result.data.optJSONObject("library");
        if (data != null) {
            // Merge rather than replace: the reply was computed before anything
            // typed during this request landed in SharedPreferences.
            out.library = store.mergeSave(Library.fromJson(data));
            JSONObject stats = result.data.optJSONObject("stats");
            out.merged = stats == null ? 0 : stats.optInt("added", 0) + stats.optInt("updated", 0) + stats.optInt("deleted", 0);
        }
        out.ok = true;
        // Stamp each book at the version the desktop just confirmed, so the
        // shelf can say "synced" without another round trip — and can say
        // "pending" the moment a local edit moves a book past that stamp.
        if (out.library != null) store.markBooksSynced(out.library);
        // The service and the button both come through here, so this is the one
        // place that can keep "上次同步" honest for the background path too.
        store.markSynced();
        return out;
    }

    /** Sends one book's change immediately (called right after an edit). */
    public static void pushSoon(Context context) {
        SyncService.requestSync(context);
    }

    // ------------------------------------------- R72: the desktop's model

    /**
     * What one AI request produced.
     *
     * The two verbs answer different shapes and the phone treats them
     * differently: `proofread` is a list of replacements
     * (`{start,end,original,replacement,reason}`) that can be applied, while
     * `revise` is a list of opinions (`{quote,issue,why,advice,example,kind,
     * severity,start,end}`) that are only ever read.
     */
    public static final class AiOutcome {
        public boolean ok;
        public String message = "";
        public String code = "";
        /** The writer pressed ✕; the caller must not treat this as a failure. */
        public boolean canceled;
        /** Blocks whose model reply was empty — "said nothing", not "nothing to fix". */
        public int empty;
        public org.json.JSONArray suggestions;
    }

    /**
     * A lock of its own, not `LOCK`.
     *
     * The sync lock exists to stop two discovery rounds from fighting over the
     * same UDP socket. Sharing it here would be worse than the race it prevents:
     * a model run takes tens of seconds, and holding the sync lock for that long
     * would stall the background service's tick — the phone would stop syncing
     * exactly while the writer is waiting for advice.
     */
    private static final Object AI_LOCK = new Object();

    /** One signed request, with the address and credentials already resolved. */
    private interface AiCall {
        LanClient.Result run(String address, int port, String deviceId, String secret);
    }

    public static AiOutcome proofread(Context context, String text, String mode) {
        return runAi(context, text, "校对", (address, port, deviceId, secret) ->
            LanClient.proofread(address, port, deviceId, secret, text, mode));
    }

    /** R72: 修改建议 — the editorial verb the phone actually shows. */
    public static AiOutcome revise(Context context, String text, String focus, String note, String provider, String model) {
        return runAi(context, text, "点评", (address, port, deviceId, secret) ->
            LanClient.revise(address, port, deviceId, secret, text, focus, note, provider, model));
    }

    /** R72: same request, but reporting per-block progress and cancellable. */
    public static AiOutcome reviseStream(Context context, String text, String focus, String note, String provider, String model, LanClient.Progress progress) {
        return runAi(context, text, "点评", (address, port, deviceId, secret) ->
            LanClient.reviseStream(address, port, deviceId, secret, text, focus, note, provider, model, progress));
    }

    /** Stops the in-flight streaming request (the ✕). */
    public static void cancelAi() {
        LanClient.cancelAi();
    }

    public static void clearCancel() {
        LanClient.clearCancel();
    }

    /** R72: what models this desktop can run right now. */
    public static final class ModelsOutcome {
        public boolean ok;
        public String message = "";
        public org.json.JSONObject data;
    }

    /**
     * The desktop's model list.
     *
     * Its own lock-free path is fine — this is a short host query, not a model
     * run — but it goes through the same resolve/retry dance so "找不到电脑"
     * means the same thing here as it does for a sync.
     */
    public static ModelsOutcome models(Context context) {
        Store store = new Store(context);
        ModelsOutcome out = new ModelsOutcome();
        if (!store.paired()) {
            out.message = "还没有配对电脑";
            return out;
        }
        String pair = locate(store, true);
        if (pair.isEmpty()) {
            out.message = "找不到电脑，确认两台设备在同一个 Wi-Fi";
            return out;
        }
        LanClient.Result result = LanClient.models(host(pair), port(pair), store.deviceId(), store.secret());
        if (!result.ok && !result.reachable) {
            Discovery.Found found = Discovery.listen(store.context(), DISCOVERY_TIMEOUT_MS, store.hostId());
            if (found != null) {
                store.updateAddress(found.address, found.port);
                result = LanClient.models(found.address, found.port, store.deviceId(), store.secret());
            }
        }
        if (!result.ok) {
            out.message = result.message.isEmpty() ? "读取模型列表失败" : result.message;
            return out;
        }
        out.data = result.data;
        out.ok = true;
        return out;
    }

    /**
     * Resolves the desktop, signs, sends, and gives a stale address one second
     * chance.
     *
     * Deliberately not offline-capable: the model, the key and the model picker
     * all live on the desktop. When it is not reachable the honest answer is
     * "现在联系不上电脑", not a fake local checker.
     */
    private static AiOutcome runAi(Context context, String text, String verb, AiCall call) {
        synchronized (AI_LOCK) {
            Store store = new Store(context);
            AiOutcome out = new AiOutcome();
            if (!store.paired()) {
                out.message = "还没有配对电脑，先在桌面插件的「手机同步」里配对";
                return out;
            }
            if (text == null || text.trim().isEmpty()) {
                out.message = "这一章还没有正文";
                return out;
            }
            String pair = locate(store, true);
            if (pair.isEmpty()) {
                out.message = "找不到电脑，确认两台设备在同一个 Wi-Fi";
                return out;
            }
            LanClient.Result result = call.run(host(pair), port(pair), store.deviceId(), store.secret());
            if (!result.ok && !result.reachable) {
                // Same second chance as sync: a DHCP lease can move between the
                // ping and the request, and a model call is too expensive to
                // lose to a stale address.
                Discovery.Found found = Discovery.listen(store.context(), DISCOVERY_TIMEOUT_MS, store.hostId());
                if (found != null) {
                    store.updateAddress(found.address, found.port);
                    result = call.run(found.address, found.port, store.deviceId(), store.secret());
                }
            }
            if (!result.ok) {
                out.code = result.code;
                out.canceled = "canceled".equals(result.code);
                out.message = result.message.isEmpty() ? verb + "失败" : result.message;
                return out;
            }
            out.suggestions = result.data == null ? null : result.data.optJSONArray("suggestions");
            out.empty = result.data == null ? 0 : result.data.optInt("empty", 0);
            out.ok = true;
            return out;
        }
    }
}
