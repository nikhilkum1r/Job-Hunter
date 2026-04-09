import * as winston from 'winston';
import { EventEmitter } from 'events';
import { Writable } from 'stream';

// Create a global event emitter for log events
export const logEmitter = new EventEmitter();

// Create a writable stream that emits lines to our EventEmitter
const logStream = new Writable({
    write(chunk, encoding, callback) {
        logEmitter.emit('new-log', chunk.toString().trim());
        callback();
    }
});

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'horizon.log' }),
        new winston.transports.Stream({ stream: logStream })
    ]
});

export default logger;
