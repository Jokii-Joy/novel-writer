package com.novelwriter.app;

import android.app.Activity;
import android.content.Context;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputType;
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

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * R72: 修改建议 as a page, not a dialog.
 *
 * The desktop puts advice in a column beside the manuscript. A phone has no
 * room for a column, so the same thing is folded into the page: the chapter is
 * laid out paragraph by paragraph, and each note sits **directly under the
 * paragraph its quote came from**. The note is a TextView — it can be selected
 * and copied, never typed into. The paragraphs above it are ordinary EditTexts,
 * so the only editable thing on this screen is the writer's own prose, which is
 * exactly the rule.
 *
 * Why a separate activity rather than a panel inside {@link EditActivity}: the
 * editor is one EditText holding the whole chapter, and a single field cannot
 * have a card inserted between its paragraphs. Splitting the editor into
 * per-paragraph fields permanently would have cost cross-paragraph selection
 * and a caret that can cross line breaks — the two things a writer uses most.
 * So the writing screen stays as it was, and this screen is the reading pass.
 *
 * Saving: the paragraphs are the source of truth while this screen is open.
 * A keystroke schedules the same 1.2 s debounced write the editor uses, and
 * both back and pause flush immediately.
 */
public final class AdviceActivity extends Activity {

    public static final String EXTRA_BOOK = "bookId";
    public static final String EXTRA_CHAPTER = "chapterId";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ADVICE = "advice";
    /** Offset of the sent text inside the chapter, when only a selection was sent. */
    public static final String EXTRA_BASE = "base";

    private static final long SAVE_DELAY_MS = 1200L;

    private Store store;
    private String bookId;
    private String chapterId;
    private String chapterTitle = "";

    /** One entry per line of the chapter, empty lines included. */
    private String[] paragraphs = new String[0];
    private final List<EditText> fields = new ArrayList<>();
    private JSONArray advice = new JSONArray();
    /** Where the text that produced `advice` starts in the chapter. */
    private int baseOffset = 0;
    /** The extra was there but did not parse — a different failure from "no advice". */
    private boolean adviceUnreadable = false;

    private final Handler saver = new Handler(Looper.getMainLooper());
    private final Runnable saveTick = this::flush;
    private boolean dirty = false;

