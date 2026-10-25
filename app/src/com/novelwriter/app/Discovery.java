package com.novelwriter.app;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;

/**
 * Finds the desktop without the user typing an IP.
 *
 * The host broadcasts a small JSON beacon on UDP 41287 every 30 seconds (and
 * once right after it starts), listing the device id and every address it thinks
 * it has. Listening is enough — no mDNS, no discovery library, no service
 * registration, which is why this is 100 lines instead of a dependency.
 *
 * Why a beacon at all when pairing already carried an address: laptops move
 * between Wi-Fi networks and docks, so the address in `peers.json` goes stale.
 * Scanning the QR again every time the user opens the laptop would make pairing
 * feel broken; the beacon lets the phone notice "same device, new address" and
 * update in place.
 */
public final class Discovery {

    public static final int DISCOVERY_PORT = 41287;

    /** What a beacon told us. */
    public static final class Found {
        public String id;
        public String name;
        public int port;
        public String address;
    }

    private Discovery() {
    }

    /**
     * Waits up to `timeoutMs` for a beacon from `wantId` (or any host when null).
     *
     * Returns null on timeout. Never throws: a network without broadcast (some
     * corporate Wi-Fi) is a normal condition, and the caller then falls back to
     * the address it already stored.
     */
    public static Found listen(long timeoutMs, String wantId) {
        DatagramSocket socket = null;
        try {
            socket = new DatagramSocket(DISCOVERY_PORT);
            socket.setBroadcast(true);
            socket.setSoTimeout(600);
            long deadline = System.currentTimeMillis() + timeoutMs;
            byte[] buffer = new byte[2048];
            while (System.currentTimeMillis() < deadline) {
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                try {
                    socket.receive(packet);
                } catch (SocketTimeoutException timeout) {
                    continue;
                }
                String text = new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8);
                JSONObject raw;
                try {
                    raw = new JSONObject(text);
                } catch (Exception error) {
                    continue;
                }
                if (!"nw-lansync/1".equals(raw.optString("protocol", ""))) continue;
                if (!"host".equals(raw.optString("role", ""))) continue;
                String id = raw.optString("id", "");
                if (wantId != null && !wantId.isEmpty() && !wantId.equals(id)) continue;
                Found found = new Found();
                found.id = id;
                found.name = raw.optString("name", "电脑");
                found.port = raw.optInt("port", 0);
                // Prefer an address on the same subnet as the packet we just got:
                // a laptop advertising its VPN address is useless to a phone on
                // the home Wi-Fi.
                found.address = pickAddress(raw.optJSONArray("addresses"), packet.getAddress());
                if (found.address.isEmpty() || found.port <= 0) continue;
                return found;
            }
            return null;
        } catch (Exception error) {
            return null;
        } finally {
            if (socket != null) socket.close();
        }
    }

    private static String pickAddress(JSONArray addresses, InetAddress from) {
        if (addresses == null || addresses.length() == 0) return from == null ? "" : from.getHostAddress();
        String prefix = from == null ? "" : prefixOf(from.getHostAddress(), 2);
        String fallback = "";
        for (int i = 0; i < addresses.length(); i += 1) {
            String address = addresses.optString(i, "");
            if (address.isEmpty()) continue;
            if (fallback.isEmpty()) fallback = address;
            if (!prefix.isEmpty() && prefixOf(address, 2).equals(prefix)) return address;
        }
        return fallback;
    }

    private static String prefixOf(String address, int octets) {
        if (address == null) return "";
        String[] parts = address.split("\\.");
        if (parts.length < octets) return "";
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < octets; i += 1) {
            if (i > 0) out.append('.');
            out.append(parts[i]);
        }
        return out.toString();
    }
}
