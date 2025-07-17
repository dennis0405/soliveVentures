idf_component_register(
    SRCS "src/ota_helper.c"
    INCLUDE_DIRS "include"
    REQUIRES ble_ota esp_ringbuf bt app_update
)
