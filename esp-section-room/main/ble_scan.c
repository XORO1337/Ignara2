#include "room_beacon.h"

#include <string.h>
#include <stdio.h>
#include "esp_log.h"
#include "esp_bt.h"
#include "esp_bt_main.h"
#include "esp_gap_ble_api.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "nvs_flash.h"
#include "sdkconfig.h"

static const char *TAG = "ign-ble";

static ign_tracked_tag_t s_tags[IGN_MAX_TRACKED_TAGS];
static SemaphoreHandle_t s_tags_mutex;

static const esp_ble_scan_params_t s_scan_params = {
    .scan_type = BLE_SCAN_TYPE_ACTIVE,
    .own_addr_type = BLE_ADDR_TYPE_PUBLIC,
    .scan_filter_policy = BLE_SCAN_FILTER_ALLOW_ALL,
    .scan_interval = 0x50,
    .scan_window = 0x30,
    .scan_duplicate = BLE_SCAN_DUPLICATE_DISABLE,
};

static esp_ble_adv_data_t s_relay_adv_data = {
    .set_scan_rsp = false,
    .include_name = true,
    .include_txpower = false,
    .min_interval = 0x20,
    .max_interval = 0x40,
    .appearance = 0x00,
    .manufacturer_len = 0,
    .p_manufacturer_data = NULL,
    .service_data_len = 0,
    .p_service_data = NULL,
    .service_uuid_len = 0,
    .p_service_uuid = NULL,
    .flag = (ESP_BLE_ADV_FLAG_GEN_DISC | ESP_BLE_ADV_FLAG_BREDR_NOT_SPT),
};

static esp_ble_adv_params_t s_relay_adv_params = {
    .adv_int_min = 0x20,
    .adv_int_max = 0x40,
    .adv_type = ESP_BLE_ADV_TYPE_NONCONN_IND,
    .own_addr_type = BLE_ADDR_TYPE_PUBLIC,
    .channel_map = ADV_CHNL_ALL,
    .adv_filter_policy = ESP_BLE_ADV_FILTER_ALLOW_SCAN_ANY_CON_ANY,
};

static void format_mac_id(const esp_bd_addr_t addr, char *out, size_t len)
{
    snprintf(out, len, "%02X%02X%02X%02X%02X%02X", addr[0], addr[1], addr[2], addr[3], addr[4], addr[5]);
}

static bool parse_employee_id(const uint8_t *adv_data, uint8_t adv_len, char *out, size_t out_len)
{
    if (!adv_data || adv_len == 0 || out_len < 2) {
        return false;
    }

    const char *prefix = CONFIG_IGNARA_BLE_ADV_NAME_PREFIX;
    size_t prefix_len = strlen(prefix);

    uint8_t name_len = 0;
    const uint8_t *name = esp_ble_resolve_adv_data((uint8_t *)adv_data, ESP_BLE_AD_TYPE_NAME_CMPL, &name_len);
    if (!name || name_len == 0) {
        name = esp_ble_resolve_adv_data((uint8_t *)adv_data, ESP_BLE_AD_TYPE_NAME_SHORT, &name_len);
    }
    if (!name || name_len == 0) {
        return false;
    }

    if (prefix_len == 0 || name_len <= prefix_len) {
        return false;
    }
    if (memcmp(name, prefix, prefix_len) != 0) {
        return false;
    }

    size_t copy = name_len - prefix_len;
    if (copy >= out_len) {
        copy = out_len - 1;
    }
    memcpy(out, name + prefix_len, copy);
    out[copy] = '\0';
    return true;
}

