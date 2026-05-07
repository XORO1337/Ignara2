#include "room_beacon.h"

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"

static const char *TAG = "ign-room";

static void report_task(void *arg)
{
    (void)arg;
    ign_tracked_tag_t tags[IGN_MAX_TRACKED_TAGS];

    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(CONFIG_IGNARA_REPORT_INTERVAL_MS));

        if (!ign_wifi_is_connected()) {
            ESP_LOGW(TAG, "WiFi not connected, skipping report");
            continue;
        }

        size_t count = ign_ble_snapshot_tags(tags, IGN_MAX_TRACKED_TAGS);
        ign_http_post_report(tags, count);
    }
}

static void notify_poll_task(void *arg)
{
    (void)arg;
    ign_notification_t notifications[4];

    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(CONFIG_IGNARA_NOTIFY_POLL_INTERVAL_MS));

        if (!ign_wifi_is_connected()) {
            continue;
        }

        size_t count = ign_http_poll_notifications(notifications, sizeof(notifications) / sizeof(notifications[0]));
        if (count == 0) {
            continue;
        }

        for (size_t i = 0; i < count; i++) {
            ESP_LOGI(TAG, "Notification [%s] priority=%s: %s",
                notifications[i].id, notifications[i].priority, notifications[i].message);
            ign_ble_start_notification_advertisement(&notifications[i]);
            vTaskDelay(pdMS_TO_TICKS(CONFIG_IGNARA_RELAY_ADV_SECONDS * 1000));
            ign_ble_stop_notification_advertisement();
        }
    }
}

void app_main(void)
{
    ESP_LOGI(TAG, "Ignara room beacon booting");
    ESP_LOGI(TAG, "  Device ID: %s", CONFIG_IGNARA_BEACON_DEVICE_ID);
    ESP_LOGI(TAG, "  Room ID:   %s", CONFIG_IGNARA_BEACON_ROOM_ID);
#ifdef CONFIG_IGNARA_API_SCHEME_HTTPS
    ESP_LOGI(TAG, "  API:       https://%s:%d", CONFIG_IGNARA_API_HOST, CONFIG_IGNARA_API_PORT);
#else
    ESP_LOGI(TAG, "  API:       http://%s:%d", CONFIG_IGNARA_API_HOST, CONFIG_IGNARA_API_PORT);
#endif

    ign_ble_scan_init();
    ign_wifi_init_and_connect();

    xTaskCreate(report_task, "ign-report", 6144, NULL, 5, NULL);
    xTaskCreate(notify_poll_task, "ign-notify", 6144, NULL, 5, NULL);
}
