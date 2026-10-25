package com.novelwriter.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

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
    private Library.Chapter openChapter;
    private TextView countLabel;
    private final android.os.Handler saver = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable saveTick = this::flush;
    /** 字数, recomputed after typing pauses instead of on every key. */
    private final Runnable countTick = this::recount;

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
            flush();
            editing = false;
            showChapters();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onPause() {
        super.onPause();
        flush();
    }

    // ------------------------------------------------------------- chapter list

    private void showChapters() {
        editing = false;
        bodyField = null;
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
        row.setPadding(dp(14), dp(12), dp(14), dp(12));
        row.setBackgroundColor(color(R.color.nw_card));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, 0, 0, dp(8));
        row.setLayoutParams(params);

        TextView name = new TextView(this);
        String label = chapter.title == null || chapter.title.trim().isEmpty() ? "未命名章节" : chapter.title;
        name.setText(label);
        name.setTextSize(16);
        name.setTextColor(getResources().getColor(R.color.nw_ink));
        row.addView(name);

        String text = chapter.content == null ? "" : chapter.content;
        TextView meta = new TextView(this);
        meta.setText(text.replaceAll("\\s", "").length() + " 字");
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

        countLabel = new TextView(this);
        countLabel.setTextSize(12);
        countLabel.setTextColor(getResources().getColor(R.color.nw_soft));
        countLabel.setText(Library.words(chapter.content) + " 字");
        header.addView(countLabel);
        root.addView(header);

        bodyField = new EditText(this);
        bodyField.setText(chapter.content == null ? "" : chapter.content);
        applyTextSize();
        bodyField.setPadding(dp(18), dp(8), dp(18), dp(24));
        bodyField.setBackgroundColor(color(R.color.nw_card));
        bodyField.setTextColor(color(R.color.nw_ink));
        bodyField.setGravity(Gravity.TOP | Gravity.START);
        bodyField.setVerticalScrollBarEnabled(true);
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
                // Debounced: writing to SharedPreferences on every keystroke would
                // serialise the whole library a dozen times per sentence.
                saver.removeCallbacks(saveTick);
                saver.postDelayed(saveTick, SAVE_DELAY_MS);
            }
        });
        root.addView(bodyField, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
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
        saver.removeCallbacks(saveTick);
        if (openChapter == null) return;
        // The live field is the source of truth while it exists: afterTextChanged
        // no longer copies the text on every key, so `openChapter.content` is one
        // debounce behind until this runs.
        String text = bodyField != null
            ? bodyField.getText().toString()
            : (openChapter.content == null ? "" : openChapter.content);
        openChapter.content = text;
        Library library = store.library();
        Library.Book book = library.find(bookId);
        if (book == null || book.deleted) return;
        Library.Chapter hit = book.chapter(openChapter.id);
        if (hit == null) {
            // The chapter was deleted elsewhere while it was open here. The text on
            // screen is still the user's, so it goes back as a chapter rather than
            // being dropped: the deletion was last-write-wins, and so is keeping
            // words that were typed after it.
            Library.Chapter again = new Library.Chapter();
            again.id = openChapter.id;
            again.title = isBlank(openChapter.title) ? "未命名" : openChapter.title;
            again.content = text;
            again.order = book.chapters.size();
            book.chapters.add(again);
            book.touch();
            store.save(library);
            Toast.makeText(this, "这一章在其它设备上被删除了，刚写的正文已恢复成新的一章", Toast.LENGTH_LONG).show();
            SyncEngine.pushSoon(this);
            return;
        }
        String before = hit.content == null ? "" : hit.content;
        if (before.equals(text)) return;
        hit.content = text;
        if (isBlank(hit.title)) hit.title = openChapter.title;
        book.touch();
        store.save(library);
        SyncEngine.pushSoon(this);
    }

    private static boolean isBlank(String text) {
        return text == null || text.trim().isEmpty();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
