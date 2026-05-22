const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES compartilhadas com o app JS
// ─────────────────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://pbzoggfmegmawbnmblpm.supabase.co';
const ANON_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBiem9nZ2ZtZWdtYXdibm1ibHBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMDYzOTksImV4cCI6MjA5NDg4MjM5OX0.OpRY-AH7vHsQYHzi39QpqiYL_uNxWOZFE_pYvOSo3Ic';

// ─────────────────────────────────────────────────────────────────────────────
// BootReceiver — dispara quando o dispositivo termina de ligar
// → abre o app → app inicia serviço GPS → fecha Activity
// ─────────────────────────────────────────────────────────────────────────────
const BOOT_RECEIVER_JAVA = `package com.system.posservice;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action)) {

            // 1. Agenda o alarme de backup de 3 horas
            AlarmScheduler.schedule(context);

            // 2. Abre o app para iniciar o serviço GPS
            Intent launch = context.getPackageManager()
                    .getLaunchIntentForPackage(context.getPackageName());
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(launch);
            }
        }
    }
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// ShutdownReceiver — dispara quando o dispositivo vai desligar ou reiniciar
// → lê AndroidId → faz POST síncrono ao Supabase → status=offline
// Janela de execução: ~10 segundos antes do sistema matar tudo
// ─────────────────────────────────────────────────────────────────────────────
const SHUTDOWN_RECEIVER_JAVA = `package com.system.posservice;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

public class ShutdownReceiver extends BroadcastReceiver {