    @Override
    protected void attachBaseContext(Context base) {
        super.attachBaseContext(Skin.wrap(base));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        store = new Store(this);
        bookId = getIntent() == null ? "" : getIntent().getStringExtra(EXTRA_BOOK);
        chapterId = getIntent() == null ? "" : getIntent().getStringExtra(EXTRA_CHAPTER);
        chapterTitle = getIntent() == null ? "" : getIntent().getStringExtra(EXTRA_TITLE);
        String raw = getIntent() == null ? "" : getIntent().getStringExtra(EXTRA_ADVICE);
        baseOffset = getIntent() == null ? 0 : Math.max(0, getIntent().getIntExtra(EXTRA_BASE, 0));
        boolean unreadable = false;
        try {
            advice = raw == null || raw.isEmpty() ? new JSONArray() : new JSONArray(raw);
        } catch (Exception error) {
            advice = new JSONArray();
            // A silently empty page is indistinguishable from "the model had
            // nothing to say". Keep the failure on screen instead.
            unreadable = true;
        }
        this.adviceUnreadable = unreadable;
        // Keep what we were given: leaving this page (or the app) must not throw
        // away a result that took two minutes to produce.
        if (advice.length() > 0) {
            store.saveAdvice(chapterId, chapterTitle, advice.toString());
        }

        Library.Book book = store.library().find(bookId);
        Library.Chapter chapter = book == null ? null : book.chapter(chapterId);
        if (chapter == null) {
            // Silently finishing looked exactly like "the advice page is empty"
            // from the other side of the screen.
            Toast.makeText(this, "这一章已经不在了，先回正文看看", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        // split with -1 keeps trailing empty lines, so joining the paragraphs
        // back together reproduces the chapter byte for byte.
        paragraphs = (chapter.content == null ? "" : chapter.content).split("\n", -1);
        if (paragraphs.length == 0) paragraphs = new String[] {""};

        buildUi();
        Skin.applyBars(this);
    }

    @Override
    public void onBackPressed() {
        // Finish only after the write lands. The editor that opened this page
        // reloads the chapter in its own onResume; finishing first would race
        // that reload and the editor would keep — and later save — the old text.
        saveAndFinish();
    }

    @Override
    protected void onPause() {
        super.onPause();
        flush();
    }

    // ------------------------------------------------------------------- view

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(color(R.color.nw_paper));

        root.addView(header());

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(16), dp(4), dp(16), dp(32));

        // Advice whose quote could not be found still has value — it goes at the
        // end under a heading rather than being dropped.
        List<JSONObject> orphans = new ArrayList<>();        List<List<JSONObject>> byParagraph = new ArrayList<>();
        for (int i = 0; i < paragraphs.length; i += 1) byParagraph.add(new ArrayList<JSONObject>());
        if (advice.length() == 0) {
            // An empty page is indistinguishable from a broken hand-off, so say
            // which one it is.
            TextView empty = new TextView(this);
            empty.setText(adviceUnreadable
                ? "建议没有传过来（这次的结果读不出来），再试一次就好"
                : "这一次没有值得改的地方");
            empty.setTextSize(13.5f);
            empty.setTextColor(color(R.color.nw_soft));
            empty.setPadding(dp(2), dp(10), dp(2), dp(10));
            list.addView(empty);
        }
        for (int i = 0; i < advice.length(); i += 1) {
            JSONObject item = advice.optJSONObject(i);
            if (item == null) continue;
            int index = paragraphOf(item);
            if (index >= 0 && index < byParagraph.size()) byParagraph.get(index).add(item);
            else orphans.add(item);
        }

        for (int i = 0; i < paragraphs.length; i += 1) {
            if (paragraphs[i].trim().isEmpty()) {
                // A blank line is structure, not an editable paragraph: it keeps
                // the gap between scenes without offering an empty text box.
                View gap = new View(this);
                list.addView(gap, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(10)));
                continue;
            }
            list.addView(paragraphField(i));
            for (JSONObject item : byParagraph.get(i)) list.addView(adviceCard(item));
        }

        if (!orphans.isEmpty()) {
            TextView heading = new TextView(this);
            heading.setText("没有对上的建议");
            heading.setTextSize(12);
            heading.setTextColor(color(R.color.nw_soft));
            heading.setPadding(dp(2), dp(22), 0, dp(6));
            list.addView(heading);
            for (JSONObject item : orphans) list.addView(adviceCard(item));
        }

        scroll.addView(list, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
    }

