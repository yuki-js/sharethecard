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
  type NfcAntennaInfo,
} from "@aokiapp/jsapdu-interface";

/**
 * Mock device information
 */
class MockDeviceInfo extends SmartCardDeviceInfo {
  constructor(
    public readonly id: string,
    public readonly friendlyName: string = "Mock Smart Card Reader",
  ) {
    super();
  }

  readonly devicePath = undefined;
  readonly description = "Mock device for testing";
  readonly supportsApdu = true;
  readonly supportsHce = false;
  readonly isIntegratedDevice = false;
  readonly isRemovableDevice = true;
  readonly d2cProtocol = "iso7816" as const;
  readonly p2dProtocol = "usb" as const;
  readonly apduApi = ["mock"];
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
    private responses: Map<string, Uint8Array> = new Map(),
  ) {
    super(parentDevice);
    // デフォルトレスポンスを設定
    this.setupDefaultResponses();
  }

  /**
   * テスト用のデフォルトレスポンスを設定
   */
  private setupDefaultResponses(): void {
    // SELECT File (00 A4 04 00 08 A0 00 00 00 03 00 00 00)
    this.responses.set(
      "00A4040008A000000003000000",
      new Uint8Array([0x90, 0x00]) // Success
    );

    // GET DATA (00 CA 00 00 00)
    this.responses.set(
      "00CA000000",
      new Uint8Array([
        // Data: "MOCK" in ASCII
        0x4D, 0x4F, 0x43, 0x4B,
        // SW: 9000
        0x90, 0x00
      ])
    );

    // READ BINARY (00 B0 00 00 10) - Read 16 bytes
    this.responses.set(
      "00B0000010",
      new Uint8Array([
        // 16 bytes of test data
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
        0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10,
        // SW: 9000
        0x90, 0x00
      ])
    );

    // READ BINARY (short APDU) - Le=256 encoded as 0x00
    // Matches CommandApdu with Le=256 used in integration tests
    this.responses.set(
      "00B0000000",
      new Uint8Array([
        // SW: 9000 (no data payload required by tests)
        0x90, 0x00
      ])
    );

    // READ BINARY (extended APDU) - Le=256 (0x0100) with extended marker 0x00
    // Format: CLA INS P1 P2 00 Le1 Le2 => 00 B0 00 00 00 01 00
    this.responses.set(
      "00B00000000100",
      new Uint8Array([
        // SW: 9000 (no data payload required by tests)
        0x90, 0x00
      ])
    );

    // READ BINARY (extended APDU) - Le=4096 (0x1000) with extended marker 0x00
    // Format: CLA INS P1 P2 00 Le1 Le2 => 00 B0 00 00 00 10 00
    this.responses.set(
      "00B00000001000",
      new Uint8Array([
        // SW: 9000 (no data payload required by tests)
        0x90, 0x00
      ])
    );

    // VERIFY PIN incorrect (00 20 00 00 04 31 32 33 34) - Returns 63CX (X retries left)
    this.responses.set(
      "002000000431323334",
      new Uint8Array([0x63, 0xC2]) // 2 retries left
    );

    // GET CHALLENGE (00 84 00 00 08) - Returns 8 random bytes
    this.responses.set(
      "0084000008",
      new Uint8Array([
        // 8 random bytes
        0xAB, 0xCD, 0xEF, 0x01, 0x23, 0x45, 0x67, 0x89,
        // SW: 9000
        0x90, 0x00
      ])
    );

    // File not found (00 A4 00 00 02 FF FF)
    this.responses.set(
      "00A4000002FFFF",
      new Uint8Array([0x6A, 0x82]) // File not found
    );

    // Wrong length (00 C0 00 00 00) - Get Response with wrong Le
    this.responses.set(
      "00C0000000",
      new Uint8Array([0x6C, 0x10]) // Correct length is 0x10
    );

    // Security not satisfied (00 D0 00 00 04 01 02 03 04)
    this.responses.set(
      "00D000000401020304",
      new Uint8Array([0x69, 0x82]) // Security status not satisfied
    );
  }

  async getAtr(): Promise<Uint8Array> {
    this.assertNotReleased();
    // Minimal valid ATR
    return new Uint8Array([0x3b, 0x00]);
  }

  async transmit(apdu: CommandApdu): Promise<ResponseApdu>;
  async transmit(apdu: Uint8Array): Promise<Uint8Array>;
  async transmit(
    apdu: CommandApdu | Uint8Array,
  ): Promise<ResponseApdu | Uint8Array> {
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

      // Default (strict ISO7816 behavior): return appropriate error SW
      const emptyData = new Uint8Array(0);
      const cla = parseInt(key.slice(0, 2), 16);
      if (cla !== 0x00 && cla !== 0x80) {
        // CLA not supported
        return new ResponseApdu(emptyData as Uint8Array<ArrayBuffer>, 0x6E, 0x00);
      }
      // INS not supported
      return new ResponseApdu(emptyData as Uint8Array<ArrayBuffer>, 0x6D, 0x00);
    } else {
      // Raw bytes
      const key = Array.from(apdu, (b) => b.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
      const response = this.responses.get(key);

      if (response) {
        return response;
      }

      // Default (strict ISO7816 behavior): return appropriate error SW
      const cla = apdu[0] ?? 0x00;
      if (cla !== 0x00 && cla !== 0x80) {
        // CLA not supported
        return new Uint8Array([0x6E, 0x00]);
      }
      // INS not supported
      return new Uint8Array([0x6D, 0x00]);
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
      throw new Error("Card session already released");
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
    responses?: Map<string, Uint8Array>,
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
      throw new Error("Session already active");
    }

    if (!this.cardPresent) {
      throw new Error("Card not present");
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
        reject(new Error("Timeout waiting for card"));
      }, timeout);

      // For mock, immediately resolve if card becomes present
      if (this.cardPresent) {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  async startHceSession(): Promise<never> {
    throw new Error("HCE not supported in mock platform");
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
      throw new Error("Device already released");
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
    const deviceInfo = new MockDeviceInfo("mock-device-1", "Mock Reader 1");
    const device = new MockSmartCardDevice(
      this,
      deviceInfo,
      this.deviceResponses.get(deviceInfo.id),
    );
    this.devices.set(deviceInfo.id, device);
  }

  async release(force?: boolean): Promise<void> {
    if (!force) {
      this.assertInitialized();
    }

    // Release all devices
    const releasePromises = Array.from(this.devices.values()).map((device) =>
      device.release().catch(() => {}),
    );
    await Promise.allSettled(releasePromises);

    this.devices.clear();
    this.initialized = false;
  }

  async getDeviceInfo(): Promise<SmartCardDeviceInfo[]> {
    this.assertInitialized();
    return Array.from(this.devices.values()).map((device) =>
      device.getDeviceInfo(),
    );
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
        this.deviceResponses.get(id),
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
      throw new Error("Platform not initialized");
    }

    const deviceInfo = new MockDeviceInfo(id, friendlyName);
    const device = new MockSmartCardDevice(
      this,
      deviceInfo,
      this.deviceResponses.get(id),
    );
    this.devices.set(id, device);
  }

  /**
   * Configure response for specific device and APDU command (for testing)
   */
  setDeviceResponse(
    deviceId: string,
    command: string,
    response: Uint8Array,
  ): void {
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
