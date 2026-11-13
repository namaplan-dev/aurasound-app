package com.aurasound.player;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.widget.RemoteViews;

public final class WidgetStateHelper {
    public static final String PREFS_NAME = "aurasound_widget_prefs";
    public static final String ACTION_PREV = "com.aurasound.player.ACTION_WIDGET_PREV";
    public static final String ACTION_TOGGLE = "com.aurasound.player.ACTION_WIDGET_TOGGLE";
    public static final String ACTION_NEXT = "com.aurasound.player.ACTION_WIDGET_NEXT";
    public static final String EXTRA_WIDGET_ACTION = "aurasound_widget_action";

    private static final String KEY_TITLE = "title";
    private static final String KEY_ARTIST = "artist";
    private static final String KEY_ALBUM = "album";
    private static final String KEY_FORMAT = "formatBadge";
    private static final String KEY_PLAYING = "isPlaying";
    private static final String KEY_PENDING_ACTION = "pendingAction";

    private WidgetStateHelper() {}

    public static void saveState(
        Context context,
        String title,
        String artist,
        String album,
        String formatBadge,
        boolean isPlaying
    ) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString(KEY_TITLE, title != null && !title.isEmpty() ? title : "AuraSound Hi-Fi")
            .putString(KEY_ARTIST, artist != null && !artist.isEmpty() ? artist : "Tap to browse library")
            .putString(KEY_ALBUM, album != null && !album.isEmpty() ? album : "Local Studio Library")
            .putString(KEY_FORMAT, formatBadge != null && !formatBadge.isEmpty() ? formatBadge : "AURASOUND · HI-FI")
            .putBoolean(KEY_PLAYING, isPlaying)
            .apply();
    }

    public static void setPendingAction(Context context, String action) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_PENDING_ACTION, action).apply();
    }

    public static String consumePendingAction(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String action = prefs.getString(KEY_PENDING_ACTION, null);
        if (action != null) {
            prefs.edit().remove(KEY_PENDING_ACTION).apply();
        }
        return action;
    }

    public static void updateAllWidgets(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String title = prefs.getString(KEY_TITLE, "AuraSound Hi-Fi");
        String artist = prefs.getString(KEY_ARTIST, "Tap to open player");
        String album = prefs.getString(KEY_ALBUM, "Local Studio Library");
        String formatBadge = prefs.getString(KEY_FORMAT, "AURASOUND · HI-FI");
        boolean isPlaying = prefs.getBoolean(KEY_PLAYING, false);

        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int playIcon = isPlaying ? R.drawable.ic_widget_pause : R.drawable.ic_widget_play;

        PendingIntent openAppIntent = createOpenAppPendingIntent(context);
        PendingIntent prevIntent = createActionPendingIntent(context, ACTION_PREV, 101);
        PendingIntent toggleIntent = createActionPendingIntent(context, ACTION_TOGGLE, 102);
        PendingIntent nextIntent = createActionPendingIntent(context, ACTION_NEXT, 103);

        // 1. Update Compact Top Bar (4x1) widgets
        ComponentName miniComp = new ComponentName(context, AuraWidgetMiniProvider.class);
        int[] miniIds = manager.getAppWidgetIds(miniComp);
        if (miniIds != null && miniIds.length > 0) {
            RemoteViews miniViews = new RemoteViews(context.getPackageName(), R.layout.widget_aurasound_mini);
            miniViews.setTextViewText(R.id.widget_mini_title, title);
            miniViews.setTextViewText(R.id.widget_mini_artist, artist);
            miniViews.setImageViewResource(R.id.widget_mini_play, playIcon);
            miniViews.setOnClickPendingIntent(R.id.widget_mini_root, openAppIntent);
            miniViews.setOnClickPendingIntent(R.id.widget_mini_prev, prevIntent);
            miniViews.setOnClickPendingIntent(R.id.widget_mini_play, toggleIntent);
            miniViews.setOnClickPendingIntent(R.id.widget_mini_next, nextIntent);
            manager.updateAppWidget(miniIds, miniViews);
        }

        // 2. Update Studio Deck (4x2) widgets
        ComponentName studioComp = new ComponentName(context, AuraWidgetLargeProvider.class);
        int[] studioIds = manager.getAppWidgetIds(studioComp);
        if (studioIds != null && studioIds.length > 0) {
            RemoteViews studioViews = new RemoteViews(context.getPackageName(), R.layout.widget_aurasound_studio);
            studioViews.setTextViewText(R.id.widget_studio_badge, formatBadge);
            studioViews.setTextViewText(R.id.widget_studio_title, title);
            studioViews.setTextViewText(R.id.widget_studio_artist, artist);
            studioViews.setTextViewText(R.id.widget_studio_album, album);
            studioViews.setImageViewResource(R.id.widget_studio_play, playIcon);
            studioViews.setOnClickPendingIntent(R.id.widget_studio_root, openAppIntent);
            studioViews.setOnClickPendingIntent(R.id.widget_studio_prev, prevIntent);
            studioViews.setOnClickPendingIntent(R.id.widget_studio_play, toggleIntent);
            studioViews.setOnClickPendingIntent(R.id.widget_studio_next, nextIntent);
            manager.updateAppWidget(studioIds, studioViews);
        }
    }

    private static PendingIntent createOpenAppPendingIntent(Context context) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT |
            (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getActivity(context, 100, intent, flags);
    }

    private static PendingIntent createActionPendingIntent(Context context, String action, int requestCode) {
        Intent intent = new Intent(context, WidgetActionReceiver.class);
        intent.setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT |
            (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getBroadcast(context, requestCode, intent, flags);
    }
}
