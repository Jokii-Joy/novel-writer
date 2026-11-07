package com.novelwriter.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
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
    private TextView subtitleLine;
    private View emptyState;
    private TextView emptyHint;
    /**
     * Book id → {updatedAt, 字数}, so a redraw does not recount every chapter of
     * every book. Invalidated by the timestamp it was computed from, which is
     * exactly what changes when the text does.
     */
    private final java.util.Map<String, long[]> wordCache = new java.util.HashMap<>();

    /** Repaints the two status lines while the shelf is on screen. */
    private final Handler ticker = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            refreshStatus();
            ticker.postDelayed(this, 5000);
        }
    };

    /** R38: the night/resources override has to be in place before any view. */
    @Override
    protected void attachBaseContext(Context base) {
        super.attachBaseContext(Skin.wrap(base));
    }

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
        if (store.paired()) {
            SyncService.start(this);
            // R72: a manual tap is no longer how a returning writer catches up —
            // opening the shelf is. The service would get here within 45 s anyway;
            // doing it now is what makes the app feel connected rather than merely
            // capable of connecting.
            SyncService.requestSync(this);
        }
        // One number — 「上次同步」 — changes underneath us while the service works.
        // Refreshing it every 5 s is cheaper than wiring the activity to the
        // service, and it means the line is never stale in the user's hands.
        ticker.removeCallbacks(tick);
        ticker.post(tick);
    }

    @Override
    protected void onPause() {
        ticker.removeCallbacks(tick);
        super.onPause();
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
        header.setPadding(dp(20), dp(20), dp(14), dp(12));

        // Title and one honest line under it: which desktop this shelf is
        // attached to is the first thing a writer checks after opening the app.
        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);

        TextView title = new TextView(this);
        title.setText("精神空间");
        title.setTextSize(26);
        title.setLetterSpacing(0.02f);
        title.setTypeface(Typeface.create("serif", Typeface.BOLD));
        title.setTextColor(color(R.color.nw_ink));
        titles.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setTextSize(11.5f);
        subtitle.setTextColor(color(R.color.nw_soft));
        subtitle.setPadding(0, dp(3), 0, 0);
        titles.addView(subtitle);
        subtitleLine = subtitle;
        header.addView(titles, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        // R38 ⑤: 白天 / 黑夜. A glyph rather than a label so it does not compete
        // with ＋; the content description carries the meaning for TalkBack.
        Button skin = new Button(this);
        skin.setText(Skin.night(this) ? "☀" : "☾");
        skin.setTextSize(18);
        skin.setContentDescription("切换白天黑夜");
        skin.setTextColor(color(R.color.nw_ink));
        skin.setBackgroundResource(R.drawable.nw_touch_pill);
        skin.setPadding(0, 0, 0, 0);
        skin.setMinWidth(dp(40));
        skin.setMinimumWidth(dp(40));
        skin.setOnClickListener(v -> {
            Skin.toggle(this);
            // Recreate instead of repainting: every colour already comes from a
            // resource, so a new activity picks up the other palette for free.
            recreate();
        });
        header.addView(skin);

        // R72: the shelf's one primary action is a clay disc, not a ＋ floating in
        // the title row — on a phone the plus was the least visible thing on screen
        // while being the only way to start writing.
        Button add = new Button(this);
        add.setText("＋");
        add.setTextSize(22);
        add.setAllCaps(false);
        add.setIncludeFontPadding(false);
        add.setPadding(0, 0, 0, 0);
        add.setTextColor(color(R.color.nw_on_clay));
        add.setBackgroundResource(R.drawable.nw_fab);
        add.setContentDescription("新建书");
        add.setOnClickListener(v -> promptNewBook());
        LinearLayout.LayoutParams fab = new LinearLayout.LayoutParams(dp(44), dp(44));
        fab.setMargins(dp(10), 0, 0, 0);
        add.setLayoutParams(fab);
        header.addView(add);
        root.addView(header);

        // ---- sync row
        LinearLayout syncRow = new LinearLayout(this);
        syncRow.setOrientation(LinearLayout.HORIZONTAL);
        syncRow.setGravity(Gravity.CENTER_VERTICAL);
        syncRow.setPadding(dp(18), 0, dp(12), dp(10));

        statusLine = new TextView(this);
        statusLine.setTextSize(12);
        statusLine.setTextColor(color(R.color.nw_soft));
        statusLine.setLineSpacing(dp(2), 1f);
        syncRow.addView(statusLine, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        // R72: sync is automatic; the button is a "catch up now" for the case where
        // the writer wants to see it happen, not the way it normally works. It is
        // therefore a quiet text button, while 配对/已配对 keeps the clay accent.
        Button syncBtn = textButton("立即同步", R.color.nw_soft);
        syncBtn.setOnClickListener(v -> manualSync());
        syncRow.addView(syncBtn);

        Button pairBtn = textButton(store.paired() ? "已配对" : "配对", R.color.nw_clay);
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
        LinearLayout empty = new LinearLayout(this);
        empty.setOrientation(LinearLayout.VERTICAL);
        empty.setGravity(Gravity.CENTER_HORIZONTAL);
        empty.setPadding(dp(28), dp(52), dp(28), dp(28));

        TextView emptyTitle = new TextView(this);
        emptyTitle.setText("书架还是空的");
        emptyTitle.setTextSize(17);
        emptyTitle.setTypeface(Typeface.create("serif", Typeface.NORMAL));
        emptyTitle.setTextColor(color(R.color.nw_ink));
        empty.addView(emptyTitle);

        emptyHint = new TextView(this);
        emptyHint.setText("在电脑上配对后，书会自动同步过来；也可以就在这里写第一本。");
        emptyHint.setTextSize(13.5f);
        emptyHint.setTextColor(color(R.color.nw_soft));
        emptyHint.setGravity(Gravity.CENTER);
        emptyHint.setLineSpacing(dp(3), 1f);
        emptyHint.setPadding(0, dp(10), 0, dp(18));
        empty.addView(emptyHint);

        Button first = new Button(this);
        first.setText("新建第一本书");
        first.setAllCaps(false);
        first.setTextSize(14);
        first.setTextColor(color(R.color.nw_on_clay));
        first.setBackgroundResource(R.drawable.nw_button_clay);
        first.setPadding(dp(20), dp(10), dp(20), dp(10));
        first.setOnClickListener(v -> promptNewBook());
        empty.addView(first);

        empty.setVisibility(View.GONE);
        listBox.addView(empty);
        emptyState = empty;

        setContentView(root);
        Skin.applyBars(this);
    }

    private void render() {
        listBox.removeAllViews();
        Library library = store.library();
        List<Library.Book> books = library.visibleBooks();
        emptyState.setVisibility(books.isEmpty() ? View.VISIBLE : View.GONE);
        if (books.isEmpty()) listBox.addView(emptyState);

        for (Library.Book book : books) listBox.addView(bookRow(book));

        refreshStatus();
        // A quiet cross-fade instead of a hard swap: the shelf is redrawn after
        // every edit, and a hard swap on resume is the flash that made coming back
        // to the app feel janky.
        listBox.setAlpha(0f);
        listBox.animate().alpha(1f).setDuration(140).start();
    }

    /**
     * The two status lines above the shelf.
     *
     * Called from `render` and from the 5 s ticker, so it must stay allocation-
     * light and must not touch the list. Reading `markSynced()`'s timestamp is how
     * the background service's work becomes visible without the activity having to
     * observe the service: the number simply changes under it.
     */
    private void refreshStatus() {
        if (subtitleLine != null) {
            subtitleLine.setText(store.paired()
                ? "书房 · 与「" + hostLabel() + "」相连"
                : "书房 · 还没有连接电脑");
        }
        if (statusLine == null) return;
        if (!store.paired()) {
            statusLine.setText("未配对 · 打开电脑插件的「手机同步」，把地址和配对码填进来");
            return;
        }
        long at = store.lastSyncAt();
        if (at <= 0) statusLine.setText("自动同步已开启 · 还没有同步过");
        else statusLine.setText("自动同步已开启 · " + ago(at) + "同步过");
    }

    private String hostLabel() {
        String name = store.hostName();
        return name == null || name.isEmpty() ? "电脑" : name;
    }

    /** "刚刚" / "3 分钟前" / "12:03" / "10-31 12:03" — never a raw timestamp. */
    private String ago(long at) {
        long delta = Math.max(0, System.currentTimeMillis() - at);
        if (delta < 45_000) return "刚刚";
        if (delta < 3_600_000) return (delta / 60_000) + " 分钟前";
        String pattern = delta < 86_400_000 ? "HH:mm" : "MM-dd HH:mm";
        return new SimpleDateFormat(pattern, Locale.CHINA).format(new Date(at)) + " ";
    }

    /** A text-only button with pill feedback, used by the header and sync row. */
    private Button textButton(String label, int colorRes) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(12.5f);
        button.setAllCaps(false);
        button.setTextColor(color(colorRes));
        button.setBackgroundResource(R.drawable.nw_touch_pill);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        button.setPadding(dp(10), dp(4), dp(10), dp(4));
        return button;
    }

    private View bookRow(Library.Book book) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(dp(16), dp(14), dp(16), dp(14));
        row.setBackgroundResource(R.drawable.nw_card_touch);
        // A one-dip lift is what separates the card from the paper behind it; a
        // bigger elevation on a full-width row reads as a floating dialog.
        row.setElevation(dp(1));

        TextView name = new TextView(this);
        name.setText(book.title == null || book.title.isEmpty() ? "未命名" : book.title);
        name.setTextSize(17);
        name.setTypeface(Typeface.create("serif", Typeface.NORMAL));
        name.setTextColor(color(R.color.nw_ink));
        row.addView(name);

        long[] cached = wordCache.get(book.id);
        if (cached == null || cached[0] != book.updatedAt) {
            int words = 0;
            for (Library.Chapter chapter : book.chapters) words += Library.words(chapter.content);
            cached = new long[] {book.updatedAt, words};
            wordCache.put(book.id, cached);
        }
        TextView meta = new TextView(this);
        meta.setText(book.chapters.size() + " 章 · " + cached[1] + " 字 · " + new SimpleDateFormat("MM-dd HH:mm", Locale.CHINA).format(new Date(book.updatedAt)));
        meta.setTextSize(12);
        meta.setTextColor(color(R.color.nw_soft));
        meta.setPadding(0, dp(4), 0, 0);
        row.addView(meta);

        // R38 ④: per-book sync state. Only meaningful while paired — an unpaired
        // phone has no mirror to be behind, and saying 「未同步」 on every row
        // before the first pairing would read as an error.
        if (store.paired()) {
            int state = store.bookSyncState(book.id, book.updatedAt);
            TextView tag = new TextView(this);
            tag.setText(state == Store.SYNC_DONE ? "已同步" : state == Store.SYNC_PENDING ? "有改动待同步" : "还没有同步过");
            tag.setTextSize(11);
            tag.setTextColor(state == Store.SYNC_PENDING ? color(R.color.nw_clay) : color(R.color.nw_soft));
            tag.setPadding(0, dp(2), 0, 0);
            row.addView(tag);
        }

        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(dp(2), 0, dp(2), dp(10));
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