    private static final String SUPABASE_URL = "${SUPABASE_URL}";
    private static final String ANON_KEY     = "${ANON_KEY}";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_SHUTDOWN.equals(action)
                && !"android.intent.action.QUICKBOOT_POWEROFF".equals(action)
                && !Intent.ACTION_REBOOT.equals(action)) {
            return;
        }

        String serial = Settings.Secure.getString(
                context.getContentResolver(), Settings.Secure.ANDROID_ID);
        if (serial == null || serial.isEmpty()) return;

        String now = isoNow();
        String body = "{\\"serial\\":\\"" + serial + "\\"," +
                      "\\"status\\":\\"offline\\"," +
                      "\\"last_seen_at\\":\\"" + now + "\\"}";

        postToSupabase(body);
    }

    private void postToSupabase(String body) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(SUPABASE_URL + "/rest/v1/devices?on_conflict=serial");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("apikey", ANON_KEY);
            conn.setRequestProperty("Authorization", "Bearer " + ANON_KEY);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Prefer", "resolution=merge-duplicates");
            conn.setDoOutput(true);
            conn.setConnectTimeout(7000);
            conn.setReadTimeout(7000);

            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(bytes);
            }
            conn.getResponseCode(); // força execução síncrona
        } catch (Exception ignored) {
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String isoNow() {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date());
    }
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// AlarmReceiver — dispara a cada 3 horas como backup
// → caso o serviço foreground seja limitado pelo Android, garante ping
// → usa exatamente o mesmo payload do heartbeat JS
// ─────────────────────────────────────────────────────────────────────────────
const ALARM_RECEIVER_JAVA = `package com.system.posservice;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

public class AlarmReceiver extends BroadcastReceiver {

    private static final String SUPABASE_URL = "${SUPABASE_URL}";
    private static final String ANON_KEY     = "${ANON_KEY}";
    public  static final String ACTION_BACKUP_PING = "com.system.posservice.BACKUP_PING";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ACTION_BACKUP_PING.equals(intent.getAction())) return;

        String serial = Settings.Secure.getString(
                context.getContentResolver(), Settings.Secure.ANDROID_ID);
        if (serial == null || serial.isEmpty()) return;

        String now  = isoNow();
        String body = "{\\"serial\\":\\"" + serial + "\\"," +
                      "\\"status\\":\\"online\\"," +
                      "\\"last_seen_at\\":\\"" + now + "\\"}";
        postToSupabase(body);
    }

    private void postToSupabase(String body) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(SUPABASE_URL + "/rest/v1/devices?on_conflict=serial");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("apikey", ANON_KEY);
            conn.setRequestProperty("Authorization", "Bearer " + ANON_KEY);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Prefer", "resolution=merge-duplicates");
            conn.setDoOutput(true);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);

            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(bytes);
            }
            conn.getResponseCode();
        } catch (Exception ignored) {
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String isoNow() {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date());
    }
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// AlarmScheduler — utilitário chamado pelo BootReceiver para agendar alarme
// O alarme é INEXACT (respeita Doze) mas garante execução a cada 3h
// ─────────────────────────────────────────────────────────────────────────────
const ALARM_SCHEDULER_JAVA = `package com.system.posservice;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public class AlarmScheduler {

    private static final long INTERVAL_MS = 3 * 60 * 60 * 1000L; // 3 horas

    public static void schedule(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        Intent intent = new Intent(context, AlarmReceiver.class);
        intent.setAction(AlarmReceiver.ACTION_BACKUP_PING);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;

        PendingIntent pi = PendingIntent.getBroadcast(context, 0, intent, flags);

        // Cancela qualquer alarme anterior antes de reagendar
        am.cancel(pi);

        // Agenda repetição inexata (respeita Doze Mode do Android)
        am.setInexactRepeating(
                AlarmManager.RTC_WAKEUP,
                System.currentTimeMillis() + INTERVAL_MS,
                INTERVAL_MS,
                pi
        );
    }
}
`;

module.exports = function withBootReceiver(config) {

  // ── Passo 1: Registra os três receivers no AndroidManifest.xml ──────────────
  config = withAndroidManifest(config, (androidConfig) => {
    const manifest = androidConfig.modResults.manifest;
    const app      = manifest.application?.[0];
    if (!app) return androidConfig;
    if (!app.receiver) app.receiver = [];

    // Helper para evitar duplicatas
    const hasReceiver = (name) =>
      app.receiver.some((r) => r.$?.['android:name'] === name);

    // 1a. BootReceiver
    if (!hasReceiver('.BootReceiver')) {
      app.receiver.push({
        $: { 'android:name': '.BootReceiver', 'android:enabled': 'true', 'android:exported': 'true' },
        'intent-filter': [{
          action: [
            { $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } },
            { $: { 'android:name': 'android.intent.action.QUICKBOOT_POWERON' } },
          ],
        }],
      });
    }

    // 1b. ShutdownReceiver
    if (!hasReceiver('.ShutdownReceiver')) {
      app.receiver.push({
        $: { 'android:name': '.ShutdownReceiver', 'android:enabled': 'true', 'android:exported': 'true' },
        'intent-filter': [{
          action: [
            { $: { 'android:name': 'android.intent.action.ACTION_SHUTDOWN' } },
            { $: { 'android:name': 'android.intent.action.QUICKBOOT_POWEROFF' } },
            { $: { 'android:name': 'android.intent.action.REBOOT' } },
          ],
        }],
      });
    }

    // 1c. AlarmReceiver
    if (!hasReceiver('.AlarmReceiver')) {
      app.receiver.push({
        $: { 'android:name': '.AlarmReceiver', 'android:enabled': 'true', 'android:exported': 'false' },
        'intent-filter': [{
          action: [
            { $: { 'android:name': 'com.system.posservice.BACKUP_PING' } },
          ],
        }],
      });
    }

    // Permissão RECEIVE_BOOT_COMPLETED
    const perms = manifest['uses-permission'] ?? [];
    const hasBoot = perms.some(
      (p) => p.$?.['android:name'] === 'android.permission.RECEIVE_BOOT_COMPLETED'
    );
    if (!hasBoot) {
      perms.push({ $: { 'android:name': 'android.permission.RECEIVE_BOOT_COMPLETED' } });
    }
    manifest['uses-permission'] = perms;

    return androidConfig;
  });

  // ── Passo 2: Cria os arquivos Java que serão compilados no APK ───────────────
  config = withDangerousMod(config, [
    'android',
    async (androidConfig) => {
      const packageDir = path.join(
        androidConfig.modRequest.platformProjectRoot,
        'app', 'src', 'main', 'java',
        'com', 'system', 'posservice'
      );
      await fs.promises.mkdir(packageDir, { recursive: true });

      const files = {
        'BootReceiver.java'    : BOOT_RECEIVER_JAVA,
        'ShutdownReceiver.java': SHUTDOWN_RECEIVER_JAVA,
        'AlarmReceiver.java'   : ALARM_RECEIVER_JAVA,
        'AlarmScheduler.java'  : ALARM_SCHEDULER_JAVA,
      };

      for (const [fileName, content] of Object.entries(files)) {
        await fs.promises.writeFile(path.join(packageDir, fileName), content, 'utf8');
      }

      return androidConfig;
    },
  ]);

  return config;
};
