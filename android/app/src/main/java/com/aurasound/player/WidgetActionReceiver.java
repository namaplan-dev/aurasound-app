package com.aurasound.player;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class WidgetActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String rawAction = intent.getAction();
        String mapped = null;
        if (WidgetStateHelper.ACTION_PREV.equals(rawAction)) {
            mapped = "prev";
        } else if (WidgetStateHelper.ACTION_TOGGLE.equals(rawAction)) {
            mapped = "toggle";
        } else if (WidgetStateHelper.ACTION_NEXT.equals(rawAction)) {
            mapped = "next";
        }
        if (mapped == null) return;

        boolean delivered = AuraWidgetPlugin.dispatchWidgetAction(mapped);
        if (!delivered) {
            WidgetStateHelper.setPendingAction(context, mapped);
            Intent launch = new Intent(context, MainActivity.class);
            launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            launch.putExtra(WidgetStateHelper.EXTRA_WIDGET_ACTION, mapped);
            context.startActivity(launch);
        }
    }
}
