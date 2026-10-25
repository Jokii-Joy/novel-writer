package com.novelwriter.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Pairs with the desktop by typing two lines off its screen.
 *
 * This used to be a camera screen. Scanning turned out to be the fragile half of
 * pairing — autofocus on a 3 cm code, glare, and cameras that report the preview
 * size the code was *not* cropped from — so the form is the default now and the
 * scanner is the fallback. The desktop panel prints both values as text for
 * exactly this reason.
 *
 * Two fields rather than one "nw1:host:port:token" line: on a phone keyboard the
 * colon-separated form is easy to mistype and impossible to correct partially.
 * A pasted full payload still works — it is split in {@link #onPair()}.
 */
public final class PairActivity extends Activity {

    private static final int DEFAULT_PORT = 41288;

    private EditText addressField;
    private EditText tokenField;
    private TextView status;
    private Button pairButton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(color(R.color.nw_paper));
        scroll.setFillViewport(true);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(22), dp(26), dp(22), dp(26));
        scroll.addView(root, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = new TextView(this);
        title.setText("配对电脑");
        title.setTextSize(20);
        title.setTextColor(color(R.color.nw_ink));
        root.addView(title);

        TextView hint = new TextView(this);
        hint.setText("在电脑的插件里打开「设置 → 手机同步 → 显示配对二维码」：二维码下面会列出「电脑地址」和「配对码」。把这两行照着填进来就行，不用管二维码。");
        hint.setTextSize(13);
        hint.setTextColor(color(R.color.nw_soft));
        hint.setPadding(0, dp(10), 0, dp(20));
        root.addView(hint);

        root.addView(label("电脑地址"));
        addressField = new EditText(this);
        addressField.setHint("192.168.1.7:41288");
        addressField.setTextSize(15);
        addressField.setSingleLine(true);
        addressField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        addressField.setTextColor(color(R.color.nw_ink));
        addressField.setHintTextColor(color(R.color.nw_soft));
        root.addView(addressField, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView addressNote = new TextView(this);
        addressNote.setText("只填 IP 也行，端口默认 " + DEFAULT_PORT);
        addressNote.setTextSize(12);
        addressNote.setTextColor(color(R.color.nw_soft));
        addressNote.setPadding(0, 0, 0, dp(16));
        root.addView(addressNote);

        root.addView(label("配对码"));
        tokenField = new EditText(this);
        tokenField.setHint("例如 3xKq9ploB2Z1");
        tokenField.setTextSize(15);
        tokenField.setSingleLine(true);
        tokenField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        tokenField.setTextColor(color(R.color.nw_ink));
        tokenField.setHintTextColor(color(R.color.nw_soft));
        tokenField.setImeOptions(EditorInfo.IME_ACTION_DONE);
        tokenField.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                onPair();
                return true;
            }
            return false;
        });
        root.addView(tokenField, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView tokenNote = new TextView(this);
        tokenNote.setText("配对码 5 分钟后失效，过期就在电脑上重新生成一次。");
        tokenNote.setTextSize(12);
        tokenNote.setTextColor(color(R.color.nw_soft));
        tokenNote.setPadding(0, 0, 0, dp(22));
        root.addView(tokenNote);

        pairButton = new Button(this);
        pairButton.setText("配对");
        pairButton.setTextSize(15);
        pairButton.setTextColor(0xffffffff);
        pairButton.setBackgroundColor(color(R.color.nw_clay));
        pairButton.setOnClickListener(v -> onPair());
        root.addView(pairButton, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        status = new TextView(this);
        status.setTextSize(13);
        status.setTextColor(color(R.color.nw_clay));
        status.setPadding(0, dp(16), 0, dp(8));
        status.setVisibility(android.view.View.GONE);
        root.addView(status);

        Button scan = new Button(this);
        scan.setText("改成扫码");
        scan.setTextSize(13);
        scan.setTextColor(color(R.color.nw_soft));
        scan.setBackgroundColor(0x00000000);
        scan.setOnClickListener(v -> startActivity(new Intent(this, ScanActivity.class)));
        root.addView(scan, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        setContentView(scroll);

        if (getIntent() != null) {
            String seeded = getIntent().getStringExtra("address");
            if (seeded != null && !seeded.isEmpty()) addressField.setText(seeded);
        }
    }

    // --------------------------------------------------------------- pairing

    private void onPair() {
        String typed = Pairing.cleanAddress(addressField.getText() == null ? "" : addressField.getText().toString());
        String token = tokenField.getText() == null ? "" : tokenField.getText().toString().trim();

        // A whole pasted payload is accepted too: nw1:host:port:token. Checking it
        // first means a paste never needs the second field filled in.
        if (typed.startsWith("nw1:")) {
            String[] parts = typed.split(":", 4);
            if (parts.length < 4) {
                fail("这行地址不完整，应该像 nw1:192.168.1.7:41288:配对码");
                return;
            }
            typed = parts[1] + ":" + parts[2];
            if (token.isEmpty()) token = parts[3].trim();
        }
        if (typed.isEmpty()) {
            fail("先填电脑地址，在电脑的配对面板里能看到。");
            return;
        }
        if (token.isEmpty()) {
            fail("还差配对码，在电脑的配对面板里「配对码」那一行。");
            return;
        }

        String host = Pairing.hostOf(typed).trim();
        int port = Pairing.portOf(typed, DEFAULT_PORT);
        if (host.isEmpty()) {
            fail("地址里没有 IP，例如 192.168.1.7:41288");
            return;
        }

        status.setVisibility(android.view.View.VISIBLE);
        status.setTextColor(color(R.color.nw_soft));
        status.setText("正在连 " + host + ":" + port + " …");
        pairButton.setEnabled(false);

        Pairing.run(this, host, port, token, null, null, (ok, message) -> {
            if (isFinishing()) return;
            pairButton.setEnabled(true);
            if (ok) {
                Toast.makeText(this, "配对成功", Toast.LENGTH_SHORT).show();
                setResult(RESULT_OK);
                finish();
                return;
            }
            status.setTextColor(color(R.color.nw_clay));
            status.setText(message);
        });
    }

    private void fail(String message) {
        status.setVisibility(android.view.View.VISIBLE);
        status.setTextColor(color(R.color.nw_clay));
        status.setText(message);
    }

    // ------------------------------------------------------------------ bits

    private TextView label(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(12.5f);
        view.setTextColor(color(R.color.nw_soft));
        view.setPadding(0, dp(4), 0, dp(4));
        return view;
    }

    private int color(int id) {
        return getResources().getColor(id);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
