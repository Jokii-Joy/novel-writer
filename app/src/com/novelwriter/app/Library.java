package com.novelwriter.app;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * The phone's copy of the library — deliberately the same shape the desktop's
 * sync engine merges (`{version, books:[{id,title,author,updatedAt,deleted,
 * chapters:[{id,title,content,order}]}]}`).
 *
 * Why one shape for both sides: the conflict rule is book-level last-write-wins,
 * which only works if both ends can read the other's timestamps. A phone-specific
 * format would need a translation layer, and a translation layer is where
 * millisecond timestamps silently become seconds.
 */
public final class Library {

    public static final class Chapter {
        public String id;
        public String title;
        public String content;
        public int order;

        Chapter copy() {
            Chapter out = new Chapter();
            out.id = id;
            out.title = title;
            out.content = content;
            out.order = order;
            return out;
        }
    }

    public static final class Book {
        public String id;
        public String title = "";
        public String author = "";
        public long updatedAt;
        public boolean deleted;
        public final List<Chapter> chapters = new ArrayList<>();

        /** Marks the book as edited "now" — the timestamp the merge compares. */
        public void touch() {
            updatedAt = System.currentTimeMillis();
        }

        Chapter chapter(String chapterId) {
            for (Chapter row : chapters) {
                if (row.id != null && row.id.equals(chapterId)) return row;
            }
            return null;
        }
    }

    public final List<Book> books = new ArrayList<>();

    // ------------------------------------------------------------------ load

    public static Library fromJson(JSONObject raw) {
        Library lib = new Library();
        if (raw == null) return lib;
        JSONArray rows = raw.optJSONArray("books");
        if (rows == null) return lib;
        for (int i = 0; i < rows.length(); i += 1) {
            JSONObject row = rows.optJSONObject(i);
            if (row == null) continue;
            Book book = new Book();
            book.id = row.optString("id", "");
            if (book.id.isEmpty()) continue;
            book.title = row.optString("title", "");
            book.author = row.optString("author", "");
            book.updatedAt = row.optLong("updatedAt", 0L);
            book.deleted = row.optBoolean("deleted", false);
            JSONArray chapters = row.optJSONArray("chapters");
            if (chapters != null) {
                for (int c = 0; c < chapters.length(); c += 1) {
                    JSONObject ch = chapters.optJSONObject(c);
                    if (ch == null) continue;
                    Chapter chapter = new Chapter();
                    chapter.id = ch.optString("id", "");
                    if (chapter.id.isEmpty()) continue;
                    chapter.title = ch.optString("title", "");
                    chapter.content = ch.optString("content", "");
                    chapter.order = ch.optInt("order", c);
                    book.chapters.add(chapter);
                }
            }
            lib.books.add(book);
        }
        return lib;
    }

    public JSONObject toJson() {
        JSONObject root = new JSONObject();
        try {
            root.put("version", 1);
            JSONArray rows = new JSONArray();
            for (Book book : books) rows.put(bookJson(book));
            root.put("books", rows);
        } catch (JSONException error) {
            // JSONObject only throws on non-finite numbers here; nothing to lose.
        }
        return root;
    }

    private static JSONObject bookJson(Book book) throws JSONException {
        JSONObject out = new JSONObject();
        out.put("id", book.id);
        out.put("title", book.title == null ? "" : book.title);
        out.put("author", book.author == null ? "" : book.author);
        out.put("updatedAt", book.updatedAt);
        out.put("deleted", book.deleted);
        JSONArray chapters = new JSONArray();
        for (Chapter chapter : book.chapters) {
            JSONObject row = new JSONObject();
            row.put("id", chapter.id);
            row.put("title", chapter.title == null ? "" : chapter.title);
            row.put("content", chapter.content == null ? "" : chapter.content);
            row.put("order", chapter.order);
            chapters.put(row);
        }
        out.put("chapters", chapters);
        return out;
    }

    // --------------------------------------------------------------- editing

    /** Books the list should show: alive, newest first. */
    public List<Book> visibleBooks() {
        List<Book> out = new ArrayList<>();
        for (Book book : books) {
            if (!book.deleted) out.add(book);
        }
        out.sort((a, b) -> {
            if (b.updatedAt != a.updatedAt) return Long.compare(b.updatedAt, a.updatedAt);
            return a.id.compareTo(b.id);
        });
        return out;
    }

    public Book find(String id) {
        for (Book book : books) {
            if (book.id != null && book.id.equals(id)) return book;
        }
        return null;
    }

    public Book findByTitle(String title) {
        for (Book book : books) {
            if (book.deleted) continue;
            if (book.title != null && book.title.equals(title)) return book;
        }
        return null;
    }

    /**
     * Deletes a book the way the merge engine understands.
     *
     * The row stays in the file as a tombstone. Dropping it entirely would look
     * identical to "this phone never had that book", so the desktop would keep its
     * copy and the next sync would resurrect what the user just deleted — the
     * exact failure the product spec calls out.
     */
    public void tombstone(Book book) {
        if (book == null) return;
        book.deleted = true;
        book.chapters.clear();
        book.touch();
    }

    /**
     * Folds a library that came back from the desktop into this one.
     *
     * The desktop resolves conflicts and sends the winner, so its answer is
     * authoritative for everything it knew about when the request left. What it
     * cannot know about is an edit made while that request was in flight: the
     * editor writes the whole library to SharedPreferences, and overwriting the
     * file with the reply afterwards silently drops whatever was typed in those
     * few hundred milliseconds. Merging by id and timestamp keeps that edit and
     * still takes every other book, chapter change and tombstone from the reply.
     */
    public void mergeIn(Library incoming) {
        if (incoming == null) return;
        for (Book fresh : incoming.books) {
            Book mine = find(fresh.id);
            if (mine == null) {
                books.add(fresh);
                continue;
            }
            if (fresh.updatedAt <= mine.updatedAt) continue;
            if (fresh.deleted) {
                mine.deleted = true;
                mine.chapters.clear();
            } else {
                mine.deleted = false;
                mine.chapters.clear();
                mine.chapters.addAll(fresh.chapters);
            }
            mine.title = fresh.title;
            mine.author = fresh.author;
            mine.updatedAt = fresh.updatedAt;
        }
    }

    public static Book createBook(String title) {
        Book book = new Book();
        book.id = UUID.randomUUID().toString();
        book.title = title == null ? "" : title.trim();
        book.touch();
        Chapter first = new Chapter();
        first.id = UUID.randomUUID().toString();
        first.title = "第一章";
        first.content = "";
        first.order = 0;
        book.chapters.add(first);
        return book;
    }

    public static Chapter createChapter(Book book, String title) {
        Chapter chapter = new Chapter();
        chapter.id = UUID.randomUUID().toString();
        chapter.title = title == null ? "" : title.trim();
        chapter.content = "";
        chapter.order = book == null ? 0 : book.chapters.size();
        return chapter;
    }
}
