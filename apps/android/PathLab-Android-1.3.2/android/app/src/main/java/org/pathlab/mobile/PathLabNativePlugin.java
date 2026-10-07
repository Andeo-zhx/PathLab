package org.pathlab.mobile;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "PathLabNative")
public class PathLabNativePlugin extends Plugin {
    private static final String API_ENDPOINT = "https://api.deepseek.com/chat/completions";
    private static final String MODEL = "deepseek-flash";
    private static final int MAXIMUM_CHARACTERS = 12000;
    private static final String KEY_ALIAS = "pathlab.deepseek.translation";
    private static final String PREFERENCES = "pathlab_secure";
    private static final String KEY_IV = "deepseek_key_iv";
    private static final String KEY_CIPHERTEXT = "deepseek_key_ciphertext";

    private final ExecutorService networkExecutor = Executors.newCachedThreadPool();
    private volatile TranslationOperation activeTranslation;
    private final ConcurrentLinkedQueue<JSObject> pendingProjectResults = new ConcurrentLinkedQueue<>();

    private static final class TranslationOperation {
        final PluginCall call;
        final AtomicBoolean completed = new AtomicBoolean(false);
        volatile HttpURLConnection connection;

        TranslationOperation(PluginCall call) {
            this.call = call;
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
        Uri source = intent.getData();
        if (source == null) return;

        networkExecutor.execute(() -> {
            JSObject result;
            try {
                result = copyExternalProjectToCache(source);
            } catch (Exception exception) {
                JSObject failed = new JSObject();
                failed.put("failed", true);
                failed.put("message", "无法从文件应用读取工程：" + exception.getLocalizedMessage());
                result = failed;
            }
            final JSObject projectResult = result;
            final String eventName = projectResult.has("failed") ? "projectOpenFailed" : "projectOpened";
            getActivity().runOnUiThread(() -> {
                pendingProjectResults.add(projectResult);
                notifyListeners(eventName, projectResult);
            });
        });
    }

    @PluginMethod
    public void consumeOpenedProject(PluginCall call) {
        JSObject result = pendingProjectResults.poll();
        if (result == null) {
            result = new JSObject();
            result.put("cancelled", true);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void invoke(PluginCall call) {
        JSObject request = call.getObject("request");
        if (request == null) {
            call.resolve(failure("invalid-request", "翻译请求无效。"));
            return;
        }

        String operation = request.getString("op", "");
        switch (operation) {
            case "status":
                try {
                    JSObject status = new JSObject();
                    status.put("ok", true);
                    status.put("keyConfigured", loadApiKey() != null);
                    call.resolve(status);
                } catch (Exception exception) {
                    call.resolve(failure("keystore-error", "无法读取 Android 安全存储中的 API Key。"));
                }
                break;
            case "save-key":
                String key = request.getString("key", "").trim();
                if (key.isEmpty()) {
                    call.resolve(failure("invalid-key", "请输入 DeepSeek API Key。"));
                    return;
                }
                try {
                    saveApiKey(key);
                    JSObject saved = new JSObject();
                    saved.put("ok", true);
                    saved.put("keyConfigured", true);
                    call.resolve(saved);
                } catch (Exception exception) {
                    call.resolve(failure("keystore-error", "无法安全保存 API Key，请稍后重试。"));
                }
                break;
            case "delete-key":
                try {
                    deleteApiKey();
                    JSObject deleted = new JSObject();
                    deleted.put("ok", true);
                    deleted.put("keyConfigured", false);
                    call.resolve(deleted);
                } catch (Exception exception) {
                    call.resolve(failure("keystore-error", "无法删除 Android 安全存储中的 API Key。"));
                }
                break;
            case "cancel":
                cancelActiveTranslation();
                JSObject cancelled = new JSObject();
                cancelled.put("ok", true);
                cancelled.put("cancelled", true);
                call.resolve(cancelled);
                break;
            case "translate":
                translate(request, call);
                break;
            default:
                call.resolve(failure("unsupported-operation", "不支持此翻译操作。"));
        }
    }

    @PluginMethod
    public void pickProject(PluginCall call) {
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        picker.addCategory(Intent.CATEGORY_OPENABLE);
        picker.setType("*/*");
        picker.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
            "application/zip",
            "application/x-zip-compressed",
            "application/octet-stream"
        });
        picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, picker, "handleProjectPickerResult");
    }

    @ActivityCallback
    public void handleProjectPickerResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result == null || result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        Uri source = result.getData().getData();
        if (source == null) {
            call.reject("文件选择器没有返回有效文件。");
            return;
        }

