idf_component_register(
    SRCS
        "room_beacon_main.c"
        "wifi_conn.c"
        "ble_scan.c"
        "http_sync.c"
    INCLUDE_DIRS "."
    REQUIRES
        nvs_flash
        esp_wifi
        esp_netif
        esp_event
        esp_http_client
        json
        bt
)
