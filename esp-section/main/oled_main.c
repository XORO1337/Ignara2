/*
 * Ignara employee tag firmware for the ESP32-C3 Super Mini.
 *
 * The tag does two things:
 *   1. Broadcasts a BLE advertisement carrying the employee ID so that the
 *      room-mounted beacon can log proximity.
 *   2. Drives a 16x2 HD44780 LCD (via an I2C PCF8574 backpack) to show the
 *      employee's name/ID, and lets the wearer flip to a "meeting" screen
 *      with a push button + buzzer feedback.
 *
 * -------------------------------------------------------------------------
 * ESP32-C3 Super Mini wiring
 * -------------------------------------------------------------------------
 *   LCD backpack VCC   -> 5V         (board's 5V / VBUS pad)
 *   LCD backpack GND   -> GND
 *   LCD backpack SDA   -> GPIO5
 *   LCD backpack SCL   -> GPIO6
 *
 *   Push button        -> GPIO3 and GND   (uses internal pull-up, active LOW)
 *
 *   Buzzer  +          -> GPIO4
 *   Buzzer  -          -> GND
 *
 * Notes:
 *   - Most PCF8574 LCD backpacks are at I2C address 0x27 (some are 0x3F).
 *     Change LCD_I2C_ADDRESS below if yours differs.
 *   - GPIO2, GPIO8, GPIO9 are strapping pins and are avoided here.
 *   - GPIO8 is the onboard LED, GPIO9 is the BOOT button.
 *   - GPIO20/GPIO21 are reserved for UART0 (flashing / logging).
 *   - The LCD expects 5V on VCC for readable contrast; the PCF8574 I/O is
 *     tolerant of the C3's 3.3 V I2C levels.
 * -------------------------------------------------------------------------
 */

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_check.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_rom_sys.h"
#include "driver/i2c_master.h"
#include "driver/gpio.h"
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

#define TAG "ignara"

/* -------------------------------------------------------------------------
 * I2C / LCD configuration
 * ------------------------------------------------------------------------- */
#define I2C_MASTER_NUM          I2C_NUM_0
#define I2C_MASTER_SDA_IO       GPIO_NUM_5
#define I2C_MASTER_SCL_IO       GPIO_NUM_6
#define I2C_MASTER_FREQ_HZ      100000
#define I2C_MASTER_TIMEOUT_MS   100

#define BUTTON_PIN              GPIO_NUM_3
#define BUZZER_PIN              GPIO_NUM_4

#define LCD_I2C_ADDRESS         0x27

/* PCF8574 bit mapping used by common LCD backpacks */
#define LCD_RS                  0x01
#define LCD_RW                  0x02
#define LCD_EN                  0x04
#define LCD_BACKLIGHT           0x08

/* HD44780 commands */
#define LCD_CMD_CLEAR           0x01
#define LCD_CMD_HOME            0x02
#define LCD_CMD_ENTRY_MODE      0x06
#define LCD_CMD_DISPLAY_ON      0x0C
#define LCD_CMD_FUNCTION_SET    0x28
#define LCD_COLS                16

static i2c_master_bus_handle_t s_i2c_bus = NULL;
static i2c_master_dev_handle_t s_lcd_dev = NULL;
static int s_last_button_state = 1;
static int s_current_button_state = 1;

static char s_default_line1[LCD_COLS + 1];
static char s_default_line2[LCD_COLS + 1];
static const char *s_meeting_line1 = "meeting:";
static const char *s_meeting_line2 = "in conference room 3PM ";

/* -------------------------------------------------------------------------
 * BLE advertising state
 * ------------------------------------------------------------------------- */
static bool s_ble_adv_started = false;
static uint8_t s_adv_config_done = 0;

#define ADV_CONFIG_FLAG         (1 << 0)
#define SCAN_RSP_CONFIG_FLAG    (1 << 1)

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

/* -------------------------------------------------------------------------
 * BLE advertising
 * ------------------------------------------------------------------------- */
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

/* -------------------------------------------------------------------------
 * Buzzer
 * ------------------------------------------------------------------------- */
static void buzzer_beep(int times, int on_ms, int off_ms)
{
    for (int i = 0; i < times; i++) {
        gpio_set_level(BUZZER_PIN, 1);
        vTaskDelay(pdMS_TO_TICKS(on_ms));
        gpio_set_level(BUZZER_PIN, 0);
        if (off_ms > 0) {
            vTaskDelay(pdMS_TO_TICKS(off_ms));
        }
    }
}

/* -------------------------------------------------------------------------
 * LCD (HD44780 via PCF8574 I2C backpack)
 * ------------------------------------------------------------------------- */