    private View header() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(18), dp(16), dp(18), dp(10));

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        Button back = new Button(this);
        back.setText("‹");
        back.setTextSize(24);
        back.setAllCaps(false);
        back.setMinWidth(0);
        back.setMinimumWidth(0);
        back.setPadding(dp(8), 0, dp(10), 0);
        back.setTextColor(color(R.color.nw_ink));
        back.setBackgroundResource(R.drawable.nw_touch_pill);
        back.setContentDescription("返回正文");
        back.setOnClickListener(v -> onBackPressed());
        row.addView(back);

        TextView title = new TextView(this);
        title.setText("修改建议");
        title.setTextSize(19);
        title.setTypeface(Typeface.create("serif", Typeface.BOLD));
        title.setTextColor(color(R.color.nw_ink));
        row.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView count = new TextView(this);
        count.setText(advice.length() + " 条");
        count.setTextSize(12);
        count.setTextColor(color(R.color.nw_soft));
        row.addView(count);
        box.addView(row);

        TextView hint = new TextView(this);
        hint.setText((chapterTitle.isEmpty() ? "" : chapterTitle + " · ") + "正文可直接改，建议只读");
        hint.setTextSize(11.5f);
        hint.setTextColor(color(R.color.nw_soft));
        hint.setPadding(dp(6), dp(4), 0, 0);
        box.addView(hint);
        return box;
    }

    /** One paragraph, editable in place. */
    private View paragraphField(final int index) {
        EditText field = new EditText(this);
        field.setText(paragraphs[index]);
        field.setTextSize(store.editTextSize());
        field.setTextColor(color(R.color.nw_ink));
        field.setBackgroundColor(0);
        field.setPadding(dp(2), dp(6), dp(2), dp(6));
        field.setLineSpacing(Math.round(store.editTextSize() * 0.45f), 1f);
        field.setGravity(Gravity.TOP | Gravity.START);
        field.setVerticalScrollBarEnabled(false);
        field.setHorizontalScrollBarEnabled(false);
        field.setOverScrollMode(View.OVER_SCROLL_NEVER);
        field.setInputType(InputType.TYPE_CLASS_TEXT
            | InputType.TYPE_TEXT_FLAG_MULTI_LINE
            | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        field.setTag(index);
        field.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {
            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
            }

            @Override
            public void afterTextChanged(Editable editable) {
                int slot = (Integer) field.getTag();
                if (slot < 0 || slot >= paragraphs.length) return;
                String next = editable.toString();
                if (next.equals(paragraphs[slot])) return;
                paragraphs[slot] = next;
                dirty = true;
                saver.removeCallbacks(saveTick);
                saver.postDelayed(saveTick, SAVE_DELAY_MS);
            }
        });
        fields.add(field);
        return field;
    }

    /**
     * The note under a paragraph.
     *
     * Read-only by construction: a TextView, not an EditText, and no click
     * handler, so tapping it cannot turn the advice into something the writer
     * types over. The quote is repeated here because on a phone the paragraph
     * above may be long enough that "this sentence" is not obvious.
     */
    private View adviceCard(JSONObject item) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(12), dp(14), dp(12));
        card.setBackgroundResource(R.drawable.nw_advice);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(dp(2), dp(4), dp(2), dp(16));
        card.setLayoutParams(params);

        String kind = kindLabel(item.optString("kind", ""));
        String severity = item.optString("severity", "");
        TextView tag = new TextView(this);
        tag.setText(severityLabel(severity, kind));
        tag.setTextSize(11);
        tag.setTextColor("high".equals(severity) ? color(R.color.nw_clay) : color(R.color.nw_soft));
        card.addView(tag);

        String quote = item.optString("quote", "");
        if (!quote.isEmpty()) {
            TextView line = new TextView(this);
            line.setText("「" + quote + "」");
            line.setTextSize(12.5f);
            line.setTextColor(color(R.color.nw_soft));
            line.setTypeface(Typeface.create("serif", Typeface.ITALIC));
            line.setPadding(0, dp(5), 0, 0);
            card.addView(line);
        }

        String issue = item.optString("issue", "");
        if (!issue.isEmpty()) {
            TextView text = new TextView(this);
            text.setText(issue);
            text.setTextSize(14.5f);
            text.setTextColor(color(R.color.nw_ink));
            text.setPadding(0, dp(6), 0, 0);
            card.addView(text);
        }

        String why = item.optString("why", "");
        if (!why.isEmpty()) {
            TextView text = new TextView(this);
            text.setText(why);
            text.setTextSize(12.5f);
            text.setTextColor(color(R.color.nw_soft));
            text.setPadding(0, dp(4), 0, 0);
            card.addView(text);
        }

        String adviceText = item.optString("advice", "");
        if (!adviceText.isEmpty()) {
            TextView text = new TextView(this);
            text.setText(adviceText);
            text.setTextSize(14);
            text.setTextColor(color(R.color.nw_clay));
            text.setPadding(0, dp(8), 0, 0);
            card.addView(text);
        }

        String example = item.optString("example", "");
        if (!example.isEmpty()) {
            TextView text = new TextView(this);
            text.setText("例：" + example);
            text.setTextSize(13);
            text.setTextColor(color(R.color.nw_ink));
            text.setAlpha(0.85f);
            text.setPadding(dp(10), dp(6), dp(2), 0);
            card.addView(text);
        }
        return card;
    }

    // ------------------------------------------------------------ positioning

    /**
     * Which paragraph a note belongs to.
     *
     * The host already locates the quote and returns `start` (or -1). Trust the
     * offset when we have it — counting newlines up to it is exact — and fall
     * back to a plain substring search so an advice from a slightly older
     * snapshot still lands somewhere sensible.
     */
    private int paragraphOf(JSONObject item) {
        int start = item.optInt("start", -1);
        if (start >= 0) start += baseOffset;
        if (start > 0) {
            int offset = 0;
            for (int i = 0; i < paragraphs.length; i += 1) {
                int end = offset + paragraphs[i].length();
                if (start <= end) return i;
                offset = end + 1;
            }
        }
        String quote = item.optString("quote", "");
        if (!quote.isEmpty()) {
            for (int i = 0; i < paragraphs.length; i += 1) {
                if (paragraphs[i].contains(quote)) return i;
            }
        }
        return -1;
    }

    // ------------------------------------------------------------------ saving

    private void flush() {
        saver.removeCallbacks(saveTick);
        if (!dirty) return;
        dirty = false;
        final String text = joinedText();
        store.updateInBackground(library -> {
            Library.Book book = library.find(bookId);
            if (book == null || book.deleted) return false;
            Library.Chapter hit = book.chapter(chapterId);
            if (hit == null) return false;
            String before = hit.content == null ? "" : hit.content;
            if (before.equals(text)) return false;
            hit.content = text;
            book.touch();
            return true;
        }, changed -> {
            if (changed) SyncEngine.pushSoon(this);
        });
    }

    /** Same write, but `finish()` waits for it. Used by back / the ‹ button. */
    private void saveAndFinish() {
        saver.removeCallbacks(saveTick);
        if (!dirty) {
            finish();
            return;
        }
        dirty = false;
        final String text = joinedText();
        store.updateInBackground(library -> {
            Library.Book book = library.find(bookId);
            if (book == null || book.deleted) return false;
            Library.Chapter hit = book.chapter(chapterId);
            if (hit == null) return false;
            String before = hit.content == null ? "" : hit.content;
            if (before.equals(text)) return false;
            hit.content = text;
            book.touch();
            return true;
        }, changed -> {
            if (changed) SyncEngine.pushSoon(this);
            finish();
        });
    }

    /** The chapter as the fields currently read it. */
    private String joinedText() {
        StringBuilder joined = new StringBuilder();
        for (int i = 0; i < paragraphs.length; i += 1) {
            if (i > 0) joined.append('\n');
            joined.append(paragraphs[i] == null ? "" : paragraphs[i]);
        }
        return joined.toString();
    }

    // ---------------------------------------------------------------- helpers

    private static String kindLabel(String kind) {
        switch (kind == null ? "" : kind) {
            case "rhythm": return "节奏";
            case "diction": return "语言";
            case "pov": return "视角";
            case "detail": return "画面";
            case "dialogue": return "对话";
            case "structure": return "结构";
            case "character": return "人物";
            case "logic": return "逻辑";
            case "emotion": return "情绪";
            case "redundancy": return "冗余";
            default: return "建议";
        }
    }

    private static String severityLabel(String severity, String kind) {
        String level = "high".equals(severity) ? "高" : "low".equals(severity) ? "低" : "中";
        return kind + " · " + level;
    }

    private int color(int id) {
        return Skin.color(this, id);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