        try {
            String originalName = displayName(source);
            String safeName = new File(originalName).getName().replaceAll("[\\\\/:*?\"<>|]+", "_");
            if (safeName.isEmpty()) safeName = "project.pathlab";

            File importDirectory = new File(getContext().getCacheDir(), "PathLabImports");
            if (!importDirectory.exists() && !importDirectory.mkdirs()) {
                throw new java.io.IOException("无法创建临时导入目录");
            }
            String cachedName = UUID.randomUUID() + "-" + safeName;
            File copied = new File(importDirectory, cachedName);

            try (InputStream input = getContext().getContentResolver().openInputStream(source);
                 OutputStream output = new FileOutputStream(copied)) {
                if (input == null) throw new java.io.IOException("无法读取所选文件");
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            }

            JSObject picked = new JSObject();
            picked.put("relativePath", "PathLabImports/" + cachedName);
            picked.put("fileName", originalName);
            call.resolve(picked);
        } catch (Exception exception) {
            call.reject("无法复制所选工程文件：" + exception.getLocalizedMessage());
        }
    }

    private String displayName(Uri uri) {
        String name = null;
        try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (column >= 0) name = cursor.getString(column);
            }
        } catch (Exception ignored) {}
        if (name == null || name.trim().isEmpty()) name = uri.getLastPathSegment();
        return name == null || name.trim().isEmpty() ? "project.pathlab" : name;
    }

    private JSObject copyExternalProjectToCache(Uri source) throws Exception {
        String originalName = displayName(source);
        if (!originalName.toLowerCase(java.util.Locale.ROOT).endsWith(".pathlab")) {
            throw new java.io.IOException("请选择 .pathlab 工程文件。");
        }
        String safeName = new File(originalName).getName().replaceAll("[\\\\/:*?\"<>|]+", "_");
        if (safeName.isEmpty()) safeName = "project.pathlab";

        File importDirectory = new File(getContext().getCacheDir(), "PathLabImports");
        if (!importDirectory.exists() && !importDirectory.mkdirs()) {
            throw new java.io.IOException("无法创建临时导入目录");
        }
        String cachedName = UUID.randomUUID() + "-" + safeName;
        File copied = new File(importDirectory, cachedName);
        try (InputStream input = getContext().getContentResolver().openInputStream(source);
             OutputStream output = new FileOutputStream(copied)) {
            if (input == null) throw new java.io.IOException("无法读取所选文件");
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
        } catch (Exception exception) {
            copied.delete();
            throw exception;
        }

        JSObject opened = new JSObject();
        opened.put("relativePath", "PathLabImports/" + cachedName);
        opened.put("fileName", originalName);
        return opened;
    }

    private void translate(JSObject request, PluginCall call) {
        String text = request.getString("text", "");
        if (text.trim().isEmpty()) {
            call.resolve(failure("empty-text", "标注文字为空，无法翻译。"));
            return;
        }
        if (text.length() > MAXIMUM_CHARACTERS) {
            call.resolve(failure("text-too-long", "单条标注最多支持 " + MAXIMUM_CHARACTERS + " 个字符。"));
            return;
        }

        String target = request.getString("targetLanguage", "");
        if (!"zh".equals(target) && !"en".equals(target)) {
            call.resolve(failure("invalid-language", "目标语言设置无效。"));
            return;
        }

        final String apiKey;
        try {
            apiKey = loadApiKey();
            if (apiKey == null || apiKey.isEmpty()) {
                call.resolve(failure("missing-key", "请先添加 DeepSeek API Key。"));
                return;
            }
        } catch (Exception exception) {
            call.resolve(failure("keystore-error", "无法读取 Android 安全存储中的 API Key。"));
            return;
        }

        cancelActiveTranslation();
        TranslationOperation operation = new TranslationOperation(call);
        activeTranslation = operation;
        networkExecutor.execute(() -> performTranslation(operation, text, target, apiKey));
    }

    private void performTranslation(TranslationOperation operation, String text, String target, String apiKey) {
        HttpURLConnection connection = null;
        try {
            JSONObject payload = translationPayload(text, target);
            connection = (HttpURLConnection) new URL(API_ENDPOINT).openConnection();
            operation.connection = connection;
            if (activeTranslation != operation) {
                connection.disconnect();
                return;
            }
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(60000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Authorization", "Bearer " + apiKey);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json");

            byte[] requestBytes = payload.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(requestBytes);
            }

            int statusCode = connection.getResponseCode();
            InputStream responseStream = statusCode >= 200 && statusCode < 300
                ? connection.getInputStream()
                : connection.getErrorStream();
            String responseBody = readFully(responseStream);

            if (statusCode < 200 || statusCode >= 300) {
                String detail = "HTTP " + statusCode;
                try {
                    JSONObject error = new JSONObject(responseBody).optJSONObject("error");
                    if (error != null) detail = error.optString("message", detail);
                } catch (Exception ignored) {}
                completeTranslation(operation, failure("api-error", "DeepSeek 翻译失败：" + detail));
                return;
            }

            JSONObject root = new JSONObject(responseBody);
            JSONArray choices = root.optJSONArray("choices");
            JSONObject firstChoice = choices == null || choices.length() == 0 ? null : choices.optJSONObject(0);
            JSONObject message = firstChoice == null ? null : firstChoice.optJSONObject("message");
            String translated = message == null ? "" : message.optString("content", "").trim();
            if (translated.isEmpty()) {
                completeTranslation(operation, failure("empty-response", "DeepSeek 没有返回译文。"));
                return;
            }

            JSObject result = new JSObject();
            result.put("ok", true);
            result.put("text", translated);
            completeTranslation(operation, result);
        } catch (Exception exception) {
            if (activeTranslation == operation) {
                completeTranslation(operation, failure("network-error", "连接 DeepSeek 失败：" + exception.getLocalizedMessage()));
            }
        } finally {
            if (connection != null) connection.disconnect();
            if (activeTranslation == operation) activeTranslation = null;
        }
    }

    private JSONObject translationPayload(String text, String target) throws Exception {
        String language = "en".equals(target) ? "English" : "Chinese";
        String systemPrompt = "Translate into " + language
            + ". Preserve meaning, pathology and medical terminology, abbreviations, Latin species names, numbers, and line breaks. Return only the translation, without explanations, alternatives, or Markdown.";
        JSONArray messages = new JSONArray();
        messages.put(new JSONObject().put("role", "system").put("content", systemPrompt));
        messages.put(new JSONObject().put("role", "user").put("content", text));
        return new JSONObject()
            .put("model", MODEL)
            .put("messages", messages)
            .put("thinking", new JSONObject().put("type", "disabled"))
            .put("max_tokens", 2048);
    }

    private String readFully(InputStream input) throws Exception {
        if (input == null) return "";
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = stream.read(buffer)) != -1) output.write(buffer, 0, read);
            return output.toString("UTF-8");
        }
    }

    private void completeTranslation(TranslationOperation operation, JSObject result) {
        if (operation.completed.compareAndSet(false, true)) operation.call.resolve(result);
    }

    private void cancelActiveTranslation() {
        TranslationOperation previous = activeTranslation;
        activeTranslation = null;
        if (previous == null) return;
        HttpURLConnection connection = previous.connection;
        if (connection != null) connection.disconnect();
        JSObject cancelled = new JSObject();
        cancelled.put("ok", true);
        cancelled.put("cancelled", true);
        completeTranslation(previous, cancelled);
    }

    private String loadApiKey() throws Exception {
        android.content.SharedPreferences preferences = getContext().getSharedPreferences(PREFERENCES, Activity.MODE_PRIVATE);
        String encodedIv = preferences.getString(KEY_IV, null);
        String encodedCiphertext = preferences.getString(KEY_CIPHERTEXT, null);
        if (encodedIv == null && encodedCiphertext == null) return null;
        if (encodedIv == null || encodedCiphertext == null) throw new java.security.GeneralSecurityException("Incomplete encrypted API key");

        byte[] iv = Base64.decode(encodedIv, Base64.NO_WRAP);
        byte[] ciphertext = Base64.decode(encodedCiphertext, Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateSecretKey(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
    }

    private void saveApiKey(String key) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey());
        byte[] ciphertext = cipher.doFinal(key.getBytes(StandardCharsets.UTF_8));
        String encodedIv = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP);
        String encodedCiphertext = Base64.encodeToString(ciphertext, Base64.NO_WRAP);
        boolean saved = getContext().getSharedPreferences(PREFERENCES, Activity.MODE_PRIVATE)
            .edit()
            .putString(KEY_IV, encodedIv)
            .putString(KEY_CIPHERTEXT, encodedCiphertext)
            .commit();
        if (!saved) throw new java.io.IOException("Unable to persist encrypted API key");
    }

    private SecretKey getOrCreateSecretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        }

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build());
        return generator.generateKey();
    }

    private void deleteApiKey() throws Exception {
        boolean saved = getContext().getSharedPreferences(PREFERENCES, Activity.MODE_PRIVATE)
            .edit()
            .remove(KEY_IV)
            .remove(KEY_CIPHERTEXT)
            .commit();
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS);
        if (!saved) throw new java.io.IOException("Unable to remove encrypted API key");
    }

    private JSObject failure(String code, String message) {
        JSObject result = new JSObject();
        result.put("ok", false);
        result.put("code", code);
        result.put("message", message);
        return result;
    }
}
