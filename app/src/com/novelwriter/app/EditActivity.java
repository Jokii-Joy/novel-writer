package com.novelwriter.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

/**
 * Chapter list + the chapter editor for one book.
 *
 * Two modes in one activity (list, then editor) instead of two activities:
 * pressing back from the editor should land on the chapter list of the same book,
 * and a second activity would have to re-read the library anyway to know which
 * book it came from.
 *
 * Saving: the text field writes into the in-memory library on every keystroke and
 * the library is flushed to SharedPreferences on pause and after a 1.2 s idle
 * window — the same 1.2 s debounce the desktop uses, so "when is it saved" means
 * the same thing on both sides.
 */
public final class EditActivity extends Activity {

    private static final long SAVE_DELAY_MS = 1200L;

    private Store store;
    private String bookId;
    private LinearLayout root;
    private boolean editing = false;

    private EditText bodyField;
    /**
     * The editor scrolls, the text field does not.
     *
     * A scrollable EditText scrolls *itself*: every drag moves the whole layout
     * (and Android re-runs parts of the text layout on each move), which is what
     * made a long chapter feel sticky. Inside a ScrollView the field is one tall
     * block that never scrolls, so a drag is a plain translation and the caret is
     * kept in view by hand (see keepCaretVisible).
     */
    private ScrollView editorScroll;
    private Library.Chapter openChapter;
    private TextView countLabel;
    private final android.os.Handler saver = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable saveTick = this::flush;
    /** 字数, recomputed after typing pauses instead of on every key. */
    private final Runnable countTick = this::recount;
    /** Caret follow, throttled so a fast typist does not scroll per keystroke. */
    private final Runnable caretTick = this::keepCaretVisible;

    /** R38: night colours are chosen before the first view is built. */
    @Override
    protected void attachBaseContext(Context base) {
        super.attachBaseContext(Skin.wrap(base));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        store = new Store(this);
        bookId = getIntent() == null ? "" : getIntent().getStringExtra("bookId");
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(getResources().getColor(R.color.nw_paper));
        setContentView(root);
        Skin.applyBars(this);
        showChapters();
    }

    @Override
    public void onBackPressed() {
        if (editing) {
            // The save is asynchronous now, so the list is drawn *after* the write
            // lands; otherwise the chapter list would briefly show the word count
            // from before the last sentence.
            editing = false;
            flushThen(this::showChapters);
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onPause() {
        super.onPause();
        flush();
        stopJobWatch();
    }

    /**
     * R72: pick up edits made on the 修改建议 page.
     *
     * The advice page is a separate activity that edits the same chapter
     * paragraph by paragraph. Without this, coming back would show — and then
     * save — the text this screen was holding *before* those edits, silently
     * undoing them. A plain string compare keeps the common case (nothing
     * changed, only the screen turned off and on) free of any visible effect.
     */
    @Override
    protected void onResume() {
        super.onResume();
        startJobWatch();
        if (lastAdviceStrip != null && openChapter != null) {
            lastAdviceStrip.setVisibility(store.adviceFor(openChapter.id).isEmpty() ? View.GONE : View.VISIBLE);
        }
        if (!editing || bodyField == null || openChapter == null) return;
        Library.Book book = store.library().find(bookId);
        Library.Chapter fresh = book == null ? null : book.chapter(openChapter.id);
        if (fresh == null) return;
        String next = fresh.content == null ? "" : fresh.content;
        String shown = bodyField.getText() == null ? "" : bodyField.getText().toString();
        if (next.equals(shown)) return;
        int caret = Math.min(Math.max(0, bodyField.getSelectionStart()), next.length());
        bodyField.setText(next);
        bodyField.setSelection(caret);
        openChapter.content = next;
        saver.removeCallbacks(countTick);
        saver.post(countTick);
    }

    // ------------------------------------------------------------- chapter list

    private void showChapters() {
        editing = false;
        bodyField = null;
        jobStrip = null;
        lastAdviceStrip = null;
        editorScroll = null;
        openChapter = null;
        root.removeAllViews();

        Library.Book book = store.library().find(bookId);
        if (book == null) {
            finish();
            return;
        }

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(16), dp(16), dp(10), dp(10));

        TextView title = new TextView(this);
        title.setText(book.title);
        title.setTextSize(21);
        title.setTypeface(android.graphics.Typeface.create("serif", android.graphics.Typeface.BOLD));
        title.setTextColor(getResources().getColor(R.color.nw_ink));
        header.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        header.addView(skinButton());

        Button add = new Button(this);
        add.setText("＋");
        add.setTextSize(20);
        add.setTextColor(getResources().getColor(R.color.nw_clay));
        add.setBackgroundColor(0);
        add.setOnClickListener(v -> addChapter(book));
        header.addView(add);
        root.addView(header);

        ScrollView scroll = new ScrollView(this);
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(12), 0, dp(12), dp(24));
        scroll.addView(list, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        if (book.chapters.isEmpty()) {
            TextView empty = new TextView(this);
            empty.setText("还没有章节。点右上角 ＋ 开始写。");
            empty.setTextSize(14);
            empty.setTextColor(getResources().getColor(R.color.nw_soft));
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(dp(24), dp(36), dp(24), dp(36));
            list.addView(empty);
        }

        for (Library.Chapter chapter : book.chapters) list.addView(chapterRow(book, chapter));
    }

    private int color(int id) {
        return Skin.color(this, id);
    }

    /** 白天 / 黑夜 switch, shown on both the chapter list and the editor. */
    private Button skinButton() {
        Button skin = new Button(this);
        skin.setText(Skin.night(this) ? "☀" : "☾");
        skin.setTextSize(18);
        skin.setContentDescription("切换白天黑夜");
        skin.setTextColor(getResources().getColor(R.color.nw_ink));
        skin.setBackgroundColor(0);
        skin.setOnClickListener(v -> {
            Skin.toggle(this);
            recreate();
        });
        return skin;
    }

    /**
     * One 字号 step, persisted.
     *
     * A reader who has to zoom by pinching has already lost their place; two
     * buttons that keep the caret where it was are worth more than a setting
     * buried three taps away.
     */
    private Button fontButton(String label, float delta) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(12);
        button.setMinimumWidth(0);
        button.setMinWidth(0);
        button.setPadding(dp(8), 0, dp(8), 0);
        button.setTextColor(getResources().getColor(R.color.nw_soft));
        button.setBackgroundColor(0);
        button.setOnClickListener(v -> {
            float next = Math.max(14f, Math.min(34f, store.editTextSize() + delta));
            store.setEditTextSize(next);
            applyTextSize();
        });
        return button;
    }

