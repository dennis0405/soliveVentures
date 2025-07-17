#include <string.h>
#include <stdio.h>
#include <inttypes.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "esp_log.h"
#include "nvs_flash.h"
#include "ota_helper.h"
#include "hello_world.h"

static const char *TAG = "APP_MAIN";
# define OTA_TASK_SIZE 8192
# define HELLO_WORLD_TASK_SIZE 4096

void app_main(void)
{
    ESP_LOGI(TAG, "Initializing nvs flash");
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES ||
        ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    ESP_LOGI(TAG, "Initializing BLE OTA and Hello World task");

    // Initialize BLE OTA
    if (!ble_ota_helper_init()) {
        ESP_LOGE(TAG, "Failed to initialize BLE OTA");
        esp_restart();
    }

    // hello_world_task
    ret = xTaskCreate(hello_world_task, "hello_world_task",
        HELLO_WORLD_TASK_SIZE, NULL, 2, NULL);
    if (ret != pdPASS) {
        ESP_LOGE(TAG, "Failed to create hello_world_task");
        esp_restart();
    }

    ESP_LOGI(TAG, "System initialization complete");

    while (1) {
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}
