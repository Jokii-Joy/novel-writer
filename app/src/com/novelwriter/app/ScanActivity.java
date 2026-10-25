package com.novelwriter.app;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.hardware.Camera;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.common.HybridBinarizer;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;

/**
 * Scans the desktop's pairing code and completes the handshake.
 *
 * Uses the deprecated `android.hardware.Camera` rather than Camera2 on purpose:
 * Camera2 needs a session/state machine and an OpenGL or ImageReader plumbing to
 * get at luminance data, all to decode a code that is held still for two seconds.
 * The legacy API hands us YUV frames directly in a preview callback, which is
 * exactly what ZXing's PlanarYUVLuminanceSource eats.
 *
 * Decoding runs on a worker thread: binarising a 1280x720 frame takes 20-40 ms,
 * and doing that on the UI thread would make the preview stutter visibly.
 */
public final class ScanActivity extends Activity implements SurfaceHolder.Callback, Camera.PreviewCallback {

    private static final int PERMISSION_REQUEST = 21;
    private static final long DECODE_INTERVAL_MS = 220;

    private SurfaceView preview;
    private TextView hint;
    private FrameLayout frame;
    private Camera camera;
    private MultiFormatReader reader;
    private long lastDecodeAt = 0;
    private volatile boolean decoding = false;
    private volatile boolean finished = false;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        frame = new FrameLayout(this);
        frame.setBackgroundColor(Color.BLACK);

        preview = new SurfaceView(this);
        frame.addView(preview, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        preview.getHolder().addCallback(this);

        hint = new TextView(this);
        hint.setText("把电脑上的配对二维码放进框里");
        hint.setTextColor(Color.WHITE);
        hint.setTextSize(14);
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(dp(24), dp(16), dp(24), dp(16));
        hint.setBackgroundColor(0x88000000);
        FrameLayout.LayoutParams hintParams = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        hintParams.gravity = Gravity.BOTTOM;
        frame.addView(hint, hintParams);

        setContentView(frame);

        Map<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);
        hints.put(DecodeHintType.POSSIBLE_FORMATS, EnumSet.of(BarcodeFormat.QR_CODE));
        hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
        reader = new MultiFormatReader();
        reader.setHints(hints);