static esp_err_t lcd_i2c_write(uint8_t data)
{
    return i2c_master_transmit(s_lcd_dev, &data, 1, I2C_MASTER_TIMEOUT_MS);
}

static esp_err_t lcd_write4(uint8_t nibble_with_ctrl)
{
    /* Pulse EN high->low to latch each 4-bit nibble */
    ESP_RETURN_ON_ERROR(lcd_i2c_write(nibble_with_ctrl | LCD_EN), TAG, "lcd_i2c_write EN high failed");
    esp_rom_delay_us(1);
    ESP_RETURN_ON_ERROR(lcd_i2c_write(nibble_with_ctrl & ~LCD_EN), TAG, "lcd_i2c_write EN low failed");
    esp_rom_delay_us(50);
    return ESP_OK;
}

static esp_err_t lcd_send_byte(uint8_t value, bool rs)
{
    uint8_t ctrl = LCD_BACKLIGHT | (rs ? LCD_RS : 0);
    uint8_t high = (value & 0xF0) | ctrl;
    uint8_t low = ((value << 4) & 0xF0) | ctrl;

    ESP_RETURN_ON_ERROR(lcd_write4(high), TAG, "write high nibble failed");
    ESP_RETURN_ON_ERROR(lcd_write4(low), TAG, "write low nibble failed");
    return ESP_OK;
}

static esp_err_t lcd_cmd(uint8_t cmd)
{
    return lcd_send_byte(cmd, false);
}

static esp_err_t lcd_data(uint8_t data)
{
    return lcd_send_byte(data, true);
}

static esp_err_t lcd_set_cursor(uint8_t col, uint8_t row)
{
    static const uint8_t row_offsets[] = {0x00, 0x40, 0x14, 0x54};
    if (row > 3) {
        row = 3;
    }
    return lcd_cmd((uint8_t)(0x80 | (col + row_offsets[row])));
}

static esp_err_t lcd_print(const char *text)
{
    while (*text) {
        ESP_RETURN_ON_ERROR(lcd_data((uint8_t)(*text)), TAG, "lcd_data failed");
        text++;
    }
    return ESP_OK;
}

static esp_err_t lcd_print_padded_line(const char *text)
{
    char out[LCD_COLS + 1];
    size_t text_len = strlen(text);
    for (size_t i = 0; i < LCD_COLS; i++) {
        out[i] = (i < text_len) ? text[i] : ' ';
    }
    out[LCD_COLS] = '\0';
    return lcd_print(out);
}

static esp_err_t lcd_print_scroll_window(const char *text, size_t offset)
{
    char window[LCD_COLS + 1];
    size_t text_len = strlen(text);

    for (size_t i = 0; i < LCD_COLS; i++) {
        window[i] = text[(offset + i) % text_len];
    }
    window[LCD_COLS] = '\0';

    return lcd_print(window);
}

static esp_err_t lcd_init_4bit(void)
{
    vTaskDelay(pdMS_TO_TICKS(50));

    /* Initialization sequence required by HD44780 in 4-bit mode */
    ESP_RETURN_ON_ERROR(lcd_write4(0x30 | LCD_BACKLIGHT), TAG, "init step 1 failed");
    vTaskDelay(pdMS_TO_TICKS(5));
    ESP_RETURN_ON_ERROR(lcd_write4(0x30 | LCD_BACKLIGHT), TAG, "init step 2 failed");
    esp_rom_delay_us(150);
    ESP_RETURN_ON_ERROR(lcd_write4(0x30 | LCD_BACKLIGHT), TAG, "init step 3 failed");
    ESP_RETURN_ON_ERROR(lcd_write4(0x20 | LCD_BACKLIGHT), TAG, "set 4-bit mode failed");

    ESP_RETURN_ON_ERROR(lcd_cmd(LCD_CMD_FUNCTION_SET), TAG, "function set failed");
    ESP_RETURN_ON_ERROR(lcd_cmd(0x08), TAG, "display off failed");
    ESP_RETURN_ON_ERROR(lcd_cmd(LCD_CMD_CLEAR), TAG, "clear failed");
    vTaskDelay(pdMS_TO_TICKS(2));
    ESP_RETURN_ON_ERROR(lcd_cmd(LCD_CMD_ENTRY_MODE), TAG, "entry mode failed");
    ESP_RETURN_ON_ERROR(lcd_cmd(LCD_CMD_DISPLAY_ON), TAG, "display on failed");
    ESP_RETURN_ON_ERROR(lcd_cmd(LCD_CMD_HOME), TAG, "home failed");
    vTaskDelay(pdMS_TO_TICKS(2));

    return ESP_OK;
}

