/**
 * Mock SmartCard Platform for testing
 * Implements jsapdu-interface abstractions without requiring physical hardware
 * 
 * Reference: research/jsapdu/packages/interface/src/abstracts.ts
 */

import {
  SmartCardPlatform,
  SmartCardDevice,
  SmartCard,
  SmartCardDeviceInfo,
  CommandApdu,
  ResponseApdu,
  type NfcAntennaInfo
} from '@aokiapp/jsapdu-interface';

/**
 * Mock device information
 */
class MockDeviceInfo extends SmartCardDeviceInfo {
  constructor(
    public readonly id: string,
    public readonly friendlyName: string = 'Mock Smart Card Reader'
  ) {
    super();
  }

  readonly devicePath = undefined;
  readonly description = 'Mock device for testing';
  readonly supportsApdu = true;
  readonly supportsHce = false;
  readonly isIntegratedDevice = false;
  readonly isRemovableDevice = true;
  readonly d2cProtocol = 'iso7816' as const;
  readonly p2dProtocol = 'usb' as const;
  readonly apduApi = ['mock'];
  readonly antennaInfo = undefined;
}

/**
 * Mock SmartCard implementation
 * Returns predefined responses for testing
 */
class MockSmartCard extends SmartCard {
  private released = false;

  constructor(
    parentDevice: SmartCardDevice,
    private responses: Map<string, Uint8Array> = new Map()
  ) {
    super(parentDevice);
  }

  async getAtr(): Promise<Uint8Array> {
    this.assertNotReleased();
    // Minimal valid ATR
    return new Uint8Array([0x3B, 0x00]);
  }

  async transmit(apdu: CommandApdu): Promise<ResponseApdu>;
  async transmit(apdu: Uint8Array): Promise<Uint8Array>;
  async transmit(apdu: CommandApdu | Uint8Array): Promise<ResponseApdu | Uint8Array> {
    this.assertNotReleased();

    if (apdu instanceof CommandApdu) {
      // Check for predefined response
      const key = apdu.toHexString();
      const response = this.responses.get(key);
      
      if (response) {
        // Ensure proper ArrayBuffer type
        const bytes = new Uint8Array(response);
        return ResponseApdu.fromUint8Array(bytes as Uint8Array<ArrayBuffer>);
      }
      
      // Default: return success (9000)
      const emptyData = new Uint8Array(0);
      return new ResponseApdu(emptyData as Uint8Array<ArrayBuffer>, 0x90, 0x00);
    } else {
      // Raw bytes
      const key = Array.from(apdu, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      const response = this.responses.get(key);
      
      if (response) {
        return response;
      }
      
      // Default: return success
      return new Uint8Array([0x90, 0x00]);
    }
  }

  async reset(): Promise<void> {
    this.assertNotReleased();
    // Mock: no-op
  }

  async release(): Promise<void> {
    if (this.released) {
      return;
    }
    this.released = true;
  }

  private assertNotReleased(): void {
    if (this.released) {
      throw new Error('Card session already released');
    }
  }

  /**
   * Configure response for specific APDU command (for testing)
   */
  setResponse(command: string, response: Uint8Array): void {
    this.responses.set(command.toUpperCase(), response);
  }
}

/**
 * Mock SmartCard Device
 */
class MockSmartCardDevice extends SmartCardDevice {
  private cardSession: MockSmartCard | null = null;
  private released = false;
  private cardPresent = true;
  private responses: Map<string, Uint8Array>;

  constructor(
    parentPlatform: SmartCardPlatform,
    private deviceInfo: MockDeviceInfo,
    responses?: Map<string, Uint8Array>
  ) {
    super(parentPlatform);
    this.responses = responses ?? new Map();
  }

  getDeviceInfo(): SmartCardDeviceInfo {
    return this.deviceInfo;
  }

  isSessionActive(): boolean {
    return this.cardSession !== null;
  }

  async isDeviceAvailable(): Promise<boolean> {
    return !this.released;
  }

  async isCardPresent(): Promise<boolean> {
    this.assertNotReleased();
    return this.cardPresent;
  }

  async startSession(): Promise<SmartCard> {
    this.assertNotReleased();
    
    if (this.cardSession) {
      throw new Error('Session already active');
    }
    
    if (!this.cardPresent) {
      throw new Error('Card not present');
    }

    this.cardSession = new MockSmartCard(this, this.responses);
    return this.cardSession;
  }

