#include <stdbool.h>
#include <stdint.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/i2c.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_bt.h"
#include "esp_bt_defs.h"
#include "esp_bt_main.h"
#include "esp_gap_ble_api.h"
#include "nvs_flash.h"
#include "sdkconfig.h"

#ifndef CONFIG_IGNARA_EMPLOYEE_NAME
#define CONFIG_IGNARA_EMPLOYEE_NAME "Unset Employee"
#endif
#ifndef CONFIG_IGNARA_EMPLOYEE_ID
#define CONFIG_IGNARA_EMPLOYEE_ID "emp-000"
#endif
#ifndef CONFIG_IGNARA_SPLASH_SECONDS
#define CONFIG_IGNARA_SPLASH_SECONDS 4
#endif

#define TAG "oled"

#define I2C_PORT I2C_NUM_0
#define I2C_SDA_GPIO 21
#define I2C_SCL_GPIO 22
#define I2C_CLK_HZ 400000

#define OLED_ADDR 0x3C
#define OLED_WIDTH 128
#define OLED_HEIGHT 64
#define OLED_PAGES (OLED_HEIGHT / 8)

#define LOGO_WIDTH 16
#define LOGO_HEIGHT 16

static uint8_t s_framebuffer[OLED_WIDTH * OLED_PAGES];
static bool s_ble_adv_started = false;
static uint8_t s_adv_config_done = 0;

#define ADV_CONFIG_FLAG (1 << 0)
#define SCAN_RSP_CONFIG_FLAG (1 << 1)

static uint8_t s_adv_raw_data[31];
static uint8_t s_adv_raw_len = 0;
static uint8_t s_scan_rsp_raw_data[] = {
    0x08, ESP_BLE_AD_TYPE_LE_DEV_ADDR, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x02, ESP_BLE_AD_TYPE_TX_PWR, 0x09,
};

static esp_ble_adv_params_t s_adv_params = {
    .adv_int_min = 0x20,
    .adv_int_max = 0x40,
    .adv_type = ADV_TYPE_NONCONN_IND,
    .own_addr_type = BLE_ADDR_TYPE_PUBLIC,
    .channel_map = ADV_CHNL_ALL,
    .adv_filter_policy = ADV_FILTER_ALLOW_SCAN_ANY_CON_ANY,
};

#if !CONFIG_BT_BLE_42_FEATURES_SUPPORTED
static const uint8_t s_ext_adv_instance = 0;
static esp_ble_gap_ext_adv_params_t s_ext_adv_params = {
    .type = ESP_BLE_GAP_SET_EXT_ADV_PROP_LEGACY_NONCONN,
    .interval_min = 0x20,
    .interval_max = 0x40,
    .channel_map = ADV_CHNL_ALL,
    .own_addr_type = BLE_ADDR_TYPE_PUBLIC,
    .peer_addr_type = BLE_ADDR_TYPE_PUBLIC,
    .peer_addr = {0},
    .filter_policy = ADV_FILTER_ALLOW_SCAN_ANY_CON_ANY,
    .tx_power = EXT_ADV_TX_PWR_NO_PREFERENCE,
    .primary_phy = ESP_BLE_GAP_PRI_PHY_1M,
    .max_skip = 0,
    .secondary_phy = ESP_BLE_GAP_PHY_1M,
    .sid = 0,
    .scan_req_notif = false,
};
static esp_ble_gap_ext_adv_t s_ext_adv = {
    .instance = 0,
    .duration = 0,
    .max_events = 0,
};
#endif

static const uint8_t logo_bmp[] = {
    0b00000000, 0b11000000,
    0b00000001, 0b11000000,
    0b00000001, 0b11000000,
    0b00000011, 0b11100000,
    0b11110011, 0b11100000,
    0b11111110, 0b11111000,
    0b01111110, 0b11111111,
    0b00110011, 0b10011111,
    0b00011111, 0b11111100,
    0b00001101, 0b01110000,
    0b00011011, 0b10100000,
    0b00111111, 0b11100000,
    0b00111111, 0b11110000,
    0b01111100, 0b11110000,
    0b01110000, 0b01110000,
    0b00000000, 0b00110000,
};

