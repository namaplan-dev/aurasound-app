package com.aurasound.player;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AuraWidget")
public class AuraWidgetPlugin extends Plugin {
    private static volatile AuraWidgetPlugin activeInstance;

    @Override
    public void load() {
        activeInstance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
        }
    }

    @PluginMethod
    public void syncState(PluginCall call) {
        String title = call.getString("title", "AuraSound Hi-Fi");
        String artist = call.getString("artist", "Tap to open player");
        String album = call.getString("album", "Local Studio Library");
        String formatBadge = call.getString("formatBadge", "AURASOUND · HI-FI");
        boolean isPlaying = Boolean.TRUE.equals(call.getBoolean("isPlaying", false));

        WidgetStateHelper.saveState(getContext(), title, artist, album, formatBadge, isPlaying);
        WidgetStateHelper.updateAllWidgets(getContext());
        call.resolve();
    }

    @PluginMethod
    public void consumePendingAction(PluginCall call) {
        String action = WidgetStateHelper.consumePendingAction(getContext());
        JSObject res = new JSObject();
        res.put("action", action);
        call.resolve(res);
    }

    public static boolean dispatchWidgetAction(String action) {
        AuraWidgetPlugin instance = activeInstance;
        if (instance == null || instance.getBridge() == null) {
            return false;
        }
        JSObject payload = new JSObject();
        payload.put("action", action);
        instance.notifyListeners("widgetAction", payload, true);
        return true;
    }
}
