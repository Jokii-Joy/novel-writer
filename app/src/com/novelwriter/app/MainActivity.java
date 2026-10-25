package com.novelwriter.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * The book list.
 *
 * Views are built in code rather than XML: the whole screen is one scroll of
 * rows, and keeping the layout next to the data means a row's structure and the
 * fields it reads cannot drift apart. It also keeps the APK to a single dex.
 *
 * Colour and spacing mirror the desktop's warm-paper theme so the two do not look
 * like different products (values live in res/values/colors.xml).
 */
public final class MainActivity extends Activity {

    private Store store;
    private LinearLayout listBox;
    private TextView statusLine;
    private TextView emptyHint;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        store = new Store(this);
        buildUi();
        if (!store.backgroundAsked()) {
            store.markBackgroundAsked();
            // Posted so the dialog appears over a drawn screen rather than during
            // the first frame.
            new Handler(Looper.getMainLooper()).postDelayed(this::askForBackgroundPermissions, 400);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        render();
        if (store.paired()) SyncService.start(this);
    }

    private int color(int id) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) return getColor(id);
        return getResources().getColor(id);
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(color(R.color.nw_paper));

        // ---- header
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(18), dp(18), dp(12), dp(10));

        TextView title = new TextView(this);
        title.setText("精神空间");
        title.setTextSize(23);
        title.setTypeface(Typeface.create("serif", Typeface.BOLD));
        title.setTextColor(color(R.color.nw_ink));
        header.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        Button add = new Button(this);
        add.setText("＋");
        add.setTextSize(20);
        add.setTextColor(color(R.color.nw_clay));
        add.setBackgroundColor(Color.TRANSPARENT);
        add.setOnClickListener(v -> promptNewBook());
        header.addView(add);
        root.addView(header);

        // ---- sync row
        LinearLayout syncRow = new LinearLayout(this);
        syncRow.setOrientation(LinearLayout.HORIZONTAL);
        syncRow.setGravity(Gravity.CENTER_VERTICAL);
        syncRow.setPadding(dp(18), 0, dp(12), dp(10));

        statusLine = new TextView(this);
        statusLine.setTextSize(12.5f);
        statusLine.setTextColor(color(R.color.nw_soft));
        syncRow.addView(statusLine, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        Button syncBtn = new Button(this);
        syncBtn.setText("同步");
        syncBtn.setTextSize(12.5f);
        syncBtn.setTextColor(color(R.color.nw_ink));
        syncBtn.setBackgroundColor(Color.TRANSPARENT);
        syncBtn.setOnClickListener(v -> manualSync());
        syncRow.addView(syncBtn);

        Button pairBtn = new Button(this);
        pairBtn.setTextSize(12.5f);
        pairBtn.setTextColor(color(R.color.nw_clay));
        pairBtn.setBackgroundColor(Color.TRANSPARENT);
        pairBtn.setText(store.paired() ? "已配对" : "配对");
        pairBtn.setOnClickListener(v -> {
            if (store.paired()) confirmUnpair();
            else openPairing();
        });
        syncRow.addView(pairBtn);
        root.addView(syncRow);

        // ---- list
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        listBox = new LinearLayout(this);
        listBox.setOrientation(LinearLayout.VERTICAL);
        listBox.setPadding(dp(12), 0, dp(12), dp(24));
        scroll.addView(listBox, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        // ---- empty state (sits under the list, toggled in render)
        emptyHint = new TextView(this);
        emptyHint.setText("还没有书。点右上角 ＋ 新建，或者在电脑上配对后自动同步。");
        emptyHint.setTextSize(14);
        emptyHint.setTextColor(color(R.color.nw_soft));
        emptyHint.setGravity(Gravity.CENTER);
        emptyHint.setPadding(dp(32), dp(40), dp(32), dp(40));
        emptyHint.setVisibility(View.GONE);
        listBox.addView(emptyHint);

        setContentView(root);
    }

    private void render() {
        listBox.removeAllViews();
        Library library = store.library();
        List<Library.Book> books = library.visibleBooks();
        emptyHint.setVisibility(books.isEmpty() ? View.VISIBLE : View.GONE);
        if (books.isEmpty()) listBox.addView(emptyHint);

        for (Library.Book book : books) listBox.addView(bookRow(book));

        if (!store.paired()) {
            statusLine.setText("未配对 · 在电脑插件里打开「手机同步」，把地址和配对码填进手机");
        } else {
            long at = store.lastSyncAt();
            String host = store.hostName();
            statusLine.setText(at > 0
                ? "已连接 " + host + " · " + new SimpleDateFormat("HH:mm", Locale.CHINA).format(new Date(at)) + " 同步过"
                : "已配对 " + host + " · 尚未同步");
        }
    }

    private View bookRow(Library.Book book) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(dp(14), dp(13), dp(14), dp(13));
        row.setBackgroundColor(Color.WHITE);

        TextView name = new TextView(this);
        name.setText(book.title == null || book.title.isEmpty() ? "未命名" : book.title);
        name.setTextSize(17);
        name.setTypeface(Typeface.create("serif", Typeface.NORMAL));
        name.setTextColor(color(R.color.nw_ink));
        row.addView(name);

        int words = 0;
        for (Library.Chapter chapter : book.chapters) {
            String text = chapter.content == null ? "" : chapter.content;
            words += text.replaceAll("\\s", "").length();
        }
        TextView meta = new TextView(this);
        meta.setText(book.chapters.size() + " 章 · " + words + " 字 · " + new SimpleDateFormat("MM-dd HH:mm", Locale.CHINA).format(new Date(book.updatedAt)));
        meta.setTextSize(12);
        meta.setTextColor(color(R.color.nw_soft));
        meta.setPadding(0, dp(4), 0, 0);
        row.addView(meta);

        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, 0, 0, dp(8));
        row.setLayoutParams(params);

        row.setOnClickListener(v -> openBook(book));
        row.setOnLongClickListener(v -> {
            bookMenu(book);
            return true;
        });
        return row;
    }

    private void openBook(Library.Book book) {
        Intent intent = new Intent(this, EditActivity.class);
        intent.putExtra("bookId", book.id);
        startActivity(intent);
    }

    private void bookMenu(Library.Book book) {
        String[] items = {"重命名", "删除"};
        new AlertDialog.Builder(this)
            .setTitle(book.title)
            .setItems(items, (dialog, which) -> {
                if (which == 0) promptRename(book);
                else confirmDelete(book);
            })
            .show();
    }

    private void promptNewBook() {
        EditText input = new EditText(this);
        input.setHint("书名");
        new AlertDialog.Builder(this)
            .setTitle("新建书")
            .setView(input)
            .setPositiveButton("创建", (dialog, which) -> {
                String title = input.getText().toString().trim();
                if (title.isEmpty()) title = "未命名";
                Library library = store.library();
                library.books.add(Library.createBook(title));
                store.save(library);
                render();
                SyncEngine.pushSoon(this);
            })
            .setNegativeButton("取消", null)
            .show();
    }

    private void promptRename(Library.Book book) {
        EditText input = new EditText(this);
        input.setText(book.title);
        new AlertDialog.Builder(this)
            .setTitle("重命名")
            .setView(input)
            .setPositiveButton("保存", (dialog, which) -> {
                Library library = store.library();
                Library.Book target = library.find(book.id);
                if (target == null) return;
                target.title = input.getText().toString().trim();
                target.touch();
                store.save(library);
                render();
                SyncEngine.pushSoon(this);
            })
            .setNegativeButton("取消", null)
            .show();
    }

    private void confirmDelete(Library.Book book) {
        new AlertDialog.Builder(this)
            .setTitle("删除《" + book.title + "》？")
            .setMessage("会一并从电脑上删除。这是同步删除，不是本地隐藏。")
            .setPositiveButton("删除", (dialog, which) -> {
                Library library = store.library();
                // Tombstone, not removal: a row that vanishes looks identical to
                // "never had it" and the desktop would send it back on the next
                // sync (the resurrection case in the spec).
                library.tombstone(library.find(book.id));
                store.save(library);
                render();
                SyncEngine.pushSoon(this);
            })
            .setNegativeButton("取消", null)
            .show();
    }

    private void manualSync() {
        if (!store.paired()) {
            openPairing();
            return;
        }
        statusLine.setText("正在同步…");
        new Thread(() -> {
            SyncEngine.Outcome outcome = SyncEngine.sync(getApplicationContext());
            runOnUiThread(() -> {
                if (outcome.ok) {
                    store.markSynced();
                    render();
                    Toast.makeText(this, outcome.merged > 0 ? "已同步 " + outcome.merged + " 处改动" : "已是最新", Toast.LENGTH_SHORT).show();
                } else {
                    statusLine.setText(outcome.message);
                    Toast.makeText(this, outcome.message, Toast.LENGTH_LONG).show();
                }
            });
        }, "nw-manual-sync").start();
    }

    /** Pairing starts with typed values now; the camera is the fallback. */
    private void openPairing() {
        startActivity(new Intent(this, PairActivity.class));
    }

    private void confirmUnpair() {
        new AlertDialog.Builder(this)
            .setTitle("解除配对？")
            .setMessage("解除后这台手机不再同步到那台电脑，本地书籍保留。下次需要重新扫码。")
            .setPositiveButton("解除", (dialog, which) -> {
                store.unpair();
                SyncService.stop(this);
                render();
            })
            .setNegativeButton("取消", null)
            .show();
    }

    /**
     * First-run housekeeping the user cannot skip silently: without the
     * notification permission the foreground service is invisible, and without a
     * battery-optimisation exemption Chinese OEM ROMs kill it within minutes. Both
     * dialogs are dismissible — the app still works with the screen on.
     */
    private void askForBackgroundPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {"android.permission.POST_NOTIFICATIONS"}, 41);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
            if (power != null && !power.isIgnoringBatteryOptimizations(getPackageName())) {
                new AlertDialog.Builder(this)
                    .setTitle("允许后台同步")
                    .setMessage("为了让手机和电脑随时保持一致，需要在系统设置里允许本应用在后台运行、并关闭电池优化。")
                    .setPositiveButton("去设置", (dialog, which) -> {
                        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                        intent.setData(Uri.parse("package:" + getPackageName()));
                        try {
                            startActivity(intent);
                        } catch (Exception ignored) {
                            startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                        }
                    })
                    .setNegativeButton("稍后", null)
                    .show();
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 41) askForBackgroundPermissions();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