static esp_err_t oled_write_command(uint8_t cmd)
{
    uint8_t payload[2] = {0x00, cmd};
    return i2c_master_write_to_device(I2C_PORT, OLED_ADDR, payload, sizeof(payload), pdMS_TO_TICKS(100));
}

static esp_err_t oled_write_data(const uint8_t *data, size_t len)
{
    uint8_t tx[17];
    tx[0] = 0x40;

    while (len > 0) {
        size_t chunk = len > 16 ? 16 : len;
        memcpy(&tx[1], data, chunk);
        ESP_RETURN_ON_ERROR(
            i2c_master_write_to_device(I2C_PORT, OLED_ADDR, tx, chunk + 1, pdMS_TO_TICKS(100)),
            TAG,
            "failed to write display data"
        );
        data += chunk;
        len -= chunk;
    }
    return ESP_OK;
}

static esp_err_t oled_set_cursor(uint8_t page, uint8_t column)
{
    ESP_RETURN_ON_ERROR(oled_write_command((uint8_t)(0xB0 | page)), TAG, "set page failed");
    ESP_RETURN_ON_ERROR(oled_write_command((uint8_t)(0x00 | (column & 0x0F))), TAG, "set column low failed");
    ESP_RETURN_ON_ERROR(oled_write_command((uint8_t)(0x10 | (column >> 4))), TAG, "set column high failed");
    return ESP_OK;
}

static esp_err_t oled_update(void)
{
    for (uint8_t page = 0; page < OLED_PAGES; page++) {
        ESP_RETURN_ON_ERROR(oled_set_cursor(page, 0), TAG, "cursor set failed");
        ESP_RETURN_ON_ERROR(
            oled_write_data(&s_framebuffer[page * OLED_WIDTH], OLED_WIDTH),
            TAG,
            "page write failed"
        );
    }
    return ESP_OK;
}

static void oled_clear(bool color)
{
    memset(s_framebuffer, color ? 0xFF : 0x00, sizeof(s_framebuffer));
}

static void oled_draw_pixel(int x, int y, bool color)
{
    if (x < 0 || x >= OLED_WIDTH || y < 0 || y >= OLED_HEIGHT) {
        return;
    }

    const size_t idx = (size_t)x + ((size_t)y / 8U) * OLED_WIDTH;
    const uint8_t bit = (uint8_t)(1U << (y & 0x7));

    if (color) {
        s_framebuffer[idx] |= bit;
    } else {
        s_framebuffer[idx] &= (uint8_t)~bit;
    }
}

static void oled_draw_line(int x0, int y0, int x1, int y1, bool color)
{
    int dx = (x1 > x0) ? (x1 - x0) : (x0 - x1);
    int sx = (x0 < x1) ? 1 : -1;
    int dy = (y0 > y1) ? (y1 - y0) : (y0 - y1);
    int sy = (y0 < y1) ? 1 : -1;
    int err = dx + dy;

    while (true) {
        oled_draw_pixel(x0, y0, color);
        if (x0 == x1 && y0 == y1) {
            break;
        }
        int e2 = err * 2;
        if (e2 >= dy) {
            err += dy;
            x0 += sx;
        }
        if (e2 <= dx) {
            err += dx;
            y0 += sy;
        }
    }
}

static void oled_draw_rect(int x, int y, int w, int h, bool color)
{
    oled_draw_line(x, y, x + w - 1, y, color);
    oled_draw_line(x, y + h - 1, x + w - 1, y + h - 1, color);
    oled_draw_line(x, y, x, y + h - 1, color);
    oled_draw_line(x + w - 1, y, x + w - 1, y + h - 1, color);
}

static void oled_draw_circle(int xc, int yc, int r, bool color)
{
    int x = 0;
    int y = r;
    int d = 3 - (2 * r);

    while (y >= x) {
        oled_draw_pixel(xc + x, yc + y, color);
        oled_draw_pixel(xc - x, yc + y, color);
        oled_draw_pixel(xc + x, yc - y, color);
        oled_draw_pixel(xc - x, yc - y, color);
        oled_draw_pixel(xc + y, yc + x, color);
        oled_draw_pixel(xc - y, yc + x, color);
        oled_draw_pixel(xc + y, yc - x, color);
        oled_draw_pixel(xc - y, yc - x, color);

        x++;
        if (d > 0) {
            y--;
            d += 4 * (x - y) + 10;
        } else {
            d += 4 * x + 6;
        }
    }
}

