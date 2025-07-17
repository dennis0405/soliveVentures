#include <string.h>
#include <stdio.h>
#include <inttypes.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/ringbuf.h"
#include "freertos/semphr.h"

#include "ota_helper.h"
#include "ble_ota.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_bt.h"

static const char *TAG = "OTA_HELPER";

#define OTA_RINGBUF_SIZE                    8192
#define OTA_TASK_SIZE                       8192

esp_ota_handle_t out_handle      = 0;
SemaphoreHandle_t notify_sem     = NULL;
static RingbufHandle_t s_ringbuf = NULL;
static bool is_ota_started       = false;

void 
restart_ota_process(void) {
    ESP_LOGI(TAG, "Rebooting esp firmware to restart OTA process");
    vTaskDelay(pdMS_TO_TICKS(1000));
    esp_restart();
}

bool
ble_ota_ringbuf_init(uint32_t ringbuf_size)
{
    s_ringbuf = xRingbufferCreate(ringbuf_size, RINGBUF_TYPE_BYTEBUF);
    if (!s_ringbuf) {
        return false;
    }
    return true;
}

size_t
write_to_ringbuf(const uint8_t *data, size_t size)
{
    if (!s_ringbuf) {
        ESP_LOGE(TAG, "Ring buffer not initialized");
        return 0;
    }

    BaseType_t done = xRingbufferSend(s_ringbuf, (void *)data, size, 0);
    if (done) {
        return size;
    } else {
        ESP_LOGE(TAG, "Failed to write to ring buffer");
        return 0;
    }
}

void
ota_task(void *arg)
{
    esp_partition_t *partition = NULL;
    const esp_partition_t *next_partition = NULL;
    uint32_t recv_len = 0;
    uint8_t *data = NULL;
    size_t item_size = 0;
    esp_err_t err;

    ESP_LOGI(TAG, "ota_task start");

    notify_sem = xSemaphoreCreateCounting(100, 0);
    if (!notify_sem) {
        ESP_LOGE(TAG, "Failed to create notify semaphore");
        goto OTA_ERROR;
    }
    xSemaphoreGive(notify_sem);

    partition = (esp_partition_t *)esp_ota_get_running_partition();
    if (!partition) {
        ESP_LOGE(TAG, "get running partition failed!");
        goto OTA_ERROR;
    }

    // rollback -> valid state 전환
    esp_ota_img_states_t ota_state;
    if (esp_ota_get_state_partition(partition, &ota_state) == ESP_OK) {
        if (ota_state == ESP_OTA_IMG_PENDING_VERIFY) {
            ESP_ERROR_CHECK(esp_ota_mark_app_valid_cancel_rollback());
            ESP_LOGI(TAG, "Marked running image as valid");
        }
    } else {
        ESP_LOGE(TAG, "Failed to get OTA state for running partition!");
        goto OTA_ERROR;
    }
    
    if (partition->type != ESP_PARTITION_TYPE_APP) {
        ESP_LOGE(TAG, "running partition is not app type!");
        goto OTA_ERROR;
    }
    if (partition->subtype == ESP_PARTITION_SUBTYPE_APP_OTA_0) {
        next_partition = esp_partition_find_first(ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_APP_OTA_1, NULL);
    } else if (partition->subtype == ESP_PARTITION_SUBTYPE_APP_OTA_1) {
        next_partition = esp_partition_find_first(ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_APP_OTA_0, NULL);
    } else {
        ESP_LOGE(TAG, "running partition subtype is not OTA subtype!");
        goto OTA_ERROR;
    }
    if (!next_partition) {
        ESP_LOGE(TAG, "valid OTA partition not found!");
        goto OTA_ERROR;
    }

    if (esp_ota_begin(next_partition, OTA_SIZE_UNKNOWN, &out_handle) != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_begin failed!");
        goto OTA_ERROR;
    }

    // task를 늦게 등록해서 fw_length에 이미 길이 값이 설정
    uint32_t ota_total_len = esp_ble_ota_get_fw_length();
    ESP_LOGI(TAG, "OTA total length: %u bytes", ota_total_len);
    if (ota_total_len <= 0) {
        ESP_LOGE(TAG, "OTA total length is zero, aborting OTA process.");
        goto OTA_ERROR;
    }

    /*deal with all receive packet*/
    for (;;) {
        // ota task will block here until data is available in the ring buffer (4KB chunk)
        // max delay set to 10 seconds
        data = (uint8_t *)xRingbufferReceive(s_ringbuf, &item_size, (TickType_t)pdMS_TO_TICKS(10000));
        // timeout occurred
        if (!data) {
            ESP_LOGE(TAG, "Timeout waiting for data in ring buffer");
            goto OTA_ERROR;
        }

        // take the semaphore (timeout 10 seconds)
        if (xSemaphoreTake(notify_sem, pdMS_TO_TICKS(10000)) != pdTRUE) {
            vRingbufferReturnItem(s_ringbuf, (void *)data);
            ESP_LOGE(TAG, "Failed to take semaphore for OTA operation");
            goto OTA_ERROR;
        }
        
        // write data to OTA partition and return the item to the ring buffer
        err = esp_ota_write(out_handle, data, item_size);
        vRingbufferReturnItem(s_ringbuf, (void *)data);
        if (err != ESP_OK) {
            xSemaphoreGive(notify_sem);
            ESP_LOGE(TAG, "esp_ota_write failed");
            goto OTA_ERROR;
        }

        recv_len += item_size;
        uint8_t progress = (recv_len * 100) / ota_total_len;
        ESP_LOGI(TAG, "recv: %u, recv_total:%"PRIu32", total:%"PRIu32"\n", item_size, recv_len, ota_total_len);
        
        esp_ble_ota_send_progress_report(progress);
        ESP_LOGI(TAG, "Sent progress: %d%%", progress);
        
        // 전송 받은 length로 OTA 작업이 완료되었는지 확인
        if (recv_len >= ota_total_len) {
            xSemaphoreGive(notify_sem);
            break;
        }
        
        // release the semaphore for next iteration
        xSemaphoreGive(notify_sem);
    }
    ESP_LOGI(TAG, "OTA flash upload success, total length: %" PRIu32, recv_len);

    if (esp_ota_end(out_handle) != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_end failed");
        goto OTA_ERROR;
    }

    if (esp_ota_set_boot_partition(next_partition) != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_set_boot_partition failed");
        goto OTA_ERROR;
    }

    ESP_LOGI(TAG, "OTA successful, rebooting...");
    vTaskDelay(pdMS_TO_TICKS(2000));
    esp_restart();

OTA_ERROR:
    vTaskDelay(pdMS_TO_TICKS(2000));
    restart_ota_process();

    // never reached, but just in case
    vTaskDelete(NULL);
    return;
}

