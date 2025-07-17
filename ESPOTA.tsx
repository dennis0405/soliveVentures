/* ------------------------------ Imports ----------------------------- */
import React, { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Button,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Device } from 'react-native-ble-plx';
import { useOtaStore } from '~/stores/otaStore';

/* ------------------------- Helper Components -------------------------- */
const ProgressBar = ({ progress }: { progress: number }) => {
  return (
    <View style={styles.progressBarContainer}>
      <View style={[styles.progressBarFill, { width: `${progress}%` }]} />
      <Text style={styles.progressText}>{progress}%</Text>
    </View>
  );
};

/* ------------------------------ Component ----------------------------- */
const ESPOTA = () => {
  
  const {
    device, 
    isScanning,
    foundDevices,
    isUpdating,
    progress,

    startScan,
    stopScan,
    connectDevice, 
    disconnectDevice, 
    otaUpdate,
    loadFirmware,
  } = useOtaStore();

  useEffect(() => {
    return () => {
      stopScan();
    };
  }, [stopScan]);

  const connect = useCallback(
    async (d: Device) => {
      try {
        await connectDevice(d.id);
      } catch (e) {
        console.error('Connect error:', e);
      }
    },
    [connectDevice],
  );

  const disconnect = useCallback(() => {
    disconnectDevice();
  }, [disconnectDevice]);

  const startOta = useCallback(async () => {
    if (!device || isUpdating) return;

    try {
      const b64 = await loadFirmware();
      await otaUpdate(b64, 492);
    } catch (e) {
      console.error('OTA failed:', e);
    }
  }, [device, isUpdating, otaUpdate, loadFirmware]);

  const renderDeviceItem = ({ item }: { item: Device }) => (
    <TouchableOpacity style={styles.deviceRow} onPress={() => connect(item)}>
      <Text style={styles.deviceText}>
        {item.localName || item.name || 'Unknown Device'}
      </Text>
      <Text style={styles.deviceDetailText}>{item.id}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ESP32 OTA Update</Text>

      {/* UI for when no device is connected */}
      {!device ? (
        <>
          <View style={styles.scanButtonContainer}>
            <Button
              title={isScanning ? 'Scanning...' : 'Scan for Devices'}
              onPress={isScanning ? stopScan : startScan}
            />
          </View>

          {isScanning && <ActivityIndicator size="large" style={styles.scanner} />}

          <FlatList
            data={foundDevices}
            keyExtractor={d => d.id}
            renderItem={renderDeviceItem}
            ListEmptyComponent={
              !isScanning ? (
                <View style={styles.emptyListContainer}>
                  <Text style={styles.emptyListText}>No OTA devices found.</Text>
                  <Text style={styles.emptyListSubText}>Press "Scan" to search.</Text>
                </View>
              ) : null
            }
          />
        </>
      ) : (
        /* UI for when a device is connected */
        <>
          <View style={styles.connectedDeviceCard}>
              <Text style={styles.connectedTitle}>Connected Device</Text>
              <Text style={styles.connectedDeviceName}>
                {device.localName || device.name}
              </Text>
              <Text style={styles.connectedDeviceId}>{device.id}</Text>
              <View style={styles.disconnectButton}>
                <Button title="Disconnect" onPress={disconnect} color="#FF3B30" />
              </View>
          </View>

          <View style={styles.otaSection}>
            <Text style={styles.otaTitle}>Firmware Update</Text>
            {isUpdating ? (
              // Show the progress bar while updating
              <ProgressBar progress={progress} />
            ) : (
              // Show the start button when not updating
              <Button
                title={'Start OTA Update'}
                onPress={startOta}
                disabled={isUpdating}
              />
            )}
          </View>
        </>
      )}
    </View>
  );
};

export default ESPOTA;

/* ------------------------------ Styles ----------------------------- */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F0F7',
    padding: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
    color: '#1c1c1e',
  },
  scanButtonContainer: {
    marginHorizontal: 20,
    marginBottom: 15,
  },
  scanner: {
    marginVertical: 20,
  },
  // Device List Styles
  deviceRow: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginVertical: 6,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  deviceText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1c1c1e',
  },
  deviceDetailText: {
    fontSize: 13,
    color: '#8e8e93',
    marginTop: 4,
  },
  emptyListContainer: {
    marginTop: 50,
    alignItems: 'center',
  },
  emptyListText: {
    fontSize: 16,
    color: '#8e8e93',
  },
  emptyListSubText: {
    fontSize: 14,
    color: '#c7c7cc',
    marginTop: 8,
  },
  // Connected Device UI Styles
  connectedDeviceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  connectedTitle: {
      fontSize: 16,
      color: '#8e8e93',
      marginBottom: 8,
  },
  connectedDeviceName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#007AFF',
    marginBottom: 4,
  },
  connectedDeviceId: {
      fontSize: 14,
      color: '#3c3c43',
      marginBottom: 20,
  },
  disconnectButton: {
      width: '60%',
  },
  // OTA Section Styles
  otaSection: {
    marginTop: 30,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  otaTitle: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 20,
  },
  // Progress Bar Styles
  progressBarContainer: {
    height: 30,
    backgroundColor: '#e0e0e0',
    borderRadius: 15,
    justifyContent: 'center',
    overflow: 'hidden', // Ensures the fill stays within the rounded corners
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 15,
  },
  progressText: {
    position: 'absolute',
    width: '100%',
    textAlign: 'center',
    fontWeight: 'bold',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0, 0, 0, 0.25)',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 2,
  },
});