  async waitForCardPresence(timeout: number): Promise<void> {
    this.assertNotReleased();
    
    if (this.cardPresent) {
      return;
    }
    
    // Simulate waiting
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timeout waiting for card'));
      }, timeout);
      
      // For mock, immediately resolve if card becomes present
      if (this.cardPresent) {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  async startHceSession(): Promise<never> {
    throw new Error('HCE not supported in mock platform');
  }

  async release(): Promise<void> {
    if (this.released) {
      return;
    }

    if (this.cardSession) {
      await this.cardSession.release();
      this.cardSession = null;
    }

    this.released = true;
  }

  private assertNotReleased(): void {
    if (this.released) {
      throw new Error('Device already released');
    }
  }

  /**
   * Control card presence (for testing)
   */
  setCardPresent(present: boolean): void {
    this.cardPresent = present;
    if (!present && this.cardSession) {
      // Auto-release session if card removed
      this.cardSession.release().catch(() => {});
      this.cardSession = null;
    }
  }

  /**
   * Configure response for specific APDU command (for testing)
   */
  setResponse(command: string, response: Uint8Array): void {
    this.responses.set(command.toUpperCase(), response);
  }
}

/**
 * Mock SmartCard Platform
 * Provides simulated card reader functionality for testing
 * Follows jsapdu-interface patterns exactly
 */
export class MockSmartCardPlatform extends SmartCardPlatform {
  private devices: Map<string, MockSmartCardDevice> = new Map();
  private deviceResponses: Map<string, Map<string, Uint8Array>> = new Map();

  constructor() {
    super();
  }

  async init(force?: boolean): Promise<void> {
    if (!force) {
      this.assertNotInitialized();
    }

    // Set initialized flag BEFORE creating devices
    // SmartCardDevice constructor calls assertInitialized() on parent
    this.initialized = true;

    // Now create default mock device
    const deviceInfo = new MockDeviceInfo('mock-device-1', 'Mock Reader 1');
    const device = new MockSmartCardDevice(
      this,
      deviceInfo,
      this.deviceResponses.get(deviceInfo.id)
    );
    this.devices.set(deviceInfo.id, device);
  }

  async release(force?: boolean): Promise<void> {
    if (!force) {
      this.assertInitialized();
    }

    // Release all devices
    const releasePromises = Array.from(this.devices.values()).map(device =>
      device.release().catch(() => {})
    );
    await Promise.allSettled(releasePromises);

    this.devices.clear();
    this.initialized = false;
  }

  async getDeviceInfo(): Promise<SmartCardDeviceInfo[]> {
    this.assertInitialized();
    return Array.from(this.devices.values()).map(device => device.getDeviceInfo());
  }

  async acquireDevice(id: string): Promise<SmartCardDevice> {
    this.assertInitialized();
    
    const existingDevice = this.devices.get(id);
    if (!existingDevice) {
      throw new Error(`Device not found: ${id}`);
    }

    // If device was released, create new instance
    // This allows re-acquiring devices after release (important for sequential sessions)
    const isAvailable = await existingDevice.isDeviceAvailable();
    if (!isAvailable) {
      const deviceInfo = existingDevice.getDeviceInfo();
      const newDevice = new MockSmartCardDevice(
        this,
        deviceInfo as MockDeviceInfo,
        this.deviceResponses.get(id)
      );
      this.devices.set(id, newDevice);
      return newDevice;
    }

    return existingDevice;
  }

  /**
   * Add additional mock device (for testing multi-reader scenarios)
   */
  addMockDevice(id: string, friendlyName?: string): void {
    if (!this.initialized) {
      throw new Error('Platform not initialized');
    }

    const deviceInfo = new MockDeviceInfo(id, friendlyName);
    const device = new MockSmartCardDevice(
      this,
      deviceInfo,
      this.deviceResponses.get(id)
    );
    this.devices.set(id, device);
  }

  /**
   * Configure response for specific device and APDU command (for testing)
   */
  setDeviceResponse(deviceId: string, command: string, response: Uint8Array): void {
    let deviceResponses = this.deviceResponses.get(deviceId);
    if (!deviceResponses) {
      deviceResponses = new Map();
      this.deviceResponses.set(deviceId, deviceResponses);
    }
    deviceResponses.set(command.toUpperCase(), response);

    // Update existing device if already created
    const device = this.devices.get(deviceId);
    if (device) {
      device.setResponse(command, response);
    }
  }

  /**
   * Control card presence for specific device (for testing)
   */
  setCardPresent(deviceId: string, present: boolean): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.setCardPresent(present);
    }
  }
}