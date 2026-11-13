package com.aurasound.player;

import android.Manifest;
import android.content.ContentUris;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "LocalMusicScanner",
    permissions = {
        @Permission(alias = "audio", strings = { Manifest.permission.READ_MEDIA_AUDIO }),
        @Permission(alias = "legacyStorage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
    }
)
public class LocalMusicScannerPlugin extends Plugin {

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private String getRequiredPermissionAlias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? "audio" : "legacyStorage";
    }

    @PluginMethod
    public void scanDeviceAudio(PluginCall call) {
        String alias = getRequiredPermissionAlias();
        if (getPermissionState(alias) != PermissionState.GRANTED) {
            requestPermissionForAlias(alias, call, "audioPermissionsCallback");
            return;
        }
        runMediaStoreScan(call);
    }

    @PermissionCallback
    private void audioPermissionsCallback(PluginCall call) {
        String alias = getRequiredPermissionAlias();
        if (getPermissionState(alias) == PermissionState.GRANTED) {
            runMediaStoreScan(call);
        } else {
            call.reject("Audio storage permission denied. Please allow music access in Android Settings.");
        }
    }

    private void runMediaStoreScan(PluginCall call) {
        executor.execute(() -> {
            try {
                JSArray tracks = queryMediaStoreAudio();
                JSObject result = new JSObject();
                result.put("tracks", tracks);
                result.put("count", tracks.length());
                call.resolve(result);
            } catch (Exception ex) {
                call.reject("Failed to scan device audio: " + ex.getMessage(), ex);
            }
        });
    }

    private JSArray queryMediaStoreAudio() {
        JSArray results = new JSArray();
        Uri collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;

        List<String> projectionList = new ArrayList<>();
        projectionList.add(MediaStore.Audio.Media._ID);
        projectionList.add(MediaStore.Audio.Media.TITLE);
        projectionList.add(MediaStore.Audio.Media.ARTIST);
        projectionList.add(MediaStore.Audio.Media.ALBUM);
        projectionList.add(MediaStore.Audio.Media.ALBUM_ID);
        projectionList.add(MediaStore.Audio.Media.DURATION);
        projectionList.add(MediaStore.Audio.Media.SIZE);
        projectionList.add(MediaStore.Audio.Media.MIME_TYPE);
        projectionList.add(MediaStore.Audio.Media.DATA);
        projectionList.add(MediaStore.Audio.Media.DISPLAY_NAME);
        projectionList.add(MediaStore.Audio.Media.IS_MUSIC);
        projectionList.add(MediaStore.Audio.Media.DATE_ADDED);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            projectionList.add(MediaStore.Audio.Media.RELATIVE_PATH);
            projectionList.add(MediaStore.Audio.Media.BITRATE);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            projectionList.add(MediaStore.Audio.Media.GENRE);
        }

        String[] projection = projectionList.toArray(new String[0]);
        String selection = MediaStore.Audio.Media.IS_MUSIC + " != 0";
        String sortOrder = MediaStore.Audio.Media.TITLE + " COLLATE NOCASE ASC";

        try (Cursor cursor = getContext().getContentResolver().query(collection, projection, selection, null, sortOrder)) {
            if (cursor == null) return results;

            int totalRows = cursor.getCount();
            emitScanProgress(0, totalRows, "Scanning device music folders...");

            int idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
            int titleCol = cursor.getColumnIndex(MediaStore.Audio.Media.TITLE);
            int artistCol = cursor.getColumnIndex(MediaStore.Audio.Media.ARTIST);
            int albumCol = cursor.getColumnIndex(MediaStore.Audio.Media.ALBUM);
            int durationCol = cursor.getColumnIndex(MediaStore.Audio.Media.DURATION);
            int sizeCol = cursor.getColumnIndex(MediaStore.Audio.Media.SIZE);
            int mimeCol = cursor.getColumnIndex(MediaStore.Audio.Media.MIME_TYPE);
            int dataCol = cursor.getColumnIndex(MediaStore.Audio.Media.DATA);
            int displayNameCol = cursor.getColumnIndex(MediaStore.Audio.Media.DISPLAY_NAME);
            int dateAddedCol = cursor.getColumnIndex(MediaStore.Audio.Media.DATE_ADDED);
            int relPathCol = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? cursor.getColumnIndex(MediaStore.Audio.Media.RELATIVE_PATH)
                : -1;
            int bitrateCol = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? cursor.getColumnIndex(MediaStore.Audio.Media.BITRATE)
                : -1;
            int genreCol = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? cursor.getColumnIndex(MediaStore.Audio.Media.GENRE)
                : -1;

            int scannedRow = 0;
            while (cursor.moveToNext()) {
                scannedRow++;
                long id = cursor.getLong(idCol);
                long durationMs = durationCol >= 0 ? cursor.getLong(durationCol) : 0L;
                long size = sizeCol >= 0 ? cursor.getLong(sizeCol) : 0L;
                String displayName = displayNameCol >= 0 ? safeStr(cursor.getString(displayNameCol)) : "";
                String dataPath = dataCol >= 0 ? safeStr(cursor.getString(dataCol)) : "";
                String mimeType = mimeCol >= 0 ? safeStr(cursor.getString(mimeCol)) : "";

                if (scannedRow == 1 || scannedRow % 10 == 0 || scannedRow == totalRows) {
                    emitScanProgress(scannedRow, Math.max(totalRows, scannedRow), !displayName.isEmpty() ? displayName : "Scanning audio...");
                }

                if (size <= 4096) continue;
                if (durationMs > 0 && durationMs < 10000) continue;

                String lowerName = (!displayName.isEmpty() ? displayName : dataPath).toLowerCase(Locale.ROOT);
                String title = titleCol >= 0 ? safeStr(cursor.getString(titleCol)) : "";
                if (title.isEmpty()) {
                    title = stripExtension(!displayName.isEmpty() ? displayName : new File(dataPath).getName());
                }

                String artist = artistCol >= 0 ? safeStr(cursor.getString(artistCol)) : "";
                if (artist.isEmpty() || "<unknown>".equalsIgnoreCase(artist)) {
                    artist = "Unknown Artist";
                }

                String album = albumCol >= 0 ? safeStr(cursor.getString(albumCol)) : "";
                if (album.isEmpty() || "<unknown>".equalsIgnoreCase(album)) {
                    album = "Local Collection";
                }

                String genre = genreCol >= 0 ? safeStr(cursor.getString(genreCol)) : "";
                if (genre.isEmpty()) {
                    genre = "Local Audio";
                }

                String folderPath = "";
                if (relPathCol >= 0) {
                    folderPath = safeStr(cursor.getString(relPathCol)).replaceAll("/+$", "");
                }
                if (folderPath.isEmpty() && !dataPath.isEmpty()) {
                    File parent = new File(dataPath).getParentFile();
                    folderPath = parent != null ? parent.getName() : "Device Music";
                }
                if (folderPath.isEmpty()) {
                    folderPath = "Device Music";
                }

                Uri contentUri = ContentUris.withAppendedId(collection, id);
                String albumArtUri = "";

                int durationSec = Math.max(1, (int) Math.round(durationMs / 1000.0));
                String format = detectFormat(lowerName, mimeType);
                int bitrateBps = bitrateCol >= 0 ? cursor.getInt(bitrateCol) : 0;
                int bitrateKbps = bitrateBps > 0
                    ? Math.max(64, Math.round(bitrateBps / 1000f))
                    : (durationSec > 0 ? Math.max(128, (int) Math.round((size * 8.0) / durationSec / 1000.0)) : 320);

                int sampleRate = ("FLAC".equals(format) || "WAV".equals(format)) ? 48000 : 44100;
                int bitDepth = ("FLAC".equals(format) || "WAV".equals(format) || "ALAC".equals(format)) ? 24 : 16;
                long addedAtMs = dateAddedCol >= 0 ? cursor.getLong(dateAddedCol) * 1000L : System.currentTimeMillis();

                JSObject item = new JSObject();
                item.put("mediaId", id);
                item.put("title", title);
                item.put("artist", artist);
                item.put("album", album);
                item.put("genre", genre);
                item.put("durationSec", durationSec);
                item.put("fileName", !displayName.isEmpty() ? displayName : new File(dataPath).getName());
                item.put("folderPath", folderPath);
                item.put("filePath", dataPath);
                item.put("contentUri", contentUri.toString());
                item.put("albumArtUri", albumArtUri);
                item.put("fileSize", size);
                item.put("format", format);
                item.put("sampleRate", sampleRate);
                item.put("bitDepth", bitDepth);
                item.put("bitrateKbps", bitrateKbps);
                item.put("addedAt", addedAtMs);
                results.put(item);
            }

            emitScanProgress(totalRows, totalRows, "Completed device scan");
        }

        return results;
    }

    private void emitScanProgress(int current, int total, String fileName) {
        JSObject payload = new JSObject();
        payload.put("current", current);
        payload.put("total", total);
        payload.put("fileName", fileName);
        notifyListeners("scanProgress", payload);
    }

    private String safeStr(String value) {
        return value == null ? "" : value.trim();
    }

    private String stripExtension(String name) {
        int dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(0, dot) : name;
    }

    private String detectFormat(String lowerName, String mimeType) {
        if (lowerName.endsWith(".flac") || mimeType.contains("flac")) return "FLAC";
        if (lowerName.endsWith(".wav") || lowerName.endsWith(".wave") || mimeType.contains("wav")) return "WAV";
        if (lowerName.endsWith(".alac") || mimeType.contains("alac")) return "ALAC";
        if (lowerName.endsWith(".m4a")) return "ALAC";
        if (lowerName.endsWith(".ogg") || lowerName.endsWith(".oga") || lowerName.endsWith(".opus") || mimeType.contains("ogg") || mimeType.contains("opus")) return "OGG";
        if (lowerName.endsWith(".aac") || mimeType.contains("aac")) return "AAC";
        return "MP3";
    }
}
