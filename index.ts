import { BleManager } from 'react-native-ble-plx';
import { createNavigationContainerRef } from '@react-navigation/native';
import { RootStackParamList } from '~/navigation/AppNavigator';

// API URL map for different environments

export const API_URL = __DEV__
  ? API_URL_MAP[process.env.NODE_ENV as keyof typeof API_URL_MAP]
  : API_URL_MAP.prod;

console.log('process.env.NODE_ENV', process.env.NODE_ENV, API_URL);

export const HAPTIC_FEEDBACK_OPTIONS = {
  enableVibrateFallback: true,
  ignoreAndroidSystemSettings: false,
};

export const BLE_MANAGER = new BleManager();

// ESP32 BLE UUIDs
export const ESP32_ADVERTISE_UUID      = '00001811-0000-1000-8000-00805f9b34fb'; //0x1811
export const ESP32_SERVICE_UUID        = '00008018-0000-1000-8000-00805f9b34fb'; //0x8018
export const ESP32_RECV_FW_CHAR_UUID   = '00008020-0000-1000-8000-00805f9b34fb'; //0x8020
export const ESP32_PROGRESS_CHAR_UUID  = '00008021-0000-1000-8000-00805f9b34fb'; //0x8021
export const ESP32_COMMAND_CHAR_UUID   = '00008022-0000-1000-8000-00805f9b34fb'; //0x8022
export const ESP32_CUSTOMER_CHAR_UUID  = '00008023-0000-1000-8000-00805f9b34fb'; //0x8023

// Renesas BLE UUIDs
export const RENESAS_SERVICE_UUID = '0000fff0-0000-1000-8000-00805f9b34fb'; // Renesas의 서비스 UUID
export const RENESAS_WRITE_CHARACTERISTIC_UUID =
  '0000fff2-0000-1000-8000-00805f9b34fb'; // 쓰기 특성 UUID
export const RENESAS_NOTIFY_CHARACTERISTIC_UUID =
  '0000fff1-0000-1000-8000-00805f9b34fb'; // 알림 특성 UUID

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigate<RouteName extends keyof RootStackParamList>(
  name: RouteName,
  params?: RootStackParamList[RouteName],
) {
  if (navigationRef.isReady()) {
    navigationRef.reset({
      index: 0,
      routes: [{ name, params }],
    });
  }
}

export const SIMULATION_TARGET_UUIDs = ['123'];