static void i2c_lcd_init(void)
{
    i2c_master_bus_config_t bus_cfg = {
        .i2c_port = I2C_MASTER_NUM,
        .sda_io_num = I2C_MASTER_SDA_IO,
        .scl_io_num = I2C_MASTER_SCL_IO,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    ESP_ERROR_CHECK(i2c_new_master_bus(&bus_cfg, &s_i2c_bus));

    i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = LCD_I2C_ADDRESS,
        .scl_speed_hz = I2C_MASTER_FREQ_HZ,
    };
    ESP_ERROR_CHECK(i2c_master_bus_add_device(s_i2c_bus, &dev_cfg, &s_lcd_dev));
}

static void button_init(void)
{
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << BUTTON_PIN),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&io_conf));
}

static void buzzer_init(void)
{
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << BUZZER_PIN),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&io_conf));
    ESP_ERROR_CHECK(gpio_set_level(BUZZER_PIN, 0));
}

/* -------------------------------------------------------------------------
 * app_main
 * ------------------------------------------------------------------------- */
void app_main(void)
{
    ESP_LOGI(TAG, "Ignara employee tag booting (ESP32-C3 Super Mini)");
    ESP_LOGI(TAG, "  Employee name: %s", CONFIG_IGNARA_EMPLOYEE_NAME);
    ESP_LOGI(TAG, "  Employee id:   %s", CONFIG_IGNARA_EMPLOYEE_ID);

    /* Default LCD screen content: line 1 = name, line 2 = E_ID: <id> */
    snprintf(s_default_line1, sizeof(s_default_line1), "%s", CONFIG_IGNARA_EMPLOYEE_NAME);
    snprintf(s_default_line2, sizeof(s_default_line2), "E_ID: %s", CONFIG_IGNARA_EMPLOYEE_ID);

    ESP_ERROR_CHECK(ble_advertising_init());

    i2c_lcd_init();
    button_init();
    buzzer_init();
    ESP_LOGI(TAG, "I2C LCD init on SDA=%d, SCL=%d, addr=0x%02X",
             I2C_MASTER_SDA_IO, I2C_MASTER_SCL_IO, LCD_I2C_ADDRESS);
    ESP_LOGI(TAG, "Button init on GPIO%d (INPUT_PULLUP)", BUTTON_PIN);
    ESP_LOGI(TAG, "Buzzer init on GPIO%d", BUZZER_PIN);

    ESP_ERROR_CHECK(lcd_init_4bit());
    ESP_ERROR_CHECK(lcd_set_cursor(0, 0));
    ESP_ERROR_CHECK(lcd_print_padded_line(s_default_line1));
    ESP_ERROR_CHECK(lcd_set_cursor(0, 1));
    ESP_ERROR_CHECK(lcd_print_padded_line(s_default_line2));

    bool meeting_mode = false;
    size_t scroll_offset = 0;

    while (1) {
        s_current_button_state = gpio_get_level(BUTTON_PIN);

        /* Button is wired active-low with INPUT_PULLUP */
        if (s_last_button_state == 1 && s_current_button_state == 0) {
            vTaskDelay(pdMS_TO_TICKS(20));
            s_current_button_state = gpio_get_level(BUTTON_PIN);
            if (s_current_button_state == 0) {
                meeting_mode = !meeting_mode;
                scroll_offset = 0;
                if (meeting_mode) {
                    ESP_LOGI(TAG, "Button pressed: switching to meeting screen");
                    buzzer_beep(1, 120, 0);
                    ESP_ERROR_CHECK(lcd_set_cursor(0, 0));
                    ESP_ERROR_CHECK(lcd_print_padded_line(s_meeting_line1));
                } else {
                    ESP_LOGI(TAG, "Button pressed: switching to default screen");
                    buzzer_beep(2, 80, 80);
                    ESP_ERROR_CHECK(lcd_set_cursor(0, 0));
                    ESP_ERROR_CHECK(lcd_print_padded_line(s_default_line1));
                    ESP_ERROR_CHECK(lcd_set_cursor(0, 1));
                    ESP_ERROR_CHECK(lcd_print_padded_line(s_default_line2));
                }
            }
        }
        s_last_button_state = s_current_button_state;

        if (meeting_mode) {
            ESP_ERROR_CHECK(lcd_set_cursor(0, 1));
            ESP_ERROR_CHECK(lcd_print_scroll_window(s_meeting_line2, scroll_offset));
            scroll_offset = (scroll_offset + 1) % strlen(s_meeting_line2);
            vTaskDelay(pdMS_TO_TICKS(300));
        } else {
            vTaskDelay(pdMS_TO_TICKS(50));
        }

        if (!s_ble_adv_started) {
            static int warn_counter = 0;
            if (++warn_counter >= 40) {
                ESP_LOGW(TAG, "BLE advertising not started yet");
                warn_counter = 0;
            }
        }
    }
}
