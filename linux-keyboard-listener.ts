import * as fs from 'fs';
import * as EventEmitter from 'events';
import { Keys } from './constant/keys.constant';
import { Events } from './constant/events.constant';
import Characters from './constant/characters.constant';
// import { Chars, ShiftedChars, ShiftKeys } from './constant/characters.constant';
// import { Chars, ShiftedChars, ShiftKeys } as ;

// Event: require(`${__dirname}/constant/events.constant.ts`),
// Key: require(`${__dirname}/constant/keys.constant.ts`),
// Character: require(`${__dirname}/constant/characters.constant.ts`),

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @class _KeyboardListener
 * */
class _KeyboardListener extends EventEmitter {
    public last: any;
    public delimiter: any;
    public on: any;
    public debounce: any;
    public ErrorCode: any;
    public length: any;
    public is64bit: any;
    public size: any;
    public Event: any;
    public Key: any;
    public code: any;
    public value: any;
    public Chars: any;
    public ShiftedChars: any;
    public ShiftKeys: any;
    private _SysInfo: any;
    private _line: any;
    private _interval: any;
    private _path: any;
    public isOpen: any;
    private _forceClose: any;
    public emit: any;
    private _fd: any;
    private _stream: any;
    static Constants = {
        Event: Events,
        Key: Keys,
        Character: Characters,
        // Event: require(`${__dirname}/constant/events.constant.js`),
        // Key: require(`${__dirname}/constant/keys.constant.js`),
        // Character: require(`${__dirname}/constant/characters.constant.js`),
        ErrorCode: {
            BlockedClosing: 0x01,
            MaxOpenAttempt: 0x02,
            Stream: 0x04,
        },
    };

    /**
     * List all available device paths from devpath
     * @static
     * @params {Regex} [regex] - regex to filter outpur
     * @params {string} [devpath=/dev/path] - parent path to read
     * @returns {string[]} list of available paths
     * */
    static async listDevice(regex, devpath = '/dev/input') {
        const devices: string[] = [];

        const exists = await fs.promises
            .stat(devpath)
            .then((error) => true)
            .catch((error) => false);

        if (!exists) return devices;

        const list = await fs.promises.readdir(devpath, {
            recursive: true,
            withFileTypes: true,
        });

        for (const item of list) {
            const fullpath: string = `${item.path}/${item.name}`;
            const valid = item.isCharacterDevice() || item.isSymbolicLink();
            const filtered = regex === undefined ? true : fullpath.match(regex);

            if (valid && filtered) devices.push(fullpath);
        }

        return devices;
    }

    constructor(options = {}) {
        super();

        if (options) this.init(options);
    }

    /**
     * Check system architecture is 64-bit or 32-bit.
     * Byte size for 'long' is different between 64 and 32 bit.
     * It's used to determine input event struct size which has timespec variable.
     * The struct for input event is shown below
     *
     * struct input_event {
     * 	struct timeval time;
     * 	__u16 type;
     * 	__u16 code;
     * 	__s32 value;
     * };
     *
     * @private
     * */
    _detectSytem() {
        const is64bit = process.arch.includes('64');
        this._SysInfo = {
            is64bit,
            size: {
                struct: is64bit ? 24 : 16,
                long: is64bit ? 8 : 4,
                timespec: is64bit ? 16 : 8,
            },
        };
    }

    /**
     * Initialize class properies
     * @params {Object} options - configuration
     * @params {string} options.path - Path to selected input event device
     * @params {number} [options.interval=1000] - interval between attempt to check dev path is accessible, in ms
     * @params {Object} [options.readline] - if defined, then will activated parse by line
     * */
    init(options: any = {}) {
        this._detectSytem();

        this.setPath(options.path);
        this.setInterval(options.interval);

        if (options.readline) this.readline(options.readline);

        return this;
    }

    /**
     * Parse incoming data into delimited string
     * @params {string} [options.delimiter='\n'] - delimiter character
     * @params {string} [options.on='keydown'] - read character on 'keydown' or 'keyup'
     * @params {number} [options.debounce=100] - delay in ms between line to avoid double line reading
     * */
    readline(options: any = {}) {
        const { delimiter, on, debounce } = options;

        this._line = {
            delimiter: delimiter || '\n',
            debounce: debounce || 100,
            on: on || 'keydown',
            message: '',
            shiftPressed: false,
            timer: {
                last: Date.now(),
                get diff() {
                    return Date.now() - this.last;
                },
            },
        };

        return this;
    }

    /**
     * set ms interval between attempt to open path
     * @params {number} [ms=1000] - interval in milliseconds
     * */
    setInterval(ms = 1000) {
        this._interval = ms;
        return this;
    }

    /**
     * set dev input path to listen
     * @params {string} devpath - path to dev input
     * */
    setPath(devpath) {
        this._path = devpath;
        return this;
    }

    /**
     * restart listener, if devpath is defined, then open new stream with that path
     * @params {string} [devpath] - new devpath if needed
     * */
    async restart(devpath) {
        await this.close();

        if (typeof devpath === 'string') this.setPath(devpath);

        return this.open();
    }

    /**
     * Stop listener and remove handlers
     * */
    async close() {
        if (!this.isOpen) return this;

        this._forceClose = true;
        this.isOpen = false;

        // https://nodejs.org/api/fs.html#filehandlecreatereadstreamoptions
        const { ErrorCode } = _KeyboardListener.Constants;
        const blocked = setTimeout(
            () =>
                this.emit('error', {
                    code: ErrorCode.BlockedClosing,
                    error: "Can't finish until data is available from old device",
                }),
            this._interval,
        );

        // read stream is auto closed when file handle is closed
        await this._fd.close();

        clearTimeout(blocked);

        return this;
    }