void
ota_recv_fw_cb(uint8_t *buf, uint32_t length)
{   
    if (!is_ota_started) {
        BaseType_t task = xTaskCreate(ota_task, "ota_task", OTA_TASK_SIZE, NULL, 10, NULL);
        if (task == pdPASS) {
            is_ota_started = true;
        } else {
            ESP_LOGE(TAG, "Failed to create OTA task");
            restart_ota_process();
            return;
        }
    }
    write_to_ringbuf(buf, length);
}

bool ble_ota_helper_init()
{
    esp_err_t ret;

    ESP_LOGI(TAG, "Initializing BLE OTA helper");
    
    if (!ble_ota_ringbuf_init(OTA_RINGBUF_SIZE)) {
        ESP_LOGE(TAG, "%s init ringbuf fail", __func__);
        return false;
    }
    
    ESP_ERROR_CHECK(esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT));
    esp_bt_controller_config_t bt_cfg = BT_CONTROLLER_INIT_CONFIG_DEFAULT();
    
    ret = esp_bt_controller_init(&bt_cfg);
    if (ret) {
        ESP_LOGE(TAG, "%s enable controller failed: %s\n", __func__, esp_err_to_name(ret));
        return false;
    }
    ret = esp_bt_controller_enable(ESP_BT_MODE_BLE);
    if (ret) {
        ESP_LOGE(TAG, "%s enable controller failed: %s\n", __func__, esp_err_to_name(ret));
        return false;
    }
    if (esp_ble_ota_host_init() != ESP_OK) {
        ESP_LOGE(TAG, "%s initialize ble host fail: %s\n", __func__, esp_err_to_name(ret));
        return false;
    }

    // RECV_FW_CHAR callback
    esp_ble_ota_recv_fw_data_callback(ota_recv_fw_cb);
    return true;
}
