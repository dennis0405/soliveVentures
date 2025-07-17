/* ----------------------------- Imports ----------------------------------------- */
import { Buffer } from 'buffer';
import { Device, Subscription } from 'react-native-ble-plx';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { BLE_MANAGER } from '../constants';
import { DeviceProfile, DeviceType, getDeviceProfile } from './deviceStore';
import { PermissionsAndroid, Platform } from 'react-native';
import RNFS from 'react-native-fs';

/* ----------------------------- Constants ---------------------------------------- */
const SECTOR_SIZE = 4096; // 4KB

/* ----------------------------- helper functions --------------------------------- */
function calcCrc16(buffer: Buffer): number {
  let crc = 0;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i] << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff;
      else crc = (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function makeOtaStartCmd(fwLength: number): Buffer {
  const packet = Buffer.alloc(20, 0x00);
  packet.writeUInt16LE(0x0001, 0);              // Command ID
  packet.writeUInt32LE(fwLength, 2);            // Firmware length
  const crc = calcCrc16(packet.subarray(0, 18));
  packet.writeUInt16LE(crc, 18);                // CRC16
  return packet;
}

async function sendStartOtaCommand(
    device: Device, 
    profile: DeviceProfile, 
    fwLength: number
): Promise<void> {
    const cmd = makeOtaStartCmd(fwLength);
    await device.writeCharacteristicWithResponseForService(
      profile.serviceUUID,
      profile.commandUUID!,
      cmd.toString('base64')
    );
    console.log('🔄 OTA Start CMD sent (fw_length=', fwLength, ')');
}

function withTimeout<T>(promise: Promise<T>, ms: number, errorMsg = 'Operation timed out'): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(errorMsg)), ms);
    promise
      .then(res => resolve(res))
      .catch(err => reject(err))
      .finally(() => clearTimeout(timer));
  });
}

function createProgressHandler(onProgress?: (pct: number) => void) {
  let current = 0;
  let waiters: { pct: number; resolve: () => void; reject: (e?: any) => void }[] = [];

  const updateProgress = (newPct: number) => {
    if (newPct > current) {
      console.log(`🔄 OTA 진행률: ${current}% -> ${newPct}%`);
      current = newPct;
      onProgress?.(current);
      waiters = waiters.filter(w => {
        if (current >= w.pct) { w.resolve(); return false; }
        return true;
      });
    }
  };

  const waitForProgress = (pct: number) =>
    new Promise<void>((res, rej) => {
      if (current >= pct) return res();
      waiters.push({ pct, resolve: res, reject: rej });
    });

  const rejectAll = (reason: any) => { waiters.forEach(w => w.reject(reason)); waiters = []; };

  return { updateProgress, waitForProgress, rejectAll };
}
/* ---------------------------- Typescript Interface -------------------------------- */
export interface OTAStore {
    
    device: Device | null;
    type: DeviceType | null;
    isScanning: boolean;
    foundDevices: Device[];

    isUpdating: boolean;
    progress: number;

    startScan: () => void;
    stopScan: () => void;

    connectDevice: (deviceId: string) => Promise<void>;
    disconnectDevice: () => Promise<void>;
    cancelConnection: () => Promise<void>;

    otaUpdate: (
        base64Firmware: string, 
        chunkSize?: number,
    ) => Promise<void>;

    loadFirmware: () => Promise<string>;
    requestPermissions: () => Promise<void>;
}

