package com.novelwriter.app;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;

/**
 * Finds the desktop without the user typing an IP.
 *
 * Two things happen on the same socket, because one alone is not reliable:
 *
 * 1. **We broadcast a probe and the host answers by unicast, immediately.** The
 *    host also broadcasts a beacon every 10 seconds, but waiting for a tick that
 *    lands at an unknown moment is what made "立即同步" fail the first two or
 *    three times: a 2.5s listen window against a 30s beacon period hit roughly
 *    one time in twelve. Asking turns the wait into a round trip.
 * 2. **We still listen for beacons**, so a host that cannot hear probes (some
 *    APs drop client-to-client broadcast, or the probe races the host's startup)
 *    is still discovered within one beacon period.
 *
 * The socket binds an ephemeral port with SO_REUSEADDR. Binding 41287 — as this
 * class used to — meant two concurrent lookups (the 45s background tick and a
 * tap on "立即同步") collided, the second one threw BindingException and its
 * caller reported "找不到电脑" without the network being at fault.
 */
public final class Discovery {

    public static final int DISCOVERY_PORT = 41287;

    private static final String PROTOCOL = "nw-lansync/1";

    /** How often we re-ask while waiting for an answer. */
    private static final long PROBE_EVERY_MS = 700;

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
     * Waits up to `timeoutMs` for the desktop: probes at once and every
     * {@link #PROBE_EVERY_MS}, and returns as soon as a host answers.
     *
     * Returns null on timeout. Never throws: a network without broadcast (some
     * corporate Wi-Fi) is a normal condition, and the caller then falls back to
     * the address it already stored.
     */
    public static Found listen(Context context, long timeoutMs, String wantId) {
        DatagramSocket socket = null;
        Multicast multicast = Multicast.acquire(context);
        try {
            socket = new DatagramSocket();
            socket.setReuseAddress(true);
            socket.setBroadcast(true);
            socket.setSoTimeout(200);

            byte[] probe = probeBytes();
            List<InetAddress> targets = probeTargets();
            long deadline = System.currentTimeMillis() + Math.max(timeoutMs, PROBE_EVERY_MS);
            long nextProbe = 0;
            byte[] buffer = new byte[4096];

            while (System.currentTimeMillis() < deadline) {
                long now = System.currentTimeMillis();
                if (now >= nextProbe) {
                    sendProbe(socket, probe, targets);
                    nextProbe = now + PROBE_EVERY_MS;
                }
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                try {
                    socket.receive(packet);
                } catch (SocketTimeoutException timeout) {
                    continue;
                }
                Found found = read(packet, wantId);
                if (found != null) return found;
            }
            return null;
        } catch (Exception error) {
            return null;
        } finally {
            if (socket != null) socket.close();
            multicast.release();
        }
    }

    private static byte[] probeBytes() {
        try {
            JSONObject probe = new JSONObject();
            probe.put("protocol", PROTOCOL);
            probe.put("role", "probe");
            probe.put("at", System.currentTimeMillis());
            return probe.toString().getBytes(StandardCharsets.UTF_8);
        } catch (Exception error) {
            return "{\"protocol\":\"nw-lansync/1\",\"role\":\"probe\"}".getBytes(StandardCharsets.UTF_8);
        }
    }

    /**
     * One broadcast plus every interface's directed broadcast.
     *
     * A directed broadcast (e.g. 192.168.1.255) survives access points that drop
     * 255.255.255.255; the limited broadcast survives interfaces whose netmask we
     * could not read. Sending both costs two datagrams.
     */
    private static List<InetAddress> probeTargets() {
        List<InetAddress> targets = new ArrayList<>();
        try {
            targets.add(InetAddress.getByName("255.255.255.255"));
        } catch (Exception error) {
            /* unreachable in practice */
        }
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface card = interfaces.nextElement();
                if (card == null || !card.isUp() || card.isLoopback()) continue;
                for (InterfaceAddress entry : card.getInterfaceAddresses()) {
                    InetAddress broadcast = entry.getBroadcast();
                    if (broadcast != null && !targets.contains(broadcast)) targets.add(broadcast);
                }
            }
        } catch (Exception error) {
            /* fall back to the limited broadcast only */
        }
        return targets;
    }

    private static void sendProbe(DatagramSocket socket, byte[] probe, List<InetAddress> targets) {
        for (InetAddress target : targets) {
            try {
                socket.send(new DatagramPacket(probe, probe.length, target, DISCOVERY_PORT));
            } catch (IOException error) {
                /* one bad interface must not stop the others */
            }
        }
    }

    private static Found read(DatagramPacket packet, String wantId) {
        String text = new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8);
        JSONObject raw;
        try {
            raw = new JSONObject(text);
        } catch (Exception error) {
            return null;
        }
        if (!PROTOCOL.equals(raw.optString("protocol", ""))) return null;
        if (!"host".equals(raw.optString("role", ""))) return null;
        String id = raw.optString("id", "");
        if (wantId != null && !wantId.isEmpty() && !wantId.equals(id)) return null;
        Found found = new Found();
        found.id = id;
        found.name = raw.optString("name", "电脑");
        found.port = raw.optInt("port", 0);
        // Prefer an address on the same subnet as the packet we just got: a
        // laptop advertising its VPN address is useless to a phone on the home
        // Wi-Fi. A unicast answer's source address is the best hint of all, since
        // that is the address the host actually reached us from.
        found.address = pickAddress(raw.optJSONArray("addresses"), packet.getAddress());
        if (found.address.isEmpty() || found.port <= 0) return null;
        return found;
    }

    private static String pickAddress(JSONArray addresses, InetAddress from) {
        String hint = from == null ? "" : from.getHostAddress();
        if (addresses == null || addresses.length() == 0) return hint;
        // A probe answer arrives from the interface that can actually reach us;
        // when the host lists that same address, it is the answer.
        for (int i = 0; i < addresses.length(); i += 1) {
            if (hint != null && !hint.isEmpty() && hint.equals(addresses.optString(i, ""))) return hint;
        }
        String prefix = hint == null ? "" : prefixOf(hint, 2);
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

    /** Kept for callers that want the target list without sending. */
    static List<InetAddress> targets() {
        return Collections.unmodifiableList(probeTargets());
    }
}