    private void applyTextSize() {
        if (bodyField == null) return;
        float size = store.editTextSize();
        bodyField.setTextSize(size);
        // Leading scales with the type: a fixed gap makes large text a wall and
        // small text float apart.
        bodyField.setLineSpacing(Math.round(size * 0.5f * getResources().getDisplayMetrics().scaledDensity), 1f);
    }

    private View chapterRow(Library.Book book, Library.Chapter chapter) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(dp(16), dp(14), dp(16), dp(14));
        row.setBackgroundResource(R.drawable.nw_card_touch);
        row.setElevation(dp(1));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(dp(2), 0, dp(2), dp(10));
        row.setLayoutParams(params);

        TextView name = new TextView(this);
        String label = chapter.title == null || chapter.title.trim().isEmpty() ? "未命名章节" : chapter.title;
        name.setText(label);
        name.setTextSize(16);
        name.setTextColor(getResources().getColor(R.color.nw_ink));
        row.addView(name);

        String text = chapter.content == null ? "" : chapter.content;
        TextView meta = new TextView(this);
        // Library.words never allocates; the old replaceAll built a copy of the
        // whole chapter for every row on every redraw.
        meta.setText(Library.words(text) + " 字");
        meta.setTextSize(12);
        meta.setTextColor(getResources().getColor(R.color.nw_soft));
        meta.setPadding(0, dp(3), 0, 0);
        row.addView(meta);