/* ---------------------------- Zustand Store --------------------------------------- */
export const useOtaStore = create<OTAStore>()(
  subscribeWithSelector<OTAStore>((set, get) => ({
    device: null,
    type: null,
    isScanning: false,
    foundDevices: [],

    isUpdating: false,
    progress: 0,

    startScan: async () => {
        const { requestPermissions, stopScan } = get();
        if (get().isScanning) return;

        await requestPermissions();
        set({ isScanning: true, foundDevices: [] });

        BLE_MANAGER.startDeviceScan(
          null,
          { allowDuplicates: false },
          (error, scannedDevice) => {
            if (error) {
              console.error('Scan error:', error.errorCode);
              stopScan();
              return;
            }
            if (
              scannedDevice &&
              scannedDevice.isConnectable && 
              scannedDevice.localName?.toLowerCase().includes('ota')
            ) {
              set(state => ({
                foundDevices: state.foundDevices.some(d => d.id === scannedDevice.id)
                  ? state.foundDevices
                  : [...state.foundDevices, scannedDevice],
              }));
            }
          },
        );
    },

    stopScan: () => {
      BLE_MANAGER.stopDeviceScan();
      set({ isScanning: false, foundDevices: [] });
    },

    connectDevice: async deviceId => {
      const isConnected = await BLE_MANAGER.isDeviceConnected(deviceId);
      let cd: Device;

      if (!isConnected) {
        cd = await BLE_MANAGER.connectToDevice(deviceId, {
          autoConnect: false,
          timeout: 5000,
        });
        await cd.discoverAllServicesAndCharacteristics();
      } else {
        const devices = await BLE_MANAGER.connectedDevices([]);
        const found = devices.find(d => d.id === deviceId);
        if (!found) throw new Error('Connected device not found');
        cd = found;
      }

      const profile = getDeviceProfile(cd.name ?? '');
      if (!profile) throw new Error('Unknown device type: ' + cd.name);
      set({ device: cd, type: profile.type });

      if (Platform.OS === 'android') {
        await BLE_MANAGER.requestMTUForDevice(cd.id, 500);
      }
    },

    disconnectDevice: async () => {
      await get().cancelConnection();
    },

    cancelConnection: async () => {
      const d = get().device;
      if (d) {
        await d.cancelConnection();
        set({ device: null, type: null });
      }
    },

    otaUpdate: async (
      base64Firmware,
      chunkSize = 492,
    ) => {
        set ({ isUpdating: true, progress: 0 });
        let cleanup = false;
        const progressHandler = createProgressHandler(newPct => {
            set({ progress: newPct });
        });
        let cmdSub: Subscription | null = null, recvSub: Subscription | null = null, 
            cusSub: Subscription | null = null, progressSub: Subscription | null = null, 
            disconnectSub: Subscription | null = null;
        
        let startResolve!: () => void;
        let startReject!: (e: any) => void;
        const startAck = new Promise<void>((res, rej) => {
            startResolve = res;
            startReject = rej;
        });
      
        try {
          const device = get().device;
          if (!device) throw new Error('No device connected');
        
          const profile = getDeviceProfile(device.name ?? '');
          if (!profile) throw new Error('Unknown device profile');
        
          if (!profile.serviceUUID || !profile.writeUUID ||
              !profile.notifyUUID ||  !profile.commandUUID || !profile.customerUUID) {
              throw new Error('Device profile is incomplete: ' + JSON.stringify(profile));
          }

          const firmware = Buffer.from(base64Firmware, 'base64');
          const totalLength = firmware.length;

          disconnectSub = device.onDisconnected((e, d) => {
              // disconnection during OTA update
              // catch, finally will handle cleanup
              if (!cleanup && e) {
                console.error('OTA device disconnected. Try again.', e);
              }
          });

          recvSub = device.monitorCharacteristicForService(
            profile.serviceUUID,
            profile.writeUUID,
            err => { 
            if (!cleanup && err) {
                console.error("OTA RECV_FW_CHAR subscription error:", err);
                startReject(err); 
            }
            }
          );
          cusSub = device.monitorCharacteristicForService(
            profile.serviceUUID,
            profile.customerUUID,
            err => { 
            if (!cleanup && err) {
                console.error("OTA CUSTOMER_CHAR subscription error:", err); 
                startReject(err); 
            }
            }
          );
          cmdSub = device.monitorCharacteristicForService(
            profile.serviceUUID,
            profile.commandUUID,
            (err, char) => {
            if (!cleanup && err) {
                console.error("OTA COMMAND_CHAR subscription error:", err);
                return startReject(err);
            }
            if (char?.value) {
                console.log('🔄 OTA Start CMD notify received');
                startResolve();
            }
            }
          );
          progressSub = device.monitorCharacteristicForService(
            profile.serviceUUID,
            profile.notifyUUID,
            (err, char) => {
            if (!cleanup && err) {
                console.error("OTA PROGRESS_CHAR subscription error:", err);
                return progressHandler.rejectAll(err);
            }
            if (char?.value) {
                const pct = Buffer.from(char.value, 'base64').readUInt8(0);
                progressHandler.updateProgress(pct);
            }
            }
          );

          await sendStartOtaCommand(device, profile, totalLength);
          await withTimeout(startAck, 3000, 'OTA start response timeout');

          const numSectors = Math.ceil(totalLength / SECTOR_SIZE);
          console.log(`Start Sending firmware chunks... MTU: ${chunkSize}, Sectors: ${numSectors}, Total Length: ${totalLength} bytes`);
          for (let sector = 0; sector < numSectors; sector++) {
            const offset = sector * SECTOR_SIZE; // 0
            const sectorChunk = firmware.subarray(
            offset,
            Math.min(offset + SECTOR_SIZE, totalLength)
            ); // 4096
            const crc = calcCrc16(sectorChunk);

            const header = Buffer.alloc(3);
            header.writeUInt16LE(sector, 0);

            const numSeq = Math.ceil(sectorChunk.length / chunkSize);
            for (let seq = 0; seq < numSeq; seq++) {
                const slice = sectorChunk.subarray(
                seq * chunkSize,
                Math.min((seq + 1) * chunkSize, sectorChunk.length)
            );
              const isLast = seq === numSeq - 1;
              const packet = Buffer.alloc(3 + slice.length + (isLast ? 2 : 0));
              header.writeUInt8((isLast ? 0xFF : seq), 2);
              header.copy(packet, 0);
              packet.set(slice, 3);
              if (isLast) packet.writeUInt16LE(crc, 3 + slice.length);

              await device.writeCharacteristicWithResponseForService(
                profile.serviceUUID,
                profile.writeUUID,
                packet.toString('base64')
              );
            }

            console.log(`📦 Sector ${sector + 1}/${numSectors} sent`);
            const endOffset = offset + sectorChunk.length;
            const expectedPct = Math.floor((endOffset / totalLength) * 100);
            await withTimeout(
              progressHandler.waitForProgress(expectedPct),
              5000,
              `Progress wait timeout at ${expectedPct}%`
            ); 
          }

          await withTimeout(
            progressHandler.waitForProgress(100),
            5000,
            'Final progress wait timeout'
          );
          console.log('✅ OTA update completed successfully');
        } catch (e) {
          console.error('OTA update failed:', e);
          startReject?.(e);
          progressHandler?.rejectAll(e);
        } finally {
          cleanup = true
          set({ device: null, type: null, isUpdating: false, progress: 0 });
          disconnectSub?.remove();
          cmdSub?.remove();
          recvSub?.remove();
          cusSub?.remove();
          progressSub?.remove();
        }
    },
  
    loadFirmware: async (): Promise<string> => {
      const firmware = await RNFS.readFileAssets('firmware.bin', 'base64');
      return firmware;
    },
    
    requestPermissions: async () => {
      if (Platform.OS === 'android') {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]);
      }
    },

  }))
);