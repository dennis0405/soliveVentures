#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "led_strip.h"
#include "blink.h"

static const char *TAG = "LED_BLINK";
static uint8_t s_led_state = 0; // LED state variable
static led_strip_handle_t led_strip;

#define BLINK_PERIOD 1000 // Blink period in milliseconds
#define BLINK_GPIO 48

bool blink_init(void) {
    ESP_LOGI(TAG, "Initializing Blink GPIO LED");
    led_strip_config_t strip_config = {
        .strip_gpio_num = BLINK_GPIO,
        .max_leds = 1, // at least one LED on board
    };

    led_strip_rmt_config_t rmt_config = {
        .resolution_hz = 10 * 1000 * 1000, // 10MHz
        .flags.with_dma = false,
    };
    ESP_ERROR_CHECK(led_strip_new_rmt_device(&strip_config, &rmt_config, &led_strip));
    led_strip_clear(led_strip);
    return true; // Initialization successful
}

static void blink_led(void)
{
    if (s_led_state) {
        led_strip_set_pixel(led_strip, 0, 16, 16, 16);
        led_strip_refresh(led_strip);
    } else {
        led_strip_clear(led_strip);
    }
}

void blink_task(void *pvParameter) {
    ESP_LOGI(TAG, "Starting Blink Task");
    while (1) {
        ESP_LOGI(TAG, "Turning the LED %s!", s_led_state == true ? "ON" : "OFF");
        blink_led(); // Toggle the LED state
        s_led_state = !s_led_state; // Toggle the state for the next iteration
        vTaskDelay(BLINK_PERIOD / portTICK_PERIOD_MS);
    }
}