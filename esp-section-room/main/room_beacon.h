#pragma once

#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>

#define IGN_MAX_TRACKED_TAGS 32
#define IGN_EMPLOYEE_ID_MAX 32
#define IGN_DEVICE_ID_MAX 24
#define IGN_NOTIFY_MESSAGE_MAX 180

typedef struct {
    char device_id[IGN_DEVICE_ID_MAX];     // e.g. formatted BLE MAC address
    char employee_id[IGN_EMPLOYEE_ID_MAX]; // parsed from advertisement name
    int rssi;
    int64_t last_seen_ms;
    bool in_use;
} ign_tracked_tag_t;

typedef struct {
    char id[40];
    char message[IGN_NOTIFY_MESSAGE_MAX];
    char priority[8];
    int64_t expires_at_ms;
} ign_notification_t;

// WiFi
void ign_wifi_init_and_connect(void);
bool ign_wifi_is_connected(void);

// BLE scanner + tag table
void ign_ble_scan_init(void);
size_t ign_ble_snapshot_tags(ign_tracked_tag_t *out, size_t max);
void ign_ble_start_notification_advertisement(const ign_notification_t *notification);
void ign_ble_stop_notification_advertisement(void);

// HTTP sync
void ign_http_post_report(const ign_tracked_tag_t *tags, size_t count);
size_t ign_http_poll_notifications(ign_notification_t *out, size_t max);