        row.setOnClickListener(v -> showEditor(book, chapter));
        row.setOnLongClickListener(v -> {
            new android.app.AlertDialog.Builder(this)
                .setTitle(label)
                .setItems(new String[] {"重命名", "删除"}, (dialog, which) -> {
                    if (which == 0) renameChapter(book, chapter);
                    else deleteChapter(book, chapter);
                })
                .show();
            return true;
        });
        return row;
    }

    private void addChapter(Library.Book book) {
        EditText input = new EditText(this);
        input.setHint("章节名");
        new android.app.AlertDialog.Builder(this)
            .setTitle("新建章节")
            .setView(input)
            .setPositiveButton("创建", (dialog, which) -> {
                Library library = store.library();
                Library.Book target = library.find(book.id);
                if (target == null) return;
                String name = input.getText().toString().trim();
                target.chapters.add(Library.createChapter(target, name.isEmpty() ? "新章节" : name));
                target.touch();
                store.save(library);
                showChapters();
                SyncEngine.pushSoon(this);
            })
            .setNegativeButton("取消", null)
            .show();
    }

    private void renameChapter(Library.Book book, Library.Chapter chapter) {
        EditText input = new EditText(this);
        input.setText(chapter.title);
        new android.app.AlertDialog.Builder(this)
            .setTitle("重命名章节")
            .setView(input)
            .setPositiveButton("保存", (dialog, which) -> {
                Library library = store.library();
                Library.Book target = library.find(book.id);
                Library.Chapter hit = target == null ? null : target.chapter(chapter.id);
                if (hit == null) return;
                hit.title = input.getText().toString().trim();
                target.touch();
                store.save(library);
                showChapters();
                SyncEngine.pushSoon(this);
            })
            .setNegativeButton("取消", null)
            .show();
    }

    private void deleteChapter(Library.Book book, Library.Chapter chapter) {
        new android.app.AlertDialog.Builder(this)
            .setTitle("删除这一章？")
            .setMessage("这一章会从所有设备上删除。")
            .setPositiveButton("删除", (dialog, which) -> {
                Library library = store.library();
                Library.Book target = library.find(book.id);
                if (target != null) {
                    for (int i = target.chapters.size() - 1; i >= 0; i -= 1) {
                        if (chapter.id.equals(target.chapters.get(i).id)) target.chapters.remove(i);
                    }
                    target.touch();
                    store.save(library);
                }
                showChapters();
                SyncEngine.pushSoon(this);
            })
            .setNegativeButton("取消", null)
            .show();
    }

    // ----------------------------------------------------------------- editor

    private void showEditor(Library.Book book, Library.Chapter chapter) {
        editing = true;
        openChapter = chapter;
        root.removeAllViews();

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(16), dp(14), dp(16), dp(8));

        TextView name = new TextView(this);
        name.setText(chapter.title == null || chapter.title.trim().isEmpty() ? book.title : chapter.title);
        name.setTextSize(16);
        name.setTextColor(getResources().getColor(R.color.nw_soft));
        header.addView(name, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        header.addView(fontButton("A-", -1f));
        header.addView(fontButton("A+", 1f));

        // R72: the one action in this app that needs the desktop's model. It sits
        // in the header rather than the punctuation strip because it is a command,
        // not a character, and it is the first thing a writer looks for after
        // finishing a paragraph.
        header.addView(aiButton());

        countLabel = new TextView(this);
        countLabel.setTextSize(12);
        countLabel.setTextColor(getResources().getColor(R.color.nw_soft));
        countLabel.setText(Library.words(chapter.content) + " 字");
        header.addView(countLabel);
        root.addView(header);

        // R72: a run continues while the dialog is hidden, so its state needs a
        // home on the page itself. Tapping the strip brings the card back.
        jobStrip = new TextView(this);
        jobStrip.setTextSize(12);
        jobStrip.setTextColor(color(R.color.nw_on_clay));
        jobStrip.setBackgroundResource(R.drawable.nw_button_clay);
        jobStrip.setPadding(dp(14), dp(7), dp(14), dp(7));
        jobStrip.setVisibility(View.GONE);
        jobStrip.setOnClickListener(v -> {
            JSONObject job = parseJson(store.reviseJob());
            if (job != null && "running".equals(job.optString("state"))) showRunDialog(job);
        });
        LinearLayout.LayoutParams stripParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        stripParams.setMargins(dp(16), 0, dp(16), dp(8));
        root.addView(jobStrip, stripParams);

        // R72: advice is kept per chapter, so a second look does not cost another
        // model run — and leaving the page does not lose what was already paid for.
        lastAdviceStrip = new TextView(this);
        lastAdviceStrip.setText("查看上次的修改建议 ›");
        lastAdviceStrip.setTextSize(12);
        lastAdviceStrip.setTextColor(color(R.color.nw_soft));
        lastAdviceStrip.setPadding(dp(16), 0, dp(16), dp(8));
        lastAdviceStrip.setVisibility(store.adviceFor(chapter.id).isEmpty() ? View.GONE : View.VISIBLE);
        lastAdviceStrip.setOnClickListener(v -> openStoredAdvice());
        root.addView(lastAdviceStrip);
        // Re-paint it as soon as the page is built: coming back from Home should
        // show the run without waiting for the next poll tick.
        Runnable paint = this::syncJobUi;
        saver.post(paint);

        // The field is as tall as its text and the ScrollView does the scrolling.
        // A scrolling EditText re-lays-out on every drag; a plain block inside a
        // ScrollView is just translated, which is the difference between "scrolls
        // with the text" and "sticks for a moment" on a long chapter.
        editorScroll = new ScrollView(this);
        editorScroll.setFillViewport(true);
        editorScroll.setVerticalScrollBarEnabled(true);
        editorScroll.setSmoothScrollingEnabled(false);
        // The page sits on the paper instead of bleeding to the screen edges: the
        // margin is what makes a phone screen read as a sheet of paper rather than
        // a white rectangle with text in it.
        editorScroll.setPadding(dp(10), 0, dp(10), 0);
        editorScroll.setClipToPadding(false);

        bodyField = new EditText(this);
        bodyField.setText(chapter.content == null ? "" : chapter.content);
        applyTextSize();
        bodyField.setPadding(dp(18), dp(10), dp(18), dp(26));
        // R72: the page is a card on the paper, like the shelf's rows — rounded,
        // inset by the ScrollView's padding, with a hairline-free edge. Night mode
        // gets its own colour through @color/nw_card.
        bodyField.setBackgroundResource(R.drawable.nw_card);
        bodyField.setTextColor(color(R.color.nw_ink));
        bodyField.setGravity(Gravity.TOP | Gravity.START);
        // No inner scrolling, no horizontal scrolling, and no "automatically move
        // the caret into view" (that is what makes a non-scrolling EditText jump
        // when it sits inside a ScrollView). keepCaretVisible does it by hand.
        bodyField.setVerticalScrollBarEnabled(false);
        bodyField.setHorizontalScrollBarEnabled(false);
        bodyField.setOverScrollMode(View.OVER_SCROLL_NEVER);
        // Multi-line prose, with the IME's spell-check pass switched off: the
        // checker walks the text around the caret on every keystroke, which is
        // pure overhead for a 30k-character chapter and adds its own hitch.
        bodyField.setInputType(InputType.TYPE_CLASS_TEXT
            | InputType.TYPE_TEXT_FLAG_MULTI_LINE
            | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        bodyField.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count2, int after) {
            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count2) {
            }

            @Override
            public void afterTextChanged(Editable editable) {
                // R38 ③: nothing is copied here. The old version called
                // editable.toString() — a full copy of a chapter that can be
                // 30k characters — and then ran a regex over it on *every*
                // keystroke, so typing outran the field on a long chapter. Both
                // the word count and the save now read the field once, after
                // typing pauses.
                saver.removeCallbacks(countTick);
                saver.postDelayed(countTick, 260);
                // Caret follow is throttled too: scrolling on every keystroke
                // fights the scroll the user may be doing with a finger.
                saver.removeCallbacks(caretTick);
                saver.postDelayed(caretTick, 120);
                // Debounced: writing to SharedPreferences on every keystroke would
                // serialise the whole library a dozen times per sentence.
                saver.removeCallbacks(saveTick);
                saver.postDelayed(saveTick, SAVE_DELAY_MS);
            }
        });
        editorScroll.addView(bodyField, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(editorScroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(hairline());
        root.addView(symbolBar());
    }

    /** One physical pixel of @color/nw_line, used to separate the page from the keys. */
    private View hairline() {
        View line = new View(this);
        line.setBackgroundColor(getResources().getColor(R.color.nw_line));
        line.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1));
        return line;
    }

    // --------------------------------------------------- R72: 修改建议

    /** 「修改建议」 — asks the paired desktop, never a model directly. */
    private Button aiButton() {
        Button button = new Button(this);
        button.setText("修改建议");
        button.setTextSize(12.5f);
        button.setAllCaps(false);
        button.setMinimumWidth(0);
        button.setMinWidth(0);
        button.setMinimumHeight(0);
        button.setPadding(dp(12), dp(2), dp(12), dp(2));
        button.setTextColor(color(R.color.nw_clay));
        button.setBackgroundColor(0);
        button.setContentDescription("让电脑上的编辑给这一章提修改建议");
        button.setOnClickListener(v -> startRevise());
        return button;
    }

    /**
     * Sends the selection (or the whole chapter) to the desktop and opens the
     * advice page.
     *
     * The 20000-character ceiling is the host's own cap, checked here first so a
     * long chapter fails in one tap with an explanation instead of after a
     * minute of waiting for a 413.
     *
     * Why flush before opening: the advice page edits the chapter that is on
     * disk, and the offsets it receives were computed against the text we just
     * sent. If the last 1.2 s of typing had not been written yet, the page would
     * open on an older copy and its notes would point at the wrong paragraphs.
     */
    /** Fields the 修改建议 sheet edits; the dialog's 开始 button reads them on click. */
    private JSONArray aiModels = new JSONArray();
    private String aiProviderChoice = "";
    private String aiModelChoice = "";
    private String aiFocus = "all";
    private String aiCurrentProvider = "";
    private String aiCurrentModel = "";
    private TextView aiModelLabel;
    private EditText aiNoteField;
    private final java.util.List<Button> aiFocusChips = new java.util.ArrayList<>();

    private void startRevise() {
        if (bodyField == null) return;
        Editable editable = bodyField.getText();
        if (editable == null) return;
        String full = editable.toString();
        int from = Math.min(Math.max(0, bodyField.getSelectionStart()), full.length());
        int to = Math.min(Math.max(0, bodyField.getSelectionEnd()), full.length());
        boolean scoped = to > from;
        final String source = scoped ? full.substring(from, to) : full;
        if (source.trim().isEmpty()) {
            toast("这一章还没有正文");
            return;
        }
        if (source.length() > 20000) {
            toast("一次最多 2 万字，先选中一段再提建议");
            return;
        }
        final int base = scoped ? from : 0;
        final boolean selectionMode = scoped;

        // The model list is small but it lives on the desktop, so it costs a
        // round trip. Fetch it before showing the sheet rather than inside it:
        // a list that pops in a second late under the writer's finger is worse
        // than a spinner for half a second.
        final AlertDialog busy = busyDialog("正在读取可用模型…");
        busy.show();
        new Thread(() -> {
            SyncEngine.ModelsOutcome listed = SyncEngine.models(getApplicationContext());
            runOnUiThread(() -> {
                if (isFinishing()) return;
                if (busy.isShowing()) busy.dismiss();
                showReviseSheet(source, base, selectionMode, listed);
            });
        }, "nw-models").start();
    }

    /**
     * The pre-flight sheet: which model, which dimension, and an optional note.
     *
     * This is the phone's answer to the desktop dialog's two dropdowns and its
     * 「额外要求」 box. Defaults are the last choice made on *this phone*, then
     * the desktop's current selection — opening the sheet twice should not feel
     * like re-configuring anything.
     */
    private void showReviseSheet(final String source, final int base, final boolean scoped, SyncEngine.ModelsOutcome listed) {
        JSONObject data = listed != null && listed.ok ? listed.data : null;
        aiModels = data == null || data.optJSONArray("models") == null ? new JSONArray() : data.optJSONArray("models");
        JSONObject current = data == null ? null : data.optJSONObject("current");
        aiCurrentProvider = current == null ? "" : current.optString("provider", "");
        aiCurrentModel = current == null ? "" : current.optString("model", "");

        String provider = store.aiProvider();
        String model = store.aiModel();
        if (!modelExists(provider, model)) {
            provider = current == null ? "" : current.optString("provider", "");
            model = current == null ? "" : current.optString("model", "");
        }
        if (!modelExists(provider, model) && aiModels.length() > 0) {
            JSONObject row = aiModels.optJSONObject(0);
            if (row != null) {
                provider = row.optString("provider", "");
                model = row.optString("id", "");
            }
        }
        aiProviderChoice = provider;
        aiModelChoice = model;
        aiFocus = "all";

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(20), dp(6), dp(20), dp(2));

        panel.addView(sheetLabel("模型"));
        aiModelLabel = new TextView(this);
        aiModelLabel.setTextSize(15);
        aiModelLabel.setTextColor(color(R.color.nw_clay));
        aiModelLabel.setPadding(0, dp(4), 0, dp(10));
        aiModelLabel.setContentDescription("更换模型");
        refreshModelLabel();
        aiModelLabel.setOnClickListener(v -> pickModel());
        panel.addView(aiModelLabel);

        if (listed == null || !listed.ok) {
            TextView warn = new TextView(this);
            warn.setText((listed == null ? "读取模型列表失败" : listed.message) + "，先用电脑当前的模型");
            warn.setTextSize(11.5f);
            warn.setTextColor(color(R.color.nw_soft));
            warn.setPadding(0, 0, 0, dp(8));
            panel.addView(warn);
        }

        panel.addView(sheetLabel("关注"));
        HorizontalScrollView strip = new HorizontalScrollView(this);
        strip.setHorizontalScrollBarEnabled(false);
        LinearLayout chips = new LinearLayout(this);
        chips.setOrientation(LinearLayout.HORIZONTAL);
        chips.setPadding(0, dp(6), 0, dp(10));
        aiFocusChips.clear();
        String[][] focuses = {
            {"all", "全部"}, {"rhythm", "节奏"}, {"diction", "语言"}, {"pov", "视角"}, {"detail", "画面"},
            {"dialogue", "对话"}, {"structure", "结构"}, {"character", "人物"}, {"logic", "逻辑"},
            {"emotion", "情绪"}, {"redundancy", "冗余"},
        };
        for (String[] pair : focuses) {
            Button chip = new Button(this);
            chip.setText(pair[1]);
            chip.setTextSize(12.5f);
            chip.setAllCaps(false);
            chip.setTag(pair[0]);
            chip.setMinWidth(0);
            chip.setMinimumWidth(0);
            chip.setMinHeight(0);
            chip.setMinimumHeight(0);
            chip.setPadding(dp(14), dp(6), dp(14), dp(6));
            chip.setOnClickListener(v -> {
                aiFocus = String.valueOf(v.getTag());
                paintFocusChips();
            });
            LinearLayout.LayoutParams chipParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            chipParams.setMargins(0, 0, dp(8), 0);
            chips.addView(chip, chipParams);
            aiFocusChips.add(chip);
        }
        strip.addView(chips, new HorizontalScrollView.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        panel.addView(strip);
        paintFocusChips();

        panel.addView(sheetLabel("额外要求（可留空）"));
        aiNoteField = new EditText(this);
        aiNoteField.setHint("比如：别动对话，只看结尾");
        aiNoteField.setTextSize(14);
        aiNoteField.setTextColor(color(R.color.nw_ink));
        aiNoteField.setHintTextColor(color(R.color.nw_soft));
        aiNoteField.setBackgroundColor(0);
        aiNoteField.setPadding(dp(2), dp(6), dp(2), dp(6));
        aiNoteField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        panel.addView(aiNoteField);

        new AlertDialog.Builder(this)
            .setTitle(scoped ? "修改建议 · 选中的段落" : "修改建议 · 整章")
            .setView(panel)
            .setNegativeButton("取消", null)
            .setPositiveButton("开始", (dialog, which) -> runRevise(
                source, base, scoped,
                aiProviderChoice, aiModelChoice, aiFocus,
                aiNoteField.getText() == null ? "" : aiNoteField.getText().toString().trim()))
            .show();
    }

    private TextView sheetLabel(String text) {
        TextView label = new TextView(this);
        label.setText(text);
        label.setTextSize(11.5f);
        label.setTextColor(color(R.color.nw_soft));
        label.setPadding(0, dp(10), 0, 0);
        return label;
    }

    private void paintFocusChips() {
        for (Button chip : aiFocusChips) {
            boolean on = String.valueOf(chip.getTag()).equals(aiFocus);
            chip.setTextColor(on ? color(R.color.nw_on_clay) : color(R.color.nw_ink));
            chip.setBackgroundResource(on ? R.drawable.nw_button_clay : R.drawable.nw_touch_pill);
        }
    }

    private void refreshModelLabel() {
        if (aiModelLabel == null) return;
        if (aiProviderChoice.isEmpty() || aiModelChoice.isEmpty()) {
            aiModelLabel.setText("电脑当前的默认模型  ›");
            return;
        }
        String name = aiModelChoice;
        for (int i = 0; i < aiModels.length(); i += 1) {
            JSONObject row = aiModels.optJSONObject(i);
            if (row == null) continue;
            if (row.optString("provider", "").equals(aiProviderChoice) && row.optString("id", "").equals(aiModelChoice)) {
                name = row.optString("name", aiModelChoice);
                break;
            }
        }
        aiModelLabel.setText(name + " · " + aiProviderChoice + "  ›");
    }

    private boolean modelExists(String provider, String model) {
        if (provider == null || provider.isEmpty() || model == null || model.isEmpty()) return false;
        for (int i = 0; i < aiModels.length(); i += 1) {
            JSONObject row = aiModels.optJSONObject(i);
            if (row == null) continue;
            if (row.optString("provider", "").equals(provider) && row.optString("id", "").equals(model)) return true;
        }
        return false;
    }

    /** The list dialog; index 0 is always "whatever the desktop has selected". */
    private void pickModel() {
        if (aiModels.length() == 0) {
            toast("电脑没有报告可用模型，将用它当前的默认模型");
            return;
        }
        final String[] labels = new String[aiModels.length() + 1];
        labels[0] = "电脑当前的默认模型";
        for (int i = 0; i < aiModels.length(); i += 1) {
            JSONObject row = aiModels.optJSONObject(i);
            String name = row == null ? "" : row.optString("name", row.optString("id", ""));
            String prov = row == null ? "" : row.optString("provider", "");
            boolean isCurrent = row != null
                && row.optString("provider", "").equals(aiCurrentProvider)
                && row.optString("id", "").equals(aiCurrentModel);
            labels[i + 1] = name + " · " + prov + (isCurrent ? "（电脑默认）" : "");
        }
        new AlertDialog.Builder(this)
            .setTitle("选择模型")
            .setItems(labels, (dialog, which) -> {
                if (which == 0) {
                    aiProviderChoice = "";
                    aiModelChoice = "";
                } else {
                    JSONObject row = aiModels.optJSONObject(which - 1);
                    if (row != null) {
                        aiProviderChoice = row.optString("provider", "");
                        aiModelChoice = row.optString("id", "");
                    }
                }
                refreshModelLabel();
            })
            .show();
    }

    // ------------------------------------------------ 修改建议 job (R72)

    /** The dialog currently showing the job, if any. */
    private RunDialog jobDialog;
    /** The in-page "still reading…" strip; survives the dialog being hidden. */
    private TextView jobStrip;
    /** True when the writer pressed Back to hide the card — do not pop it back up. */
    private boolean jobDialogHidden;
    /** "查看上次的修改建议" — the stored advice for this chapter, if any. */
    private TextView lastAdviceStrip;
    private final android.os.Handler jobPoller = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable jobTick = new Runnable() {
        @Override
        public void run() {
            syncJobUi();
            jobPoller.postDelayed(this, 700);
        }
    };

    private void startJobWatch() {
        jobPoller.removeCallbacks(jobTick);
        jobPoller.post(jobTick);
    }

    private void stopJobWatch() {
        jobPoller.removeCallbacks(jobTick);
    }

    /**
     * Starts the run in the service and shows its dialog.
     *
     * Nothing here waits for the answer: {@link ReviseService} owns the request
     * and writes its state into the store, and this screen only displays what it
     * finds there. That is what lets the dialog survive Home, a trip back to the
     * shelf, and a rotation — and why the only thing that ends a run is the ✕.
     */
    private void runRevise(final String source, final int base, final boolean scoped, final String provider, final String model, final String focus, final String note) {
        if (openChapter == null) return;
        store.setAiChoice(provider, model);
        store.clearReviseJob();
        jobDialogHidden = false;
        // Save first: the advice page edits the chapter on disk, and the offsets
        // in the answer are relative to the text being sent right now.
        flush();
        ReviseService.begin(this, ReviseService.startIntent(
            this, bookId, openChapter.id,
            openChapter.title == null ? "" : openChapter.title,
            base, source, focus, note, provider, model, scoped));
        syncJobUi();
        startJobWatch();
    }

    /**
     * One look at the job blob.
     *
     * Called every 700 ms while this screen is resumed, and once on resume. It is
     * driven by storage rather than by a callback on purpose: the run may have
     * finished while the writer was in another app, and the only durable record
     * of that is what the service wrote.
     */
    private void syncJobUi() {
        if (!editing || openChapter == null || isFinishing()) {
            dismissJobDialog();
            return;
        }
        JSONObject job = parseJson(store.reviseJob());
        if (job == null) {
            dismissJobDialog();
            return;
        }
        if (!bookId.equals(job.optString("bookId")) || !openChapter.id.equals(job.optString("chapterId"))) {
            // Another chapter's job: leave it alone, its own editor will take it.
            dismissJobDialog();
            return;
        }
        String state = job.optString("state", "");
        if ("running".equals(state)) {
            if (!jobDialogHidden && (jobDialog == null || !jobDialog.isShowing())) {
                showRunDialog(job);
            }
            if (jobDialog != null) jobDialog.onProgress(job.optInt("done", 0), job.optInt("total", 0));
            updateJobStrip(true, "正在读这一章 · 第 " + Math.min(job.optInt("done", 0) + 1, Math.max(job.optInt("total", 1), 1))
                + " / " + Math.max(job.optInt("total", 1), 1) + " 批 · 点这里看进度");
            return;
        }
        updateJobStrip(false, "");
        dismissJobDialog();
        store.clearReviseJob();
        if ("done".equals(state)) {
            deliverAdvice(job);
        } else if ("error".equals(state)) {
            String message = job.optString("message", "");
            String code = job.optString("code", "");
            notice("没有取到建议", code.isEmpty() || message.contains(code) ? message : message + "（" + code + "）");
        }
        // "canceled": the writer asked for it; say nothing.
    }

    private void deliverAdvice(JSONObject job) {
        String advice = job.optString("advice", "[]");
        if (advice.isEmpty() || "[]".equals(advice)) {
            if (job.optInt("empty", 0) > 0) {
                notice("模型没有返回内容", "这一遍模型一个字都没写出来，长文时最容易这样。换一个模型再试，或者把关注点收窄一点。");
            } else {
                notice("这一遍没有建议", "模型读完了，但没有给出值得改的地方。可以换个关注点或换个模型再试一次。");
            }
            return;
        }
        store.saveAdvice(openChapter.id, job.optString("title", ""), advice);
        Intent intent = new Intent(this, AdviceActivity.class);
        intent.putExtra(AdviceActivity.EXTRA_BOOK, bookId);
        intent.putExtra(AdviceActivity.EXTRA_CHAPTER, openChapter.id);
        intent.putExtra(AdviceActivity.EXTRA_TITLE, job.optString("title", ""));
        intent.putExtra(AdviceActivity.EXTRA_ADVICE, advice);
        intent.putExtra(AdviceActivity.EXTRA_BASE, job.optInt("base", 0));
        try {
            startActivity(intent);
        } catch (RuntimeException error) {
            notice("打不开建议页", error.getMessage() == null ? "未知错误" : error.getMessage());
        }
    }

    private void dismissJobDialog() {
        RunDialog dialog = jobDialog;
        // Null first: the dismiss listener uses "is this still the current
        // dialog" to tell a programmatic close from the writer pressing Back.
        jobDialog = null;
        if (dialog != null) dialog.dismiss();
    }

    private void showRunDialog(JSONObject job) {
        jobDialogHidden = false;
        RunDialog dialog = new RunDialog("正在读这一章…", job.optLong("startedAt", System.currentTimeMillis()));
        dialog.setOnCancel(() -> {
            // The only thing that stops a run.
            ReviseService.stop(this);
            dialog.dismiss();
        });
        jobDialog = dialog;
        dialog.show();
    }

    private void updateJobStrip(boolean show, String text) {
        if (jobStrip == null) return;
        jobStrip.setVisibility(show ? View.VISIBLE : View.GONE);
        if (show) jobStrip.setText(text);
    }

    /** Opens the advice saved from the last run on this chapter. */
    private void openStoredAdvice() {
        if (openChapter == null) return;
        String advice = store.adviceFor(openChapter.id);
        if (advice.isEmpty()) {
            toast("这一章还没有保存的建议");
            return;
        }
        Intent intent = new Intent(this, AdviceActivity.class);
        intent.putExtra(AdviceActivity.EXTRA_BOOK, bookId);
        intent.putExtra(AdviceActivity.EXTRA_CHAPTER, openChapter.id);
        intent.putExtra(AdviceActivity.EXTRA_TITLE, openChapter.title == null ? "" : openChapter.title);
        intent.putExtra(AdviceActivity.EXTRA_ADVICE, advice);
        intent.putExtra(AdviceActivity.EXTRA_BASE, 0);
        try {
            startActivity(intent);
        } catch (RuntimeException error) {
            notice("打不开建议页", error.getMessage() == null ? "未知错误" : error.getMessage());
        }
    }

    private static JSONObject parseJson(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception error) {
            return null;
        }
    }

    /**
     * The waiting card: a real bar where there is something to count, an elapsed
     * clock where there is not, and one way out.
     *
     * `total` is the number of paragraph blocks the host will feed the model, so
     * "3 / 7 段" is progress, not decoration. A short chapter is one block — for
     * those the bar goes indeterminate rather than sitting at 0 forever, and the
     * clock is what tells the writer it is still alive.
     */
    private final class RunDialog {
        private final AlertDialog dialog;
        private final android.widget.ProgressBar bar;
        private final TextView status;
        private final TextView hint;
        private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
        private final long startedAt;
        private Runnable onCancel;

        private final Runnable ticker = new Runnable() {
            @Override
            public void run() {
                long seconds = Math.max(0, (System.currentTimeMillis() - startedAt) / 1000);
                hint.setText("已用 " + seconds + " 秒 · 点 ✕ 会停止这次运行");
                // A chapter shorter than one block has no per-block progress to
                // show, so the status line becomes the proof of life: it changes
                // at 10 s and 30 s instead of leaving a spinner that looks hung.
                if (bar.isIndeterminate()) {
                    if (seconds >= 30) status.setText("模型还在写，长章会更久…");
                    else if (seconds >= 10) status.setText("还在读，稍等一下…");
                }
                handler.postDelayed(this, 1000);
            }
        };

        RunDialog(String opening, long startedAt) {
            this.startedAt = startedAt > 0 ? startedAt : System.currentTimeMillis();
            LinearLayout card = new LinearLayout(EditActivity.this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(20), dp(18), dp(20), dp(18));
            card.setBackgroundResource(R.drawable.nw_card);

            LinearLayout row = new LinearLayout(EditActivity.this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);

            TextView title = new TextView(EditActivity.this);
            title.setText("修改建议");
            title.setTextSize(16);
            title.setTypeface(android.graphics.Typeface.create("serif", android.graphics.Typeface.BOLD));
            title.setTextColor(color(R.color.nw_ink));
            row.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

            Button close = new Button(EditActivity.this);
            close.setText("✕");
            close.setTextSize(16);
            close.setAllCaps(false);
            close.setMinWidth(0);
            close.setMinimumWidth(dp(34));
            close.setMinHeight(0);
            close.setMinimumHeight(dp(34));
            close.setPadding(0, 0, 0, 0);
            close.setTextColor(color(R.color.nw_soft));
            close.setBackgroundResource(R.drawable.nw_touch_pill);
            close.setContentDescription("停止这次运行");
            close.setOnClickListener(v -> {
                if (onCancel != null) onCancel.run();
            });
            row.addView(close);
            card.addView(row);

            bar = new android.widget.ProgressBar(EditActivity.this, null, android.R.attr.progressBarStyleHorizontal);
            bar.setIndeterminate(true);
            bar.setMax(100);
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
                bar.setProgressTintList(android.content.res.ColorStateList.valueOf(color(R.color.nw_clay)));
            }
            LinearLayout.LayoutParams barParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(4));
            barParams.setMargins(0, dp(16), 0, 0);
            card.addView(bar, barParams);

            status = new TextView(EditActivity.this);
            status.setText(opening);
            status.setTextSize(13.5f);
            status.setTextColor(color(R.color.nw_ink));
            status.setPadding(0, dp(12), 0, 0);
            card.addView(status);

            hint = new TextView(EditActivity.this);
            hint.setTextSize(11.5f);
            hint.setTextColor(color(R.color.nw_soft));
            hint.setPadding(0, dp(6), 0, 0);
            hint.setText("已用 0 秒 · 点 ✕ 会停止这次运行");
            card.addView(hint);

            dialog = new AlertDialog.Builder(EditActivity.this)
                .setView(card)
                // Back hides the card; it does not stop the run. Stopping is the ✕
                // and only the ✕ — the writer may want to walk back to the shelf
                // with the chapter still being read.
                .setCancelable(true)
                .create();
            dialog.setCanceledOnTouchOutside(false);
            dialog.setOnDismissListener(d -> {
                handler.removeCallbacks(ticker);
                if (jobDialog == RunDialog.this) {
                    // Back, not ✕: the run continues, and the card must stay down
                    // until the writer taps the strip.
                    jobDialog = null;
                    jobDialogHidden = true;
                }
            });
        }

        void setOnCancel(Runnable action) {
            onCancel = action;
        }

        void show() {
            dialog.show();
            handler.post(ticker);
        }

        boolean isShowing() {
            return dialog.isShowing();
        }

        void dismiss() {
            handler.removeCallbacks(ticker);
            if (dialog.isShowing()) dialog.dismiss();
        }

        /** Called on the UI thread for every `progress` line from the host. */
        void onProgress(int done, int total) {
            if (!dialog.isShowing()) return;
            if (total <= 1) {
                bar.setIndeterminate(true);
                status.setText("模型正在读这一章…");
                return;
            }
            if (bar.isIndeterminate()) {
                bar.setIndeterminate(false);
                bar.setMax(total);
            }
            int shown = Math.max(0, Math.min(done, total));
            bar.setProgress(shown);
            int current = Math.min(shown + 1, total);
            // 「批」, not 「段」: the model reads the whole chapter; long text is
            // just split into batches because one request cannot carry an
            // unlimited manuscript. Calling each batch a 段 made the writer
            // think only one paragraph was being read.
            status.setText("正在读第 " + current + " / " + total + " 批（整章分批）…");
        }
    }

    /** A quiet "working" dialog: a small spinner and one line, no buttons to mash. */
    private AlertDialog busyDialog(String label) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.HORIZONTAL);
        box.setGravity(Gravity.CENTER_VERTICAL);
        box.setPadding(dp(22), dp(18), dp(22), dp(18));

        android.widget.ProgressBar spinner = new android.widget.ProgressBar(this);
        spinner.setIndeterminate(true);
        LinearLayout.LayoutParams spinnerParams = new LinearLayout.LayoutParams(dp(22), dp(22));
        spinnerParams.setMargins(0, 0, dp(14), 0);
        box.addView(spinner, spinnerParams);

        TextView text = new TextView(this);
        text.setText(label);
        text.setTextSize(14);
        text.setTextColor(color(R.color.nw_ink));
        box.addView(text);

        return new AlertDialog.Builder(this).setView(box).setCancelable(true).create();
    }

    private void toast(String message) {
        if (!isFinishing()) Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    /** A modal, unmissable one-liner. Used where silence would read as a bug. */
    private void notice(String title, String message) {
        if (isFinishing()) return;
        new AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage(message)
            .setPositiveButton("知道了", null)
            .show();
    }

    /**
     * A row of characters a phone keyboard makes hard to reach.
     *
     * Chinese prose needs 、「」《》——…… far more often than it needs the
     * letters a 26-key IME offers first, and each of those is three taps deep in
     * a symbol page. The strip is one tap instead, and it inserts at the caret
     * rather than appending, so it never moves the text the author is looking at.
     *
     * Tab is spelled as two ideographic spaces to match the desktop editor
     * (60-editor.js: `TAB_TEXT = '\u3000\u3000'`) — a real tab character has no
     * meaning in Chinese prose and renders as a variable gap.
     */
    private View symbolBar() {
        HorizontalScrollView strip = new HorizontalScrollView(this);
        strip.setHorizontalScrollBarEnabled(false);
        strip.setFillViewport(true);
        strip.setBackgroundColor(color(R.color.nw_bar));

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(dp(6), dp(4), dp(6), dp(4));
        row.setGravity(Gravity.CENTER_VERTICAL);

        String[] tokens = {
            "Tab", "“”", "‘’", "《》", "、", "，", "。",
            "——", "……", "！", "？", "：", "；", "（", "）",
        };
        for (String token : tokens) {
            row.addView(symbolButton("Tab".equals(token) ? "⇥" : token,
                "Tab".equals(token) ? "\u3000\u3000" : token));
        }

        strip.addView(row, new HorizontalScrollView.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        strip.setLayoutParams(params);
        return strip;
    }

    /** One symbol key: label on the face, `text` into the buffer. */
    private Button symbolButton(String label, String text) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(15);
        button.setMinimumWidth(0);
        button.setMinWidth(0);
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        button.setPadding(dp(10), dp(2), dp(10), dp(2));
        button.setTextColor(getResources().getColor(R.color.nw_ink));
        button.setBackgroundColor(0);
        button.setAllCaps(false);
        button.setContentDescription(label);
        button.setOnClickListener(v -> insertAtCaret(text));
        return button;
    }

    /**
     * Inserts at the selection, replacing it, and leaves the caret after the
     * inserted text. Going through the Editable keeps the field's own undo
     * behaviour and fires the TextWatcher, so the word count and the 1.2 s
     * autosave both follow without extra plumbing.
     */
    private void insertAtCaret(String text) {
        if (bodyField == null || text == null) return;
        Editable editable = bodyField.getText();
        if (editable == null) return;
        int start = Math.max(0, bodyField.getSelectionStart());
        int end = Math.max(start, bodyField.getSelectionEnd());
        int safeStart = Math.min(start, editable.length());
        int safeEnd = Math.min(end, editable.length());
        editable.replace(safeStart, safeEnd, text);
        int caret = Math.min(safeStart + text.length(), editable.length());
        bodyField.setSelection(caret);
        bodyField.requestFocus();
        saver.removeCallbacks(caretTick);
        saver.post(caretTick);
    }

    /**
     * Scrolls the editor so the caret stays a comfortable distance from the edge.
     *
     * Only moves when the caret actually leaves the middle band, so a reader who
     * scrolled away to re-read a passage is not yanked back on the next keystroke,
     * and a typist near the bottom gets a page-turn instead of one line at a time.
     */
    private void keepCaretVisible() {
        if (editorScroll == null || bodyField == null) return;
        int caret = bodyField.getSelectionEnd();
        if (caret < 0) return;
        android.text.Layout layout = bodyField.getLayout();
        if (layout == null) return;
        int line = layout.getLineForOffset(caret);
        int top = layout.getLineTop(line);
        int bottom = layout.getLineBottom(line);
        int viewHeight = editorScroll.getHeight() - editorScroll.getPaddingTop() - editorScroll.getPaddingBottom();
        if (viewHeight <= 0) return;
        int scrollY = editorScroll.getScrollY();
        int margin = Math.max(dp(24), viewHeight / 4);
        if (top - margin < scrollY) {
            editorScroll.smoothScrollTo(0, Math.max(0, top - margin));
        } else if (bottom + margin > scrollY + viewHeight) {
            editorScroll.smoothScrollTo(0, Math.max(0, bottom + margin - viewHeight));
        }
    }

    /** 字数, from the live field, a beat after the last keystroke. */
    private void recount() {
        if (bodyField == null || countLabel == null) return;
        countLabel.setText(Library.words(bodyField.getText()) + " 字");
    }

    /**
     * Writes the in-memory text back to disk.
     *
     * Called on pause, on back, and 1.2 s after typing stops. Only a real change
     * is written: `touch()` moves the timestamp the merge compares, so touching
     * unconditionally meant that merely opening a chapter and going back made this
     * phone the newest writer of the whole book, and the next sync replaced every
     * edit the desktop had made to the other chapters since. Opening a chapter is
     * not an edit.
     */
    private void flush() {
        flushThen(null);
    }

    /** Saves, then runs `after` on the UI thread (or right away if there is nothing to save). */
    private void flushThen(Runnable after) {
        saver.removeCallbacks(saveTick);
        if (openChapter == null) {
            if (after != null) after.run();
            return;
        }
        // The live field is the source of truth while it exists: afterTextChanged
        // no longer copies the text on every key, so the stored chapter is one
        // debounce behind until this runs.
        final String text = bodyField != null
            ? bodyField.getText().toString()
            : (openChapter.content == null ? "" : openChapter.content);
        final String chapterId = openChapter.id;
        final String chapterTitle = openChapter.title;
        // Parse, edit and serialise on the store's worker: on a big library this
        // is tens of milliseconds, and doing it on the main thread every 1.2 s is
        // felt as a stutter while writing.
        store.updateInBackground(library -> {
            Library.Book book = library.find(bookId);
            if (book == null || book.deleted) return false;
            Library.Chapter hit = book.chapter(chapterId);
            if (hit == null) {
                // The chapter was deleted elsewhere while it was open here. The text
                // on screen is still the user's, so it goes back as a chapter rather
                // than being dropped: the deletion was last-write-wins, and so is
                // keeping words that were typed after it.
                Library.Chapter again = new Library.Chapter();
                again.id = chapterId;
                again.title = isBlank(chapterTitle) ? "未命名" : chapterTitle;
                again.content = text;
                again.order = book.chapters.size();
                book.chapters.add(again);
                book.touch();
                return true;
            }
            String before = hit.content == null ? "" : hit.content;
            if (before.equals(text)) return false;
            hit.content = text;
            if (isBlank(hit.title)) hit.title = chapterTitle;
            book.touch();
            return true;
        }, changed -> {
            if (changed) SyncEngine.pushSoon(this);
            if (after != null) after.run();
        });
    }

    private static boolean isBlank(String text) {
        return text == null || text.trim().isEmpty();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
