package com.aurasound.player;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.app.RecoverableSecurityException;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.Settings;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import android.media.MediaMetadataRetriever;
import android.util.Base64;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "LocalMusicScanner",
    permissions = {
        @Permission(alias = "audio", strings = { Manifest.permission.READ_MEDIA_AUDIO }),
        @Permission(alias = "legacyStorage", strings = {
            Manifest.permission.READ_EXTERNAL_STORAGE,
            Manifest.permission.WRITE_EXTERNAL_STORAGE
        })
    }
)
public class LocalMusicScannerPlugin extends Plugin {

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private ActivityResultLauncher<IntentSenderRequest> deleteIntentLauncher;
    private ActivityResultLauncher<IntentSenderRequest> writeIntentLauncher;
    private ActivityResultLauncher<Intent> writeSettingsLauncher;
    private ActivityResultLauncher<Intent> folderPickerLauncher;

    private PluginCall pendingDeleteCall;
    private List<Uri> pendingDeleteUris = new ArrayList<>();
    private List<String> pendingDeletePaths = new ArrayList<>();

    private PluginCall pendingWriteCall;
    private List<TagWriteItem> pendingWriteItems = new ArrayList<>();

    private PluginCall pendingRingtoneCall;
    private Uri pendingRingtoneUri;
    private String pendingRingtonePath = "";

    private PluginCall pendingFolderCall;

    private static class TagWriteItem {
        final Uri uri;
        final String filePath;
        final String title;
        final String artist;
        final String album;
        final String genre;
        final String year;
        final String composer;
        final String lyrics;
        final boolean hasLyricsField;

        TagWriteItem(
            Uri uri,
            String filePath,
            String title,
            String artist,
            String album,
            String genre,
            String year,
            String composer,
            String lyrics,
            boolean hasLyricsField
        ) {
            this.uri = uri;
            this.filePath = filePath;
            this.title = title;
            this.artist = artist;
            this.album = album;
            this.genre = genre;
            this.year = year;
            this.composer = composer;
            this.lyrics = lyrics;
            this.hasLyricsField = hasLyricsField;
        }
    }

    @Override
    public void load() {
        super.load();
        deleteIntentLauncher = getBridge().registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(),
            result -> {
                PluginCall call = pendingDeleteCall;
                List<Uri> uris = new ArrayList<>(pendingDeleteUris);
                List<String> paths = new ArrayList<>(pendingDeletePaths);
                pendingDeleteCall = null;
                pendingDeleteUris.clear();
                pendingDeletePaths.clear();

                if (call == null) return;
                if (result.getResultCode() == Activity.RESULT_OK) {
                    executor.execute(() -> {
                        int count = uris.size();
                        for (String p : paths) {
                            if (p != null && !p.isEmpty()) {
                                File f = new File(p);
                                if (f.exists()) {
                                    // Clean up leftover file path if outside MediaStore
                                    f.delete();
                                }
                            }
                        }
                        if (!paths.isEmpty()) {
                            MediaScannerConnection.scanFile(
                                getContext(),
                                paths.toArray(new String[0]),
                                null,
                                null
                            );
                        }
                        JSObject res = new JSObject();
                        res.put("deletedCount", count);
                        res.put("cancelled", false);
                        res.put("diskDeleted", true);
                        call.resolve(res);
                    });
                } else {
                    JSObject res = new JSObject();
                    res.put("deletedCount", 0);
                    res.put("cancelled", true);
                    res.put("diskDeleted", false);
                    call.resolve(res);
                }
            }
        );

