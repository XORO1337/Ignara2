idf_component_register(SRCS "oled_main.c"
                       PRIV_REQUIRES spi_flash driver esp_driver_i2c esp_driver_gpio bt nvs_flash
                       INCLUDE_DIRS "")