static void oled_draw_bitmap(int x, int y, const uint8_t *bitmap, int w, int h, bool color)
{
    int row_bytes = (w + 7) / 8;

    for (int row = 0; row < h; row++) {
        for (int col = 0; col < w; col++) {
            int byte_idx = row * row_bytes + (col / 8);
            int bit_idx = 7 - (col % 8);
            if ((bitmap[byte_idx] >> bit_idx) & 0x01) {
                oled_draw_pixel(x + col, y + row, color);
            }
        }
    }
}

static const uint8_t font5x7[96][5] = {
    {0x00,0x00,0x00,0x00,0x00}, {0x00,0x00,0x5F,0x00,0x00}, {0x00,0x07,0x00,0x07,0x00},
    {0x14,0x7F,0x14,0x7F,0x14}, {0x24,0x2A,0x7F,0x2A,0x12}, {0x23,0x13,0x08,0x64,0x62},
    {0x36,0x49,0x55,0x22,0x50}, {0x00,0x05,0x03,0x00,0x00}, {0x00,0x1C,0x22,0x41,0x00},
    {0x00,0x41,0x22,0x1C,0x00}, {0x14,0x08,0x3E,0x08,0x14}, {0x08,0x08,0x3E,0x08,0x08},
    {0x00,0x50,0x30,0x00,0x00}, {0x08,0x08,0x08,0x08,0x08}, {0x00,0x60,0x60,0x00,0x00},
    {0x20,0x10,0x08,0x04,0x02}, {0x3E,0x51,0x49,0x45,0x3E}, {0x00,0x42,0x7F,0x40,0x00},
    {0x42,0x61,0x51,0x49,0x46}, {0x21,0x41,0x45,0x4B,0x31}, {0x18,0x14,0x12,0x7F,0x10},
    {0x27,0x45,0x45,0x45,0x39}, {0x3C,0x4A,0x49,0x49,0x30}, {0x01,0x71,0x09,0x05,0x03},
    {0x36,0x49,0x49,0x49,0x36}, {0x06,0x49,0x49,0x29,0x1E}, {0x00,0x36,0x36,0x00,0x00},
    {0x00,0x56,0x36,0x00,0x00}, {0x08,0x14,0x22,0x41,0x00}, {0x14,0x14,0x14,0x14,0x14},
    {0x00,0x41,0x22,0x14,0x08}, {0x02,0x01,0x51,0x09,0x06}, {0x32,0x49,0x79,0x41,0x3E},
    {0x7E,0x11,0x11,0x11,0x7E}, {0x7F,0x49,0x49,0x49,0x36}, {0x3E,0x41,0x41,0x41,0x22},
    {0x7F,0x41,0x41,0x22,0x1C}, {0x7F,0x49,0x49,0x49,0x41}, {0x7F,0x09,0x09,0x01,0x01},
    {0x3E,0x41,0x41,0x51,0x32}, {0x7F,0x08,0x08,0x08,0x7F}, {0x00,0x41,0x7F,0x41,0x00},
    {0x20,0x40,0x41,0x3F,0x01}, {0x7F,0x08,0x14,0x22,0x41}, {0x7F,0x40,0x40,0x40,0x40},
    {0x7F,0x02,0x04,0x02,0x7F}, {0x7F,0x04,0x08,0x10,0x7F}, {0x3E,0x41,0x41,0x41,0x3E},
    {0x7F,0x09,0x09,0x09,0x06}, {0x3E,0x41,0x51,0x21,0x5E}, {0x7F,0x09,0x19,0x29,0x46},
    {0x46,0x49,0x49,0x49,0x31}, {0x01,0x01,0x7F,0x01,0x01}, {0x3F,0x40,0x40,0x40,0x3F},
    {0x1F,0x20,0x40,0x20,0x1F}, {0x7F,0x20,0x18,0x20,0x7F}, {0x63,0x14,0x08,0x14,0x63},
    {0x03,0x04,0x78,0x04,0x03}, {0x61,0x51,0x49,0x45,0x43}, {0x00,0x00,0x7F,0x41,0x41},
    {0x02,0x04,0x08,0x10,0x20}, {0x41,0x41,0x7F,0x00,0x00}, {0x04,0x02,0x01,0x02,0x04},
    {0x40,0x40,0x40,0x40,0x40}, {0x00,0x01,0x02,0x04,0x00}, {0x20,0x54,0x54,0x54,0x78},
    {0x7F,0x48,0x44,0x44,0x38}, {0x38,0x44,0x44,0x44,0x20}, {0x38,0x44,0x44,0x48,0x7F},
    {0x38,0x54,0x54,0x54,0x18}, {0x08,0x7E,0x09,0x01,0x02}, {0x08,0x14,0x54,0x54,0x3C},
    {0x7F,0x08,0x04,0x04,0x78}, {0x00,0x44,0x7D,0x40,0x00}, {0x20,0x40,0x44,0x3D,0x00},
    {0x00,0x7F,0x10,0x28,0x44}, {0x00,0x41,0x7F,0x40,0x00}, {0x7C,0x04,0x18,0x04,0x78},
    {0x7C,0x08,0x04,0x04,0x78}, {0x38,0x44,0x44,0x44,0x38}, {0x7C,0x14,0x14,0x14,0x08},
    {0x08,0x14,0x14,0x18,0x7C}, {0x7C,0x08,0x04,0x04,0x08}, {0x48,0x54,0x54,0x54,0x20},
    {0x04,0x3F,0x44,0x40,0x20}, {0x3C,0x40,0x40,0x20,0x7C}, {0x1C,0x20,0x40,0x20,0x1C},
    {0x3C,0x40,0x30,0x40,0x3C}, {0x44,0x28,0x10,0x28,0x44}, {0x0C,0x50,0x50,0x50,0x3C},
    {0x44,0x64,0x54,0x4C,0x44}, {0x00,0x08,0x36,0x41,0x00}, {0x00,0x00,0x7F,0x00,0x00},
    {0x00,0x41,0x36,0x08,0x00}, {0x10,0x08,0x08,0x10,0x08}, {0x78,0x46,0x41,0x46,0x78},
};