static void upsert_tag(const char *device_id, const char *employee_id, int rssi)
{
    if (xSemaphoreTake(s_tags_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        return;
    }

    int64_t now = esp_timer_get_time() / 1000;
    int slot = -1;
    int oldest_slot = 0;
    int64_t oldest_ts = now;

    for (int i = 0; i < IGN_MAX_TRACKED_TAGS; i++) {
        if (s_tags[i].in_use && strcmp(s_tags[i].device_id, device_id) == 0) {
            slot = i;
            break;
        }
        if (!s_tags[i].in_use) {
            if (slot == -1) {
                slot = i;
            }
        } else if (s_tags[i].last_seen_ms < oldest_ts) {
            oldest_ts = s_tags[i].last_seen_ms;
            oldest_slot = i;
        }
    }

    if (slot == -1) {
        slot = oldest_slot;
    }

    ign_tracked_tag_t *entry = &s_tags[slot];
    entry->in_use = true;
    strncpy(entry->device_id, device_id, sizeof(entry->device_id) - 1);
    entry->device_id[sizeof(entry->device_id) - 1] = '\0';
    strncpy(entry->employee_id, employee_id ? employee_id : "", sizeof(entry->employee_id) - 1);
    entry->employee_id[sizeof(entry->employee_id) - 1] = '\0';
    entry->rssi = rssi;
    entry->last_seen_ms = now;

    xSemaphoreGive(s_tags_mutex);
}

static void gap_event_handler(esp_gap_ble_cb_event_t event, esp_ble_gap_cb_param_t *param)
{
    switch (event) {
    case ESP_GAP_BLE_SCAN_PARAM_SET_COMPLETE_EVT:
        esp_ble_gap_start_scanning(0); // 0 = scan forever
        break;

    case ESP_GAP_BLE_SCAN_START_COMPLETE_EVT:
        if (param->scan_start_cmpl.status != ESP_BT_STATUS_SUCCESS) {
            ESP_LOGE(TAG, "scan start failed: %d", param->scan_start_cmpl.status);
        } else {
            ESP_LOGI(TAG, "BLE scan started");
        }
        break;

    case ESP_GAP_BLE_SCAN_RESULT_EVT: {
        struct ble_scan_result_evt_param *r = &param->scan_rst;
        if (r->search_evt != ESP_GAP_SEARCH_INQ_RES_EVT) {
            break;
        }

        char device_id[IGN_DEVICE_ID_MAX];
        format_mac_id(r->bda, device_id, sizeof(device_id));

        char employee_id[IGN_EMPLOYEE_ID_MAX] = {0};
        bool matched = parse_employee_id(r->ble_adv, r->adv_data_len + r->scan_rsp_len, employee_id, sizeof(employee_id));
        if (!matched) {
            // Not one of our employee tags — skip.
            break;
        }

        upsert_tag(device_id, employee_id, r->rssi);
        break;
    }

    case ESP_GAP_BLE_ADV_DATA_SET_COMPLETE_EVT:
        esp_ble_gap_start_advertising(&s_relay_adv_params);
        break;

    default:
        break;
    }
}

void ign_ble_scan_init(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    } else {
        ESP_ERROR_CHECK(err);
    }

    s_tags_mutex = xSemaphoreCreateMutex();

    ESP_ERROR_CHECK(esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT));

    esp_bt_controller_config_t bt_cfg = BT_CONTROLLER_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_bt_controller_init(&bt_cfg));
    ESP_ERROR_CHECK(esp_bt_controller_enable(ESP_BT_MODE_BLE));
    ESP_ERROR_CHECK(esp_bluedroid_init());
    ESP_ERROR_CHECK(esp_bluedroid_enable());

    ESP_ERROR_CHECK(esp_ble_gap_register_callback(gap_event_handler));
    ESP_ERROR_CHECK(esp_ble_gap_set_device_name(CONFIG_IGNARA_BEACON_DEVICE_ID));
    ESP_ERROR_CHECK(esp_ble_gap_set_scan_params((esp_ble_scan_params_t *)&s_scan_params));
}

size_t ign_ble_snapshot_tags(ign_tracked_tag_t *out, size_t max)
{
    if (!out || max == 0) {
        return 0;
    }

    if (xSemaphoreTake(s_tags_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        return 0;
    }

    int64_t now = esp_timer_get_time() / 1000;
    int64_t horizon = (int64_t)CONFIG_IGNARA_BLE_SCAN_WINDOW_MS;
    size_t written = 0;

    for (int i = 0; i < IGN_MAX_TRACKED_TAGS && written < max; i++) {
        if (!s_tags[i].in_use) {
            continue;
        }
        if ((now - s_tags[i].last_seen_ms) > horizon) {
            s_tags[i].in_use = false;
            continue;
        }
        out[written++] = s_tags[i];
    }

    xSemaphoreGive(s_tags_mutex);
    return written;
}

void ign_ble_start_notification_advertisement(const ign_notification_t *notification)
{
    if (!notification) {
        return;
    }

    // Encode the notification into a short advertising device-name so nearby
    // employee tags can receive it by scanning. Format: "IGN-NOTE:<msg>"
    char adv_name[31];
    int prefix_len = snprintf(adv_name, sizeof(adv_name), "IGN-NOTE:");
    if (prefix_len < 0 || prefix_len >= (int)sizeof(adv_name)) {
        return;
    }

    size_t room_for_msg = sizeof(adv_name) - 1 - (size_t)prefix_len;
    strncpy(adv_name + prefix_len, notification->message, room_for_msg);
    adv_name[sizeof(adv_name) - 1] = '\0';

    ESP_LOGI(TAG, "Relaying notification via BLE: '%s'", adv_name);

    esp_ble_gap_stop_scanning();
    esp_ble_gap_set_device_name(adv_name);
    esp_ble_gap_config_adv_data(&s_relay_adv_data);
}

void ign_ble_stop_notification_advertisement(void)
{
    esp_ble_gap_stop_advertising();
    esp_ble_gap_set_device_name(CONFIG_IGNARA_BEACON_DEVICE_ID);
    esp_ble_gap_start_scanning(0);
}