        if (!hasCameraPermission()) {
            requestPermissions(new String[] {Manifest.permission.CAMERA}, PERMISSION_REQUEST);
        }
    }

    private boolean hasCameraPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        return checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != PERMISSION_REQUEST) return;
        if (grantResults.length == 0 || grantResults[0] != PackageManager.PERMISSION_GRANTED) {
            hint.setText("没有相机权限，无法扫码。可以改为在电脑上手动输入地址。");
        }
    }

    // ------------------------------------------------------------------ camera

    @Override
    public void surfaceCreated(SurfaceHolder holder) {
        if (!hasCameraPermission()) return;
        try {
            camera = Camera.open();
        } catch (Exception error) {
            hint.setText("打不开相机：" + (error.getMessage() == null ? "未知原因" : error.getMessage()));
            return;
        }
        Camera.Parameters params = camera.getParameters();
        params.setPreviewSize(1280, 720);
        params.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
        try {
            camera.setParameters(params);
        } catch (Exception ignored) {
            // Not every device honours 1280x720; the default preview size still
            // scans, it is only slower on a small code.
        }
        try {
            camera.setPreviewDisplay(holder);
        } catch (Exception error) {
            hint.setText("无法把画面输出到屏幕：" + error.getMessage());
            return;
        }
        camera.setPreviewCallback(this);
        camera.startPreview();
    }

    @Override
    public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
        if (camera != null) {
            camera.stopPreview();
            camera.startPreview();
        }
    }

    @Override
    public void surfaceDestroyed(SurfaceHolder holder) {
        releaseCamera();
    }

    private void releaseCamera() {
        if (camera == null) return;
        try {
            camera.setPreviewCallback(null);
            camera.stopPreview();
        } catch (Exception ignored) {
            // Camera already gone (the activity was killed mid-preview).
        }
        camera.release();
        camera = null;
    }

    @Override
    protected void onPause() {
        super.onPause();
        releaseCamera();
    }

    @Override
    public void onPreviewFrame(byte[] data, Camera source) {
        if (data == null || finished || decoding) return;
        long now = System.currentTimeMillis();
        if (now - lastDecodeAt < DECODE_INTERVAL_MS) return;
        lastDecodeAt = now;
        decoding = true;
        Camera.Size size = source.getParameters().getPreviewSize();
        int width = size.width;
        int height = size.height;
        new Thread(() -> decode(data, width, height), "nw-qr").start();
    }

    private void decode(byte[] data, int width, int height) {
        try {
            PlanarYUVLuminanceSource source = new PlanarYUVLuminanceSource(data, width, height, 0, 0, width, height, false);
            BinaryBitmap bitmap = new BinaryBitmap(new HybridBinarizer(source));
            Result result = reader.decodeWithState(bitmap);
            if (result != null && !finished) {
                finished = true;
                String text = result.getText();
                main.post(() -> handlePayload(text));
            }
        } catch (Exception notFound) {
            // NotFoundException is the normal case: most frames have no code yet.
        } finally {
            decoding = false;
        }
    }

    // ---------------------------------------------------------------- pairing

    private void handlePayload(String payload) {
        Uri uri;
        try {
            uri = Uri.parse(payload);
        } catch (Exception error) {
            hint.setText("这个二维码不是配对码");
            finished = false;
            return;
        }
        if (!"nw-pair".equals(uri.getScheme())) {
            hint.setText("这个二维码不是精神空间的配对码");
            finished = false;
            return;
        }
        String token = uri.getQueryParameter("tok");
        String hostId = uri.getQueryParameter("did");
        String hostName = uri.getQueryParameter("name");
        String address = uri.getQueryParameter("addr");
        String portText = uri.getQueryParameter("port");
        if (token == null || token.isEmpty() || address == null || address.isEmpty()) {
            hint.setText("配对码不完整，请在电脑上重新生成");
            finished = false;
            return;
        }
        int port = 41288;
        try {
            if (portText != null) port = Integer.parseInt(portText);
        } catch (NumberFormatException ignored) {
            // Fall back to the default LAN port rather than failing the scan.
        }

        hint.setText("正在与 " + (hostName == null ? "电脑" : hostName) + " 配对…");
        final int finalPort = port;
        final String finalAddress = address;
        new Thread(() -> pair(finalAddress, finalPort, token, hostId, hostName), "nw-pair").start();
    }

    private void pair(String address, int port, String token, String hostId, String hostName) {
        Store store = new Store(getApplicationContext());
        LanClient.Result result = LanClient.accept(address, port, token, store.deviceId(), store.deviceName(), store.publicKey());
        main.post(() -> {
            if (result.ok) {
                String secret = result.data == null ? "" : result.data.optString("secret", "");
                if (secret.isEmpty()) {
                    hint.setText("配对被接受但没有拿到密钥，请重新生成二维码");
                    finished = false;
                    return;
                }
                store.setSecret(secret);
                store.setHost(
                    hostId == null ? (result.data == null ? "" : result.data.optString("deviceId", "")) : hostId,
                    hostName == null ? (result.data == null ? "" : result.data.optString("deviceName", "")) : hostName,
                    address,
                    port);
                store.markSynced();
                // Take the desktop's library as the starting point. Without this
                // the first sync would push an empty phone library and the merge
                // would keep both — a fresh phone would show no books until it
                // was edited on the desktop.
                org.json.JSONObject lib = result.data == null ? null : result.data.optJSONObject("library");
                if (lib != null) store.save(Library.fromJson(lib));
                SyncService.start(getApplicationContext());
                Toast.makeText(this, "配对成功", Toast.LENGTH_SHORT).show();
                setResult(RESULT_OK);
                finish();
                return;
            }
            hint.setText(result.message == null || result.message.isEmpty() ? "配对失败，请重新生成二维码" : result.message);
            finished = false;
        });
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