static void ble_gap_event_handler(esp_gap_ble_cb_event_t event, esp_ble_gap_cb_param_t *param)
{
    switch (event) {
#if CONFIG_BT_BLE_42_FEATURES_SUPPORTED
    case ESP_GAP_BLE_ADV_DATA_RAW_SET_COMPLETE_EVT:
        if (param->adv_data_raw_cmpl.status != ESP_BT_STATUS_SUCCESS) {
            ESP_LOGE(TAG, "adv raw config failed: %d", param->adv_data_raw_cmpl.status);
            break;
        }
        s_adv_config_done &= (uint8_t)(~ADV_CONFIG_FLAG);
        if (s_adv_config_done == 0) {
            ESP_ERROR_CHECK(esp_ble_gap_start_advertising(&s_adv_params));
        }
        break;
    case ESP_GAP_BLE_SCAN_RSP_DATA_RAW_SET_COMPLETE_EVT:
        if (param->scan_rsp_data_raw_cmpl.status != ESP_BT_STATUS_SUCCESS) {
            ESP_LOGE(TAG, "scan rsp raw config failed: %d", param->scan_rsp_data_raw_cmpl.status);
            break;
        }
        s_adv_config_done &= (uint8_t)(~SCAN_RSP_CONFIG_FLAG);
        if (s_adv_config_done == 0) {
            ESP_ERROR_CHECK(esp_ble_gap_start_advertising(&s_adv_params));
        }
        break;
#else
    case ESP_GAP_BLE_EXT_ADV_SET_PARAMS_COMPLETE_EVT:
        if (param->ext_adv_set_params.status != ESP_BT_STATUS_SUCCESS) {
            ESP_LOGE(TAG, "ext adv params failed: %d", param->ext_adv_set_params.status);
            break;
        }
        ESP_ERROR_CHECK(esp_ble_gap_config_ext_adv_data_raw(s_ext_adv_instance, s_adv_raw_len, s_adv_raw_data));
        break;
    case ESP_GAP_BLE_EXT_ADV_DATA_SET_COMPLETE_EVT:
        if (param->ext_adv_data_set.status != ESP_BT_STATUS_SUCCESS) {
            ESP_LOGE(TAG, "ext adv data config failed: %d", param->ext_adv_data_set.status);
            break;
        }
        s_adv_config_done &= (uint8_t)(~ADV_CONFIG_FLAG);
        if (s_adv_config_done == 0) {
            ESP_ERROR_CHECK(esp_ble_gap_ext_adv_start(1, &s_ext_adv));
        }
        break;
#endif
    case ESP_GAP_BLE_ADV_START_COMPLETE_EVT:
        if (param->adv_start_cmpl.status == ESP_BT_STATUS_SUCCESS) {
            s_ble_adv_started = true;
            ESP_LOGI(TAG, "BLE advertising started");
        } else {
            ESP_LOGE(TAG, "BLE advertising start failed: %d", param->adv_start_cmpl.status);
        }
        break;
#if !CONFIG_BT_BLE_42_FEATURES_SUPPORTED
    case ESP_GAP_BLE_EXT_ADV_START_COMPLETE_EVT:
        if (param->ext_adv_start.status == ESP_BT_STATUS_SUCCESS) {
            s_ble_adv_started = true;
            ESP_LOGI(TAG, "BLE extended advertising started");
        } else {
            ESP_LOGE(TAG, "BLE extended advertising start failed: %d", param->ext_adv_start.status);
        }
        break;
#endif
    default:
        break;
    }
}

