package com.novelwriter.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
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
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.LuminanceSource;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.common.HybridBinarizer;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
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
    /** Preview size actually granted by the HAL (not the one we asked for). */
    private int previewWidth = 0;
    private int previewHeight = 0;
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
        hint.setText("把电脑上的配对码放进取景框；扫不动就点右边的「手动输入地址」");
        hint.setTextColor(Color.WHITE);
        hint.setTextSize(14);
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(dp(24), dp(16), dp(24), dp(16));
        hint.setBackgroundColor(0x88000000);
        FrameLayout.LayoutParams hintParams = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        hintParams.gravity = Gravity.BOTTOM;
        frame.addView(hint, hintParams);

        // The camera is the fallback, not the only road in: a phone whose camera
        // will not focus on a screen still has to be able to pair.
        Button manual = new Button(this);
        manual.setText("手动输入地址");
        manual.setTextSize(13);
        manual.setTextColor(Color.WHITE);
        manual.setBackgroundColor(0x66000000);
        manual.setOnClickListener(v -> {
            releaseCamera();
            startActivity(new Intent(this, PairActivity.class));
            finish();
        });
        FrameLayout.LayoutParams manualParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        manualParams.gravity = Gravity.BOTTOM | Gravity.END;
        manualParams.rightMargin = dp(12);
        manualParams.bottomMargin = dp(74);
        frame.addView(manual, manualParams);

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

    /**
     * R35 ①: the preview used to come up sideways. The sensor is mounted in
     * landscape, so a phone held upright showed a rotated, stretched picture —
     * the code sat on its side and there was no way to aim. `setDisplayOrientation`
     * is what rotates the preview back; the camera HAL then hands out landscape
     * frames, which is why {@link #decode} also tries the quarter turns.
     */
    private int displayOrientation() {
        int degrees = 0;
        switch (getWindowManager().getDefaultDisplay().getRotation()) {
            case Surface.ROTATION_90:
                degrees = 90;
                break;
            case Surface.ROTATION_180:
                degrees = 180;
                break;
            case Surface.ROTATION_270:
                degrees = 270;
                break;
            default:
                degrees = 0;
                break;
        }
        Camera.CameraInfo info = new Camera.CameraInfo();
        try {
            Camera.getCameraInfo(0, info);
        } catch (Exception ignored) {
            return degrees;
        }
        if (info.facing == Camera.CameraInfo.CAMERA_FACING_FRONT) {
            return (360 - (info.orientation + degrees) % 360) % 360;
        }
        return (info.orientation - degrees + 360) % 360;
    }

    /**
     * 16:9 near 1280x720 if the device offers it, otherwise the closest
     * supported size. Asking for a size the HAL does not know makes
     * `setParameters` throw, and the preview silently keeps the default (often
     * 640x480), which is both blurry and the wrong aspect for the surface.
     */
    private static Camera.Size bestPreviewSize(Camera.Parameters params) {
        List<Camera.Size> sizes = params.getSupportedPreviewSizes();
        if (sizes == null || sizes.isEmpty()) return null;
        Camera.Size best = null;
        double bestScore = Double.MAX_VALUE;
        for (Camera.Size size : sizes) {
            if (size == null || size.width < 640 || size.height < 480) continue;
            if (size.width > 1920 || size.height > 1080) continue;
            double aspect = (double) size.width / (double) size.height;
            double score = Math.abs(aspect - 16.0 / 9.0) * 10.0
                + Math.abs(size.width - 1280) / 1280.0;
            if (score < bestScore) {
                bestScore = score;
                best = size;
            }
        }
        return best;
    }

    private void applyCameraParameters(Camera cam) {
        Camera.Parameters params = cam.getParameters();
        Camera.Size size = bestPreviewSize(params);
        if (size != null) {
            try {
                params.setPreviewSize(size.width, size.height);
            } catch (Exception ignored) {
                // The size disappeared between getParameters and setParameters.
            }
        }
        List<String> focusModes = params.getSupportedFocusModes();
        if (focusModes != null) {
            if (focusModes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE)) {
                params.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
            } else if (focusModes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_VIDEO)) {
                params.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_VIDEO);
            } else if (focusModes.contains(Camera.Parameters.FOCUS_MODE_AUTO)) {
                params.setFocusMode(Camera.Parameters.FOCUS_MODE_AUTO);
            }
        }
        try {
            cam.setParameters(params);
        } catch (Exception ignored) {
            // Keep whatever the HAL chose rather than losing the preview.
        }
    }

    @Override
    public void surfaceCreated(SurfaceHolder holder) {
        if (!hasCameraPermission()) return;
        try {
            camera = Camera.open();
        } catch (Exception error) {
            hint.setText("打不开相机：" + (error.getMessage() == null ? "未知原因" : error.getMessage()));
            return;
        }
        applyCameraParameters(camera);
        Camera.Size granted = camera.getParameters().getPreviewSize();
        previewWidth = granted.width;
        previewHeight = granted.height;
        try {
            camera.setDisplayOrientation(displayOrientation());
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
        if (camera == null) return;
        try {
            camera.stopPreview();
            // The rotation can change between create and change (the activity is
            // not locked, so a user may turn the phone while pairing).
            camera.setDisplayOrientation(displayOrientation());
            camera.startPreview();
        } catch (Exception ignored) {
            // Preview already gone; surfaceDestroyed will release the camera.
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
        int width = previewWidth;
        int height = previewHeight;
        if (width <= 0 || height <= 0) {
            Camera.Size size = source.getParameters().getPreviewSize();
            width = size.width;
            height = size.height;
        }
        int frameWidth = width;
        int frameHeight = height;
        new Thread(() -> decode(data, frameWidth, frameHeight), "nw-qr").start();
    }

    private void decode(byte[] data, int width, int height) {
        try {
            LuminanceSource source = new PlanarYUVLuminanceSource(data, width, height, 0, 0, width, height, false);
            Result result = scan(source);
            // R35 ①: preview frames always arrive in sensor orientation, so the
            // code is lying on its side whenever the phone is upright. ZXing's
            // detector copes with some tilt but not reliably with a quarter turn,
            // so the frame is retried at 90/180/270 before this one is dropped.
            LuminanceSource turned = source;
            for (int i = 0; result == null && i < 3 && turned.isRotateSupported(); i += 1) {
                turned = turned.rotateCounterClockwise();
                result = scan(turned);
            }
            if (result != null && !finished) {
                finished = true;
                String text = result.getText();
                main.post(() -> handlePayload(text));
            }
        } finally {
            decoding = false;
        }
    }

    /** One binarise+detect pass; null means "no code in this frame". */
    private Result scan(LuminanceSource source) {
        try {
            return reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(source)));
        } catch (Exception notFound) {
            // NotFoundException is the normal case: most frames have no code yet.
            return null;
        }
    }

    // ---------------------------------------------------------------- pairing

    private void handlePayload(String payload) {
        // The desktop has always emitted `nw1:HOST:PORT:TOKEN`, while this class
        // used to only understand an `nw-pair://` URI that nothing ever produced —
        // so every scan decoded fine and then answered 「不是配对码」. Both shapes
        // are accepted now, `nw1` first because that is what is on screen.
        String text = payload == null ? "" : payload.trim();
        String token = "";
        String address = "";
        String hostId = null;
        String hostName = null;
        int port = 41288;

        if (text.startsWith("nw1:")) {
            String[] parts = text.split(":", 4);
            if (parts.length < 4) {
                hint.setText("这个配对码不完整，请在电脑上重新生成");
                finished = false;
                return;
            }
            address = parts[1].trim();
            token = parts[3].trim();
            try {
                port = Integer.parseInt(parts[2].trim());
            } catch (NumberFormatException ignored) {
                // Keep the default LAN port: a code without a usable port should
                // still pair on the standard one instead of dying here.
            }
        } else {
            Uri uri;
            try {
                uri = Uri.parse(text);
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
            token = uri.getQueryParameter("tok");
            hostId = uri.getQueryParameter("did");
            hostName = uri.getQueryParameter("name");
            address = uri.getQueryParameter("addr");
            String portText = uri.getQueryParameter("port");
            try {
                if (portText != null) port = Integer.parseInt(portText);
            } catch (NumberFormatException ignored) {
                // Same fallback as above.
            }
        }
        if (token == null) token = "";
        if (address == null) address = "";
        if (token.isEmpty() || address.isEmpty()) {
            hint.setText("配对码不完整，请在电脑上重新生成");
            finished = false;
            return;
        }

        hint.setText("正在与 " + (hostName == null || hostName.isEmpty() ? "电脑" : hostName) + " 配对…");
        final String targetHost = address;
        final int targetPort = port;
        final String targetToken = token;
        Pairing.run(this, targetHost, targetPort, targetToken, hostId, hostName, (ok, message) -> {
            if (isFinishing()) return;
            if (ok) {
                Toast.makeText(this, "配对成功", Toast.LENGTH_SHORT).show();
                setResult(RESULT_OK);
                finish();
                return;
            }
            hint.setText(message);
            finished = false;
        });
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