    /**
     * Start listener
     * */
    async open() {
        // don't try to open if stream is already opened
        if (this.isOpen) return this;

        this.isOpen = false;
        this._forceClose = false;

        const attempt = {
            counter: 0,
            max: 5,
        };
        const { ErrorCode } = _KeyboardListener.Constants;

        // wait until dev path exist
        while (!this.isOpen) {
            this.isOpen = await fs.promises
                .stat(this._path)
                .then((error) => true)
                .catch((error) => false);

            // no need to sleep if path is accessible
            if (!this.isOpen) {
                if (attempt.counter++ >= attempt.max) {
                    attempt.counter = 0;
                    this.emit('error', {
                        code: ErrorCode.MaxOpenAttempt,
                        error: `Can\'t open '${this._path}'!`,
                    });
                }

                await sleep(this._interval);
            }

            if (this._forceClose) return this;
        }

        this._fd = ((await fs.promises.open(this._path, 'r')) as any).on('close', () => {
            this.emit('close', this._path);

            // reopen the read stream, if not forced
            if (!this._forceClose) this.open();
        });

        this._stream = this._fd
            .createReadStream({ encoding: null })
            .on('data', (buffer) => this._parseBuffer(buffer))
            .on('error', (error) =>
                this.emit('error', {
                    code: ErrorCode.Stream,
                    error,
                }),
            );

        this.emit('open', this._path);

        return this;
    }

    /**
     * Parse incoming buffer.
     * Received bytes might contains more than just one input event.
     * each parsed event will be passed to _parseInput.
     * @private
     * @params {Buffer} buffer - received bytes
     * */
    _parseBuffer(buffer) {
        const { length } = buffer;
        const { is64bit, size } = this._SysInfo;

        for (let offset = 0; offset < length; offset += size.struct) {
            this._parseInput({
                timespec: {
                    tv_sec: is64bit ? buffer.readBigInt64LE(offset) : buffer.readInt32LE(offset),
                    tv_usec: is64bit
                        ? buffer.readBigInt64LE(offset + size.long)
                        : buffer.readInt32LE(offset + size.long),
                },
                type: buffer.readUInt16LE(offset + size.timespec),
                code: buffer.readUInt16LE(offset + size.timespec + 2),
                value: buffer.readInt32LE(offset + size.timespec + 4),
            });
        }
    }

    /**
     * Parse an input event.
     * If readline is active, then on every 'EV_KEY' event will be passed to _parseLine.
     * @private
     * @fires _KeyboardListener#data
     * @params {Object} data - input event struct as an object
     * */
    _parseInput(data) {
        const { Event, Key } = _KeyboardListener.Constants;

        const res = {
            type: Event[data.type],
            code: Event[data.type] === 'EV_MSC' ? data.code : Key[data.code],
            value: data.value,
        };

        /**
         * Input event
         * @event _KeyboardListener#data
         * @type {Object}
         * @property {string} type - input event type
         * @property {string|number} code - input event code
         * @property {number} value - input event value
         * */
        this.emit('data', res);

        if (this._line && res.type === 'EV_KEY') this._parseLine(res);
    }

    /**
     * Parse an keypress input event into corresponding keyboard key's character.
     * Emit event if delimiter character is found.
     * @private
     * @fires _KeyboardListener#readline
     * @params {Object} data - parsed input event
     * */
    _parseLine(data) {
        const { delimiter, on } = this._line;
        const { code, value } = data;

        const { Chars, ShiftedChars, ShiftKeys } = _KeyboardListener.Constants.Character;
        const isFired = (on === 'keyup' && !value) || (on !== 'keyup' && value | (value >> 1)); //BUG FIX, bug was _line.shiftPressed = true on not fired keyshift
        if (!isFired) return;

        if (!this._line.shiftPressed && ShiftKeys[code]) {
            this._line.shiftPressed = true;
            return; //IT WONT RETURN IF SHIFT PRESSED on THE FOLLOWING SHIFT KEYS
        }
        if (ShiftKeys[code]) {
            //FIX IS HERE
            this._line.shiftPressed = true;
            return; //MY FIX
        }

        // const isFired = (on === 'keyup' && !value) || (on !== 'keyup' && value | (value >> 1)); //ANOTHER BUG, not fired shift changed _line.shiftPressed!!!!

        // if (!isFired) return;

        // if(this._line.shiftPressed && ShiftKeys[code]){
        // 	console.log("SHIFTED: ", ShiftKeys[code])
        // }

        // console.log("CODE: ", code)
        const char =
            this._line.shiftPressed && ShiftedChars[code] ? ShiftedChars[code] : Chars[code];

        this._line.shiftPressed = false; //We also can move this after !char to fix this BUG

        if (!char) return;

        if (char === delimiter) {
            if (this._line.timer.diff > this._line.debounce) {
                /**
                 * Readline event
                 * @event _KeyboardListener#readline
                 * @param {string} - delimited string
                 * */
                this.emit('readline', this._line.message);
            }

            this._line.message = '';
            this._line.timer.last = Date.now();

            return;
        }

        this._line.message += char;
    }
}

// module.exports = _KeyboardListener;
const KeyboardListener = _KeyboardListener;
export default KeyboardListener;