static uint8_t build_adv_payload(char *device_name_out, size_t len)
{
    const char *prefix = "IGN-EMP-";
    int written = snprintf(device_name_out, len, "%s%s", prefix, CONFIG_IGNARA_EMPLOYEE_ID);
    if (written < 0) {
        device_name_out[0] = '\0';
    } else if ((size_t)written >= len) {
        device_name_out[len - 1] = '\0';
    }

    size_t name_len = strnlen(device_name_out, len - 1);
    if (name_len > 26) {
        name_len = 26;
        device_name_out[name_len] = '\0';
    }

    uint8_t idx = 0;
    s_adv_raw_data[idx++] = 0x02;
    s_adv_raw_data[idx++] = ESP_BLE_AD_TYPE_FLAG;
    s_adv_raw_data[idx++] = 0x06;

    s_adv_raw_data[idx++] = (uint8_t)(name_len + 1U);
    s_adv_raw_data[idx++] = ESP_BLE_AD_TYPE_NAME_CMPL;
    memcpy(&s_adv_raw_data[idx], device_name_out, name_len);
    idx = (uint8_t)(idx + name_len);

    return idx;
}

static esp_err_t ble_advertising_init(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_RETURN_ON_ERROR(nvs_flash_erase(), TAG, "nvs erase failed");
        ESP_RETURN_ON_ERROR(nvs_flash_init(), TAG, "nvs init failed");
    } else {
        ESP_RETURN_ON_ERROR(err, TAG, "nvs init failed");
    }

    ESP_RETURN_ON_ERROR(esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT), TAG, "bt mem release failed");

    esp_bt_controller_config_t bt_cfg = BT_CONTROLLER_INIT_CONFIG_DEFAULT();
    ESP_RETURN_ON_ERROR(esp_bt_controller_init(&bt_cfg), TAG, "bt controller init failed");
    ESP_RETURN_ON_ERROR(esp_bt_controller_enable(ESP_BT_MODE_BLE), TAG, "bt controller enable failed");

    esp_bluedroid_config_t bluedroid_cfg = BT_BLUEDROID_INIT_CONFIG_DEFAULT();
    ESP_RETURN_ON_ERROR(esp_bluedroid_init_with_cfg(&bluedroid_cfg), TAG, "bluedroid init failed");
    ESP_RETURN_ON_ERROR(esp_bluedroid_enable(), TAG, "bluedroid enable failed");
    ESP_RETURN_ON_ERROR(esp_ble_gap_register_callback(ble_gap_event_handler), TAG, "gap callback failed");

    char device_name[32];
    s_adv_raw_len = build_adv_payload(device_name, sizeof(device_name));
    ESP_LOGI(TAG, "BLE tag advertising as %s", device_name);

    ESP_RETURN_ON_ERROR(esp_ble_gap_set_device_name(device_name), TAG, "set device name failed");

    esp_bd_addr_t local_addr;
    uint8_t local_addr_type = 0;
    ESP_RETURN_ON_ERROR(esp_ble_gap_get_local_used_addr(local_addr, &local_addr_type), TAG, "read local addr failed");
    s_scan_rsp_raw_data[2] = local_addr[5];
    s_scan_rsp_raw_data[3] = local_addr[4];
    s_scan_rsp_raw_data[4] = local_addr[3];
    s_scan_rsp_raw_data[5] = local_addr[2];
    s_scan_rsp_raw_data[6] = local_addr[1];
    s_scan_rsp_raw_data[7] = local_addr[0];

    s_adv_config_done = ADV_CONFIG_FLAG | SCAN_RSP_CONFIG_FLAG;
