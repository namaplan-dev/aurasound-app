package com.aurasound.player;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalMusicScannerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
