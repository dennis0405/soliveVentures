#pragma once

// Function to initialize the BLE OTA
bool ble_ota_helper_init();

// ota task function
void ota_task(void *arg);