#if CONFIG_BT_BLE_42_FEATURES_SUPPORTED
    ESP_RETURN_ON_ERROR(esp_ble_gap_config_adv_data_raw(s_adv_raw_data, s_adv_raw_len), TAG, "config adv raw failed");
    ESP_RETURN_ON_ERROR(
        esp_ble_gap_config_scan_rsp_data_raw(s_scan_rsp_raw_data, sizeof(s_scan_rsp_raw_data)),
        TAG,
        "config scan rsp raw failed"
    );
#else
    s_adv_config_done = ADV_CONFIG_FLAG;
    ESP_RETURN_ON_ERROR(
        esp_ble_gap_ext_adv_set_params(s_ext_adv_instance, &s_ext_adv_params),
        TAG,
        "set ext adv params failed"
    );
#endif

    return ESP_OK;
}

static void oled_draw_char(int x, int y, char c, bool color)
{
    if (c < 32 || c > 127) {
        c = '?';
    }
    const uint8_t *glyph = font5x7[c - 32];
    for (int col = 0; col < 5; col++) {
        uint8_t bits = glyph[col];
        for (int row = 0; row < 7; row++) {
            if (bits & (1U << row)) {
                oled_draw_pixel(x + col, y + row, color);
            }
        }
    }
}

static void oled_draw_text(int x, int y, const char *text, bool color)
{
    while (*text) {
        oled_draw_char(x, y, *text, color);
        x += 6;
        if (x > OLED_WIDTH - 6) {
            break;
        }
        text++;
    }
}

static void show_employee_splash(void)
{
    oled_clear(false);
    oled_draw_text(16, 2, "IGNARA TAG", true);
    oled_draw_line(0, 12, OLED_WIDTH - 1, 12, true);
    oled_draw_text(0, 18, "Name:", true);
    oled_draw_text(0, 28, CONFIG_IGNARA_EMPLOYEE_NAME, true);
    oled_draw_text(0, 42, "ID:", true);
    oled_draw_text(0, 52, CONFIG_IGNARA_EMPLOYEE_ID, true);
    ESP_ERROR_CHECK(oled_update());
    vTaskDelay(pdMS_TO_TICKS(CONFIG_IGNARA_SPLASH_SECONDS * 1000));
}

static esp_err_t i2c_master_init(void)
{
    const i2c_config_t conf = {
        .mode = I2C_MODE_MASTER,
        .sda_io_num = I2C_SDA_GPIO,
        .scl_io_num = I2C_SCL_GPIO,
        .sda_pullup_en = GPIO_PULLUP_ENABLE,
        .scl_pullup_en = GPIO_PULLUP_ENABLE,
        .master.clk_speed = I2C_CLK_HZ,
        .clk_flags = 0,
    };

    ESP_RETURN_ON_ERROR(i2c_param_config(I2C_PORT, &conf), TAG, "i2c param config failed");
    ESP_RETURN_ON_ERROR(i2c_driver_install(I2C_PORT, conf.mode, 0, 0, 0), TAG, "i2c install failed");
    return ESP_OK;
}

