package com.novelwriter.app;

import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * The HTTP half of the LAN protocol.
 *
 * Everything here is synchronous and called from a worker thread: the sync
 * service owns a scheduler and the UI only triggers a "sync now". Keeping the
 * client blocking means no callback plumbing, and the one place concurrency
 * matters (two edits racing a sync) is guarded by the store's own lock.
 */
public final class LanClient {

    /** One attempt's outcome. `reachable == false` means "try another address". */
    public static final class Result {
        public boolean ok;
        public boolean reachable;
        public String code = "";
        public String message = "";
        public JSONObject data;
    }

    private static final int CONNECT_TIMEOUT_MS = 4000;
    private static final int READ_TIMEOUT_MS = 15000;
    private static final int PING_READ_TIMEOUT_MS = 4000;

    private LanClient() {
    }

    public static String base64Url(byte[] raw) {
        return Base64.encodeToString(raw, Base64.NO_WRAP | Base64.URL_SAFE | Base64.NO_PADDING);
    }

    /** HMAC-SHA256 of the exact bytes we put in `body`, base64url. */
    public static String sign(String secretBase64Url, String body) {
        try {
            byte[] key = Base64.decode(secretBase64Url, Base64.NO_WRAP | Base64.URL_SAFE | Base64.NO_PADDING);
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return base64Url(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception error) {
            return "";
        }
    }

    private static Result post(String address, int port, String path, JSONObject payload) {
        return call("POST", address, port, path, payload, READ_TIMEOUT_MS);
    }

    private static Result call(String method, String address, int port, String path, JSONObject payload, int readTimeoutMs) {
        Result out = new Result();
        HttpURLConnection connection = null;
        try {
            URL url = new URL("http://" + address + ":" + port + path);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(readTimeoutMs);
            // Never reuse a pooled socket. The desktop closes its keep-alive
            // sockets after 5s, but HttpURLConnection pools them for much longer;
            // reusing one the desktop already dropped throws "unexpected end of
            // stream", which used to be reported as "unreachable" — so the phone
            // went off to UDP discovery and told the user the desktop was gone
            // while it was sitting there answering. Two taps later a fresh socket
            // worked, which matched the "试很多次才行" symptom exactly.
            connection.setRequestProperty("connection", "close");
            if (payload != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("content-type", "application/json; charset=utf-8");
                byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream stream = connection.getOutputStream()) {
                    stream.write(body);
                }
            } else {
                connection.setDoOutput(false);
            }
            int status = connection.getResponseCode();
            String text = read(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
            // Something answered, so the host is up even if the body is unreadable.
            out.reachable = true;
            try {
                out.data = text.isEmpty() ? new JSONObject() : new JSONObject(text);
            } catch (org.json.JSONException error) {
                // Port 41288 with a 200 that is not ours: another service, a
                // proxy, or a captive portal. Reporting "unreachable" here sent
                // the caller off to UDP discovery, which then also failed, and the
                // user was told the desktop could not be found while it was
                // answering on that very address.
                out.data = new JSONObject();
                out.ok = false;
                out.code = "bad-answer";
                out.message = "电脑地址上有一个服务在回应，但不是精神空间（可能端口被别的程序占用）";
                return out;
            }
            out.ok = status == 200 && out.data.optBoolean("ok", false);
            out.code = out.data.optString("code", out.ok ? "" : "http-" + status);
            out.message = out.data.optString("message", "");
            return out;
        } catch (Exception error) {
            // A refused connection is expected while another address is still
            // worth trying; only an answer from the host counts as "reachable".
            out.reachable = false;
            out.code = "unreachable";
            out.message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            return out;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String read(InputStream stream) throws Exception {
        if (stream == null) return "";
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int count;
        while ((count = stream.read(chunk)) > 0) buffer.write(chunk, 0, count);
        stream.close();
        return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
    }

    /**
     * A cheap "are you there?" — one GET, no library, short timeout.
     *
     * Probing used to mean `pull()`, which ships the whole library. On a slow or
     * busy link that read could exceed the timeout, so a desktop that was
     * perfectly reachable looked unreachable, and the caller fell back to
     * broadcast discovery.
     */
    public static Result ping(String address, int port) {
        return call("GET", address, port, "/nw/v1/ping", null, PING_READ_TIMEOUT_MS);
    }

    /** Step 1 of pairing: turn the scanned token into "who is this desktop". */
    public static Result handshake(String address, int port, String token) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("token", token);
            return post(address, port, "/nw/v1/pair/handshake", payload);
        } catch (Exception error) {
            Result out = new Result();
            out.message = error.getMessage() == null ? "握手失败" : error.getMessage();
            return out;
        }
    }

    /** Step 2: post our identity, receive the secret and the desktop's library. */
    public static Result accept(String address, int port, String token, String deviceId, String deviceName, String publicKey) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("token", token);
            payload.put("deviceId", deviceId);
            payload.put("deviceName", deviceName);
            payload.put("publicKey", publicKey);
            payload.put("address", address);
            return post(address, port, "/nw/v1/pair/accept", payload);
        } catch (Exception error) {
            Result out = new Result();
            out.message = error.getMessage() == null ? "配对失败" : error.getMessage();
            return out;
        }
    }

    /**
     * Pushes our library and takes the merged one back.
     *
     * The body is base64url(JSON) and the signature covers exactly that string,
     * which is why both sides can verify without agreeing on a canonical JSON
     * serialiser — a subtlety that would otherwise cost a day of debugging skewed
     * whitespace between Java and JavaScript.
     */
    public static Result sync(String address, int port, String deviceId, String secret, Library library) {
        try {
            String encoded = base64Url(library.toJson().toString().getBytes(StandardCharsets.UTF_8));
            JSONObject payload = new JSONObject();
            payload.put("deviceId", deviceId);
            payload.put("body", encoded);
            payload.put("signature", sign(secret, encoded));
            return post(address, port, "/nw/v1/sync", payload);
        } catch (Exception error) {
            Result out = new Result();
            out.message = error.getMessage() == null ? "同步失败" : error.getMessage();
            return out;
        }
    }

    /** Reads the desktop's mirror without pushing (first sync after pairing). */
    public static Result pull(String address, int port, String deviceId, String secret) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("deviceId", deviceId);
            payload.put("body", "");
            payload.put("signature", sign(secret, ""));
            return post(address, port, "/nw/v1/library", payload);
        } catch (Exception error) {
            Result out = new Result();
            out.message = error.getMessage() == null ? "读取失败" : error.getMessage();
            return out;
        }
    }
}
