import { ESPLoader, Transport } from "esptool-js";
import { DeviceInfo, espLoaderTerminal } from "../flash";
import { convertUint8ArrayToBinaryString } from "../utils";
import { NativeSerialPort } from "./typings";

export enum SerialPortState {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    DISCONNECTING
}

type SerialReader = (data: string) => void;
const FLASH_BAUD_RATE = 921600;

export class SerialPort {
    private serialPort: NativeSerialPort;
    private state: SerialPortState = SerialPortState.DISCONNECTED;
    private readers: SerialReader[] = [];
    private reader: ReadableStreamDefaultReader<Uint8Array>;
    private deviceInfo: DeviceInfo;

    constructor(serialPort: NativeSerialPort) {
        this.serialPort = serialPort;
    }

    getInfo = async () : Promise<DeviceInfo> => {
        if(this.deviceInfo) {
            return Promise.resolve(this.deviceInfo);
        }

        const transport = new Transport(this.serialPort);
        try {
            const loader = new ESPLoader(
                transport,
                FLASH_BAUD_RATE,
                espLoaderTerminal
            );
            await loader.main_fn();
    
            // We need to wait after connecting...
            await new Promise((f) => setTimeout(f, 2000));
            const flashId = await loader.read_flash_id();
            const flashIdLowbyte = (flashId >> 16) & 0xff;
    
            this.deviceInfo = {
                description: await loader.chip.get_chip_description(loader),
                features: await loader.chip.get_chip_features(loader),
                frequency: await loader.chip.get_crystal_freq(loader),
                mac: await loader.chip.read_mac(loader),
                manufacturer: (flashId & 0xff).toString(16),
                flashId: flashId,
                device:
                    ((flashId >> 8) & 0xff).toString(16) +
                    flashIdLowbyte.toString(16),
                flashSize: loader.DETECTED_FLASH_SIZES[flashIdLowbyte]
            };
    
            return Promise.resolve(this.deviceInfo);
        } finally {
            // Reset the controller
            await transport.setDTR(false);
            await new Promise((resolve) => setTimeout(resolve, 100));
            await transport.setDTR(true);
            await transport.disconnect();
        }
        return Promise.reject();
    }

    open = async (baudRate = 115200): Promise<void> => {
        if (this.state === SerialPortState.CONNECTED) {
            return Promise.reject("Already connected");
        }

        this.state = SerialPortState.CONNECTING;
        return this.serialPort.open({ baudRate }).then(() => {
            this.state = SerialPortState.CONNECTED;
            this.startReading();
        });
    };

    close = async (): Promise<void> => {
        if (this.state !== SerialPortState.CONNECTED) {
            return Promise.reject("Not connected");
        }

        this.state = SerialPortState.DISCONNECTING;
        if (this.serialPort.readable?.locked) {
            try {
                this.reader.cancel();
                this.reader.releaseLock();
            } catch (error) {
                // never mind
            }
        }

        return this.serialPort.close().then(() => {
            this.state = SerialPortState.DISCONNECTED;
        });
    };

    getState = (): SerialPortState => {
        return this.state;
    };

    getNativeSerialPort = () : NativeSerialPort => {
        return this.serialPort;
    }

    write = async (data: string): Promise<void> => {
        if (this.state !== SerialPortState.CONNECTED) {
            return Promise.reject("Not connected");
        }

        const encoder = new TextEncoder();
        const writer = this.serialPort.writable!.getWriter();
        return writer.write(encoder.encode(data)).finally(() => {
            writer.releaseLock();
        });
    };

    /**
     * Adds a reader that will be noitified everytime there is serial data:
     * @param reader
     */
    addReader = (reader: SerialReader) => {
        this.readers.push(reader);
    };

    private startReading = async () => {
        while (this.state === SerialPortState.CONNECTED) {
            if (!this.serialPort.readable) {
                continue;
            }

            this.reader = this.serialPort.readable.getReader();
            while (this.state === SerialPortState.CONNECTED) {
                const { value, done } = await this.reader.read();
                if (done) {
                    this.reader.releaseLock();
                    break;
                }
                if (value) {
                    this.readers.forEach((reader) =>
                        reader(convertUint8ArrayToBinaryString(value))
                    );
                }
            }
        }
    };
}