        writeIntentLauncher = getBridge().registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(),
            result -> {
                PluginCall call = pendingWriteCall;
                List<TagWriteItem> items = new ArrayList<>(pendingWriteItems);
                pendingWriteCall = null;
                pendingWriteItems.clear();

                if (call == null) return;
                if (result.getResultCode() == Activity.RESULT_OK) {
                    executeTagWritesAsync(call, items);
                } else {
                    JSObject res = new JSObject();
                    res.put("updatedCount", 0);
                    res.put("cancelled", true);
                    call.resolve(res);
                }
            }
        );

        writeSettingsLauncher = getBridge().registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                PluginCall call = pendingRingtoneCall;
                Uri uri = pendingRingtoneUri;
                String path = pendingRingtonePath;
                pendingRingtoneCall = null;
                pendingRingtoneUri = null;
                pendingRingtonePath = "";

                if (call == null) return;
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.System.canWrite(getContext())) {
                    applyRingtoneInternal(call, uri, path);
                } else {
                    JSObject res = new JSObject();
                    res.put("success", false);
                    res.put("cancelled", true);
                    call.resolve(res);
                }
            }
        );

        folderPickerLauncher = getBridge().registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                PluginCall call = pendingFolderCall;
                pendingFolderCall = null;
                if (call == null) return;

                if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null && result.getData().getData() != null) {
                    Uri treeUri = result.getData().getData();
                    try {
                        int takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
                        getContext().getContentResolver().takePersistableUriPermission(treeUri, takeFlags);
                    } catch (Exception ignored) {
                        try {
                            getContext().getContentResolver().takePersistableUriPermission(
                                treeUri,
                                Intent.FLAG_GRANT_READ_URI_PERMISSION
                            );
                        } catch (Exception ignored2) {
                            // Persistable grant is best-effort
                        }
                    }
                    String folderPath = extractRelativePathFromTreeUri(treeUri);
                    String label = extractFolderLabel(folderPath);
                    JSObject res = new JSObject();
                    res.put("cancelled", false);
                    res.put("path", folderPath);
                    res.put("label", label);
                    res.put("treeUri", treeUri.toString());
                    call.resolve(res);
                } else {
                    JSObject res = new JSObject();
                    res.put("cancelled", true);
                    call.resolve(res);
                }
            }
        );
    }

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

    @PluginMethod
    public void listDeviceMusicFolders(PluginCall call) {
        String alias = getRequiredPermissionAlias();
        if (getPermissionState(alias) != PermissionState.GRANTED) {
            requestPermissionForAlias(alias, call, "folderPermissionsCallback");
            return;
        }
        runFolderDiscovery(call);
    }

    @PermissionCallback
    private void folderPermissionsCallback(PluginCall call) {
        String alias = getRequiredPermissionAlias();
        if (getPermissionState(alias) == PermissionState.GRANTED) {
            runFolderDiscovery(call);
        } else {
            call.reject("Audio storage permission denied. Please allow music access in Android Settings.");
        }
    }

    @PluginMethod
    public void pickDeviceFolder(PluginCall call) {
        try {
            pendingFolderCall = call;
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            intent.addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION |
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
            );
            getActivity().runOnUiThread(() -> folderPickerLauncher.launch(intent));
        } catch (Exception ex) {
            pendingFolderCall = null;
            call.reject("Unable to open Android folder picker: " + ex.getMessage(), ex);
        }
    }

    @PluginMethod
    public void deleteAudioFiles(PluginCall call) {
        JSArray urisArr = call.getArray("uris");
        JSArray pathsArr = call.getArray("paths");

        List<Uri> uriList = new ArrayList<>();
        if (urisArr != null) {
            for (int i = 0; i < urisArr.length(); i++) {
                String raw = urisArr.optString(i, "").trim();
                if (!raw.isEmpty()) {
                    try {
                        Uri parsed = Uri.parse(raw);
                        if ("content".equals(parsed.getScheme())) {
                            uriList.add(parsed);
                        }
                    } catch (Exception ignored) {
                        // ignore invalid uri
                    }
                }
            }
        }

        List<String> pathList = new ArrayList<>();
        if (pathsArr != null) {
            for (int i = 0; i < pathsArr.length(); i++) {
                String p = pathsArr.optString(i, "").trim();
                if (!p.isEmpty()) pathList.add(p);
            }
        }

        if (uriList.isEmpty() && pathList.isEmpty()) {
            JSObject res = new JSObject();
            res.put("deletedCount", 0);
            res.put("cancelled", false);
            res.put("diskDeleted", false);
            call.resolve(res);
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && !uriList.isEmpty()) {
            try {
                PendingIntent pi = MediaStore.createDeleteRequest(
                    getContext().getContentResolver(),
                    uriList
                );
                pendingDeleteCall = call;
                pendingDeleteUris = uriList;
                pendingDeletePaths = pathList;
                IntentSenderRequest request = new IntentSenderRequest.Builder(pi.getIntentSender()).build();
                getActivity().runOnUiThread(() -> deleteIntentLauncher.launch(request));
                return;
            } catch (Exception ex) {
                call.reject("Unable to request Android storage delete permission: " + ex.getMessage(), ex);
                return;
            }
        }

        // Legacy Android <= 10 deletion path
        executor.execute(() -> {
            int deleted = 0;
            ContentResolver resolver = getContext().getContentResolver();
            for (Uri uri : uriList) {
                try {
                    deleted += resolver.delete(uri, null, null);
                } catch (SecurityException secEx) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && secEx instanceof RecoverableSecurityException) {
                        RecoverableSecurityException rse = (RecoverableSecurityException) secEx;
                        pendingDeleteCall = call;
                        pendingDeleteUris = uriList;
                        pendingDeletePaths = pathList;
                        IntentSenderRequest req = new IntentSenderRequest.Builder(
                            rse.getUserAction().getActionIntent().getIntentSender()
                        ).build();
                        getActivity().runOnUiThread(() -> deleteIntentLauncher.launch(req));
                        return;
                    }
                } catch (Exception ignored) {
                    // fallback to File delete below
                }
            }

            for (String p : pathList) {
                File f = new File(p);
                if (f.exists() && f.delete()) {
                    deleted++;
                }
            }
            if (!pathList.isEmpty()) {
                MediaScannerConnection.scanFile(
                    getContext(),
                    pathList.toArray(new String[0]),
                    null,
                    null
                );
            }
            JSObject res = new JSObject();
            res.put("deletedCount", deleted);
            res.put("cancelled", false);
            res.put("diskDeleted", deleted > 0);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void writeAudioTags(PluginCall call) {
        JSArray updatesArr = call.getArray("updates");
        if (updatesArr == null || updatesArr.length() == 0) {
            JSObject res = new JSObject();
            res.put("updatedCount", 0);
            res.put("cancelled", false);
            call.resolve(res);
            return;
        }

        List<TagWriteItem> items = new ArrayList<>();
        List<Uri> urisNeedingWrite = new ArrayList<>();

        for (int i = 0; i < updatesArr.length(); i++) {
            JSONObject obj = updatesArr.optJSONObject(i);
            if (obj == null) continue;
            String rawUri = obj.optString("contentUri", "").trim();
            String filePath = obj.optString("filePath", "").trim();
            Uri uri = null;
            if (!rawUri.isEmpty()) {
                try {
                    Uri parsed = Uri.parse(rawUri);
                    if ("content".equals(parsed.getScheme())) {
                        uri = parsed;
                        urisNeedingWrite.add(parsed);
                    }
                } catch (Exception ignored) {
                    uri = null;
                }
            }
            if (uri == null && filePath.isEmpty()) continue;

            boolean hasLyrics = obj.has("lyrics") && !obj.isNull("lyrics");
            items.add(new TagWriteItem(
                uri,
                filePath,
                obj.optString("title", ""),
                obj.optString("artist", ""),
                obj.optString("album", ""),
                obj.optString("genre", ""),
                obj.optString("year", ""),
                obj.optString("composer", ""),
                obj.optString("lyrics", "").trim(),
                hasLyrics
            ));
        }

        if (items.isEmpty()) {
            JSObject res = new JSObject();
            res.put("updatedCount", 0);
            res.put("cancelled", false);
            call.resolve(res);
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && !urisNeedingWrite.isEmpty()) {
            try {
                PendingIntent pi = MediaStore.createWriteRequest(
                    getContext().getContentResolver(),
                    urisNeedingWrite
                );
                pendingWriteCall = call;
                pendingWriteItems = items;
                IntentSenderRequest req = new IntentSenderRequest.Builder(pi.getIntentSender()).build();
                getActivity().runOnUiThread(() -> writeIntentLauncher.launch(req));
                return;
            } catch (Exception ex) {
                call.reject("Unable to request Android audio write permission: " + ex.getMessage(), ex);
                return;
            }
        }

        executeTagWritesAsync(call, items);
    }

    @PluginMethod
    public void setAsRingtone(PluginCall call) {
        String rawUri = call.getString("contentUri", "").trim();
        String filePath = call.getString("filePath", "").trim();

        Uri targetUri = null;
        if (!rawUri.isEmpty()) {
            try {
                targetUri = Uri.parse(rawUri);
            } catch (Exception ignored) {
                targetUri = null;
            }
        }
        if (targetUri == null && !filePath.isEmpty()) {
            targetUri = Uri.fromFile(new File(filePath));
        }

        if (targetUri == null) {
            call.reject("Missing audio URI for ringtone.");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.System.canWrite(getContext())) {
            pendingRingtoneCall = call;
            pendingRingtoneUri = targetUri;
            pendingRingtonePath = filePath;
            Intent intent = new Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            getActivity().runOnUiThread(() -> writeSettingsLauncher.launch(intent));
            return;
        }

        applyRingtoneInternal(call, targetUri, filePath);
    }

    private void applyRingtoneInternal(PluginCall call, Uri targetUri, String filePath) {
        executor.execute(() -> {
            try {
                if (targetUri != null && "content".equals(targetUri.getScheme())) {
                    try {
                        ContentValues cv = new ContentValues();
                        cv.put(MediaStore.Audio.Media.IS_RINGTONE, 1);
                        getContext().getContentResolver().update(targetUri, cv, null, null);
                    } catch (Exception ignored) {
                        // Some scoped MediaStore rows block column updates; setActualDefaultRingtoneUri still works
                    }
                }
                RingtoneManager.setActualDefaultRingtoneUri(
                    getContext(),
                    RingtoneManager.TYPE_RINGTONE,
                    targetUri
                );
                JSObject res = new JSObject();
                res.put("success", true);
                res.put("cancelled", false);
                res.put("uri", targetUri != null ? targetUri.toString() : filePath);
                call.resolve(res);
            } catch (Exception ex) {
                call.reject("Unable to set ringtone: " + ex.getMessage(), ex);
            }
        });
    }

    @PluginMethod
    public void readAudioFileBase64(PluginCall call) {
        String rawUri = call.getString("contentUri", "").trim();
        String filePath = call.getString("filePath", "").trim();
        int maxBytes = Math.min(20 * 1024 * 1024, Math.max(1024 * 1024, call.getInt("maxBytes", 18 * 1024 * 1024)));

        executor.execute(() -> {
            try (InputStream in = !rawUri.isEmpty() && rawUri.startsWith("content://")
                ? getContext().getContentResolver().openInputStream(Uri.parse(rawUri))
                : (!filePath.isEmpty() ? new FileInputStream(filePath) : null)
            ) {
                if (in == null) {
                    call.reject("Unable to open audio recording file.");
                    return;
                }
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[32768];
                int n;
                int total = 0;
                while ((n = in.read(buf)) > 0) {
                    if (total + n > maxBytes) {
                        call.reject("Recording exceeds 18 MB limit for direct transfer.");
                        return;
                    }
                    bos.write(buf, 0, n);
                    total += n;
                }
                String b64 = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
                JSObject res = new JSObject();
                res.put("base64", b64);
                res.put("byteLength", total);
                call.resolve(res);
            } catch (Exception ex) {
                call.reject("Failed to read audio recording: " + ex.getMessage(), ex);
            }
        });
    }

    @PluginMethod
    public void saveTranscriptNearSource(PluginCall call) {
        String rawUri = call.getString("contentUri", "").trim();
        String filePath = call.getString("filePath", "").trim();
        String folderTreeUriStr = call.getString("folderTreeUri", "").trim();
        String fileName = call.getString("fileName", "").trim();
        String textContent = call.getString("textContent", "");

        if (fileName.isEmpty()) {
            call.reject("Missing transcript file name.");
            return;
        }
        if (textContent == null) textContent = "";

        final String safeText = textContent;
        executor.execute(() -> {
            ContentResolver resolver = getContext().getContentResolver();
            byte[] payload = safeText.getBytes(StandardCharsets.UTF_8);

            // 1. Try SAF writable tree URI if user picked this recording folder via SAF
            if (!folderTreeUriStr.isEmpty()) {
                try {
                    Uri treeUri = Uri.parse(folderTreeUriStr);
                    String treeDocId = DocumentsContract.getTreeDocumentId(treeUri);
                    Uri parentDocUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, treeDocId);
                    Uri existingDoc = findChildDocumentByName(resolver, treeUri, treeDocId, fileName);
                    Uri targetDocUri = existingDoc != null
                        ? existingDoc
                        : DocumentsContract.createDocument(resolver, parentDocUri, "text/plain", fileName);
                    if (targetDocUri != null) {
                        try (OutputStream out = resolver.openOutputStream(targetDocUri, "wt")) {
                            if (out != null) {
                                out.write(payload);
                                out.flush();
                                JSObject res = new JSObject();
                                res.put("success", true);
                                res.put("savedPath", extractRelativePathFromTreeUri(treeUri) + "/" + fileName);
                                res.put("nearSource", true);
                                call.resolve(res);
                                return;
                            }
                        }
                    }
                } catch (Exception ignored) {
                    // Fall through to File / MediaStore methods
                }
            }

            // 2. Try writing directly next to filePath when direct filesystem access is permitted
            if (!filePath.isEmpty()) {
                try {
                    File src = new File(filePath);
                    File parentDir = src.getParentFile();
                    if (parentDir != null && (parentDir.exists() || parentDir.mkdirs())) {
                        File outFile = new File(parentDir, fileName);
                        try (FileOutputStream fos = new FileOutputStream(outFile, false)) {
                            fos.write(payload);
                            fos.flush();
                        }
                        MediaScannerConnection.scanFile(
                            getContext(),
                            new String[] { outFile.getAbsolutePath() },
                            new String[] { "text/plain" },
                            null
                        );
                        JSObject res = new JSObject();
                        res.put("success", true);
                        res.put("savedPath", outFile.getAbsolutePath());
                        res.put("nearSource", true);
                        call.resolve(res);
                        return;
                    }
                } catch (Exception ignored) {
                    // Scoped storage on Android 10+ may reject direct File write outside app dirs
                }
            }

            // 3. Try MediaStore.Files with matching RELATIVE_PATH on Android 10+
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                String relFolder = "";
                if (!rawUri.isEmpty()) {
                    try {
                        Uri srcUri = Uri.parse(rawUri);
                        try (Cursor c = resolver.query(
                            srcUri,
                            new String[] { MediaStore.Audio.Media.RELATIVE_PATH },
                            null,
                            null,
                            null
                        )) {
                            if (c != null && c.moveToFirst()) {
                                int col = c.getColumnIndex(MediaStore.Audio.Media.RELATIVE_PATH);
                                if (col >= 0) relFolder = safeStr(c.getString(col));
                            }
                        }
                    } catch (Exception ignored) {
                        // ignore
                    }
                }
                if (relFolder.isEmpty() && !filePath.isEmpty()) {
                    relFolder = resolveRelativeFolderPath("", filePath);
                    if ("Device Music".equals(relFolder)) relFolder = "";
                }
                if (!relFolder.isEmpty() && !relFolder.endsWith("/")) {
                    relFolder = relFolder + "/";
                }

                Uri filesUri = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                String[] attemptPaths = !relFolder.isEmpty()
                    ? new String[] { relFolder, Environment.DIRECTORY_DOCUMENTS + "/AuraSound Transcripts/" }
                    : new String[] { Environment.DIRECTORY_DOCUMENTS + "/AuraSound Transcripts/" };

                for (int i = 0; i < attemptPaths.length; i++) {
                    String targetRel = attemptPaths[i];
                    try {
                        // Remove any prior duplicate file owned by app with same path/name
                        try {
                            resolver.delete(
                                filesUri,
                                MediaStore.Files.FileColumns.DISPLAY_NAME + "=? AND " + MediaStore.MediaColumns.RELATIVE_PATH + "=?",
                                new String[] { fileName, targetRel }
                            );
                        } catch (Exception ignored) {
                            // ignore
                        }

                        ContentValues cv = new ContentValues();
                        cv.put(MediaStore.Files.FileColumns.DISPLAY_NAME, fileName);
                        cv.put(MediaStore.Files.FileColumns.MIME_TYPE, "text/plain");
                        cv.put(MediaStore.MediaColumns.RELATIVE_PATH, targetRel);
                        Uri inserted = resolver.insert(filesUri, cv);
                        if (inserted != null) {
                            try (OutputStream out = resolver.openOutputStream(inserted, "wt")) {
                                if (out != null) {
                                    out.write(payload);
                                    out.flush();
                                    JSObject res = new JSObject();
                                    res.put("success", true);
                                    res.put("savedPath", targetRel + fileName);
                                    res.put("nearSource", i == 0 && !relFolder.isEmpty());
                                    call.resolve(res);
                                    return;
                                }
                            }
                        }
                    } catch (Exception ignored) {
                        // Try fallback Documents directory on OEM Scoped Storage restrictions
                    }
                }
            }

            call.reject("Could not write transcript text file to phone storage. Add this folder with Add Folder to grant write access.");
        });
    }

    private Uri findChildDocumentByName(ContentResolver resolver, Uri treeUri, String parentDocId, String targetName) {
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocId);
        try (Cursor c = resolver.query(
            childrenUri,
            new String[] {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            },
            null,
            null,
            null
        )) {
            if (c != null) {
                int idIdx = c.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
                int nameIdx = c.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
                while (c.moveToNext()) {
                    String name = nameIdx >= 0 ? safeStr(c.getString(nameIdx)) : "";
                    if (targetName.equalsIgnoreCase(name)) {
                        String docId = idIdx >= 0 ? c.getString(idIdx) : null;
                        if (docId != null) {
                            return DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
                        }
                    }
                }
            }
        } catch (Exception ignored) {
            // ignore
        }
        return null;
    }

    private void executeTagWritesAsync(PluginCall call, List<TagWriteItem> items) {
        executor.execute(() -> {
            int updatedCount = 0;
            int embeddedCount = 0;
            List<String> scanPaths = new ArrayList<>();
            int total = items.size();

            for (int i = 0; i < total; i++) {
                TagWriteItem item = items.get(i);
                emitTagWriteProgress(i, total, !item.title.isEmpty() ? item.title : "Updating audio tags...");

                boolean wroteFile = false;
                try {
                    wroteFile = rewriteEmbeddedTagsOnItem(item);
                    if (wroteFile) {
                        embeddedCount++;
                    }
                } catch (Exception ignored) {
                    wroteFile = false;
                }

                // Also update MediaStore row directly on legacy Android where writable
                if (item.uri != null && Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                    try {
                        ContentValues cv = new ContentValues();
                        if (!item.title.isEmpty()) cv.put(MediaStore.Audio.Media.TITLE, item.title);
                        if (!item.artist.isEmpty()) cv.put(MediaStore.Audio.Media.ARTIST, item.artist);
                        if (!item.album.isEmpty()) cv.put(MediaStore.Audio.Media.ALBUM, item.album);
                        if (cv.size() > 0) {
                            getContext().getContentResolver().update(item.uri, cv, null, null);
                        }
                    } catch (Exception ignored) {
                        // Scoped MediaStore columns may be read-only; MediaScanner below refreshes from file tags
                    }
                }

                if (wroteFile) {
                    updatedCount++;
                }
                if (item.filePath != null && !item.filePath.isEmpty()) {
                    scanPaths.add(item.filePath);
                }

                emitTagWriteProgress(i + 1, total, !item.title.isEmpty() ? item.title : "Saved audio tags");
            }

            if (!scanPaths.isEmpty()) {
                MediaScannerConnection.scanFile(
                    getContext(),
                    scanPaths.toArray(new String[0]),
                    null,
                    null
                );
            }

            JSObject res = new JSObject();
            res.put("updatedCount", updatedCount);
            res.put("embeddedCount", embeddedCount);
            res.put("cancelled", false);
            call.resolve(res);
        });
    }

    private boolean rewriteEmbeddedTagsOnItem(TagWriteItem item) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        byte[] head = new byte[12];
        int headRead = 0;

        try (InputStream probe = openInputForItem(resolver, item)) {
            if (probe == null) return false;
            while (headRead < 12) {
                int r = probe.read(head, headRead, 12 - headRead);
                if (r <= 0) break;
                headRead += r;
            }
        }

        if (headRead < 4) return false;

        boolean isFlac = head[0] == 'f' && head[1] == 'L' && head[2] == 'a' && head[3] == 'C';
        String lowerPath = item.filePath != null ? item.filePath.toLowerCase(Locale.ROOT) : "";
        boolean isMp3 =
            lowerPath.endsWith(".mp3") ||
            (head[0] == 'I' && head[1] == 'D' && head[2] == '3') ||
            (headRead >= 2 && (head[0] & 0xFF) == 0xFF && (head[1] & 0xE0) == 0xE0);

        if (!isFlac && !isMp3) {
            return false;
        }

        File tempFile = File.createTempFile("aurasound_tag_", ".tmp", getContext().getCacheDir());
        try {
            boolean rewrote;
            if (isFlac) {
                rewrote = rewriteFlacToTemp(resolver, item, tempFile);
            } else {
                rewrote = rewriteMp3ToTemp(resolver, item, tempFile);
            }
            if (!rewrote) return false;

            try (InputStream in = new BufferedInputStream(new FileInputStream(tempFile));
                 OutputStream out = openOutputForItem(resolver, item)) {
                if (out == null) return false;
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                }
                out.flush();
            }
            return true;
        } finally {
            //noinspection ResultOfMethodCallIgnored
            tempFile.delete();
        }
    }

    private InputStream openInputForItem(ContentResolver resolver, TagWriteItem item) throws IOException {
        if (item.uri != null) {
            return resolver.openInputStream(item.uri);
        }
        if (item.filePath != null && !item.filePath.isEmpty()) {
            return new FileInputStream(item.filePath);
        }
        return null;
    }

    private OutputStream openOutputForItem(ContentResolver resolver, TagWriteItem item) throws IOException {
        if (item.uri != null) {
            return resolver.openOutputStream(item.uri, "wt");
        }
        if (item.filePath != null && !item.filePath.isEmpty()) {
            return new FileOutputStream(item.filePath, false);
        }
        return null;
    }

    private static final Set<String> REPLACED_ID3_FRAMES = new HashSet<>(Arrays.asList(
        "TIT2", "TPE1", "TALB", "TCON", "TYER", "TDRC", "TCOM",
        "TT2", "TP1", "TAL", "TCO", "TYE", "TCM"
    ));

    private static final Set<String> LYRICS_ID3_FRAMES = new HashSet<>(Arrays.asList(
        "USLT", "SYLT", "ULT"
    ));

    private boolean rewriteMp3ToTemp(ContentResolver resolver, TagWriteItem item, File tempFile) throws IOException {
        byte[] header10 = new byte[10];
        int oldTagTotalBytes = 0;
        List<byte[]> preservedFrames = new ArrayList<>();

        try (InputStream in = new BufferedInputStream(openInputForItem(resolver, item))) {
            if (in == null) return false;
            int n = readFully(in, header10, 0, 10);
            if (n == 10 && header10[0] == 'I' && header10[1] == 'D' && header10[2] == '3') {
                int version = header10[3] & 0xFF;
                int flags = header10[5] & 0xFF;
                int tagBodySize = readSynchsafeInt(header10, 6);
                oldTagTotalBytes = 10 + tagBodySize;
                if (tagBodySize > 0 && tagBodySize <= 24 * 1024 * 1024) {
                    byte[] tagBody = new byte[tagBodySize];
                    int got = readFully(in, tagBody, 0, tagBodySize);
                    parsePreservedId3Frames(tagBody, got, version, flags, item.hasLyricsField, preservedFrames);
                }
            }
        }

        List<byte[]> allFrames = new ArrayList<>();
        if (!item.title.isEmpty()) allFrames.add(encodeId3v23TextFrame("TIT2", item.title));
        if (!item.artist.isEmpty()) allFrames.add(encodeId3v23TextFrame("TPE1", item.artist));
        if (!item.album.isEmpty()) allFrames.add(encodeId3v23TextFrame("TALB", item.album));
        if (!item.genre.isEmpty()) allFrames.add(encodeId3v23TextFrame("TCON", item.genre));
        if (!item.year.isEmpty()) {
            String yr = item.year.replaceAll("[^0-9]", "");
            if (yr.length() >= 4) {
                allFrames.add(encodeId3v23TextFrame("TYER", yr.substring(0, 4)));
            }
        }
        if (!item.composer.isEmpty()) allFrames.add(encodeId3v23TextFrame("TCOM", item.composer));
        if (item.hasLyricsField && !item.lyrics.isEmpty()) {
            allFrames.add(encodeId3v23UsltFrame(item.lyrics));
        }
        allFrames.addAll(preservedFrames);

        int framesBytesLen = 0;
        for (byte[] f : allFrames) framesBytesLen += f.length;

        int paddingSize = 256;
        int totalTagSize = framesBytesLen + paddingSize;

        byte[] newHeader = new byte[10];
        newHeader[0] = 'I';
        newHeader[1] = 'D';
        newHeader[2] = '3';
        newHeader[3] = 3; // ID3v2.3
        newHeader[4] = 0;
        newHeader[5] = 0;
        writeSynchsafeInt(newHeader, 6, totalTagSize);

        try (InputStream in = new BufferedInputStream(openInputForItem(resolver, item));
             OutputStream out = new BufferedOutputStream(new FileOutputStream(tempFile))) {
            if (in == null) return false;
            skipFully(in, oldTagTotalBytes);

            out.write(newHeader);
            for (byte[] f : allFrames) {
                out.write(f);
            }
            out.write(new byte[paddingSize]);

            // Stream remaining audio bytes with a 128-byte sliding tail buffer to detect & update ID3v1
            byte[] tail128 = new byte[128];
            int tailFill = readFully(in, tail128, 0, 128);
            byte[] chunk = new byte[32768];
            int readLen;
            while ((readLen = in.read(chunk)) > 0) {
                if (readLen >= 128) {
                    out.write(tail128, 0, tailFill);
                    out.write(chunk, 0, readLen - 128);
                    System.arraycopy(chunk, readLen - 128, tail128, 0, 128);
                    tailFill = 128;
                } else {
                    out.write(tail128, 0, readLen);
                    System.arraycopy(tail128, readLen, tail128, 0, 128 - readLen);
                    System.arraycopy(chunk, 0, tail128, 128 - readLen, readLen);
                }
            }

            if (tailFill == 128 && tail128[0] == 'T' && tail128[1] == 'A' && tail128[2] == 'G') {
                updateId3v1Tag(tail128, item);
            }
            if (tailFill > 0) {
                out.write(tail128, 0, tailFill);
            }
            out.flush();
        }
        return true;
    }

    private void parsePreservedId3Frames(
        byte[] tagBody,
        int len,
        int version,
        int flags,
        boolean replaceLyrics,
        List<byte[]> out
    ) {
        if (version != 3 && version != 4) return;
        int pos = 0;
        if ((flags & 0x40) != 0 && pos + 4 <= len) {
            int extSize = version == 4 ? readSynchsafeInt(tagBody, pos) : readUint32BE(tagBody, pos);
            pos += version == 4 ? extSize : 4 + extSize;
        }
        while (pos + 10 <= len) {
            if (tagBody[pos] == 0) break;
            String frameId = new String(tagBody, pos, 4, StandardCharsets.US_ASCII);
            int size = version == 4 ? readSynchsafeInt(tagBody, pos + 4) : readUint32BE(tagBody, pos + 4);
            byte f0 = tagBody[pos + 8];
            byte f1 = tagBody[pos + 9];
            pos += 10;
            if (size <= 0 || pos + size > len) break;
            boolean shouldReplace =
                REPLACED_ID3_FRAMES.contains(frameId) ||
                (replaceLyrics && LYRICS_ID3_FRAMES.contains(frameId));
            if (!shouldReplace) {
                byte[] rebuilt = new byte[10 + size];
                byte[] idBytes = frameId.getBytes(StandardCharsets.US_ASCII);
                System.arraycopy(idBytes, 0, rebuilt, 0, 4);
                writeUint32BE(rebuilt, 4, size);
                rebuilt[8] = f0;
                rebuilt[9] = f1;
                System.arraycopy(tagBody, pos, rebuilt, 10, size);
                out.add(rebuilt);
            }
            pos += size;
        }
    }

    private static final Set<String> REPLACED_VORBIS_KEYS = new HashSet<>(Arrays.asList(
        "TITLE", "ARTIST", "ALBUM", "GENRE", "DATE", "YEAR", "COMPOSER"
    ));

    private static final Set<String> LYRICS_VORBIS_KEYS = new HashSet<>(Arrays.asList(
        "LYRICS", "UNSYNCEDLYRICS"
    ));

    private boolean rewriteFlacToTemp(ContentResolver resolver, TagWriteItem item, File tempFile) throws IOException {
        List<Integer> keptTypes = new ArrayList<>();
        List<byte[]> keptData = new ArrayList<>();
        String vendorStr = "reference libFLAC 1.4.3";
        List<String> preservedComments = new ArrayList<>();
        long audioStartOffset = 4;

        try (InputStream in = new BufferedInputStream(openInputForItem(resolver, item))) {
            if (in == null) return false;
            byte[] magic = new byte[4];
            if (readFully(in, magic, 0, 4) != 4 || magic[0] != 'f' || magic[1] != 'L' || magic[2] != 'a' || magic[3] != 'C') {
                return false;
            }
            boolean isLast = false;
            byte[] blkHdr = new byte[4];
            while (!isLast && readFully(in, blkHdr, 0, 4) == 4) {
                audioStartOffset += 4;
                isLast = (blkHdr[0] & 0x80) != 0;
                int blkType = blkHdr[0] & 0x7F;
                int blkLen = ((blkHdr[1] & 0xFF) << 16) | ((blkHdr[2] & 0xFF) << 8) | (blkHdr[3] & 0xFF);
                if (blkLen < 0 || blkLen > 20 * 1024 * 1024) return false;
                byte[] blkData = new byte[blkLen];
                if (readFully(in, blkData, 0, blkLen) != blkLen) return false;
                audioStartOffset += blkLen;

                if (blkType == 4) {
                    int pos = 0;
                    if (pos + 4 <= blkData.length) {
                        int vLen = readUint32LE(blkData, pos);
                        pos += 4;
                        if (vLen >= 0 && pos + vLen <= blkData.length) {
                            String v = new String(blkData, pos, vLen, StandardCharsets.UTF_8);
                            if (!v.isEmpty()) vendorStr = v;
                            pos += vLen;
                        }
                    }
                    if (pos + 4 <= blkData.length) {
                        int count = readUint32LE(blkData, pos);
                        pos += 4;
                        for (int i = 0; i < count && pos + 4 <= blkData.length; i++) {
                            int eLen = readUint32LE(blkData, pos);
                            pos += 4;
                            if (eLen < 0 || pos + eLen > blkData.length) break;
                            String entry = new String(blkData, pos, eLen, StandardCharsets.UTF_8);
                            pos += eLen;
                            int eq = entry.indexOf('=');
                            if (eq > 0) {
                                String key = entry.substring(0, eq).trim().toUpperCase(Locale.ROOT);
                                boolean shouldReplace =
                                    REPLACED_VORBIS_KEYS.contains(key) ||
                                    (item.hasLyricsField && LYRICS_VORBIS_KEYS.contains(key));
                                if (!shouldReplace) {
                                    preservedComments.add(entry);
                                }
                            }
                        }
                    }
                } else if (blkType != 1) {
                    keptTypes.add(blkType);
                    keptData.add(blkData);
                }
            }
        }

        List<String> comments = new ArrayList<>();
        if (!item.title.isEmpty()) comments.add("TITLE=" + item.title);
        if (!item.artist.isEmpty()) comments.add("ARTIST=" + item.artist);
        if (!item.album.isEmpty()) comments.add("ALBUM=" + item.album);
        if (!item.genre.isEmpty()) comments.add("GENRE=" + item.genre);
        if (!item.year.isEmpty()) {
            String yr = item.year.replaceAll("[^0-9]", "");
            if (yr.length() >= 4) comments.add("DATE=" + yr.substring(0, 4));
        }
        if (!item.composer.isEmpty()) comments.add("COMPOSER=" + item.composer);
        if (item.hasLyricsField && !item.lyrics.isEmpty()) comments.add("LYRICS=" + item.lyrics);
        comments.addAll(preservedComments);

        ByteArrayOutputStream vorbisBuf = new ByteArrayOutputStream();
        byte[] vendorBytes = vendorStr.getBytes(StandardCharsets.UTF_8);
        writeUint32LEStream(vorbisBuf, vendorBytes.length);
        vorbisBuf.write(vendorBytes);
        writeUint32LEStream(vorbisBuf, comments.size());
        for (String c : comments) {
            byte[] cb = c.getBytes(StandardCharsets.UTF_8);
            writeUint32LEStream(vorbisBuf, cb.length);
            vorbisBuf.write(cb);
        }
        byte[] vorbisBytes = vorbisBuf.toByteArray();

        List<Integer> outTypes = new ArrayList<>();
        List<byte[]> outData = new ArrayList<>();
        boolean insertedVorbis = false;
        for (int i = 0; i < keptTypes.size(); i++) {
            outTypes.add(keptTypes.get(i));
            outData.add(keptData.get(i));
            if (keptTypes.get(i) == 0 && !insertedVorbis) {
                outTypes.add(4);
                outData.add(vorbisBytes);
                insertedVorbis = true;
            }
        }
        if (!insertedVorbis) {
            outTypes.add(4);
            outData.add(vorbisBytes);
        }
        outTypes.add(1);
        outData.add(new byte[512]); // PADDING block

        try (InputStream in = new BufferedInputStream(openInputForItem(resolver, item));
             OutputStream out = new BufferedOutputStream(new FileOutputStream(tempFile))) {
            if (in == null) return false;
            skipFully(in, audioStartOffset);
            out.write(new byte[] { 'f', 'L', 'a', 'C' });

            for (int i = 0; i < outTypes.size(); i++) {
                int type = outTypes.get(i);
                byte[] data = outData.get(i);
                boolean last = i == outTypes.size() - 1;
                byte[] hdr = new byte[4];
                hdr[0] = (byte) ((last ? 0x80 : 0x00) | (type & 0x7F));
                hdr[1] = (byte) ((data.length >>> 16) & 0xFF);
                hdr[2] = (byte) ((data.length >>> 8) & 0xFF);
                hdr[3] = (byte) (data.length & 0xFF);
                out.write(hdr);
                out.write(data);
            }

            byte[] buf = new byte[32768];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
            out.flush();
        }
        return true;
    }

    private byte[] encodeId3v23TextFrame(String frameId, String text) {
        byte[] utf16 = text.getBytes(StandardCharsets.UTF_16LE);
        int payloadLen = 1 + 2 + utf16.length;
        byte[] frame = new byte[10 + payloadLen];
        byte[] idBytes = frameId.getBytes(StandardCharsets.US_ASCII);
        System.arraycopy(idBytes, 0, frame, 0, 4);
        writeUint32BE(frame, 4, payloadLen);
        frame[8] = 0;
        frame[9] = 0;
        frame[10] = 0x01; // UTF-16 with BOM
        frame[11] = (byte) 0xFF;
        frame[12] = (byte) 0xFE;
        System.arraycopy(utf16, 0, frame, 13, utf16.length);
        return frame;
    }

    private byte[] encodeId3v23UsltFrame(String lyrics) {
        byte[] utf16 = lyrics.getBytes(StandardCharsets.UTF_16LE);
        int payloadLen = 1 + 3 + 4 + 2 + utf16.length;
        byte[] frame = new byte[10 + payloadLen];
        frame[0] = 'U';
        frame[1] = 'S';
        frame[2] = 'L';
        frame[3] = 'T';
        writeUint32BE(frame, 4, payloadLen);
        frame[8] = 0;
        frame[9] = 0;
        frame[10] = 0x01; // UTF-16 with BOM
        frame[11] = 'e';
        frame[12] = 'n';
        frame[13] = 'g';
        frame[14] = (byte) 0xFF; // Empty descriptor BOM + null terminator
        frame[15] = (byte) 0xFE;
        frame[16] = 0x00;
        frame[17] = 0x00;
        frame[18] = (byte) 0xFF; // Lyrics BOM
        frame[19] = (byte) 0xFE;
        System.arraycopy(utf16, 0, frame, 20, utf16.length);
        return frame;
    }

    private void updateId3v1Tag(byte[] tail128, TagWriteItem item) {
        writeId3v1Field(tail128, 3, 30, item.title);
        writeId3v1Field(tail128, 33, 30, item.artist);
        writeId3v1Field(tail128, 63, 30, item.album);
        if (!item.year.isEmpty()) {
            String yr = item.year.replaceAll("[^0-9]", "");
            if (yr.length() >= 4) writeId3v1Field(tail128, 93, 4, yr.substring(0, 4));
        }
    }

    private void writeId3v1Field(byte[] dst, int offset, int maxLen, String val) {
        if (val == null || val.isEmpty()) return;
        Arrays.fill(dst, offset, offset + maxLen, (byte) 0);
        byte[] src = val.getBytes(StandardCharsets.ISO_8859_1);
        int copyLen = Math.min(maxLen, src.length);
        System.arraycopy(src, 0, dst, offset, copyLen);
    }

    private int readFully(InputStream in, byte[] dst, int offset, int len) throws IOException {
        int total = 0;
        while (total < len) {
            int r = in.read(dst, offset + total, len - total);
            if (r <= 0) break;
            total += r;
        }
        return total;
    }

    private void skipFully(InputStream in, long bytesToSkip) throws IOException {
        long remaining = bytesToSkip;
        while (remaining > 0) {
            long skipped = in.skip(remaining);
            if (skipped <= 0) {
                if (in.read() == -1) break;
                remaining--;
            } else {
                remaining -= skipped;
            }
        }
    }

    private int readSynchsafeInt(byte[] buf, int offset) {
        return ((buf[offset] & 0x7F) << 21)
            | ((buf[offset + 1] & 0x7F) << 14)
            | ((buf[offset + 2] & 0x7F) << 7)
            | (buf[offset + 3] & 0x7F);
    }

    private void writeSynchsafeInt(byte[] out, int offset, int value) {
        out[offset] = (byte) ((value >>> 21) & 0x7F);
        out[offset + 1] = (byte) ((value >>> 14) & 0x7F);
        out[offset + 2] = (byte) ((value >>> 7) & 0x7F);
        out[offset + 3] = (byte) (value & 0x7F);
    }

    private int readUint32BE(byte[] buf, int offset) {
        return ((buf[offset] & 0xFF) << 24)
            | ((buf[offset + 1] & 0xFF) << 16)
            | ((buf[offset + 2] & 0xFF) << 8)
            | (buf[offset + 3] & 0xFF);
    }

    private void writeUint32BE(byte[] out, int offset, int value) {
        out[offset] = (byte) ((value >>> 24) & 0xFF);
        out[offset + 1] = (byte) ((value >>> 16) & 0xFF);
        out[offset + 2] = (byte) ((value >>> 8) & 0xFF);
        out[offset + 3] = (byte) (value & 0xFF);
    }

    private int readUint32LE(byte[] buf, int offset) {
        return (buf[offset] & 0xFF)
            | ((buf[offset + 1] & 0xFF) << 8)
            | ((buf[offset + 2] & 0xFF) << 16)
            | ((buf[offset + 3] & 0xFF) << 24);
    }

    private void writeUint32LEStream(OutputStream out, int val) throws IOException {
        out.write(val & 0xFF);
        out.write((val >>> 8) & 0xFF);
        out.write((val >>> 16) & 0xFF);
        out.write((val >>> 24) & 0xFF);
    }

    private String normalizeFolderKey(String raw) {
        if (raw == null) return "";
        String norm = raw.trim().replace('\\', '/');
        while (norm.startsWith("/")) norm = norm.substring(1);
        while (norm.endsWith("/")) norm = norm.substring(0, norm.length() - 1);
        return norm.toLowerCase(Locale.ROOT);
    }

    private String extractFolderLabel(String folderPath) {
        if (folderPath == null || folderPath.trim().isEmpty()) return "Device Music";
        String clean = folderPath.trim().replace('\\', '/').replaceAll("/+$", "");
        int idx = clean.lastIndexOf('/');
        return idx >= 0 && idx + 1 < clean.length() ? clean.substring(idx + 1) : clean;
    }

    private String extractRelativePathFromTreeUri(Uri treeUri) {
        try {
            String docId = DocumentsContract.getTreeDocumentId(treeUri);
            if (docId != null && !docId.trim().isEmpty()) {
                int colon = docId.indexOf(':');
                String after = colon >= 0 ? docId.substring(colon + 1) : docId;
                after = after.replace('\\', '/').replaceAll("^/+", "").replaceAll("/+$", "");
                if (!after.isEmpty()) {
                    return after;
                }
                return "Device Music";
            }
        } catch (Exception ignored) {
            // Fallback to URI path segment
        }
        String pathSeg = treeUri.getLastPathSegment();
        if (pathSeg != null && !pathSeg.isEmpty()) {
            int colon = pathSeg.indexOf(':');
            String clean = colon >= 0 ? pathSeg.substring(colon + 1) : pathSeg;
            clean = clean.replace('\\', '/').replaceAll("^/+", "").replaceAll("/+$", "");
            if (!clean.isEmpty()) return clean;
        }
        return "Device Music";
    }

    private String resolveRelativeFolderPath(String relPathColVal, String dataPath) {
        String folderPath = safeStr(relPathColVal).replace('\\', '/').replaceAll("^/+", "").replaceAll("/+$", "");
        if (folderPath.isEmpty() && !safeStr(dataPath).isEmpty()) {
            File parent = new File(dataPath).getParentFile();
            if (parent != null) {
                String parentAbs = parent.getAbsolutePath().replace('\\', '/');
                try {
                    String extRoot = Environment.getExternalStorageDirectory().getAbsolutePath().replace('\\', '/').replaceAll("/+$", "");
                    if (parentAbs.startsWith(extRoot + "/")) {
                        folderPath = parentAbs.substring(extRoot.length() + 1);
                    }
                } catch (Exception ignored) {
                    // ignore
                }
                if (folderPath.isEmpty()) {
                    folderPath = parent.getName();
                }
            }
        }
        if (folderPath.isEmpty()) {
            folderPath = "Device Music";
        }
        return folderPath;
    }

    private Set<String> parseAllowedFolders(PluginCall call) {
        Set<String> allowed = new HashSet<>();
        if (call == null) return allowed;
        JSArray arr = call.getArray("allowedFolders");
        if (arr == null) return allowed;
        for (int i = 0; i < arr.length(); i++) {
            String item = normalizeFolderKey(arr.optString(i, ""));
            if (!item.isEmpty()) {
                allowed.add(item);
            }
        }
        return allowed;
    }

    private boolean folderMatchesAllowed(String folderPath, Set<String> allowedSet) {
        if (allowedSet == null || allowedSet.isEmpty()) return true;
        String candidate = normalizeFolderKey(folderPath);
        if (candidate.isEmpty()) return false;
        for (String allowed : allowedSet) {
            if (candidate.equals(allowed) || candidate.startsWith(allowed + "/")) {
                return true;
            }
        }
        return false;
    }

    private Set<String> parseFolderSetParam(PluginCall call, String paramName) {
        Set<String> set = new HashSet<>();
        if (call == null) return set;
        JSArray arr = call.getArray(paramName);
        if (arr == null) return set;
        for (int i = 0; i < arr.length(); i++) {
            String item = normalizeFolderKey(arr.optString(i, ""));
            if (!item.isEmpty()) {
                set.add(item);
            }
        }
        return set;
    }

    private boolean isDefaultRecordingFolder(String folderPath) {
        String norm = normalizeFolderKey(folderPath);
        if (norm.isEmpty()) return false;
        String[] parts = norm.split("/");
        for (String seg : parts) {
            if (
                "recordings".equals(seg) ||
                "recording".equals(seg) ||
                "call".equals(seg) ||
                "calls".equals(seg) ||
                "callrecordings".equals(seg) ||
                "call recordings".equals(seg) ||
                "soundrecorder".equals(seg) ||
                "sound_recorder".equals(seg) ||
                "voicerecorder".equals(seg) ||
                "voice_recorder".equals(seg) ||
                "phonerecord".equals(seg) ||
                "audiorecorder".equals(seg) ||
                "voice memos".equals(seg) ||
                "voice notes".equals(seg) ||
                "dcim".equals(seg)
            ) {
                return true;
            }
        }
        return false;
    }

    private void runFolderDiscovery(PluginCall call) {
        boolean includeNonMusic = Boolean.TRUE.equals(call.getBoolean("includeNonMusic", false));
        Set<String> excludedFolders = parseFolderSetParam(call, "excludeFolders");
        executor.execute(() -> {
            try {
                JSArray folders = queryMediaStoreFolders(includeNonMusic, excludedFolders);
                JSObject result = new JSObject();
                result.put("folders", folders);
                result.put("count", folders.length());
                call.resolve(result);
            } catch (Exception ex) {
                call.reject("Failed to list device folders: " + ex.getMessage(), ex);
            }
        });
    }

    private JSArray queryMediaStoreFolders(boolean includeNonMusic, Set<String> excludedFolders) {
        JSArray results = new JSArray();
        Uri collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
        List<String> projectionList = new ArrayList<>();
        projectionList.add(MediaStore.Audio.Media._ID);
        projectionList.add(MediaStore.Audio.Media.DURATION);
        projectionList.add(MediaStore.Audio.Media.SIZE);
        projectionList.add(MediaStore.Audio.Media.DATA);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            projectionList.add(MediaStore.Audio.Media.RELATIVE_PATH);
        }

        String[] projection = projectionList.toArray(new String[0]);
        String selection = includeNonMusic ? null : (MediaStore.Audio.Media.IS_MUSIC + " != 0");

        Map<String, Integer> folderCounts = new LinkedHashMap<>();
        try (Cursor cursor = getContext().getContentResolver().query(collection, projection, selection, null, null)) {
            if (cursor != null) {
                int durationCol = cursor.getColumnIndex(MediaStore.Audio.Media.DURATION);
                int sizeCol = cursor.getColumnIndex(MediaStore.Audio.Media.SIZE);
                int dataCol = cursor.getColumnIndex(MediaStore.Audio.Media.DATA);
                int relPathCol = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? cursor.getColumnIndex(MediaStore.Audio.Media.RELATIVE_PATH)
                    : -1;

                while (cursor.moveToNext()) {
                    long durationMs = durationCol >= 0 ? cursor.getLong(durationCol) : 0L;
                    long size = sizeCol >= 0 ? cursor.getLong(sizeCol) : 0L;
                    if (size <= (includeNonMusic ? 1024L : 4096L)) continue;
                    if (!includeNonMusic && durationMs > 0 && durationMs < 10000) continue;

                    String dataPath = dataCol >= 0 ? safeStr(cursor.getString(dataCol)) : "";
                    String relPath = relPathCol >= 0 ? safeStr(cursor.getString(relPathCol)) : "";
                    String folderPath = resolveRelativeFolderPath(relPath, dataPath);

                    if (!includeNonMusic) {
                        if (isDefaultRecordingFolder(folderPath) || folderMatchesAllowed(folderPath, excludedFolders)) {
                            continue;
                        }
                    } else {
                        if (!excludedFolders.isEmpty() && folderMatchesAllowed(folderPath, excludedFolders)) {
                            continue;
                        }
                    }
                    folderCounts.put(folderPath, (folderCounts.containsKey(folderPath) ? folderCounts.get(folderPath) : 0) + 1);
                }
            }
        }

        for (Map.Entry<String, Integer> entry : folderCounts.entrySet()) {
            JSObject obj = new JSObject();
            obj.put("path", entry.getKey());
            obj.put("label", extractFolderLabel(entry.getKey()));
            obj.put("trackCount", entry.getValue());
            results.put(obj);
        }
        return results;
    }

    private void runMediaStoreScan(PluginCall call) {
        Set<String> allowedFolders = parseAllowedFolders(call);
        Set<String> excludedFolders = parseFolderSetParam(call, "excludeFolders");
        boolean includeNonMusic = Boolean.TRUE.equals(call.getBoolean("includeNonMusic", false));
        List<String> treeUris = new ArrayList<>();
        JSArray treeArr = call.getArray("treeUris");
        if (treeArr != null) {
            for (int i = 0; i < treeArr.length(); i++) {
                String u = treeArr.optString(i, "").trim();
                if (!u.isEmpty()) treeUris.add(u);
            }
        }

        executor.execute(() -> {
            try {
                JSArray tracks = queryMediaStoreAudio(allowedFolders, excludedFolders, includeNonMusic, treeUris);
                JSObject result = new JSObject();
                result.put("tracks", tracks);
                result.put("count", tracks.length());
                call.resolve(result);
            } catch (Exception ex) {
                call.reject("Failed to scan device audio: " + ex.getMessage(), ex);
            }
        });
    }

    private JSArray queryMediaStoreAudio(
        Set<String> allowedFolders,
        Set<String> excludedFolders,
        boolean includeNonMusic,
        List<String> treeUris
    ) {
        JSArray results = new JSArray();
        Set<String> seenKeys = new HashSet<>();
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
        projectionList.add(MediaStore.Audio.Media.YEAR);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            projectionList.add(MediaStore.Audio.Media.RELATIVE_PATH);
            projectionList.add(MediaStore.Audio.Media.BITRATE);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            projectionList.add(MediaStore.Audio.Media.GENRE);
            projectionList.add(MediaStore.Audio.Media.COMPOSER);
        }

        String[] projection = projectionList.toArray(new String[0]);
        String selection = includeNonMusic ? null : (MediaStore.Audio.Media.IS_MUSIC + " != 0");
        String sortOrder = includeNonMusic
            ? (MediaStore.Audio.Media.DATE_ADDED + " DESC")
            : (MediaStore.Audio.Media.TITLE + " COLLATE NOCASE ASC");

        try (Cursor cursor = getContext().getContentResolver().query(collection, projection, selection, null, sortOrder)) {
            if (cursor != null) {
                int totalRows = cursor.getCount();
                emitScanProgress(0, totalRows, includeNonMusic ? "Scanning recordings folders..." : "Scanning device music folders...");

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
                int yearCol = cursor.getColumnIndex(MediaStore.Audio.Media.YEAR);
                int relPathCol = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? cursor.getColumnIndex(MediaStore.Audio.Media.RELATIVE_PATH)
                    : -1;
                int bitrateCol = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? cursor.getColumnIndex(MediaStore.Audio.Media.BITRATE)
                    : -1;
                int genreCol = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                    ? cursor.getColumnIndex(MediaStore.Audio.Media.GENRE)
                    : -1;
                int composerCol = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                    ? cursor.getColumnIndex(MediaStore.Audio.Media.COMPOSER)
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

                    if (size <= (includeNonMusic ? 1024L : 4096L)) continue;
                    if (!includeNonMusic && durationMs > 0 && durationMs < 10000) continue;

                    String relPath = relPathCol >= 0 ? safeStr(cursor.getString(relPathCol)) : "";
                    String folderPath = resolveRelativeFolderPath(relPath, dataPath);

                    if (allowedFolders != null && !allowedFolders.isEmpty() && !folderMatchesAllowed(folderPath, allowedFolders)) {
                        continue;
                    }
                    if (!includeNonMusic) {
                        boolean explicitlyWhitelisted = allowedFolders != null && !allowedFolders.isEmpty() && folderMatchesAllowed(folderPath, allowedFolders);
                        if (!explicitlyWhitelisted && isDefaultRecordingFolder(folderPath)) {
                            continue;
                        }
                        if (!excludedFolders.isEmpty() && folderMatchesAllowed(folderPath, excludedFolders)) {
                            continue;
                        }
                    } else if (!excludedFolders.isEmpty() && folderMatchesAllowed(folderPath, excludedFolders)) {
                        continue;
                    }

                    String fileNameResolved = !displayName.isEmpty() ? displayName : new File(dataPath).getName();
                    String lowerName = (!displayName.isEmpty() ? displayName : dataPath).toLowerCase(Locale.ROOT);
                    String title = titleCol >= 0 ? safeStr(cursor.getString(titleCol)) : "";
                    if (title.isEmpty()) {
                        title = stripExtension(fileNameResolved);
                    }

                    String artist = artistCol >= 0 ? safeStr(cursor.getString(artistCol)) : "";
                    if (artist.isEmpty() || "<unknown>".equalsIgnoreCase(artist)) {
                        artist = includeNonMusic ? "Voice Recording" : "Unknown Artist";
                    }

                    String album = albumCol >= 0 ? safeStr(cursor.getString(albumCol)) : "";
                    if (album.isEmpty() || "<unknown>".equalsIgnoreCase(album)) {
                        album = includeNonMusic ? extractFolderLabel(folderPath) : "Local Collection";
                    }

                    String genre = genreCol >= 0 ? safeStr(cursor.getString(genreCol)) : "";
                    if (genre.isEmpty()) {
                        genre = includeNonMusic ? "Recording" : "Local Audio";
                    }

                    int yearVal = yearCol >= 0 ? cursor.getInt(yearCol) : 0;
                    String composer = composerCol >= 0 ? safeStr(cursor.getString(composerCol)) : "";

                    Uri contentUri = ContentUris.withAppendedId(collection, id);
                    int durationSec = Math.max(1, (int) Math.round(durationMs / 1000.0));
                    String format = detectFormat(lowerName, mimeType);
                    int bitrateBps = bitrateCol >= 0 ? cursor.getInt(bitrateCol) : 0;
                    int bitrateKbps = bitrateBps > 0
                        ? Math.max(64, Math.round(bitrateBps / 1000f))
                        : (durationSec > 0 ? Math.max(64, (int) Math.round((size * 8.0) / durationSec / 1000.0)) : 192);

                    int sampleRate = ("FLAC".equals(format) || "WAV".equals(format)) ? 48000 : 44100;
                    int bitDepth = ("FLAC".equals(format) || "WAV".equals(format) || "ALAC".equals(format)) ? 24 : 16;
                    long addedAtMs = dateAddedCol >= 0 ? cursor.getLong(dateAddedCol) * 1000L : System.currentTimeMillis();

                    String embeddedLyrics = includeNonMusic ? "" : extractEmbeddedLyrics(getContext().getContentResolver(), contentUri, dataPath, format);

                    String key = normalizeFolderKey(folderPath) + "/" + fileNameResolved.toLowerCase(Locale.ROOT) + "#" + size;
                    seenKeys.add(key);

                    JSObject item = new JSObject();
                    item.put("mediaId", id);
                    item.put("title", title);
                    item.put("artist", artist);
                    item.put("album", album);
                    item.put("genre", genre);
                    if (yearVal > 1900 && yearVal < 2100) {
                        item.put("year", String.valueOf(yearVal));
                    }
                    if (!composer.isEmpty()) {
                        item.put("composer", composer);
                    }
                    if (embeddedLyrics != null && !embeddedLyrics.isEmpty()) {
                        item.put("lyrics", embeddedLyrics);
                    }
                    item.put("durationSec", durationSec);
                    item.put("fileName", fileNameResolved);
                    item.put("folderPath", folderPath);
                    item.put("filePath", dataPath);
                    item.put("contentUri", contentUri.toString());
                    item.put("albumArtUri", "");
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
        }

        // Also scan any SAF tree folders (covers folders hidden by .nomedia such as phone call recorder directories)
        if (includeNonMusic && treeUris != null && !treeUris.isEmpty()) {
            for (String treeUriStr : treeUris) {
                scanSafTreeForRecordings(treeUriStr, seenKeys, results);
            }
        }

        return results;
    }

    private void scanSafTreeForRecordings(String treeUriStr, Set<String> seenKeys, JSArray results) {
        try {
            Uri treeUri = Uri.parse(treeUriStr);
            String rootDocId = DocumentsContract.getTreeDocumentId(treeUri);
            String baseFolder = extractRelativePathFromTreeUri(treeUri);
            ContentResolver resolver = getContext().getContentResolver();
            List<String[]> queue = new ArrayList<>();
            queue.add(new String[] { rootDocId, baseFolder });
            int visited = 0;

            while (!queue.isEmpty() && visited < 40) {
                visited++;
                String[] cur = queue.remove(0);
                String docId = cur[0];
                String relFolder = cur[1];
                Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId);
                try (Cursor c = resolver.query(
                    childrenUri,
                    new String[] {
                        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                        DocumentsContract.Document.COLUMN_MIME_TYPE,
                        DocumentsContract.Document.COLUMN_SIZE,
                        DocumentsContract.Document.COLUMN_LAST_MODIFIED,
                    },
                    null,
                    null,
                    null
                )) {
                    if (c == null) continue;
                    int idCol = c.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
                    int nameCol = c.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
                    int mimeCol = c.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);
                    int sizeCol = c.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE);
                    int modCol = c.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);

                    while (c.moveToNext()) {
                        String childDocId = idCol >= 0 ? safeStr(c.getString(idCol)) : "";
                        String name = nameCol >= 0 ? safeStr(c.getString(nameCol)) : "";
                        String mime = mimeCol >= 0 ? safeStr(c.getString(mimeCol)) : "";
                        long size = sizeCol >= 0 ? c.getLong(sizeCol) : 0L;
                        long modMs = modCol >= 0 ? c.getLong(modCol) : System.currentTimeMillis();
                        if (childDocId.isEmpty() || name.isEmpty()) continue;

                        if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                            queue.add(new String[] { childDocId, relFolder + "/" + name });
                            continue;
                        }

                        String lower = name.toLowerCase(Locale.ROOT);
                        boolean isAudio = mime.startsWith("audio/") ||
                            lower.endsWith(".mp3") || lower.endsWith(".m4a") || lower.endsWith(".wav") ||
                            lower.endsWith(".aac") || lower.endsWith(".ogg") || lower.endsWith(".opus") ||
                            lower.endsWith(".flac") || lower.endsWith(".amr") || lower.endsWith(".3gp");
                        if (!isAudio || size <= 1024L) continue;

                        String key = normalizeFolderKey(relFolder) + "/" + lower + "#" + size;
                        if (seenKeys.contains(key)) continue;
                        seenKeys.add(key);

                        Uri docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, childDocId);
                        int durationSec = 30;
                        try (MediaMetadataRetriever mmr = new MediaMetadataRetriever()) {
                            mmr.setDataSource(getContext(), docUri);
                            String durStr = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                            if (durStr != null) {
                                durationSec = Math.max(1, (int) Math.round(Long.parseLong(durStr) / 1000.0));
                            }
                        } catch (Exception ignored) {
                            // keep best-effort duration
                        }

                        String format = detectFormat(lower, mime);
                        JSObject item = new JSObject();
                        item.put("mediaId", Math.abs(childDocId.hashCode()));
                        item.put("title", stripExtension(name));
                        item.put("artist", "Voice Recording");
                        item.put("album", extractFolderLabel(relFolder));
                        item.put("genre", "Recording");
                        item.put("durationSec", durationSec);
                        item.put("fileName", name);
                        item.put("folderPath", relFolder);
                        item.put("filePath", "");
                        item.put("contentUri", docUri.toString());
                        item.put("folderTreeUri", treeUriStr);
                        item.put("albumArtUri", "");
                        item.put("fileSize", size);
                        item.put("format", format);
                        item.put("sampleRate", 44100);
                        item.put("bitDepth", 16);
                        item.put("bitrateKbps", durationSec > 0 ? Math.max(64, (int) Math.round((size * 8.0) / durationSec / 1000.0)) : 128);
                        item.put("addedAt", modMs > 0 ? modMs : System.currentTimeMillis());
                        results.put(item);
                    }
                }
            }
        } catch (Exception ignored) {
            // Skip unreachable SAF tree URI
        }
    }

    private void emitScanProgress(int current, int total, String fileName) {
        JSObject payload = new JSObject();
        payload.put("current", current);
        payload.put("total", total);
        payload.put("fileName", fileName);
        notifyListeners("scanProgress", payload);
    }

    private void emitTagWriteProgress(int current, int total, String fileName) {
        JSObject payload = new JSObject();
        payload.put("current", current);
        payload.put("total", total);
        payload.put("fileName", fileName);
        notifyListeners("tagWriteProgress", payload);
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

    private String decodeId3TextBytes(int encoding, byte[] buf, int start, int end) {
        if (end <= start) return "";
        int len = end - start;
        try {
            if (encoding == 1) {
                boolean le = len >= 2 && (buf[start] & 0xFF) == 0xFF && (buf[start + 1] & 0xFF) == 0xFE;
                boolean be = len >= 2 && (buf[start] & 0xFF) == 0xFE && (buf[start + 1] & 0xFF) == 0xFF;
                int off = (le || be) ? start + 2 : start;
                String s = new String(buf, off, end - off, le ? StandardCharsets.UTF_16LE : StandardCharsets.UTF_16BE);
                return s.replace("\0", "").trim();
            }
            if (encoding == 2) {
                return new String(buf, start, len, StandardCharsets.UTF_16BE).replace("\0", "").trim();
            }
            if (encoding == 3) {
                return new String(buf, start, len, StandardCharsets.UTF_8).replace("\0", "").trim();
            }
            return new String(buf, start, len, StandardCharsets.ISO_8859_1).replace("\0", "").trim();
        } catch (Exception ex) {
            return "";
        }
    }

    private String extractEmbeddedLyrics(ContentResolver resolver, Uri contentUri, String filePath, String format) {
        if (!"MP3".equals(format) && !"FLAC".equals(format)) return "";
        try (InputStream in = new BufferedInputStream(
            contentUri != null ? resolver.openInputStream(contentUri) : new FileInputStream(filePath)
        )) {
            if (in == null) return "";
            byte[] head = new byte[10];
            if (readFully(in, head, 0, 10) < 4) return "";

            if (head[0] == 'I' && head[1] == 'D' && head[2] == '3') {
                int version = head[3] & 0xFF;
                int flags = head[5] & 0xFF;
                int tagSize = readSynchsafeInt(head, 6);
                if (tagSize <= 0 || tagSize > 2 * 1024 * 1024) return "";
                byte[] tagBody = new byte[tagSize];
                int got = readFully(in, tagBody, 0, tagSize);
                int pos = 0;
                if ((flags & 0x40) != 0 && pos + 4 <= got) {
                    int extSize = version == 4 ? readSynchsafeInt(tagBody, pos) : readUint32BE(tagBody, pos);
                    pos += version == 4 ? extSize : 4 + extSize;
                }
                while (pos + 10 <= got) {
                    if (tagBody[pos] == 0) break;
                    if (version == 2) {
                        String id3v22 = new String(tagBody, pos, 3, StandardCharsets.US_ASCII);
                        int size = ((tagBody[pos + 3] & 0xFF) << 16) | ((tagBody[pos + 4] & 0xFF) << 8) | (tagBody[pos + 5] & 0xFF);
                        pos += 6;
                        if (size <= 0 || pos + size > got) break;
                        if ("ULT".equals(id3v22) && size >= 5) {
                            int enc = tagBody[pos] & 0xFF;
                            int idx = pos + 4;
                            if (enc == 1 || enc == 2) {
                                while (idx + 1 < pos + size && !(tagBody[idx] == 0 && tagBody[idx + 1] == 0)) idx += 2;
                                idx += 2;
                            } else {
                                while (idx < pos + size && tagBody[idx] != 0) idx++;
                                idx++;
                            }
                            if (idx < pos + size) return decodeId3TextBytes(enc, tagBody, idx, pos + size);
                        }
                        pos += size;
                    } else {
                        String id = new String(tagBody, pos, 4, StandardCharsets.US_ASCII);
                        int size = version == 4 ? readSynchsafeInt(tagBody, pos + 4) : readUint32BE(tagBody, pos + 4);
                        pos += 10;
                        if (size <= 0 || pos + size > got) break;
                        if ("USLT".equals(id) && size >= 5) {
                            int enc = tagBody[pos] & 0xFF;
                            int idx = pos + 4;
                            if (enc == 1 || enc == 2) {
                                while (idx + 1 < pos + size && !(tagBody[idx] == 0 && tagBody[idx + 1] == 0)) idx += 2;
                                idx += 2;
                            } else {
                                while (idx < pos + size && tagBody[idx] != 0) idx++;
                                idx++;
                            }
                            if (idx < pos + size) return decodeId3TextBytes(enc, tagBody, idx, pos + size);
                        }
                        pos += size;
                    }
                }
            } else if (head[0] == 'f' && head[1] == 'L' && head[2] == 'a' && head[3] == 'C') {
                boolean isLast = false;
                byte[] firstHdr = Arrays.copyOfRange(head, 4, 8);
                byte[] extraTwo = Arrays.copyOfRange(head, 8, 10);
                boolean usedPreRead = false;
                while (!isLast) {
                    byte[] blkHdr = new byte[4];
                    if (!usedPreRead) {
                        System.arraycopy(firstHdr, 0, blkHdr, 0, 4);
                        usedPreRead = true;
                    } else if (readFully(in, blkHdr, 0, 4) != 4) {
                        break;
                    }
                    isLast = (blkHdr[0] & 0x80) != 0;
                    int blkType = blkHdr[0] & 0x7F;
                    int blkLen = ((blkHdr[1] & 0xFF) << 16) | ((blkHdr[2] & 0xFF) << 8) | (blkHdr[3] & 0xFF);
                    if (blkLen < 0 || blkLen > 2 * 1024 * 1024) break;
                    byte[] blkData = new byte[blkLen];
                    int filled;
                    if (extraTwo != null) {
                        int copy = Math.min(2, blkLen);
                        System.arraycopy(extraTwo, 0, blkData, 0, copy);
                        filled = copy;
                        if (blkLen > copy) {
                            filled += readFully(in, blkData, copy, blkLen - copy);
                        }
                        extraTwo = null;
                    } else {
                        filled = readFully(in, blkData, 0, blkLen);
                    }
                    if (filled < blkLen) break;
                    if (blkType == 4 && blkLen >= 8) {
                        int pos = 0;
                        int vLen = readUint32LE(blkData, pos);
                        pos += 4 + Math.max(0, vLen);
                        if (pos + 4 <= blkLen) {
                            int count = readUint32LE(blkData, pos);
                            pos += 4;
                            for (int i = 0; i < count && pos + 4 <= blkLen; i++) {
                                int eLen = readUint32LE(blkData, pos);
                                pos += 4;
                                if (eLen < 0 || pos + eLen > blkLen) break;
                                String entry = new String(blkData, pos, eLen, StandardCharsets.UTF_8);
                                pos += eLen;
                                int eq = entry.indexOf('=');
                                if (eq > 0) {
                                    String key = entry.substring(0, eq).trim().toUpperCase(Locale.ROOT);
                                    if ("LYRICS".equals(key) || "UNSYNCEDLYRICS".equals(key)) {
                                        String val = entry.substring(eq + 1).trim();
                                        if (!val.isEmpty()) return val;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (Exception ignored) {
            // Fast best-effort header read only
        }
        return "";
    }
}
