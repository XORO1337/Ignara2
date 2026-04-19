#include "room_beacon.h"

#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include "esp_log.h"
#include "esp_http_client.h"
#include "esp_timer.h"
#include "cJSON.h"
#include "sdkconfig.h"

static const char *TAG = "ign-http";

#define HTTP_RX_BUFFER_SIZE 2048

typedef struct {
    char *buffer;
    size_t capacity;
    size_t length;
} rx_context_t;

static esp_err_t http_event_handler(esp_http_client_event_t *evt)
{
    rx_context_t *ctx = (rx_context_t *)evt->user_data;
    switch (evt->event_id) {
    case HTTP_EVENT_ON_DATA:
        if (ctx && !esp_http_client_is_chunked_response(evt->client)) {
            size_t remaining = ctx->capacity - ctx->length - 1;
            size_t copy = evt->data_len < (int)remaining ? (size_t)evt->data_len : remaining;
            if (copy > 0) {
                memcpy(ctx->buffer + ctx->length, evt->data, copy);
                ctx->length += copy;
                ctx->buffer[ctx->length] = '\0';
            }
        }
        break;
    default:
        break;
    }
    return ESP_OK;
}

static void build_url(char *out, size_t len, const char *path)
{
#ifdef CONFIG_IGNARA_API_SCHEME_HTTPS
    const char *scheme = "https";
#else
    const char *scheme = "http";
#endif
    snprintf(out, len, "%s://%s:%d%s", scheme, CONFIG_IGNARA_API_HOST, CONFIG_IGNARA_API_PORT, path);
}

void ign_http_post_report(const ign_tracked_tag_t *tags, size_t count)
{
    cJSON *root = cJSON_CreateObject();
    if (!root) {
        return;
    }

    cJSON_AddStringToObject(root, "beaconDeviceId", CONFIG_IGNARA_BEACON_DEVICE_ID);
    cJSON_AddStringToObject(root, "roomId", CONFIG_IGNARA_BEACON_ROOM_ID);
    cJSON_AddStringToObject(root, "orgId", CONFIG_IGNARA_BEACON_ORG_ID);
    cJSON_AddNumberToObject(root, "ts", (double)(esp_timer_get_time() / 1000));

    cJSON *readings = cJSON_AddArrayToObject(root, "readings");
    int64_t now_ms = esp_timer_get_time() / 1000;
    for (size_t i = 0; i < count; i++) {
        cJSON *entry = cJSON_CreateObject();
        cJSON_AddStringToObject(entry, "deviceId", tags[i].device_id);
        if (tags[i].employee_id[0] != '\0') {
            cJSON_AddStringToObject(entry, "employeeId", tags[i].employee_id);
        }
        cJSON_AddNumberToObject(entry, "rssi", tags[i].rssi);
        cJSON_AddNumberToObject(entry, "lastSeenMsAgo", (double)(now_ms - tags[i].last_seen_ms));
        cJSON_AddItemToArray(readings, entry);
    }

    char *body = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (!body) {
        return;
    }

    char url[192];
    build_url(url, sizeof(url), "/ble-beacon/report");

    esp_http_client_config_t cfg = {
        .url = url,
        .event_handler = http_event_handler,
        .timeout_ms = 4000,
        .method = HTTP_METHOD_POST,
    };

    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (!client) {
        free(body);
        return;
    }

    esp_http_client_set_header(client, "Content-Type", "application/json");
    if (strlen(CONFIG_IGNARA_DEVICE_TOKEN) > 0) {
        esp_http_client_set_header(client, "X-Device-Token", CONFIG_IGNARA_DEVICE_TOKEN);
    }
    esp_http_client_set_post_field(client, body, strlen(body));

    esp_err_t err = esp_http_client_perform(client);
    if (err == ESP_OK) {
        int status = esp_http_client_get_status_code(client);
        ESP_LOGI(TAG, "POST /ble-beacon/report -> %d (%u tags)", status, (unsigned)count);
    } else {
        ESP_LOGW(TAG, "POST /ble-beacon/report failed: %s", esp_err_to_name(err));
    }

    esp_http_client_cleanup(client);
    free(body);
}

size_t ign_http_poll_notifications(ign_notification_t *out, size_t max)
{
    if (!out || max == 0) {
        return 0;
    }

    char path[96];
    snprintf(path, sizeof(path), "/ble-beacon/notifications/%s", CONFIG_IGNARA_BEACON_DEVICE_ID);

    char url[192];
    build_url(url, sizeof(url), path);

    char rx_buffer[HTTP_RX_BUFFER_SIZE];
    rx_buffer[0] = '\0';
    rx_context_t ctx = {.buffer = rx_buffer, .capacity = sizeof(rx_buffer), .length = 0};

    esp_http_client_config_t cfg = {
        .url = url,
        .event_handler = http_event_handler,
        .timeout_ms = 4000,
        .method = HTTP_METHOD_GET,
        .user_data = &ctx,
    };

    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (!client) {
        return 0;
    }

    if (strlen(CONFIG_IGNARA_DEVICE_TOKEN) > 0) {
        esp_http_client_set_header(client, "X-Device-Token", CONFIG_IGNARA_DEVICE_TOKEN);
    }

    esp_err_t err = esp_http_client_perform(client);
    int status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);

    if (err != ESP_OK || status < 200 || status >= 300 || ctx.length == 0) {
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "poll notifications failed: %s", esp_err_to_name(err));
        }
        return 0;
    }

    cJSON *root = cJSON_Parse(rx_buffer);
    if (!root) {
        return 0;
    }

    cJSON *pending = cJSON_GetObjectItem(root, "pending");
    size_t written = 0;
    if (cJSON_IsArray(pending)) {
        int total = cJSON_GetArraySize(pending);
        for (int i = 0; i < total && written < max; i++) {
            cJSON *item = cJSON_GetArrayItem(pending, i);
            if (!cJSON_IsObject(item)) {
                continue;
            }
            ign_notification_t *slot = &out[written++];
            memset(slot, 0, sizeof(*slot));

            cJSON *id = cJSON_GetObjectItem(item, "id");
            cJSON *msg = cJSON_GetObjectItem(item, "message");
            cJSON *prio = cJSON_GetObjectItem(item, "priority");
            cJSON *exp = cJSON_GetObjectItem(item, "expiresAt");

            if (cJSON_IsString(id) && id->valuestring) {
                strncpy(slot->id, id->valuestring, sizeof(slot->id) - 1);
            }
            if (cJSON_IsString(msg) && msg->valuestring) {
                strncpy(slot->message, msg->valuestring, sizeof(slot->message) - 1);
            }
            if (cJSON_IsString(prio) && prio->valuestring) {
                strncpy(slot->priority, prio->valuestring, sizeof(slot->priority) - 1);
            }
            if (cJSON_IsNumber(exp)) {
                slot->expires_at_ms = (int64_t)exp->valuedouble;
            }
        }
    }

    cJSON_Delete(root);
    return written;
}
