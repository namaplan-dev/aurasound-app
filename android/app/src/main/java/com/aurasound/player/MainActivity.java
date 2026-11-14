package com.aurasound.player;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalMusicScannerPlugin.class);
        registerPlugin(AuraWidgetPlugin.class);
        registerPlugin(NativeAuthPlugin.class);
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, true);
        window.setStatusBarColor(Color.parseColor("#09090B"));
        window.setNavigationBarColor(Color.parseColor("#09090B"));

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller != null) {
            controller.setAppearanceLightStatusBars(false);
            controller.setAppearanceLightNavigationBars(false);
        }

        // Explicitly pad root content inside system bars + display cutouts for Android 15/16 edge-to-edge
        View rootView = findViewById(android.R.id.content);
        if (rootView != null) {
            ViewCompat.setOnApplyWindowInsetsListener(rootView, (v, windowInsets) -> {
                Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                );
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsetsCompat.CONSUMED;
            });
            ViewCompat.requestApplyInsets(rootView);
        }

        handleWidgetIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleWidgetIntent(intent);
    }

    private void handleWidgetIntent(Intent intent) {
        if (intent == null) return;
        if (intent.getData() != null) {
            String uriString = intent.getData().toString();
            if (uriString.startsWith("aurasound://auth")) {
                NativeAuthPlugin.dispatchAuthCallback(uriString);
            }
        }
        String action = intent.getStringExtra(WidgetStateHelper.EXTRA_WIDGET_ACTION);
        if (action != null && !action.isEmpty()) {
            WidgetStateHelper.setPendingAction(this, action);
            AuraWidgetPlugin.dispatchWidgetAction(action);
            intent.removeExtra(WidgetStateHelper.EXTRA_WIDGET_ACTION);
        }
    }
}
