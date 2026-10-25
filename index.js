/**
 * @local/novel-writer — Host half.
 *
 * Registers the HTTP routes the browser half talks to. Every Harness service is
 * optional: if this plugin is mounted in a profile without an LLM or without the
 * web server, the plugin still mounts and reports the missing capability through
 * its own self-test instead of crashing the host.
 *
 * IMPORTANT — why `ctx.inject` and not `ctx.get('webServer')` at mount time:
 * the web carrier (`webServer`) is provided by the `web-runtime` row, which the
 * Loader mounts *after* the ordinary plugin rows. A mount-time read therefore
 * returns `undefined` and the plugin silently registers no routes at all — the
 * browser then sees `404` on GET and `405` on POST (the shell's default handler
 * only admits GET/HEAD) for every method including ping. Injecting the service
 * defers registration to the moment `webServer` really exists, and re-runs it if
 * the carrier is ever replaced. Verified against a live `dsh web` process.
 */
import { registerRoutes } from './lib/routes.js';
import * as lanServer from './lib/lansync-server.js';

export const name = 'novel-writer';
// Kept in step with package.json by hand: `ping` reports this, and a stale value
// makes it impossible to tell which build the running host actually loaded.
export const version = '1.2.0';

/** Diagnostic surface read by `selftest` so a broken mount is visible. */
const state = { registered: false, error: null, mountedAt: 0 };

export function apply(ctx, config) {
  const options = { dataDir: undefined, maxImportBytes: 64 * 1024 * 1024, ...(config || {}) };

  // `webServer` is a hard-ish dependency: available on a web host, absent in CLI
  // one-shot runs. `ctx.inject` keeps the plugin mounted in both cases.
  ctx.inject(['webServer'], (hostCtx) => {
    hostCtx.effect(() => {
      let dispose = () => {};
      try {
        dispose = registerRoutes(hostCtx, { options, state }) || (() => {});
      } catch (error) {
        // A route conflict (another plugin already owns the prefix) must not take
        // the whole Harness down with it.
        state.registered = false;
        state.error = error && error.message ? error.message : String(error);
        console.error('[novel-writer] failed to register routes:', error);
        dispose = () => {};
      }
      state.mountedAt = Date.now();

      // Bring the phone-facing listener up with the plugin.
      //
      // This is a *second* socket on purpose. `webServer` binds 127.0.0.1, so a
      // phone on the same Wi-Fi can never reach the plugin's own HTTP prefix —
      // measured directly: the browser gets 200 from `pair.start`, the phone's
      // SYN to the same port from a LAN address is dropped. The LAN listener
      // exposes only four verbs, and every one of them except `ping` is gated by
      // a pairing token or an HMAC secret, so being reachable is not the same as
      // being open.
      //
      // Failure is never fatal: a port collision or a firewall just means sync is
      // unavailable, and the settings page reports it from `lan.status()`.
      lanServer
        .start()
        .then((result) => {
          if (result && result.ok === false) {
            console.warn('[novel-writer] 局域网同步端口不可用:', result.message);
          }
        })
        .catch((error) => {
          console.warn('[novel-writer] 局域网同步启动失败:', error && error.message ? error.message : error);
        });

      return () => {
        state.registered = false;
        try {
          lanServer.stop();
        } catch (error) {
          console.error('[novel-writer] failed to stop the LAN listener:', error);
        }
        try {
          dispose();
        } catch (error) {
          console.error('[novel-writer] failed to dispose routes:', error);
        }
      };
    }, 'novel-writer:http');
  });
}

/** Exposed for tests/tooling that import this module directly. */
export function _routeState() {
  return { ...state };
}
