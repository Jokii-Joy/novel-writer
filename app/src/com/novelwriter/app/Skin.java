package com.novelwriter.app;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.os.Build;
import android.view.View;
import android.view.Window;

/**
 * 白天 / 黑夜, and nothing else.
 *
 * The app builds every screen in code, so "theme" is three things: which
 * resource qualifier the colours resolve under, what the status bar says, and
 * which parent theme the platform uses for the widgets we did not touch (dialogs,
 * text fields). Night resources plus a configuration override handle all three:
 *
 *   - {@link #wrap} is called from attachBaseContext, i.e. before any view exists,
 *     so {@code R.color.nw_paper} already returns the night value on the first
 *     frame. Switching mode therefore recreates the activity instead of walking
 *     the tree and repainting every TextView by hand.
 *   - the choice lives in SharedPreferences, not in the context, so it survives
 *     the recreate and applies to the next activity too.
 *
 * Deliberately not AppCompatDelegate: the app has no AndroidX dependency and one
 * bundled dex, and this is the whole of what that delegate would do for us.
 */
public final class Skin {

    private static final String PREFS = "novel-writer";
    private static final String KEY_NIGHT = "night";

    private Skin() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static boolean night(Context context) {
        return prefs(context).getBoolean(KEY_NIGHT, false);
    }

    public static void setNight(Context context, boolean on) {
        prefs(context).edit().putBoolean(KEY_NIGHT, on).apply();
    }

    public static boolean toggle(Context context) {
        boolean next = !night(context);
        setNight(context, next);
        return next;
    }

    /** Overrides the uiMode of the base context so values-night is selected. */
    public static Context wrap(Context base) {
        if (base == null) return null;
        int want = night(base) ? Configuration.UI_MODE_NIGHT_YES : Configuration.UI_MODE_NIGHT_NO;
        Configuration config = new Configuration(base.getResources().getConfiguration());
        if ((config.uiMode & Configuration.UI_MODE_NIGHT_MASK) == want) return base;
        config.uiMode = (config.uiMode & ~Configuration.UI_MODE_NIGHT_MASK) | want;
        return base.createConfigurationContext(config);
    }

    /**
     * Paints the system bars to match the page.
     *
     * The status bar icons are light-on-dark or dark-on-light depending on the
     * mode; without this the clock and battery disappear into the strip in one of
     * the two themes. Called after setContentView because the decor view does not
     * exist before that.
     */
    public static void applyBars(Activity activity) {
        Window window = activity.getWindow();
        if (window == null) return;
        int bar = activity.getResources().getColor(R.color.nw_bar);
        window.setStatusBarColor(bar);
        window.setNavigationBarColor(bar);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        View decor = window.getDecorView();
        int flags = decor.getSystemUiVisibility();
        if (night(activity)) {
            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        } else {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        decor.setSystemUiVisibility(flags);
    }

    public static int color(Context context, int id) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) return context.getColor(id);
        return context.getResources().getColor(id);
    }
}