static esp_err_t oled_init(void)
{
    static const uint8_t init_seq[] = {
        0xAE,
        0xD5, 0x80,
        0xA8, 0x3F,
        0xD3, 0x00,
        0x40,
        0x8D, 0x14,
        0x20, 0x00,
        0xA1,
        0xC8,
        0xDA, 0x12,
        0x81, 0xCF,
        0xD9, 0xF1,
        0xDB, 0x40,
        0xA4,
        0xA6,
        0x2E,
        0xAF,
    };

    for (size_t i = 0; i < sizeof(init_seq); i++) {
        ESP_RETURN_ON_ERROR(oled_write_command(init_seq[i]), TAG, "oled init failed");
    }

    oled_clear(false);
    ESP_RETURN_ON_ERROR(oled_update(), TAG, "initial clear failed");
    return ESP_OK;
}

static void test_draw_lines(void)
{
    oled_clear(false);
    for (int i = 0; i < OLED_WIDTH; i += 4) {
        oled_draw_line(0, 0, i, OLED_HEIGHT - 1, true);
    }
    for (int i = 0; i < OLED_HEIGHT; i += 4) {
        oled_draw_line(0, 0, OLED_WIDTH - 1, i, true);
    }
    ESP_ERROR_CHECK(oled_update());
    vTaskDelay(pdMS_TO_TICKS(1200));
}

static void test_draw_shapes(void)
{
    oled_clear(false);
    for (int i = 0; i < 28; i += 4) {
        oled_draw_rect(i, i, OLED_WIDTH - (2 * i), OLED_HEIGHT - (2 * i), true);
    }
    oled_draw_circle(OLED_WIDTH / 2, OLED_HEIGHT / 2, 20, true);
    oled_draw_circle(OLED_WIDTH / 2, OLED_HEIGHT / 2, 10, true);
    ESP_ERROR_CHECK(oled_update());
    vTaskDelay(pdMS_TO_TICKS(1200));
}

void app_main(void)
{
    ESP_LOGI(TAG, "Ignara employee tag booting");
    ESP_LOGI(TAG, "  Employee name: %s", CONFIG_IGNARA_EMPLOYEE_NAME);
    ESP_LOGI(TAG, "  Employee id:   %s", CONFIG_IGNARA_EMPLOYEE_ID);

    ESP_ERROR_CHECK(ble_advertising_init());

    bool oled_ready = false;
    if (i2c_master_init() == ESP_OK && oled_init() == ESP_OK) {
        oled_ready = true;
    } else {
        ESP_LOGW(TAG, "OLED init failed, continuing with BLE advertising only");
    }

    if (!oled_ready) {
        while (true) {
            if (!s_ble_adv_started) {
                ESP_LOGW(TAG, "BLE advertising not started yet");
            }
            vTaskDelay(pdMS_TO_TICKS(2000));
        }
    }

    show_employee_splash();

    test_draw_lines();
    test_draw_shapes();

    oled_clear(false);
    oled_draw_bitmap((OLED_WIDTH - LOGO_WIDTH) / 2, (OLED_HEIGHT - LOGO_HEIGHT) / 2, logo_bmp, LOGO_WIDTH, LOGO_HEIGHT, true);
    ESP_ERROR_CHECK(oled_update());
    vTaskDelay(pdMS_TO_TICKS(1000));

    ESP_ERROR_CHECK(oled_write_command(0xA7));
    vTaskDelay(pdMS_TO_TICKS(500));
    ESP_ERROR_CHECK(oled_write_command(0xA6));

    int x = (int)(esp_random() % (OLED_WIDTH - LOGO_WIDTH));
    int y = -LOGO_HEIGHT;
    int dy = 2;
    int time_to_drop = 1;

    for (time_to_drop = 0; time_to_drop <= 100; time_to_drop++) {
        oled_clear(false);
        oled_draw_bitmap(x, y, logo_bmp, LOGO_WIDTH, LOGO_HEIGHT, true);
        ESP_ERROR_CHECK(oled_update());

        y += dy;
        if (y >= OLED_HEIGHT) {
            y = -LOGO_HEIGHT;
            x = (int)(esp_random() % (OLED_WIDTH - LOGO_WIDTH));
        }

        vTaskDelay(pdMS_TO_TICKS(100));
    }
    esp_restart();
}
