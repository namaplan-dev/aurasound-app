package com.aurasound.player;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeAuth")
public class NativeAuthPlugin extends Plugin {
    private static NativeAuthPlugin activeInstance;

    @Override
    public void load() {
        activeInstance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
        }
        super.handleOnDestroy();
    }

    public static void dispatchAuthCallback(String url) {
        if (activeInstance == null || url == null || url.isEmpty()) return;
        JSObject payload = new JSObject();
        payload.put("url", url);
        activeInstance.notifyListeners("authCallback", payload, true);
    }

    @PluginMethod
    public void openAuthUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Missing auth URL.");
            return;
        }
        Uri uri = Uri.parse(url);
        try {
            // Prefer Chrome Custom Tab extras so Gmail OAuth runs in a real browser, never WebView
            Intent customTabIntent = new Intent(Intent.ACTION_VIEW, uri);
            Bundle extras = new Bundle();
            extras.putBinder("android.support.customtabs.extra.SESSION", null);
            customTabIntent.putExtras(extras);
            customTabIntent.putExtra("android.support.customtabs.extra.TITLE_VISIBILITY", 1);
            customTabIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(customTabIntent);
            call.resolve();
        } catch (ActivityNotFoundException ex) {
            try {
                Intent fallback = new Intent(Intent.ACTION_VIEW, uri);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve();
            } catch (Exception err) {
                call.reject("No browser available for Google sign-in.", err);
            }
        }
    }
}
